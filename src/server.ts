import cors from 'cors';
import { randomUUID } from 'crypto';
import { configDotenv } from 'dotenv';
import express, { Express, NextFunction, Request, Response } from 'express';
import { createReadStream } from 'fs';
import { readFile, stat } from 'fs/promises';
import swaggerUi from 'swagger-ui-express';
import {
	getAllBatchNames,
	getAllConfigurations,
	getConfigurationByName,
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

	// Support either a named config or a custom config object
	if (name && typeof name === 'string') {
		config = getConfigurationByName(
			name as Parameters<typeof getConfigurationByName>[0]
		);

		if (!config) {
			logger.warn({ name }, 'Configuration not found');
			return res
				.status(404)
				.json({ message: `Configuration with name '${name}' not found.` });
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
		const configurations = getAllConfigurations();
		const batches = getAllBatchNames();

		return res.json({
			configurations: configurations.map((c) => ({
				name: c.name,
				url: c.url,
				outputFileName: c.outputFileName,
			})),
			batches,
		});
	} catch (error) {
		logger.error({ error }, 'Error fetching configurations');
		return res.status(500).json({ message: 'Error fetching configurations' });
	}
});

app.listen(port, hostname, () => {
	logger.info(`API server listening at http://${hostname}:${port}`);
});

export default app;
