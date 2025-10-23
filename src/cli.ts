#!/usr/bin/env node

import { program } from 'commander';
import { randomUUID } from 'crypto';
import inquirer from 'inquirer';
import { createRequire } from 'node:module';
import {
	getAllBatchNames,
	getAllConfigurationNames,
	getBatchByName,
	getConfigurationByName,
	type BatchName,
} from './config.js';
import ContextCrawlerCore from './core.js';
import { jobStore } from './job-store.js';
import logger from './logger.js';
import { crawlQueue } from './queue.js';
import { Config, configSchema, NamedConfig } from './schema.js';

const require = createRequire(import.meta.url);
const { version, description } = require('../../package.json');

const messages = {
	url: 'What is the first URL of the website you want to crawl?',
	match: 'What is the URL pattern you want to match?',
	selector: 'What is the CSS selector you want to match?',
	maxPagesToCrawl: 'How many pages do you want to crawl?',
	outputFileName: 'What is the name of the output file?',
	config: 'Name of the crawl configuration to use',
};

async function handler(cliOptions: Partial<Config> & { config?: string }) {
	try {
		let config: Partial<Config> = {};

		// Load configuration from file if a name is provided
		if (cliOptions.config) {
			const namedConfig = getConfigurationByName(
				cliOptions.config as Parameters<typeof getConfigurationByName>[0]
			);
			if (!namedConfig) {
				logger.error(
					{ config: cliOptions.config },
					`Configuration '${cliOptions.config}' not found`
				);
				logger.info(
					`Available configurations: ${getAllConfigurationNames().join(', ')}`
				);
				process.exit(1);
			}
			config = { ...namedConfig };
		} else {
			// If no config is specified, prompt the user to select one
			const availableConfigs = getAllConfigurationNames();
			if (availableConfigs.length > 0) {
				const configAnswer = await inquirer.prompt({
					type: 'list',
					name: 'configName',
					message: 'Select a configuration:',
					choices: availableConfigs,
				});
				const namedConfig = getConfigurationByName(
					configAnswer.configName as Parameters<
						typeof getConfigurationByName
					>[0]
				);
				if (namedConfig) {
					config = { ...namedConfig };
				}
			}
		}

		// Override with any explicit CLI arguments
		Object.keys(cliOptions).forEach((key) => {
			if (
				cliOptions[key as keyof typeof cliOptions] !== undefined &&
				key !== 'config' &&
				key in configSchema.shape
			) {
				config[key as keyof Config] = cliOptions[
					key as keyof typeof cliOptions
				] as any;
			}
		});

		if (!config.url || !config.match || !config.selector) {
			const answers: Partial<Config> = {};

			if (!config.url) {
				const urlAnswer = await inquirer.prompt({
					type: 'input',
					name: 'url',
					message: messages.url,
				});
				answers.url = urlAnswer.url;
			}

			if (!config.match) {
				const matchAnswer = await inquirer.prompt({
					type: 'input',
					name: 'match',
					message: messages.match,
				});
				answers.match = matchAnswer.match;
			}

			if (!config.selector) {
				const selectorAnswer = await inquirer.prompt({
					type: 'input',
					name: 'selector',
					message: messages.selector,
				});
				answers.selector = selectorAnswer.selector;
			}

			config = {
				...config,
				...answers,
			};
		}

		// Apply defaults for any remaining undefined options
		const finalConfig: Config = {
			maxPagesToCrawl: 50,
		} as Config;

		// Use ContextCrawlerCore for isolated dataset management
		const crawler = new ContextCrawlerCore(finalConfig);
		await crawler.crawl();
		await crawler.write();
	} catch (error) {
		logger.error({ error }, 'Error during crawl');
		process.exit(1);
	}
}

program.version(version).description(description);

// Single crawl command
program
	.command('single')
	.description('Crawl a single configuration')
	.option('-c, --config <string>', messages.config)
	.option('-u, --url <string>', messages.url)
	.option('-m, --match <string>', messages.match)
	.option('-s, --selector <string>', messages.selector)
	.option('-p, --maxPagesToCrawl <number>', messages.maxPagesToCrawl, parseInt)
	.option('-o, --outputFileName <string>', messages.outputFileName)
	.action(handler);

// Batch crawl command
program
	.command('batch [names...]')
	.description('Run one or more predefined batches of crawl configurations')
	.option('-q, --queue', 'Queue jobs for worker instead of running directly')
	.action(async (names: string[], options: { queue?: boolean }) => {
		let selectedBatches: string[];

		// If no batch names provided, show interactive picker
		if (!names || names.length === 0) {
			const availableBatches = getAllBatchNames();
			if (availableBatches.length === 0) {
				logger.error('No batches found in configurations');
				process.exit(1);
			}

			const batchChoices = availableBatches.map((name) => {
				const count = getBatchByName(name as BatchName).length;
				return {
					name: `${name} (${count} ${count === 1 ? 'config' : 'configs'})`,
					value: name,
				};
			});

			const batchAnswer = await inquirer.prompt({
				type: 'checkbox',
				name: 'batches',
				message: 'Select batches to crawl:',
				choices: batchChoices,
				validate: (answer) => {
					if ((answer as unknown as string[]).length === 0) {
						return 'You must select at least one batch';
					}
					return true;
				},
			});

			selectedBatches = batchAnswer.batches;
		} else {
			selectedBatches = names;
		}

		// Validate all selected batches exist
		for (const name of selectedBatches) {
			const batchConfigs = getBatchByName(name as BatchName);
			if (!batchConfigs || batchConfigs.length === 0) {
				logger.error(
					{ batch: name },
					`Batch configuration '${name}' not found or is empty`
				);
				const availableBatches = getAllBatchNames();
				logger.info(`Available batches: ${availableBatches.join(', ')}`);
				process.exit(1);
			}
		}

		// If --queue flag not provided, ask user
		let useQueue = options.queue ?? false;
		if (options.queue === undefined) {
			const modeAnswer = await inquirer.prompt({
				type: 'list',
				name: 'mode',
				message: 'How do you want to run the crawl?',
				choices: [
					{
						name: 'Run directly (wait for completion)',
						value: 'direct',
					},
					{
						name: 'Queue for worker (async)',
						value: 'queue',
					},
				],
			});
			useQueue = modeAnswer.mode === 'queue';
		}

		// Collect all configs from selected batches
		const allConfigs: Array<{ batchName: string; config: NamedConfig }> = [];
		for (const batchName of selectedBatches) {
			const batchConfigs = getBatchByName(batchName as BatchName);
			for (const config of batchConfigs) {
				allConfigs.push({ batchName, config });
			}
		}

		logger.info(
			{
				batches: selectedBatches.join(', '),
				totalConfigs: allConfigs.length,
				mode: useQueue ? 'queue' : 'direct',
			},
			`Starting crawl for ${selectedBatches.length} ${
				selectedBatches.length === 1 ? 'batch' : 'batches'
			} (${allConfigs.length} total ${
				allConfigs.length === 1 ? 'config' : 'configs'
			})`
		);

		if (useQueue) {
			// Queue mode: add all configs to queue
			const jobIds: string[] = [];

			for (const { config } of allConfigs) {
				const jobId = randomUUID();

				// Create job in persistent store
				jobStore.createJob(jobId, config);

				// Add job to queue
				await crawlQueue.add('crawl', { config }, { jobId });

				jobIds.push(jobId);

				logger.info(
					{ jobId, config: config.name },
					`Queued: ${config.name} (job ID: ${jobId})`
				);
			}

			logger.info(
				{ totalJobs: jobIds.length },
				`Successfully queued ${jobIds.length} ${
					jobIds.length === 1 ? 'job' : 'jobs'
				}`
			);
			logger.info('Worker will process these jobs asynchronously');
			logger.info('Check job status via API: GET /crawl/status/{jobId}');
		} else {
			// Direct mode: run each config sequentially
			for (let i = 0; i < allConfigs.length; i++) {
				const { batchName, config } = allConfigs[i]!;
				logger.info(
					{
						progress: `${i + 1}/${allConfigs.length}`,
						batch: batchName,
						config: config.name,
					},
					`Crawling: ${config.name} (from ${batchName})`
				);

				const crawler = new ContextCrawlerCore(config);
				await crawler.crawl();
				await crawler.write();

				logger.info(
					{
						progress: `${i + 1}/${allConfigs.length}`,
						batch: batchName,
						config: config.name,
					},
					`Completed: ${config.name}`
				);
			}

			logger.info(
				{ batches: selectedBatches.join(', ') },
				`Batch crawl completed for: ${selectedBatches.join(', ')}`
			);
		}
	});

// List command
program
	.command('list')
	.description('List all available configurations and batches')
	.action(() => {
		const configurations = getAllConfigurationNames();
		const batches = getAllBatchNames();

		console.log('\nAvailable Configurations:');
		configurations.forEach((name) => {
			console.log(`  - ${name}`);
		});

		console.log('\nAvailable Batches:');
		batches.forEach((name) => {
			console.log(`  - ${name}`);
		});
	});

program.parse();
