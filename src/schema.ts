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

const Page: z.ZodType<Page> = z.custom<Page>((val) => {
	return (
		typeof val === 'object' &&
		val !== null &&
		'goto' in val &&
		'evaluate' in val &&
		'title' in val
	);
});

export const globalConfigSchema = z.object({
	maxPagesToCrawl: z.number(),
	maxTokens: z.number(),
});

export type GlobalConfig = z.infer<typeof globalConfigSchema>;

export const configSchema = z.object({
	/**
	 * Unique identifier for this configuration
	 * Must match the name used in batches.json
	 */
	name: z.string(),
	url: z.string(),
	match: z.union([z.string(), z.array(z.string())]),
	exclude: z.union([z.string(), z.array(z.string())]).optional(),
	selector: z.string(),
	/**
	 * File name for the finished data
	 * If not provided, will be auto-generated from the URL
	 * @default Auto-generated from URL
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
	onVisitPage: z.any().optional(),
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
		const parts = pathSegments.length > 0 ? [domain, pathSegments[0]] : [domain];
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
 * Generates an output file path from a URL
 * @example "https://nextjs.org/docs/app/api-reference/components" → "output/nextjs/docs.json"
 */
export function generateOutputFileNameFromUrl(url: string): string {
	try {
		const urlObj = new URL(url);

		// Extract domain name (remove TLD and www)
		const domain = urlObj.hostname.replace(/^www\./, '').split('.')[0];

		// Extract only the first path segment (ignore query params and fragments)
		const pathSegments = urlObj.pathname
			.split('/')
			.filter((segment) => segment.length > 0);

		// Build the output path: output/{domain}/{first-path-segment}.json or output/{domain}/docs.json
		const parts = pathSegments.length > 0
			? ['output', domain, pathSegments[0]]
			: ['output', domain, 'docs'];
		return parts.join('/') + '.json';
	} catch (error) {
		// Fallback to simple output.json
		return 'output/output.json';
	}
}
