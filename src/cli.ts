#!/usr/bin/env node

import { program } from 'commander';
import { randomUUID } from 'crypto';
import { createWriteStream } from 'fs';
import { mkdir, mkdtemp, readFile, rm } from 'fs/promises';
import inquirer from 'inquirer';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import {
	getAllJobNames,
	getJobConfigs,
	type JobName,
} from './config.js';
import { jobStore } from './job-store.js';
import logger from './logger.js';
import { crawlQueue } from './queue.js';
import { Config, configSchema, generateOutputFileName, NamedConfig } from './schema.js';
import { runTask } from './task-runner.js';

// Import package.json using dynamic import for better compatibility
const packageJsonUrl = new URL('../../package.json', import.meta.url);
const packageInfo = JSON.parse(
	await readFile(packageJsonUrl, 'utf-8')
) as { version: string; description: string };
const { version, description } = packageInfo;

const messages = {
	urls: 'Enter starting URLs (comma-separated for multiple):',
	match: 'What is the URL pattern you want to match?',
	selector: 'What is the CSS selector you want to match?',
	outputFileName: 'What is the name of the output file?',
	job: 'Name of the job to run',
};

program.version(version).description(description);

// Single job command
program
	.command('single [jobName]')
	.description('Run a single job (all configs in the job)')
	.option('-j, --job <string>', messages.job)
	.action(async (jobNameArg?: string, options?: { job?: string }) => {
		let selectedJobName: string;

		// Determine which job to run
		if (jobNameArg) {
			selectedJobName = jobNameArg;
		} else if (options?.job) {
			selectedJobName = options.job;
		} else {
			// Show interactive picker
			const availableJobs = getAllJobNames();
			if (availableJobs.length === 0) {
				logger.error('No jobs found in configurations');
				process.exit(1);
			}

			const jobChoices = availableJobs.map((name) => {
				const count = getJobConfigs(name as JobName).length;
				return {
					name: `${name} (${count} ${count === 1 ? 'config' : 'configs'})`,
					value: name,
				};
			});

			const jobAnswer = await inquirer.prompt({
				type: 'list',
				name: 'jobName',
				message: 'Select a job to run:',
				choices: jobChoices,
			});

			selectedJobName = jobAnswer.jobName;
		}

		// Validate job exists
		const jobConfigs = getJobConfigs(selectedJobName as JobName);
		if (!jobConfigs || jobConfigs.length === 0) {
			logger.error({ job: selectedJobName }, `Job '${selectedJobName}' not found or is empty`);
			const availableJobs = getAllJobNames();
			logger.info(`Available jobs: ${availableJobs.join(', ')}`);
			process.exit(1);
		}

		logger.info(
			{ job: selectedJobName, configCount: jobConfigs.length },
			`Running job '${selectedJobName}' with ${jobConfigs.length} ${
				jobConfigs.length === 1 ? 'config' : 'configs'
			}`
		);

		// Create unique temp directory
		const tempDir = await mkdtemp(join(tmpdir(), 'context-crawler-'));

		try {
			const results: {
				successful: Array<{ config: NamedConfig; outputFile: string }>;
				failed: Array<{ config: NamedConfig; error: string }>;
			} = {
				successful: [],
				failed: [],
			};

			// Execute all configs sequentially
			for (let i = 0; i < jobConfigs.length; i++) {
				const config = jobConfigs[i]!;
				logger.info(
					{
						progress: `${i + 1}/${jobConfigs.length}`,
						job: selectedJobName,
					},
					`Processing config ${i + 1}/${jobConfigs.length}`
				);

				// Write to isolated temp location
				const tempOutputPath = join(tempDir, `config-${i}.json`);
				const tempConfig = { ...config, outputFileName: tempOutputPath };

				const result = await runTask(tempConfig, selectedJobName);

				if (result.success && result.outputFile) {
					results.successful.push({
						config,
						outputFile: result.outputFile.toString(),
					});

					logger.info(
						{
							progress: `${i + 1}/${jobConfigs.length}`,
							job: selectedJobName,
						},
						`Completed config ${i + 1}/${jobConfigs.length}`
					);
				} else {
					results.failed.push({
						config,
						error: result.error || 'Unknown error',
					});

					logger.error(
						{
							progress: `${i + 1}/${jobConfigs.length}`,
							job: selectedJobName,
							error: result.error,
						},
						`Failed config ${i + 1}/${jobConfigs.length}`
					);
				}
			}

			// Aggregate results
			const successCount = results.successful.length;
			const failCount = results.failed.length;
			const totalCount = successCount + failCount;

			logger.info(
				{ job: selectedJobName, successCount, failCount, totalCount },
				`Job '${selectedJobName}' completed: ${successCount}/${totalCount} successful, ${failCount} failed`
			);

			// Stream aggregation to avoid memory exhaustion
			if (successCount > 0) {
				try {
					const aggregatedOutputPath = generateOutputFileName(selectedJobName);

					await mkdir(dirname(aggregatedOutputPath), { recursive: true });

					const writeStream = createWriteStream(aggregatedOutputPath, {
						encoding: 'utf-8',
					});

					// Write opening bracket
					writeStream.write('[\n');

					let itemCount = 0;
					let isFirstFile = true;

					// Stream each temp file's contents
					for (const { outputFile } of results.successful) {
						const content = await readFile(outputFile, 'utf-8');
						const data = JSON.parse(content);

						// Handle both array and single object
						const items = Array.isArray(data) ? data : [data];

						for (const item of items) {
							if (!isFirstFile) {
								writeStream.write(',\n');
							}
							writeStream.write('  ');
							writeStream.write(JSON.stringify(item, null, 2).replace(/\n/g, '\n  '));
							isFirstFile = false;
							itemCount++;
						}
					}

					// Write closing bracket
					writeStream.write('\n]\n');
					writeStream.end();

					// Wait for stream to finish
					await new Promise<void>((resolve, reject) => {
						writeStream.on('finish', () => resolve());
						writeStream.on('error', reject);
					});

					logger.info(
						{
							job: selectedJobName,
							itemCount,
							outputFile: aggregatedOutputPath,
						},
						`Streamed ${itemCount} items to ${aggregatedOutputPath}`
					);
				} catch (error) {
					logger.error(
						{
							job: selectedJobName,
							error: error instanceof Error ? error.message : error,
						},
						`Failed to aggregate outputs for job '${selectedJobName}'`
					);
				}
			} else {
				logger.info(
					{ job: selectedJobName },
					`Skipping aggregation for '${selectedJobName}' - no successful configs`
				);
			}
		} finally {
			// Always clean up temp directory
			try {
				await rm(tempDir, { recursive: true, force: true });
				logger.debug({ tempDir }, 'Cleaned up temp directory');
			} catch (error) {
				logger.warn(
					{
						tempDir,
						error: error instanceof Error ? error.message : error,
					},
					'Failed to cleanup temp directory'
				);
			}
		}
	});

// Batch crawl command
program
	.command('batch [names...]')
	.description('Run one or more jobs')
	.option('-q, --queue', 'Queue jobs for worker instead of running directly')
	.action(async (names: string[], options: { queue?: boolean }) => {
		let selectedBatches: string[];

		// If no job names provided, show interactive picker
		if (!names || names.length === 0) {
			const availableJobs = getAllJobNames();
			if (availableJobs.length === 0) {
				logger.error('No jobs found in configurations');
				process.exit(1);
			}

			const jobChoices = availableJobs.map((name) => {
				const count = getJobConfigs(name as JobName).length;
				return {
					name: `${name} (${count} ${count === 1 ? 'config' : 'configs'})`,
					value: name,
				};
			});

			const jobAnswer = await inquirer.prompt({
				type: 'checkbox',
				name: 'jobs',
				message: 'Select jobs to crawl:',
				choices: jobChoices,
				validate: (answer) => {
					if ((answer as unknown as string[]).length === 0) {
						return 'You must select at least one job';
					}
					return true;
				},
			});

			selectedBatches = jobAnswer.jobs;
		} else {
			selectedBatches = names;
		}

		// Validate all selected jobs exist
		for (const name of selectedBatches) {
			const jobConfigs = getJobConfigs(name as JobName);
			if (!jobConfigs || jobConfigs.length === 0) {
				logger.error({ job: name }, `Job '${name}' not found or is empty`);
				const availableJobs = getAllJobNames();
				logger.info(`Available jobs: ${availableJobs.join(', ')}`);
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

		// Collect all configs from selected jobs
		const allConfigs: Array<{ jobName: string; config: NamedConfig }> = [];
		for (const jobName of selectedBatches) {
			const jobConfigs = getJobConfigs(jobName as JobName);
			for (const config of jobConfigs) {
				allConfigs.push({ jobName, config });
			}
		}

		logger.info(
			{
				jobs: selectedBatches.join(', '),
				totalConfigs: allConfigs.length,
				mode: useQueue ? 'queue' : 'direct',
			},
			`Starting crawl for ${selectedBatches.length} ${
				selectedBatches.length === 1 ? 'job' : 'jobs'
			} (${allConfigs.length} total ${
				allConfigs.length === 1 ? 'config' : 'configs'
			})`
		);

		if (useQueue) {
			// Queue mode: add all configs to queue
			const jobIds: string[] = [];

			for (const { jobName, config } of allConfigs) {
				const jobId = randomUUID();

				// Generate output filename for this job
				const outputFileName = generateOutputFileName(jobName);

				// Add filename to config
				const configWithFileName = {
					...config,
					outputFileName,
				};

				// Create job in persistent store
				jobStore.createJob(jobId, configWithFileName);

				// Add job to queue
				await crawlQueue.add('crawl', { config: configWithFileName, jobName }, { jobId });

				jobIds.push(jobId);

				logger.info(
					{ jobId, job: jobName, outputFile: outputFileName },
					`Queued: ${jobName} (job ID: ${jobId})`
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
			// Direct mode: run each config sequentially with streaming aggregation per job
			// Create unique temp directory to avoid race conditions
			const tempDir = await mkdtemp(join(tmpdir(), 'context-crawler-'));

			try {
				const jobResults: Record<
					string,
					{
						successful: Array<{ config: NamedConfig; outputFile: string }>;
						failed: Array<{ config: NamedConfig; error: string }>;
					}
				> = {};

				// Initialize job results tracking
				for (const jobName of selectedBatches) {
					jobResults[jobName] = {
						successful: [],
						failed: [],
					};
				}

				// Execute all configs
				for (let i = 0; i < allConfigs.length; i++) {
					const { jobName, config } = allConfigs[i]!;
					logger.info(
						{
							progress: `${i + 1}/${allConfigs.length}`,
							job: jobName,
						},
						`Crawling config ${i + 1}/${allConfigs.length} (from ${jobName})`
					);

					// Write to isolated temp location for this config
					const tempOutputPath = join(tempDir, `${jobName}-${i}.json`);
					const tempConfig = { ...config, outputFileName: tempOutputPath };

					const result = await runTask(tempConfig, jobName);

					if (result.success && result.outputFile) {
						jobResults[jobName]!.successful.push({
							config,
							outputFile: result.outputFile.toString(),
						});

						logger.info(
							{
								progress: `${i + 1}/${allConfigs.length}`,
								job: jobName,
							},
							`Completed config ${i + 1}/${allConfigs.length}`
						);
					} else {
						jobResults[jobName]!.failed.push({
							config,
							error: result.error || 'Unknown error',
						});

						logger.error(
							{
								progress: `${i + 1}/${allConfigs.length}`,
								job: jobName,
								error: result.error,
							},
							`Failed config ${i + 1}/${allConfigs.length}`
						);
					}
				}

				// Aggregate results for each job using streaming
				for (const jobName of selectedBatches) {
					const results = jobResults[jobName]!;
					const successCount = results.successful.length;
					const failCount = results.failed.length;
					const totalCount = successCount + failCount;

					logger.info(
						{ job: jobName, successCount, failCount, totalCount },
						`Job '${jobName}' completed: ${successCount}/${totalCount} successful, ${failCount} failed`
					);

					// Stream aggregation to avoid memory exhaustion
					if (successCount > 0) {
						try {
							const aggregatedOutputPath = generateOutputFileName(jobName);

							await mkdir(dirname(aggregatedOutputPath), { recursive: true });

							const writeStream = createWriteStream(aggregatedOutputPath, {
								encoding: 'utf-8',
							});

							// Write opening bracket
							writeStream.write('[\n');

							let itemCount = 0;
							let isFirstFile = true;

							// Stream each temp file's contents
							for (const { outputFile } of results.successful) {
								const content = await readFile(outputFile, 'utf-8');
								const data = JSON.parse(content);

								// Handle both array and single object
								const items = Array.isArray(data) ? data : [data];

								for (const item of items) {
									if (!isFirstFile) {
										writeStream.write(',\n');
									}
									writeStream.write('  ');
									writeStream.write(JSON.stringify(item, null, 2).replace(/\n/g, '\n  '));
									isFirstFile = false;
									itemCount++;
								}
							}

							// Write closing bracket
							writeStream.write('\n]\n');
							writeStream.end();

							// Wait for stream to finish
							await new Promise<void>((resolve, reject) => {
								writeStream.on('finish', () => resolve());
								writeStream.on('error', reject);
							});

							logger.info(
								{
									job: jobName,
									itemCount,
									outputFile: aggregatedOutputPath,
								},
								`Streamed ${itemCount} items to ${aggregatedOutputPath}`
							);
						} catch (error) {
							logger.error(
								{
									job: jobName,
									error: error instanceof Error ? error.message : error,
								},
								`Failed to aggregate outputs for job '${jobName}'`
							);
						}
					} else {
						logger.info(
							{ job: jobName },
							`Skipping aggregation for '${jobName}' - no successful configs`
						);
					}
				}

				// Final summary
				const totalSuccessful = Object.values(jobResults).reduce(
					(sum, r) => sum + r.successful.length,
					0
				);
				const totalFailed = Object.values(jobResults).reduce(
					(sum, r) => sum + r.failed.length,
					0
				);

				logger.info(
					{
						jobs: selectedBatches.join(', '),
						totalSuccessful,
						totalFailed,
						total: allConfigs.length,
					},
					`All jobs completed: ${totalSuccessful}/${allConfigs.length} successful, ${totalFailed} failed`
				);
			} finally {
				// Always clean up temp directory
				try {
					await rm(tempDir, { recursive: true, force: true });
					logger.debug({ tempDir }, 'Cleaned up temp directory');
				} catch (error) {
					logger.warn(
						{
							tempDir,
							error: error instanceof Error ? error.message : error,
						},
						'Failed to cleanup temp directory'
					);
				}
			}
		}
	});

// List command
program
	.command('list')
	.description('List all available jobs and their config counts')
	.action(() => {
		const jobNames = getAllJobNames();

		console.log('\nAvailable Jobs:');
		if (jobNames.length === 0) {
			console.log('  (none found)');
		} else {
			jobNames.forEach((jobName: string) => {
				const configs = getJobConfigs(jobName as JobName);
				const configCount = configs.length;
				console.log(
					`  - ${jobName} (${configCount} ${configCount === 1 ? 'config' : 'configs'})`
				);
			});
		}

		console.log();
	});

program.parse();
