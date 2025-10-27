import cors from 'cors';
import { randomUUID } from 'crypto';
import { configDotenv } from 'dotenv';
import express, { Express, NextFunction, Request, Response } from 'express';
import { createReadStream } from 'fs';
import { readFile, stat } from 'fs/promises';
import net from 'net';
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

const DEFAULT_PORT = 5000;

function parsePort(value: string | undefined): number | undefined {
	if (!value) {
		return undefined;
	}

	const portNumber = Number(value);

	if (
		Number.isNaN(portNumber) ||
		!Number.isInteger(portNumber) ||
		portNumber <= 0 ||
		portNumber > 65535
	) {
		return undefined;
	}

	return portNumber;
}

async function isPortAvailable(host: string, port: number): Promise<boolean> {
	return await new Promise<boolean>((resolve, reject) => {
		const tester = net
			.createServer()
			.once('error', (error: NodeJS.ErrnoException) => {
				if (error.code === 'EADDRINUSE' || error.code === 'EACCES') {
					resolve(false);
				} else {
					reject(error);
				}
			})
			.once('listening', () => {
				tester.close(() => resolve(true));
			})
			.listen(port, host);
	});
}

async function findAvailablePort(
	host: string,
	startPort: number,
	strict: boolean
): Promise<number> {
	const maxAttempts = strict ? 1 : 20;

	for (let attempt = 0; attempt < maxAttempts; attempt++) {
		const candidatePort = startPort + attempt;
		// eslint-disable-next-line no-await-in-loop
		const available = await isPortAvailable(host, candidatePort);

		if (available) {
			return candidatePort;
		}
	}

	throw new Error(
		`Unable to find an available port starting at ${startPort} for host '${host}'`
	);
}

const app: Express = express();
const hostname = process.env.API_HOST || 'localhost';
const apiPortRaw = process.env.API_PORT;
const portEnvRaw = process.env.PORT;
const parsedApiPort = parsePort(apiPortRaw);
const parsedPortEnv = parsePort(portEnvRaw);
const preferredPort = parsedApiPort ?? parsedPortEnv ?? DEFAULT_PORT;
const hasExplicitPort =
	Boolean(parsedPortEnv) ||
	Boolean(
		parsedApiPort !== undefined &&
			parsedApiPort !== DEFAULT_PORT
	);

// Warn if using default configuration
if (!parsedApiPort && apiPortRaw) {
	logger.warn(
		{ value: apiPortRaw },
		'Invalid API_PORT value detected. Falling back to default port handling.'
	);
}

if (!parsedPortEnv && portEnvRaw) {
	logger.warn(
		{ value: portEnvRaw },
		'Invalid PORT value detected. Falling back to default port handling.'
	);
}

if ((!apiPortRaw && !portEnvRaw) || !process.env.API_HOST) {
	logger.warn(
		{ preferredPort, hostname },
		'Using default server configuration. Create a .env file from .env.example to customize.'
	);
}

function authenticateApiKey(req: Request, res: Response, next: NextFunction): void {
	const apiKey = process.env.API_KEY;

	// Skip authentication if no API_KEY is configured
	if (!apiKey) {
		next();
		return;
	}

	const requestApiKey = req.headers['x-api-key'];

	if (!requestApiKey || requestApiKey !== apiKey) {
		logger.warn({ path: req.path }, 'Unauthorized API access attempt');
		res.status(401).json({ message: 'Unauthorized' });
		return;
	}

	next();
}

function registerRoutes(): void {
	// Define a POST route to accept a job name or custom config and start a crawl job
	app.post('/crawl', authenticateApiKey, async (req: Request, res: Response) => {
		const { name, config: customConfig } = req.body;

		let config: Config | undefined;
		let jobName: string | undefined;

		// Support either a named job or a custom config object
		if (name && typeof name === 'string') {
			const configs = getJobConfigs(name);

			if (!configs || configs.length === 0) {
				logger.warn({ name }, 'Job not found');
				res.status(404).json({ message: `Job with name '${name}' not found.` });
				return;
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
				res.status(400).json({
					message: 'Invalid configuration',
					errors: validationResult.error.issues,
				});
				return;
			}
			config = validationResult.data;
			jobName = 'custom'; // Use 'custom' as the job name for ad-hoc configs
		} else {
			res.status(400).json({
				message: "Invalid request body. Either 'name' (job name) or 'config' is required.",
			});
			return;
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

			res.status(202).json({
				jobId,
				jobName,
				message: 'Crawl job started',
				statusUrl: `/crawl/status/${jobId}`,
				resultsUrl: `/crawl/results/${jobId}`,
			});
		} catch (error) {
			logger.error({ error }, 'Error starting job');
			res.status(500).json({ message: 'Failed to start crawl job.' });
		}
	});

	// Define a POST route to queue an entire batch of jobs
	app.post('/crawl/batch', authenticateApiKey, async (req: Request, res: Response) => {
		const { name } = req.body;

		if (!name || typeof name !== 'string') {
			res.status(400).json({
				message: "Invalid request body. 'name' (job name) is required.",
			});
			return;
		}

		// Get all configs for this job
		const configs = getJobConfigs(name);

		if (!configs || configs.length === 0) {
			logger.warn({ jobName: name }, 'Job not found or has no configs');
			res.status(404).json({
				message: `Job with name '${name}' not found or has no configs.`,
				availableJobs: getAllJobNames(),
			});
			return;
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

			res.status(202).json({
				message: `Batch job '${name}' queued with ${queuedConfigs.length} ${
					queuedConfigs.length === 1 ? 'config' : 'configs'
				}.`,
				jobName: name,
				configCount: queuedConfigs.length,
				configs: queuedConfigs,
			});
		} catch (error) {
			logger.error({ error, jobName: name }, 'Error queuing batch job');
			res.status(500).json({ message: 'Failed to queue batch job.' });
		}
	});

	// Get job status
	app.get('/crawl/status/:jobId', authenticateApiKey, (req: Request, res: Response) => {
		const jobId = req.params.jobId;

		if (!jobId) {
			res.status(400).json({ message: 'Job ID is required' });
			return;
		}

		const job = jobStore.getJobById(jobId);

		if (!job) {
			logger.warn({ jobId }, 'Job not found');
			res.status(404).json({ message: 'Job not found' });
			return;
		}

		res.json({
			jobId: job.id,
			status: job.status,
			createdAt: job.createdAt,
			completedAt: job.completedAt,
			...(job.status === 'failed' && { error: job.error }),
		});
	});

	// Get job results
	app.get('/crawl/results/:jobId', authenticateApiKey, async (req: Request, res: Response) => {
		const jobId = req.params.jobId;

		if (!jobId) {
			res.status(400).json({ message: 'Job ID is required' });
			return;
		}

		const job = jobStore.getJobById(jobId);

		if (!job) {
			logger.warn({ jobId }, 'Job not found');
			res.status(404).json({ message: 'Job not found' });
			return;
		}

		if (job.status === 'pending' || job.status === 'running') {
			res.status(202).json({
				message: 'Job is still processing',
				status: job.status,
				statusUrl: `/crawl/status/${jobId}`,
			});
			return;
		}

		if (job.status === 'failed') {
			logger.warn({ jobId, error: job.error }, 'Failed job results requested');
			res.status(500).json({
				message: 'Job failed',
				error: job.error,
			});
			return;
		}

		if (!job.outputFile) {
			logger.warn({ jobId }, 'No output file generated');
			res.status(404).json({
				message: 'No output file generated',
			});
			return;
		}

		try {
			// Check if file exists
			await stat(job.outputFile);

			// Stream the file to avoid loading it all into memory
			res.contentType('application/json');
			const fileStream = createReadStream(job.outputFile, 'utf-8');
			fileStream.pipe(res);
			return;
		} catch (error) {
			logger.error({ jobId, error }, 'Error reading output file');
			res.status(500).json({ message: 'Error reading output file' });
		}
	});

	// Get list of available configurations
	app.get('/configurations', authenticateApiKey, async (_req: Request, res: Response) => {
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

			res.json({
				jobs,
			});
		} catch (error) {
			logger.error({ error }, 'Error fetching configurations');
			res.status(500).json({ message: 'Error fetching configurations' });
		}
	});
}

// Wrap async initialization in IIFE to avoid top-level await issues
(async () => {
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

	// API routes
	registerRoutes();


	// Initialize the queue before starting the server
	await crawlQueue.initialize();

	let port = preferredPort;

	try {
		port = await findAvailablePort(hostname, preferredPort, hasExplicitPort);
		if (!hasExplicitPort && port !== preferredPort) {
			logger.warn(
				{ requestedPort: preferredPort, fallbackPort: port },
				`Preferred port ${preferredPort} is unavailable. Using ${port} instead.`
			);
		}
	} catch (error) {
		logger.error(
			{
				error: error instanceof Error ? error.message : error,
				host: hostname,
				requestedPort: preferredPort,
			},
			'Failed to resolve a listening port'
		);
		process.exit(1);
	}

	process.env.API_PORT = port.toString();

	const server = app.listen(port, hostname, () => {
		logger.info(`API server listening at http://${hostname}:${port}`);
		logger.info(
			{
				address: server.address(),
				listening: server.listening,
				constructor: server.constructor.name,
			},
			'HTTP server address info'
		);
	});
	server.on('close', () => {
		logger.info('HTTP server close event emitted');
	});
	server.on('listening', () => {
		logger.info('HTTP server listening event emitted');
	});
	server.on('error', (error) => {
		logger.error({ error }, 'HTTP server error event emitted');
	});
	setImmediate(() => {
		logger.info(
			{ address: server.address(), listening: server.listening },
			'HTTP server immediate state'
		);
	});
	setTimeout(() => {
		logger.info({ address: server.address() }, 'HTTP server address after delay');
	}, 1000).unref();

	let isShuttingDown = false;
	let resolveShutdown: ((code: number) => void) | undefined;

	const shutdownComplete = new Promise<number>((resolve) => {
		resolveShutdown = resolve;
	});

	// Graceful shutdown handlers
	async function shutdown(signal: string, code = 0): Promise<void> {
		if (isShuttingDown) {
			return;
		}

		isShuttingDown = true;
		logger.info({ signal }, 'Shutdown signal received');

		// Stop accepting new connections
		if (server.listening) {
			await new Promise<void>((resolve) => {
				server.close(() => {
					logger.info('HTTP server closed');
					resolve();
				});
			});
		} else {
			logger.info('HTTP server already closed');
		}

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

		if (resolveShutdown) {
			resolveShutdown(code);
			resolveShutdown = undefined;
		}
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
		shutdown('uncaughtException', 1);
	});

	process.on('unhandledRejection', (reason) => {
		logger.error(
			{ reason: reason instanceof Error ? reason.message : reason },
			'Unhandled rejection'
		);
		shutdown('unhandledRejection', 1);
	});

	const exitCode = await shutdownComplete;
	process.exit(exitCode);
})().catch((error) => {
	logger.error({ error }, 'Failed to start server');
	process.exit(1);
});

export default app;
