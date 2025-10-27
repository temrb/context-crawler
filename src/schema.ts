import { configDotenv } from 'dotenv';
import type { Page } from 'playwright';
import { z } from 'zod';

configDotenv();

export interface CrawledData {
	title: string;
	url: string;
	html: string;
	[key: string]: unknown;
}

/**
 * Type-safe hook invoked on each page visit
 * Provides access to Playwright page and data persistence
 */
export type OnVisitPageHook = (context: {
	page: Page;
	pushData: (data: Record<string, unknown>) => Promise<void>;
}) => Promise<void>;

const Page: z.ZodType<Page> = z.custom<Page>((val) => {
	return (
		typeof val === 'object' &&
		val !== null &&
		'goto' in val &&
		'evaluate' in val &&
		'title' in val
	);
});

const onVisitPageHook: z.ZodType<OnVisitPageHook> = z.custom<OnVisitPageHook>(
	(val) => {
		return typeof val === 'function';
	}
);

export const globalConfigSchema = z.object({
	maxPagesToCrawl: z.union([z.number(), z.literal('unlimited')]),
	maxTokens: z.union([z.number(), z.literal('unlimited')]),
});

export type GlobalConfig = z.infer<typeof globalConfigSchema>;

export const configSchema = z.object({
	/**
	 * Single entry point URL that seeds the crawler
	 */
	entry: z.string().url(),
	/**
	 * URL patterns to match for recursive crawling
	 */
	match: z.union([z.string(), z.array(z.string())]),
	exclude: z.union([z.string(), z.array(z.string())]).optional(),
	selector: z.string(),
	/**
	 * Automatically discover navigation links before crawling
	 * When enabled, extracts all links from navigation elements and uses them as seed URLs
	 * @default true
	 */
	autoDiscoverNav: z.boolean().optional().default(true),
	/**
	 * CSS selector(s) for navigation elements to extract links from during discovery
	 * Only used when autoDiscoverNav is true
	 * @default "nav, aside, [role='navigation']"
	 */
	discoverySelector: z
		.string()
		.optional()
		.default("nav, aside, [role='navigation']"),
	/**
	 * File name for the finished data
	 * If not provided, will be auto-generated from the job name
	 * @default Auto-generated from job name
	 */
	outputFileName: z.string().optional(),
	/** Optional cookie to be set. E.g. for Cookie Consent */
	cookie: z
		.union([
			z.object({
				name: z.string(),
				value: z.string(),
			}),
			z.array(
				z.object({
					name: z.string(),
					value: z.string(),
				})
			),
		])
		.optional(),
	/**
	 * Hook called on each page visit before content extraction
	 * Receives { page, pushData } for custom page interactions
	 */
	onVisitPage: onVisitPageHook.optional(),
	waitForSelectorTimeout: z.number().optional(),
	resourceExclusions: z.array(z.string()).optional(),
	maxFileSize: z.number().optional(),
	/**
	 * Storage directory for Crawlee data (isolated per job)
	 * @internal Used internally to isolate concurrent crawls
	 */
	storageDir: z.string().optional(),
	/**
	 * Dataset name (unique identifier for Crawlee dataset)
	 * @internal Used internally to isolate concurrent crawls
	 */
	datasetName: z.string().optional(),
});

export type Config = z.infer<typeof configSchema>;
export type ConfigInput = z.input<typeof configSchema>;

export type NamedConfig = Config;

/**
 * Generates a configuration name from a URL
 * @example "https://nextjs.org/docs/app/api-reference/components" → "nextjs-docs"
 */
export function generateNameFromUrl(url: string): string {
	try {
		const urlObj = new URL(url);

		// Extract domain name (remove TLD and www)
		const domain = urlObj.hostname.replace(/^www\./, '').split('.')[0];

		// Extract only the first path segment (ignore query params and fragments)
		const pathSegments = urlObj.pathname
			.split('/')
			.filter((segment) => segment.length > 0);

		// Combine domain and first path segment only
		const parts =
			pathSegments.length > 0 ? [domain, pathSegments[0]] : [domain];
		return parts.join('-').toLowerCase();
	} catch (error) {
		// Fallback to a simple sanitized version of the URL
		return url
			.replace(/[^a-zA-Z0-9]/g, '-')
			.replace(/-+/g, '-')
			.replace(/^-|-$/g, '')
			.toLowerCase();
	}
}

/**
 * Generates an output file path from a job name
 * @example "zod" → "output/jobs/zod.json"
 * @example "next-js-16" → "output/jobs/next-js-16.json"
 */
export function generateOutputFileName(jobName: string): string {
	return `output/jobs/${jobName}.json`;
}
