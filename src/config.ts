import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { NamedConfig } from './schema.js';

const CONFIGURATIONS_DIR = './configurations';

/**
 * Cache for loaded configurations
 */
let configurationsCache: NamedConfig[] | null = null;
let batchesCache: Record<string, NamedConfig[]> | null = null;

/**
 * Recursively loads all configuration files from a directory
 */
function loadConfigsFromDirectory(dirPath: string): NamedConfig[] {
	const configs: NamedConfig[] = [];
	const entries = readdirSync(dirPath);

	for (const entry of entries) {
		const fullPath = join(dirPath, entry);
		const stat = statSync(fullPath);

		if (stat.isFile() && entry.endsWith('.json')) {
			const content = readFileSync(fullPath, 'utf-8');
			const config = JSON.parse(content);

			// Validate that config has required 'name' property
			if (!config.name) {
				throw new Error(
					`Configuration file '${entry}' is missing required 'name' property`
				);
			}

			configs.push(config as NamedConfig);
		} else if (stat.isDirectory()) {
			// Recursively load configs from subdirectories
			configs.push(...loadConfigsFromDirectory(fullPath));
		}
	}

	return configs;
}

/**
 * Loads all configuration files from the configurations directory
 */
function loadAllConfigurations(): NamedConfig[] {
	if (configurationsCache) {
		return configurationsCache;
	}

	configurationsCache = loadConfigsFromDirectory(CONFIGURATIONS_DIR);
	return configurationsCache;
}

/**
 * Discovers batches from subdirectories in the configurations directory
 */
function loadBatches(): Record<string, NamedConfig[]> {
	if (batchesCache) {
		return batchesCache;
	}

	batchesCache = {};
	const entries = readdirSync(CONFIGURATIONS_DIR);

	for (const entry of entries) {
		const fullPath = join(CONFIGURATIONS_DIR, entry);
		const stat = statSync(fullPath);

		if (stat.isDirectory()) {
			// Each subdirectory is a batch
			const batchConfigs = loadConfigsFromDirectory(fullPath);
			if (batchConfigs.length > 0) {
				batchesCache[entry] = batchConfigs;
			}
		}
	}

	return batchesCache;
}

/**
 * Union type of all available batch names.
 */
const batches = loadBatches();
export type BatchName = keyof typeof batches;

/**
 * Union type of all available configuration names.
 */
const configurations = loadAllConfigurations();
export type ConfigurationName = (typeof configurations)[number]['name'];

/**
 * Retrieves a crawl configuration by its name.
 * @param {ConfigurationName} name - The name of the configuration to find.
 * @returns {NamedConfig | undefined} The found configuration object or undefined if not found.
 */
export function getConfigurationByName(
	name: ConfigurationName
): NamedConfig | undefined {
	const configs = loadAllConfigurations();
	return configs.find((config) => config.name === name);
}

/**
 * Retrieves a batch of crawl configurations by batch name.
 * @param {BatchName} name - The name of the batch to retrieve.
 * @returns {readonly NamedConfig[]} The array of configurations in the batch.
 */
export function getBatchByName(name: BatchName): readonly NamedConfig[] {
	const batches = loadBatches();
	return batches[name] ?? [];
}

/**
 * Gets all available configuration names
 * @returns {string[]} Array of configuration names
 */
export function getAllConfigurationNames(): string[] {
	const configs = loadAllConfigurations();
	return configs.map((config) => config.name);
}

/**
 * Gets all available batch names
 * @returns {string[]} Array of batch names
 */
export function getAllBatchNames(): string[] {
	const batches = loadBatches();
	return Object.keys(batches);
}

/**
 * Gets all configurations
 * @returns {NamedConfig[]} Array of all configurations
 */
export function getAllConfigurations(): NamedConfig[] {
	return loadAllConfigurations();
}
