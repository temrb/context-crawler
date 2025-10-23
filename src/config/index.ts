import { NamedConfig } from '../schema';
import { batchConfigs } from './batch-config.js';

/**
 * All crawl configurations in one flat array.
 * Automatically flattens all batches from batchConfigs.
 */
const crawlConfigurations = Object.values(batchConfigs).flat() as NamedConfig[];

/**
 * Union type of all available batch names.
 */
export type BatchName = keyof typeof batchConfigs;

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

/**
 * Retrieves a batch of crawl configurations by batch name.
 * @param {BatchName} name - The name of the batch to retrieve.
 * @returns {readonly NamedConfig[]} The array of configurations in the batch.
 */
export function getBatchByName(name: BatchName): readonly NamedConfig[] {
	return batchConfigs[name];
}
