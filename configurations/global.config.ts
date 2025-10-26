import type { GlobalConfig } from '../src/schema.js';

/**
 * Global configuration for the crawler.
 * Edit these values to control global crawl behavior.
 *
 * Both maxPagesToCrawl and maxTokens can be set to:
 * - A number (e.g., 1000)
 * - The string 'unlimited' for no limit
 */
export const globalConfig: GlobalConfig = {
	maxPagesToCrawl: 'unlimited',
	maxTokens: 'unlimited',
};
