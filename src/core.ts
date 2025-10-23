// For more information, see https://crawlee.dev/
import { Configuration, Dataset, downloadListOfUrls, PlaywrightCrawler } from 'crawlee';
import { randomBytes } from 'crypto';
import { PathLike } from 'fs';
import { mkdir, writeFile, rm } from 'fs/promises';
import { dirname, join } from 'path';
import { isWithinTokenLimit } from 'gpt-tokenizer';
import { Page } from 'playwright';
import logger from './logger.js';
import { getGlobalConfig } from './config.js';
import { Config, configSchema, CrawledData, generateOutputFileNameFromUrl } from './schema.js';

let pageCounter = 0;

// Internal type for configs with dataset name (required for all crawls)
type ConfigWithDataset = Config & { datasetName: string };

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
		// Load global config
		const globalConfig = getGlobalConfig();

		// Create isolated storage directory for this job
		const storageDir = config.storageDir || join(process.cwd(), 'storage', 'jobs', config.datasetName);

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
					log.info(
						`Crawling: Page ${pageCounter} / ${globalConfig.maxPagesToCrawl} - URL: ${request.loadedUrl}...`
					);

					// Use custom handling for XPath selector
					if (config.selector) {
						if (config.selector.startsWith('/')) {
							await waitForXPath(
								page,
								config.selector,
								config.waitForSelectorTimeout ?? 1000
							);
						} else {
							await page.waitForSelector(config.selector, {
								timeout: config.waitForSelectorTimeout ?? 1000,
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
						exclude:
							typeof config.exclude === 'string'
								? [config.exclude]
								: (config.exclude ?? []),
					});
				},
				// Comment this option to scrape the full website.
				maxRequestsPerCrawl: globalConfig.maxPagesToCrawl,
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

		const isUrlASitemap = /sitemap.*\.xml$/.test(config.url);

		if (isUrlASitemap) {
			const listOfUrls = await downloadListOfUrls({ url: config.url });

			// Add the initial URL to the crawling queue.
			await crawler.addRequests(listOfUrls);

			// Run the crawler
			await crawler.run();
		} else {
			// Add first URL to the queue and start the crawl.
			await crawler.run([config.url]);
		}
	}
}

export async function write(config: ConfigWithDataset): Promise<PathLike | null> {
	let nextFileNameString: PathLike | null = null;

	// Load global config
	const globalConfig = getGlobalConfig();

	// Determine storage directory
	const storageDir = config.storageDir || join(process.cwd(), 'storage', 'jobs', config.datasetName);

	// Open the dataset for this crawl with the same storage configuration
	const dataset = await Dataset.open(config.datasetName, {
		storageClient: new Configuration({
			storageClientOptions: {
				localDataDirectory: storageDir,
			},
		}).getStorageClient(),
	});
	const itemCount = (await dataset.getInfo())?.itemCount || 0;
	logger.info({ itemCount }, `Found ${itemCount} items in dataset to process...`);

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
export async function cleanupJobStorage(datasetName: string, storageDir?: string): Promise<void> {
	try {
		const targetDir = storageDir || join(process.cwd(), 'storage', 'jobs', datasetName);

		// Check if directory exists before attempting to remove
		try {
			await rm(targetDir, { recursive: true, force: true });
			logger.debug({ storageDir: targetDir }, 'Cleaned up job storage directory');
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
		// Auto-generate outputFileName from URL if not provided
		this.config = {
			...config,
			outputFileName: config.outputFileName || generateOutputFileNameFromUrl(config.url),
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
