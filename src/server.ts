import cors from 'cors';
import { randomUUID } from 'crypto';
import { configDotenv } from 'dotenv';
import express, { Express } from 'express';
import { createReadStream, PathLike } from 'fs';
import { readFile, stat } from 'fs/promises';
import swaggerUi from 'swagger-ui-express';
import { getConfigurationByName } from './config/index.js';
import GPTCrawlerCore from './core.js';
import { Config } from './schema.js';

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

// Job management
type JobStatus = 'pending' | 'running' | 'completed' | 'failed';

interface Job {
	id: string;
	status: JobStatus;
	config: Config;
	outputFile?: PathLike | null;
	error?: string;
	createdAt: Date;
	completedAt?: Date;
}

const jobs = new Map<string, Job>();

async function processJob(jobId: string) {
	const job = jobs.get(jobId);
	if (!job) return;

	try {
		job.status = 'running';
		const crawler = new GPTCrawlerCore(job.config);
		await crawler.crawl();
		const outputFileName = await crawler.write();
		job.outputFile = outputFileName;
		job.status = 'completed';
		job.completedAt = new Date();
	} catch (error) {
		job.status = 'failed';
		job.error =
			error instanceof Error ? error.message : 'Unknown error occurred';
		job.completedAt = new Date();
		console.error(`Job ${jobId} failed:`, error);
	}
}

// Define a POST route to accept a config name and start a crawl job
app.post('/crawl', async (req, res) => {
	const { name } = req.body;

	if (!name || typeof name !== 'string') {
		return res.status(400).json({
			message: "Invalid request body. 'name' of the configuration is required.",
		});
	}

	const config = getConfigurationByName(
		name as Parameters<typeof getConfigurationByName>[0]
	);

	if (!config) {
		return res
			.status(404)
			.json({ message: `Configuration with name '${name}' not found.` });
	}

	try {
		const jobId = randomUUID();

		const job: Job = {
			id: jobId,
			status: 'pending',
			config: config,
			createdAt: new Date(),
		};

		jobs.set(jobId, job);

		// Start processing in the background
		(async () => {
			try {
				await processJob(jobId);
			} catch (error) {
				console.error(`Unhandled error in background job ${jobId}:`, error);
				const job = jobs.get(jobId);
				if (job) {
					job.status = 'failed';
					job.error = 'An unexpected error occurred during processing.';
				}
			}
		})();

		return res.status(202).json({
			jobId,
			message: 'Crawl job started',
			statusUrl: `/crawl/status/${jobId}`,
			resultsUrl: `/crawl/results/${jobId}`,
		});
	} catch (error) {
		console.error('Error starting job:', error);
		return res.status(500).json({ message: 'Failed to start crawl job.' });
	}
});

// Get job status
app.get('/crawl/status/:jobId', (req, res) => {
	const { jobId } = req.params;
	const job = jobs.get(jobId);

	if (!job) {
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
app.get('/crawl/results/:jobId', async (req, res) => {
	const { jobId } = req.params;
	const job = jobs.get(jobId);

	if (!job) {
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
		return res.status(500).json({
			message: 'Job failed',
			error: job.error,
		});
	}

	if (!job.outputFile) {
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
		console.error(`Error reading output file for job ${jobId}:`, error);
		return res.status(500).json({ message: 'Error reading output file' });
	}
});

app.listen(port, hostname, () => {
	console.log(`API server listening at http://${hostname}:${port}`);
});

export default app;
