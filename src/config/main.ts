import { crawl, write } from '../core.js';
import { getConfigurationByName, type ConfigurationName } from './index.js';

const configName: ConfigurationName = 'builder-docs-container';
const configToRun = getConfigurationByName(configName);

if (!configToRun) {
	console.error(
		`Error: Default configuration '${configName}' not found in config.ts`
	);
	process.exit(1);
}

await crawl(configToRun);
await write(configToRun);
