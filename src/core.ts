// For more information, see https://crawlee.dev/
import {
	Configuration,
	Dataset,
	downloadListOfUrls,
	PlaywrightCrawler,
} from 'crawlee';
import { randomBytes } from 'crypto';
import { PathLike } from 'fs';
import { mkdir, rm, writeFile } from 'fs/promises';
import { isWithinTokenLimit } from 'gpt-tokenizer';
import { minimatch } from 'minimatch';
import { basename, dirname, join } from 'path';
import { Page } from 'playwright';
import { globalConfig } from './config.js';
import logger from './logger.js';
import {
	Config,
	configSchema,
	CrawledData,
	generateOutputFileName,
} from './schema.js';

let pageCounter = 0;

// Internal type for configs with dataset name (required for all crawls)
type ConfigWithDataset = Config & { datasetName: string };

/**
 * Extract text content from a page using CSS or XPath selector
 */
export function getPageHtml(page: Page, selector = 'body') {
	return page.evaluate((selector) => {
		// Check if the selector is an XPath
		if (selector.startsWith('/')) {
			const elements = document.evaluate(
				selector,
				document,
				null,
				XPathResult.ANY_TYPE,
				null
			);
			let result = elements.iterateNext();
			return result ? result.textContent || '' : '';
		} else {
			// Handle as a CSS selector
			const el = document.querySelector(selector) as HTMLElement | null;
			return el?.innerText || '';
		}
	}, selector);
}

/**
 * Expand exclude patterns to match both the path and all subpaths
 * Example: /support becomes ['/support', '/support/**']
 * Patterns with wildcards are kept as-is to avoid breaking glob semantics
 */
function expandExcludePatterns(patterns: string[]): string[] {
	const expanded = new Set<string>();

	for (const pattern of patterns) {
		// Always add the original pattern
		expanded.add(pattern);

		// Only add /** variant for plain directory paths (no wildcards)
		if (!pattern.includes('*') && !pattern.endsWith('/')) {
			expanded.add(`${pattern}/**`);
		}
	}

	return Array.from(expanded);
}

/**
 * Normalize and expand exclude patterns from config
 * Handles both string and array inputs, and expands patterns for subpath matching
 */
function normalizeAndExpandExcludes(exclude?: string | string[]): string[] {
	const patterns = typeof exclude === 'string' ? [exclude] : (exclude ?? []);
	return expandExcludePatterns(patterns);
}

/**
 * Discover seed URLs by extracting links from navigation elements
 * Filters discovered URLs by match pattern to only include relevant links
 */
async function discoverNavigationUrls(
	page: Page,
	discoverySelector: string,
	matchPatterns: string[],
	excludePatterns: string[]
): Promise<string[]> {
	// Extract all links from navigation elements
	const navUrls = await page.evaluate((selector) => {
		const navElements = document.querySelectorAll(selector);
		const urls: string[] = [];

		navElements.forEach((nav) => {
			const links = nav.querySelectorAll('a[href]');
			links.forEach((link) => {
				const href = (link as HTMLAnchorElement).href;
				if (href && !href.startsWith('javascript:') && !href.startsWith('#')) {
					urls.push(href);
				}
			});
		});

		return Array.from(new Set(urls)); // Remove duplicates
	}, discoverySelector);

	// Expand exclude patterns to match both paths and subpaths
	const expandedExcludes = expandExcludePatterns(excludePatterns);

	// Filter URLs by match patterns using minimatch glob matching
	const filteredUrls = navUrls.filter((url) => {
		// Check if URL matches any include pattern
		const matchesInclude = matchPatterns.some((pattern) =>
			minimatch(url, pattern)
		);
		if (!matchesInclude) {
			return false;
		}
		// Check if URL matches any exclude pattern
		const matchesExclude = expandedExcludes.some((pattern) =>
			minimatch(url, pattern)
		);
		return !matchesExclude;
	});

	return filteredUrls;
}

export async function waitForXPath(page: Page, xpath: string, timeout: number) {
	await page.waitForFunction(
		(xpath) => {
			const elements = document.evaluate(
				xpath,
				document,
				null,
				XPathResult.ANY_TYPE,
				null
			);
			return elements.iterateNext() !== null;
		},
		xpath,
		{ timeout }
	);
}

export async function crawl(config: ConfigWithDataset) {
	configSchema.parse(config);

	if (process.env.NO_CRAWL !== 'true') {
		// Create isolated storage directory for this job
		const storageDir =
			config.storageDir ||
			join(process.cwd(), 'storage', 'jobs', config.datasetName);

		// Ensure storage directory exists
		await mkdir(storageDir, { recursive: true });

		// PlaywrightCrawler crawls the web using a headless
		// browser controlled by the Playwright library.
		const crawler = new PlaywrightCrawler(
			{
				// Use the requestHandler to process each of the crawled pages.
				async requestHandler({ request, page, enqueueLinks, log, pushData }) {
					const title = await page.title();
					pageCounter++;
					const maxPages = globalConfig.maxPagesToCrawl === 'unlimited'
						? 'unlimited'
						: globalConfig.maxPagesToCrawl;
					log.info(
						`Crawling: Page ${pageCounter} / ${maxPages} - URL: ${request.loadedUrl}...`
					);

					// Use custom handling for XPath selector
					if (config.selector) {
						if (config.selector.startsWith('/')) {
							await waitForXPath(
								page,
								config.selector,
								config.waitForSelectorTimeout ?? 5000
							);
						} else {
							await page.waitForSelector(config.selector, {
								timeout: config.waitForSelectorTimeout ?? 5000,
							});
						}
					}

					const html = await getPageHtml(page, config.selector);

					// Save results as JSON to ./storage/datasets/default
					await pushData({ title, url: request.loadedUrl, html });

					if (config.onVisitPage) {
						await config.onVisitPage({ page, pushData });
					}

					// Extract links from the current page
					// and add them to the crawling queue.
					await enqueueLinks({
						globs:
							typeof config.match === 'string' ? [config.match] : config.match,
						exclude: normalizeAndExpandExcludes(config.exclude),
					});
				},
				// Set max requests per crawl (undefined = unlimited)
				...(globalConfig.maxPagesToCrawl !== 'unlimited' && {
					maxRequestsPerCrawl: globalConfig.maxPagesToCrawl,
				}),
				// Limit concurrent requests per crawler to reduce memory usage
				maxConcurrency: 2,
				// Add retry configuration
				maxRequestRetries: 2,
				// Uncomment this option to see the browser window.
				// headless: false,
				preNavigationHooks: [
					// Abort requests for certain resource types and add cookies
					async (crawlingContext, _gotoOptions) => {
						const { request, page, log } = crawlingContext;
						// Add cookies to the page
						// Because the crawler has not yet navigated to the page, so the loadedUrl is always undefined. Use the request url instead.
						if (config.cookie) {
							const cookies = (
								Array.isArray(config.cookie) ? config.cookie : [config.cookie]
							).map((cookie) => {
								return {
									name: cookie.name,
									value: cookie.value,
									url: request.url,
								};
							});
							await page.context().addCookies(cookies);
						}
						const RESOURCE_EXCLUSTIONS = config.resourceExclusions ?? [];
						// If there are no resource exclusions, return
						if (RESOURCE_EXCLUSTIONS.length === 0) {
							return;
						}
						await page.route(
							`**\/*.{${RESOURCE_EXCLUSTIONS.join()}}`,
							(route) => route.abort('aborted')
						);
						log.info(
							`Aborting requests for as this is a resource excluded route`
						);
					},
				],
			},
			new Configuration({
				// Don't purge on start - dangerous with concurrent jobs
				purgeOnStart: false,
				defaultDatasetId: config.datasetName,
				// Use isolated storage directory per job
				persistStorage: true,
				storageClientOptions: {
					localDataDirectory: storageDir,
				},
			})
		);

		// Collect all seed URLs (user-provided + discovered)
		let seedUrls = [config.entry];

		// Navigation discovery phase (if enabled)
		const autoDiscoverNav = config.autoDiscoverNav ?? true;
		if (autoDiscoverNav) {
			try {
				logger.info('Starting navigation discovery phase...');
				const { chromium } = await import('playwright');
				const browser = await chromium.launch({ headless: true });
				const context = await browser.newContext();
				const page = await context.newPage();

				// Apply cookies if configured
				if (config.cookie) {
					const cookies = (
						Array.isArray(config.cookie) ? config.cookie : [config.cookie]
					).map((cookie) => ({
						name: cookie.name,
						value: cookie.value,
						url: config.entry,
					}));
					await context.addCookies(cookies);
				}

				// Load entry point URL and discover nav links
				await page.goto(config.entry, { waitUntil: 'domcontentloaded' });
				const matchPatterns = Array.isArray(config.match)
					? config.match
					: [config.match];
				const excludePatterns =
					typeof config.exclude === 'string'
						? [config.exclude]
						: (config.exclude ?? []);
				const discoverySelector =
					config.discoverySelector ?? "nav, aside, [role='navigation']";
				const discoveredUrls = await discoverNavigationUrls(
					page,
					discoverySelector,
					matchPatterns,
					excludePatterns
				);

				await browser.close();

				logger.info(
					{ count: discoveredUrls.length },
					`Discovered ${discoveredUrls.length} URLs from navigation`
				);

				// Merge with user-provided URLs (remove duplicates)
				seedUrls = Array.from(new Set([...seedUrls, ...discoveredUrls]));

				// Filter out excluded URLs
				const expandedExcludes = expandExcludePatterns(excludePatterns);
				seedUrls = seedUrls.filter((url) => {
					return !expandedExcludes.some((pattern) => minimatch(url, pattern));
				});
				logger.info(
					{ total: seedUrls.length },
					`Total seed URLs: ${seedUrls.length}`
				);
			} catch (error) {
				logger.warn(
					{ error: error instanceof Error ? error.message : error },
					'Navigation discovery failed, continuing with provided URLs'
				);
			}
		}

		// Check if any URL is a sitemap
		const sitemapUrls = seedUrls.filter((url) => /sitemap.*\.xml$/.test(url));

		if (sitemapUrls.length > 0) {
			// Handle sitemap URLs
			for (const sitemapUrl of sitemapUrls) {
				const listOfUrls = await downloadListOfUrls({ url: sitemapUrl });
				await crawler.addRequests(listOfUrls);
			}

			// Add non-sitemap URLs
			const regularUrls = seedUrls.filter(
				(url) => !/sitemap.*\.xml$/.test(url)
			);
			if (regularUrls.length > 0) {
				await crawler.addRequests(regularUrls);
			}

			await crawler.run();
		} else {
			// Regular crawling with all seed URLs
			await crawler.run(seedUrls);
		}
	}
}

export async function write(
	config: ConfigWithDataset
): Promise<PathLike | null> {
	let nextFileNameString: PathLike | null = null;

	// Determine storage directory
	const storageDir =
		config.storageDir ||
		join(process.cwd(), 'storage', 'jobs', config.datasetName);

	// Open the dataset for this crawl with the same storage configuration
	const dataset = await Dataset.open(config.datasetName, {
		storageClient: new Configuration({
			storageClientOptions: {
				localDataDirectory: storageDir,
			},
		}).getStorageClient(),
	});
	const itemCount = (await dataset.getInfo())?.itemCount || 0;
	logger.info(
		{ itemCount },
		`Found ${itemCount} items in dataset to process...`
	);

	let currentResults: CrawledData[] = [];
	let currentSize: number = 0;
	let fileCounter: number = 1;
	const maxBytes: number = config.maxFileSize
		? config.maxFileSize * 1024 * 1024
		: Infinity;

	const getStringByteSize = (str: string): number =>
		Buffer.byteLength(str, 'utf-8');

	const nextFileName = (): string =>
		`${config.outputFileName!.replace(/\.json$/, '')}-${fileCounter}.json`;

	const writeBatchToFile = async (): Promise<void> => {
		nextFileNameString = nextFileName();
		// Ensure the output directory exists before writing the file
		const dir = dirname(nextFileNameString as string);
		await mkdir(dir, { recursive: true });
		await writeFile(
			nextFileNameString,
			JSON.stringify(currentResults, null, 2)
		);
		logger.info(
			{ count: currentResults.length, file: nextFileNameString },
			`Wrote ${currentResults.length} items to ${nextFileNameString}`
		);
		currentResults = [];
		currentSize = 0;
		fileCounter++;
	};

	let estimatedTokens: number = 0;

	const addContentOrSplit = async (data: CrawledData): Promise<void> => {
		const contentString: string = JSON.stringify(data);

		// Skip token limit checks if unlimited
		if (globalConfig.maxTokens !== 'unlimited') {
			const tokenCount: number | false = isWithinTokenLimit(
				contentString,
				globalConfig.maxTokens
			);

			if (typeof tokenCount === 'number') {
				if (estimatedTokens + tokenCount > globalConfig.maxTokens) {
					// Only write the batch if it's not empty (something to write)
					if (currentResults.length > 0) {
						await writeBatchToFile();
					}
					// Since the addition of a single item exceeded the token limit, halve it.
					estimatedTokens = Math.floor(tokenCount / 2);
					currentResults.push(data);
				} else {
					currentResults.push(data);
					estimatedTokens += tokenCount;
				}
			}
		} else {
			// No token limit - just add the data
			currentResults.push(data);
		}

		currentSize += getStringByteSize(contentString);
		if (currentSize > maxBytes) {
			await writeBatchToFile();
		}
	};

	// Process data from dataset
	await dataset.forEach(async (item) => {
		const data: CrawledData = item as CrawledData;
		await addContentOrSplit(data);
	});

	// Check if any remaining data needs to be written to a file.
	if (currentResults.length > 0) {
		// If this is the first and only batch, don't add a suffix
		if (fileCounter === 1) {
			const finalFileName = config.outputFileName!;
			const dir = dirname(finalFileName);
			await mkdir(dir, { recursive: true });
			await writeFile(finalFileName, JSON.stringify(currentResults, null, 2));
			logger.info(
				{ count: currentResults.length, file: finalFileName },
				`Wrote ${currentResults.length} items to ${finalFileName}`
			);
			nextFileNameString = finalFileName;
		} else {
			await writeBatchToFile();
		}
	}

	return nextFileNameString;
}

/**
 * Clean up storage directory for a specific job
 */
export async function cleanupJobStorage(
	datasetName: string,
	storageDir?: string
): Promise<void> {
	try {
		const targetDir =
			storageDir || join(process.cwd(), 'storage', 'jobs', datasetName);

		// Check if directory exists before attempting to remove
		try {
			await rm(targetDir, { recursive: true, force: true });
			logger.debug(
				{ storageDir: targetDir },
				'Cleaned up job storage directory'
			);
		} catch (error) {
			// Ignore ENOENT errors (directory doesn't exist)
			if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
				throw error;
			}
		}
	} catch (error) {
		logger.warn(
			{ datasetName, error: error instanceof Error ? error.message : error },
			'Failed to clean up job storage'
		);
	}
}

class ContextCrawlerCore {
	config: Config;
	datasetName: string;
	storageDir: string;

	constructor(config: Config) {
		// Sanitize outputFileName to prevent path traversal attacks
		const sanitizedFileName = config.outputFileName
			? join('output/jobs', basename(config.outputFileName))
			: generateOutputFileName(config.name);

		// Auto-generate outputFileName from task name if not provided
		this.config = {
			...config,
			outputFileName: sanitizedFileName,
		};
		// Generate a unique dataset name to isolate this crawl's data
		this.datasetName = `ds-${randomBytes(4).toString('hex')}`;
		// Set the storage directory for this job
		this.storageDir = join(process.cwd(), 'storage', 'jobs', this.datasetName);
	}

	async crawl() {
		const configWithDataset: ConfigWithDataset = {
			...this.config,
			datasetName: this.datasetName,
			storageDir: this.storageDir,
		};
		await crawl(configWithDataset);
	}

	async write(): Promise<PathLike | null> {
		const configWithDataset: ConfigWithDataset = {
			...this.config,
			datasetName: this.datasetName,
			storageDir: this.storageDir,
		};
		return write(configWithDataset);
	}

	async cleanup(): Promise<void> {
		await cleanupJobStorage(this.datasetName, this.storageDir);
	}
}

export default ContextCrawlerCore;
