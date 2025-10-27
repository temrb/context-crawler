import cors from 'cors';
import { randomUUID } from 'crypto';
import { configDotenv } from 'dotenv';
import express, { Express, NextFunction, Request, Response } from 'express';
import { createReadStream } from 'fs';
import { readFile, stat } from 'fs/promises';
import swaggerUi from 'swagger-ui-express';
import {
	getAllJobNames,
	getAllTasks,
	getTaskByName,
	getTasksByJobName,
} from './config.js';
import { jobStore } from './job-store.js';
import logger from './logger.js';
import { crawlQueue } from './queue.js';
import { Config, configSchema } from './schema.js';

configDotenv();

const app: Express = express();
const port = Number(process.env.API_PORT) || 3000;
const hostname = process.env.API_HOST || 'localhost';

// Load swagger document at runtime to avoid import assertion issues
const swaggerDocument = JSON.parse(
	await readFile(new URL('../swagger-output.json', import.meta.url), 'utf-8')
) as Record<string, unknown>;

app.use(cors());
app.use(express.json());
// Note: swagger-ui-express has type incompatibilities with express v5
// Cast to unknown first, then to the correct type to avoid type errors
app.use(
	'/api-docs',
	...(swaggerUi.serve as unknown as express.RequestHandler[]),
	swaggerUi.setup(swaggerDocument) as unknown as express.RequestHandler
);

// API Authentication middleware
function authenticateApiKey(req: Request, res: Response, next: NextFunction) {
	const apiKey = process.env.API_KEY;

	// Skip authentication if no API_KEY is configured
	if (!apiKey) {
		return next();
	}

	const requestApiKey = req.headers['x-api-key'];

	if (!requestApiKey || requestApiKey !== apiKey) {
		logger.warn({ path: req.path }, 'Unauthorized API access attempt');
		return res.status(401).json({ message: 'Unauthorized' });
	}

	next();
}

// Define a POST route to accept a config name or custom config and start a crawl job
app.post('/crawl', authenticateApiKey, async (req, res) => {
	const { name, config: customConfig } = req.body;

	let config: Config | undefined;

	// Support either a named task or a custom config object
	if (name && typeof name === 'string') {
		config = getTaskByName(name);

		if (!config) {
			logger.warn({ name }, 'Task not found');
			return res
				.status(404)
				.json({ message: `Task with name '${name}' not found.` });
		}
	} else if (customConfig && typeof customConfig === 'object') {
		// Validate custom config
		const validationResult = configSchema.safeParse(customConfig);
		if (!validationResult.success) {
			logger.warn(
				{ errors: validationResult.error.issues },
				'Invalid custom config'
			);
			return res.status(400).json({
				message: 'Invalid configuration',
				errors: validationResult.error.issues,
			});
		}
		config = validationResult.data;
	} else {
		return res.status(400).json({
			message: "Invalid request body. Either 'name' or 'config' is required.",
		});
	}

	try {
		const jobId = randomUUID();

		// Create job in persistent store
		jobStore.createJob(jobId, config);

		// Add job to queue
		await crawlQueue.add('crawl', { config }, { jobId });

		logger.info({ jobId }, 'Crawl job queued');

		return res.status(202).json({
			jobId,
			message: 'Crawl job started',
			statusUrl: `/crawl/status/${jobId}`,
			resultsUrl: `/crawl/results/${jobId}`,
		});
	} catch (error) {
		logger.error({ error }, 'Error starting job');
		return res.status(500).json({ message: 'Failed to start crawl job.' });
	}
});

// Define a POST route to queue an entire batch of jobs
app.post('/crawl/batch', authenticateApiKey, async (req, res) => {
	const { name } = req.body;

	if (!name || typeof name !== 'string') {
		return res.status(400).json({
			message: "Invalid request body. 'name' (job name) is required.",
		});
	}

	// Get all tasks for this job
	const tasks = getTasksByJobName(name);

	if (!tasks || tasks.length === 0) {
		logger.warn({ jobName: name }, 'Job not found or has no tasks');
		return res.status(404).json({
			message: `Job with name '${name}' not found or has no tasks.`,
			availableJobs: getAllJobNames(),
		});
	}

	try {
		const queuedTasks: Array<{
			configName: string;
			jobId: string;
			statusUrl: string;
			resultsUrl: string;
		}> = [];

		// Queue each task
		for (const task of tasks) {
			const jobId = randomUUID();

			// Create job in persistent store
			jobStore.createJob(jobId, task);

			// Add job to queue
			await crawlQueue.add('crawl', { config: task }, { jobId });

			queuedTasks.push({
				configName: task.name,
				jobId,
				statusUrl: `/crawl/status/${jobId}`,
				resultsUrl: `/crawl/results/${jobId}`,
			});

			logger.info(
				{ jobId, configName: task.name },
				'Task queued for batch job'
			);
		}

		logger.info(
			{ jobName: name, taskCount: queuedTasks.length },
			`Batch job '${name}' queued with ${queuedTasks.length} tasks`
		);

		return res.status(202).json({
			message: `Batch job '${name}' queued with ${queuedTasks.length} ${
				queuedTasks.length === 1 ? 'task' : 'tasks'
			}.`,
			jobName: name,
			taskCount: queuedTasks.length,
			tasks: queuedTasks,
		});
	} catch (error) {
		logger.error({ error, jobName: name }, 'Error queuing batch job');
		return res.status(500).json({ message: 'Failed to queue batch job.' });
	}
});

// Get job status
app.get('/crawl/status/:jobId', authenticateApiKey, (req, res) => {
	const jobId = req.params.jobId;

	if (!jobId) {
		return res.status(400).json({ message: 'Job ID is required' });
	}

	const job = jobStore.getJobById(jobId);

	if (!job) {
		logger.warn({ jobId }, 'Job not found');
		return res.status(404).json({ message: 'Job not found' });
	}

	return res.json({
		jobId: job.id,
		status: job.status,
		createdAt: job.createdAt,
		completedAt: job.completedAt,
		...(job.status === 'failed' && { error: job.error }),
	});
});

// Get job results
app.get('/crawl/results/:jobId', authenticateApiKey, async (req, res) => {
	const jobId = req.params.jobId;

	if (!jobId) {
		return res.status(400).json({ message: 'Job ID is required' });
	}

	const job = jobStore.getJobById(jobId);

	if (!job) {
		logger.warn({ jobId }, 'Job not found');
		return res.status(404).json({ message: 'Job not found' });
	}

	if (job.status === 'pending' || job.status === 'running') {
		return res.status(202).json({
			message: 'Job is still processing',
			status: job.status,
			statusUrl: `/crawl/status/${jobId}`,
		});
	}

	if (job.status === 'failed') {
		logger.warn({ jobId, error: job.error }, 'Failed job results requested');
		return res.status(500).json({
			message: 'Job failed',
			error: job.error,
		});
	}

	if (!job.outputFile) {
		logger.warn({ jobId }, 'No output file generated');
		return res.status(404).json({
			message: 'No output file generated',
		});
	}

	try {
		// Check if file exists
		await stat(job.outputFile);

		// Stream the file to avoid loading it all into memory
		res.contentType('application/json');
		const fileStream = createReadStream(job.outputFile, 'utf-8');
		return fileStream.pipe(res);
	} catch (error) {
		logger.error({ jobId, error }, 'Error reading output file');
		return res.status(500).json({ message: 'Error reading output file' });
	}
});

// Get list of available configurations
app.get('/configurations', authenticateApiKey, async (_req, res) => {
	try {
		const jobNames = getAllJobNames();
		const allTasks = getAllTasks();

		// Build job details with task counts
		const jobs = jobNames.map((jobName) => {
			const tasks = getTasksByJobName(jobName);
			return {
				name: jobName,
				taskCount: tasks.length,
				tasks: tasks.map((t) => ({
					name: t.name,
					urls: t.entry,
				})),
			};
		});

		return res.json({
			jobs,
			tasks: allTasks.map((t) => ({
				name: t.name,
				urls: t.entry,
				outputFileName: t.outputFileName,
			})),
		});
	} catch (error) {
		logger.error({ error }, 'Error fetching configurations');
		return res.status(500).json({ message: 'Error fetching configurations' });
	}
});

const server = app.listen(port, hostname, () => {
	logger.info(`API server listening at http://${hostname}:${port}`);
});

// Graceful shutdown handlers
async function shutdown(signal: string): Promise<void> {
	logger.info({ signal }, 'Shutdown signal received');

	// Stop accepting new connections
	server.close(() => {
		logger.info('HTTP server closed');
	});

	// Close database connections
	try {
		crawlQueue.close();
		logger.info('Queue connection closed');
	} catch (error) {
		logger.error(
			{ error: error instanceof Error ? error.message : error },
			'Error closing queue connection'
		);
	}

	try {
		jobStore.close();
		logger.info('Job store connection closed');
	} catch (error) {
		logger.error(
			{ error: error instanceof Error ? error.message : error },
			'Error closing job store connection'
		);
	}

	logger.info('Server shutdown complete');
	process.exit(0);
}

// Handle shutdown signals
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Handle uncaught errors
process.on('uncaughtException', (error) => {
	logger.error(
		{ error: error.message, stack: error.stack },
		'Uncaught exception'
	);
	shutdown('uncaughtException');
});

process.on('unhandledRejection', (reason) => {
	logger.error(
		{ reason: reason instanceof Error ? reason.message : reason },
		'Unhandled rejection'
	);
	shutdown('unhandledRejection');
});

export default app;
