import { type NamedConfig } from '../schema';

/**
 * An array of named crawl configurations.
 * Each configuration object specifies the parameters for a crawl job.
 */
export const crawlConfigurations = [
	{
		name: 'builder-docs',
		url: 'https://www.builder.io/c/docs/developers',
		match: 'https://www.builder.io/c/docs/**',
		selector: '.docs-builder-container',
		maxPagesToCrawl: 50,
		outputFileName: 'output.json',
		maxTokens: 2000000,
	},
	{
		name: 'builder-docs-container',
		url: 'https://www.builder.io/c/docs/developers',
		match: 'https://www.builder.io/c/docs/**',
		selector: '.docs-builder-container',
		maxPagesToCrawl: 50,
		outputFileName: 'data/output.json',
		maxTokens: 2000000,
	},
] as const satisfies readonly NamedConfig[];

/**
 * Union type of all available configuration names.
 * Automatically inferred from the crawlConfigurations array.
 */
export type ConfigurationName = (typeof crawlConfigurations)[number]['name'];

/**
 * Retrieves a crawl configuration by its name.
 * @param {ConfigurationName} name - The name of the configuration to find.
 * @returns {NamedConfig | undefined} The found configuration object or undefined if not found.
 */
export function getConfigurationByName(
	name: ConfigurationName
): NamedConfig | undefined {
	return crawlConfigurations.find((config) => config.name === name);
}
