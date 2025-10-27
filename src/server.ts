import cors from 'cors';
import { randomUUID } from 'crypto';
import { configDotenv } from 'dotenv';
import express, { Express, NextFunction, Request, Response } from 'express';
import { createReadStream } from 'fs';
import { readFile, stat } from 'fs/promises';
import swaggerUi from 'swagger-ui-express';
import {
	getAllJobNames,
	getJobConfigs,
} from './config.js';
import { jobStore } from './job-store.js';
import logger from './logger.js';
import { crawlQueue } from './queue.js';
import { Config, configSchema, generateOutputFileName } from './schema.js';

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

// Define a POST route to accept a job name or custom config and start a crawl job
app.post('/crawl', authenticateApiKey, async (req, res) => {
	const { name, config: customConfig } = req.body;

	let config: Config | undefined;
	let jobName: string | undefined;

	// Support either a named job or a custom config object
	if (name && typeof name === 'string') {
		const configs = getJobConfigs(name);

		if (!configs || configs.length === 0) {
			logger.warn({ name }, 'Job not found');
			return res
				.status(404)
				.json({ message: `Job with name '${name}' not found.` });
		}

		// For job-based requests, we'll queue each config separately
		// but they all belong to the same job
		jobName = name;

		// Use the first config as the primary one (or could iterate through all)
		config = configs[0];
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
		jobName = 'custom';  // Use 'custom' as the job name for ad-hoc configs
	} else {
		return res.status(400).json({
			message: "Invalid request body. Either 'name' (job name) or 'config' is required.",
		});
	}

	try {
		const jobId = randomUUID();

		// Ensure we have both config and jobName
		if (!config || !jobName) {
			throw new Error('Config or job name is missing');
		}

		// Add output filename
		const configWithFileName: Config = {
			...config,
			outputFileName: generateOutputFileName(jobName),
		};

		// Create job in persistent store
		jobStore.createJob(jobId, configWithFileName);

		// Add job to queue
		await crawlQueue.add('crawl', { config: configWithFileName, jobName }, { jobId });

		logger.info({ jobId, jobName }, 'Crawl job queued');

		return res.status(202).json({
			jobId,
			jobName,
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

	// Get all configs for this job
	const configs = getJobConfigs(name);

	if (!configs || configs.length === 0) {
		logger.warn({ jobName: name }, 'Job not found or has no configs');
		return res.status(404).json({
			message: `Job with name '${name}' not found or has no configs.`,
			availableJobs: getAllJobNames(),
		});
	}

	try {
		const queuedConfigs: Array<{
			configIndex: number;
			jobId: string;
			statusUrl: string;
			resultsUrl: string;
		}> = [];

		// Queue each config
		for (let i = 0; i < configs.length; i++) {
			const config = configs[i]!;
			const jobId = randomUUID();

			// Add output filename
			const configWithFileName = {
				...config,
				outputFileName: generateOutputFileName(name),
			};

			// Create job in persistent store
			jobStore.createJob(jobId, configWithFileName);

			// Add job to queue
			await crawlQueue.add('crawl', { config: configWithFileName, jobName: name }, { jobId });

			queuedConfigs.push({
				configIndex: i,
				jobId,
				statusUrl: `/crawl/status/${jobId}`,
				resultsUrl: `/crawl/results/${jobId}`,
			});

			logger.info(
				{ jobId, jobName: name, configIndex: i },
				'Config queued for batch job'
			);
		}

		logger.info(
			{ jobName: name, configCount: queuedConfigs.length },
			`Batch job '${name}' queued with ${queuedConfigs.length} configs`
		);

		return res.status(202).json({
			message: `Batch job '${name}' queued with ${queuedConfigs.length} ${
				queuedConfigs.length === 1 ? 'config' : 'configs'
			}.`,
			jobName: name,
			configCount: queuedConfigs.length,
			configs: queuedConfigs,
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

		// Build job details with config counts
		const jobs = jobNames.map((jobName) => {
			const configs = getJobConfigs(jobName);
			return {
				name: jobName,
				configCount: configs.length,
				outputFileName: generateOutputFileName(jobName),
			};
		});

		return res.json({
			jobs,
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
