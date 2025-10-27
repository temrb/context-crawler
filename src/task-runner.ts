import { PathLike } from 'fs';
import ContextCrawlerCore from './core.js';
import logger from './logger.js';
import { Config } from './schema.js';

export interface TaskResult {
	success: boolean;
	outputFile: PathLike | null;
	error?: string;
}

/**
 * Execute a single crawl task with error handling
 * Centralizes task execution logic shared between worker and CLI
 */
export async function runTask(config: Config): Promise<TaskResult> {
	let crawler: ContextCrawlerCore | null = null;

	try {
		logger.info({ task: config.name }, `Starting task: ${config.name}`);

		// Instantiate the crawler
		crawler = new ContextCrawlerCore(config);

		// Run the crawl
		await crawler.crawl();

		// Write the output
		const outputFile = await crawler.write();

		// Clean up job storage
		await crawler.cleanup();

		logger.info(
			{ task: config.name, outputFile },
			`Task completed: ${config.name}`
		);

		return {
			success: true,
			outputFile,
		};
	} catch (error) {
		const errorMessage =
			error instanceof Error ? error.message : 'Unknown error occurred';

		logger.error(
			{ task: config.name, error: errorMessage },
			`Task failed: ${config.name}`
		);

		// Clean up storage on error
		if (crawler) {
			try {
				await crawler.cleanup();
			} catch (cleanupError) {
				logger.warn(
					{
						task: config.name,
						error:
							cleanupError instanceof Error
								? cleanupError.message
								: cleanupError,
					},
					'Failed to cleanup storage after error'
				);
			}
		}

		return {
			success: false,
			outputFile: null,
			error: errorMessage,
		};
	}
}
