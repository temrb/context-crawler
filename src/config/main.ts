import { crawl, write } from '../core.js';
import { BatchName, getBatchByName } from './index.js';

const batchName: BatchName = 'trpc';
const batchConfigs = getBatchByName(batchName);

if (!batchConfigs || batchConfigs.length === 0) {
	console.error(
		`Error: Batch configuration '${batchName}' not found or is empty`
	);
	process.exit(1);
}

console.log(
	`Starting batch crawl for '${batchName}' (${batchConfigs.length} configurations)`
);

for (let i = 0; i < batchConfigs.length; i++) {
	const config = batchConfigs[i]!;
	console.log(`\n[${i + 1}/${batchConfigs.length}] Crawling: ${config.name}`);

	await crawl(config);
	await write(config);

	console.log(`[${i + 1}/${batchConfigs.length}] Completed: ${config.name}`);
}

console.log(`\nBatch crawl completed for '${batchName}'`);
