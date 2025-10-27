# **Final Master Plan: AI-Ready Knowledge API**

## **Architectural Strategy**

The core strategy is to decouple the generation of AI-ready artifacts (`.txt` files and vector indexes) from the server's startup process. Instead, we will integrate this generation directly into the **worker's job lifecycle**. This ensures that whenever a crawl job successfully completes and its JSON output is updated, the corresponding AI knowledge base is immediately and automatically regenerated, guaranteeing data freshness.

The server's role on startup will be a secondary one: to perform a quick consistency check and build any missing artifacts, but not to block its own launch.

---

### **Step 1: Project Setup (Dependencies)**

First, add the necessary libraries for text processing, embedding generation, and high-performance vector search.

```bash
bun add langchain @xenova/transformers hnswlib-node
```

- **`langchain`**: Provides high-level tools for text splitting and vector store management.
- **`@xenova/transformers`**: Powers the embedding model that runs locally within Node.js, requiring no external APIs.
- **`hnswlib-node`**: A high-performance library for vector similarity search.

---

### **Step 2: The Core Logic (Hardened `LLMService`)**

Create a new file at **`src/llm-service.ts`**. This service will be the central hub for managing all LLM-related data. It is designed for on-demand, single-job processing and includes cache invalidation.

````typescript
// src/llm-service.ts
import { glob } from 'glob';
import { createReadStream, existsSync } from 'fs';
import { mkdir, readFile, stat, writeFile } from 'fs/promises';
import { join, parse } from 'path';
import { RecursiveCharacterTextSplitter } from 'langchain/text_splitter';
import { HNSWLib } from '@langchain/community/vectorstores/hnswlib';
import { TransformersEmbeddings } from '@langchain/community/embeddings/xenova';
import logger from './logger.js';
import { CrawledData } from './schema.js';

const LLMS_DIR = join(process.cwd(), 'data', 'llms');
const INDEXES_DIR = join(process.cwd(), 'data', 'indexes');
const JOBS_OUTPUT_DIR = join(process.cwd(), 'output', 'jobs');

class LLMService {
 // A simple in-memory cache. For larger scale, consider an LRU cache.
 private vectorStores: Map<string, HNSWLib> = new Map();
 private embeddings: TransformersEmbeddings;
 private isInitialized = false;

 constructor() {
  this.embeddings = new TransformersEmbeddings({
   model: 'Xenova/all-MiniLM-L6-v2',
  });
  logger.info('LLMService initialized with embedding model.');
 }

 /**
  * Scans for crawled JSON files on startup and updates artifacts if they are stale.
  * This acts as a consistency check for jobs run while the server was offline.
  */
 public async initialize() {
  if (this.isInitialized) return;
  logger.info('Initializing LLMService: Checking for stale artifacts...');
  await mkdir(LLMS_DIR, { recursive: true });
  await mkdir(INDEXES_DIR, { recursive: true });

  const jobFiles = await glob(`${JOBS_OUTPUT_DIR}/*.json`);
  const processingPromises = jobFiles.map(async (jobFile) => {
   const jobName = parse(jobFile).name;
   try {
    const shouldUpdate = await this.isArtifactStale(jobName, jobFile);
    if (shouldUpdate) {
     await this.generateArtifacts(jobName, jobFile);
    }
   } catch (error) {
    logger.error(
     { job: jobName, error: error instanceof Error ? error.message : error },
     `Failed initial artifact generation for job`
    );
   }
  });

  await Promise.all(processingPromises);
  this.isInitialized = true;
  logger.info('LLMService initialization scan complete.');
 }

 /**
  * The primary method for creating/updating artifacts for a single job.
  * This should be called by the worker after a successful crawl job.
  */
 public async processJobOutput(jobName: string): Promise<void> {
  const jsonPath = join(JOBS_OUTPUT_DIR, `${jobName}.json`);
  if (!existsSync(jsonPath)) {
   throw new Error(`Job output file for '${jobName}' does not exist at ${jsonPath}.`);
  }
  await this.generateArtifacts(jobName, jsonPath);
 }

 private async generateArtifacts(jobName: string, jsonPath: string) {
  logger.info({ job: jobName }, `Generating/Updating LLM artifacts for ${jobName}...`);

  // 1. Generate the llms.txt file
  const llmTextPath = join(LLMS_DIR, `${jobName}.txt`);
  const rawJson = await readFile(jsonPath, 'utf-8');
  const data = JSON.parse(rawJson) as CrawledData[];
  const formattedText = data
   .map(item => `---
Title: ${item.title}
URL: ${item.url}
---
${item.html}`)
   .join('\n\n');
  await writeFile(llmTextPath, formattedText);
  logger.debug({ job: jobName, path: llmTextPath }, `Generated ${jobName}.txt`);

  // 2. Generate and save the vector index
  const textSplitter = new RecursiveCharacterTextSplitter({ chunkSize: 1000, chunkOverlap: 100 });
  const docs = await textSplitter.createDocuments([formattedText]);
  const vectorStore = await HNSWLib.fromDocuments(docs, this.embeddings);
  const indexPath = join(INDEXES_DIR, `${jobName}.index`);
  await vectorStore.save(indexPath);
  logger.info({ job: jobName, path: indexPath }, `Saved vector index`);

  // 3. Invalidate in-memory cache to force a reload on the next search query
  this.vectorStores.delete(jobName);
  logger.debug({ job: jobName }, 'Invalidated in-memory vector store cache.');
 }

    private async isArtifactStale(jobName: string, jsonPath: string): Promise<boolean> {
        const indexPath = join(INDEXES_DIR, `${jobName}.index`);
        if (!existsSync(indexPath)) return true; // Artifact doesn't exist, must generate.

        const jsonStats = await stat(jsonPath);
        const indexStats = await stat(indexPath);

        // If the source JSON is newer than the index, it's stale.
        return jsonStats.mtime > indexStats.mtime;
    }

 public jobExists(jobName: string): boolean {
  return existsSync(join(LLMS_DIR, `${jobName}.txt`));
 }

 public getFullTextStream(jobName: string) {
  const llmTextPath = join(LLMS_DIR, `${jobName}.txt`);
  return createReadStream(llmTextPath, 'utf-8');
 }

 public async search(jobName: string, query: string, k: number = 5): Promise<string> {
  if (!this.vectorStores.has(jobName)) {
   const indexPath = join(INDEXES_DIR, `${jobName}.index`);
   if (!existsSync(indexPath)) {
    logger.warn({ job: jobName }, 'Index not found for search. Attempting just-in-time generation.');
    await this.processJobOutput(jobName);
                if (!existsSync(indexPath)) {
        throw new Error(`Index for job '${jobName}' could not be found or generated.`);
                }
   }
   const loadedVectorStore = await HNSWLib.load(indexPath, this.embeddings);
   this.vectorStores.set(jobName, loadedVectorStore);
   logger.debug({ job: jobName }, 'Lazy-loaded vector store into memory.');
  }

  const vectorStore = this.vectorStores.get(jobName)!;
  const results = await vectorStore.similaritySearch(query, k);
  if (results.length === 0) {
   return `No relevant information found for the subject: "${query}"`;
  }
  return results
   .map((doc, i) => `--- Result ${i + 1} ---\n${doc.pageContent}`)
   .join('\n\n');
 }
}

export const llmService = new LLMService();```

---

### **Step 3: Integrate with the Worker Lifecycle**

This is the most critical change. Modify **`src/worker.ts`** to trigger the LLM artifact generation after a crawl job successfully completes.

```typescript
// src/worker.ts

// Add the llmService import at the top
import { llmService } from './llm-service.js';
// ... other imports

// Modify the processCrawlJob function
async function processCrawlJob(job: QueueJob): Promise<void> {
  const { config, jobName } = job.data;
  const { jobId } = job;
  logger.info(
    {
      jobId,
      jobName,
      queueJobId: job.id,
      attempt: job.attempts,
      maxAttempts: job.maxAttempts,
    },
    'Processing crawl job',
  );
  try {
    jobStore.updateJobStatus(jobId, 'running');
    const result = await runTask(config, jobName || 'unknown');

    if (result.success) {
      crawlQueue.markCompleted(job.id);
      jobStore.updateJobStatus(jobId, 'completed', {
        outputFile: result.outputFile || undefined,
        completedAt: new Date(),
      });

      // --- CRITICAL INTEGRATION ---
      // After a successful crawl, immediately generate/update the LLM artifacts.
      if (result.outputFile) {
        logger.info({ jobId, jobName }, 'Triggering LLM artifact generation...');
        // We run this without awaiting the entire worker task on it, but we catch
        // errors to ensure indexing failures don't fail the main job.
        llmService.processJobOutput(jobName).catch(err => {
            logger.error({
                jobId,
                jobName,
                error: err instanceof Error ? err.message : err
            }, 'LLM artifact generation failed post-job.');
        });
      }
      // --- END INTEGRATION ---

      const clearedCount = crawlQueue.clearCompletedJobs();
      if (clearedCount > 0) { /* ... */ }
      logger.info(
        { jobId, queueJobId: job.id, outputFile: result.outputFile },
        'Crawl job completed successfully',
      );
    } else {
      throw new Error(result.error || 'Task execution failed');
    }
  } catch (error) {
    // ... (rest of the function is unchanged)
  }
}

// ... rest of worker.ts
````

---

### **Step 4: Enhance the API Layer**

Modify **`src/server.ts`** to add the new endpoints and integrate the startup consistency check.

```typescript
// src/server.ts

// Add these imports at the top
import { llmService } from './llm-service.js';
import { stat } from 'fs/promises';
import { parse, join } from 'path';
import { glob } from 'glob';

// ... other imports

// Define these constants near the top
const JOBS_OUTPUT_DIR = join(process.cwd(), 'output', 'jobs');
const INDEXES_DIR = join(process.cwd(), 'data', 'indexes');

function registerRoutes(): void {
	// ... your existing /crawl and /crawl/batch routes

	// NEW: The enhanced endpoint for serving LLM data
	app.get('/get/:jobName/llms.txt', async (req: Request, res: Response) => {
		const { jobName } = req.params;
		const subject = req.query.subject as string | undefined;
		const k_param = req.query.k as string | undefined;

		const k = k_param ? parseInt(k_param, 10) : 5; // Default to 5 results
		if (isNaN(k) || k <= 0 || k > 20) {
			return res.status(400).json({
				message: 'Query parameter "k" must be a number between 1 and 20.',
			});
		}

		if (!jobName || !llmService.jobExists(jobName)) {
			return res.status(404).json({
				message: `Knowledge file for job '${jobName}' not found.`,
				availableJobs: getAllJobNames(),
			});
		}

		try {
			res.setHeader('Content-Type', 'text/plain; charset=utf-8');

			if (subject && subject.trim() !== '' && subject.trim() !== '*') {
				logger.info({ job: jobName, subject, k }, 'Performing semantic search');
				const searchResults = await llmService.search(jobName, subject, k);
				return res.send(searchResults);
			} else {
				logger.info({ job: jobName }, 'Streaming full llms.txt file');
				const stream = llmService.getFullTextStream(jobName);
				stream.pipe(res);
			}
		} catch (error) {
			const errorMessage =
				error instanceof Error ? error.message : 'Unknown error';
			logger.error(
				{ job: jobName, error: errorMessage },
				'Error serving LLM content'
			);
			res
				.status(500)
				.send(`Error processing request for '${jobName}': ${errorMessage}`);
		}
	});

	// NEW: Visibility endpoint to monitor artifact status
	app.get(
		'/llms/status',
		authenticateApiKey,
		async (_req: Request, res: Response) => {
			try {
				const jobFiles = await glob(`${JOBS_OUTPUT_DIR}/*.json`);
				const statuses = await Promise.all(
					jobFiles.map(async (jobFile) => {
						const jobName = parse(jobFile).name;
						const indexPath = join(INDEXES_DIR, `${jobName}.index`);
						const isIndexed = existsSync(indexPath);
						let lastModified: Date | null = null;
						if (isIndexed) {
							lastModified = (await stat(indexPath)).mtime;
						}
						return { jobName, isIndexed, lastModified };
					})
				);
				res.json(statuses);
			} catch (error) {
				logger.error({ error }, 'Failed to get LLM artifact statuses');
				res
					.status(500)
					.json({ message: 'Could not retrieve artifact statuses.' });
			}
		}
	);
}

// In the main startup IIFE at the bottom of the file:
(async () => {
	// ... (swagger setup, app.use calls, etc.)

	registerRoutes();
	await crawlQueue.initialize();

	// Initialize LLM service (now acts as a non-blocking startup consistency check)
	llmService.initialize().catch((error) => {
		logger.error({ error }, 'Background LLM initialization failed.');
	});

	let port = preferredPort;
	// ... (rest of the server startup logic)
})().catch((error) => {
	logger.error({ error }, 'Failed to start server');
	process.exit(1);
});
```

---

### **Step 5: Final Configuration**

Update your `.gitignore` file to exclude the new data directories.

````gitignore
# Existing ignores...
node_modules
.env
/generated/prisma
dist/
storage/

# Add these lines for LLM artifacts
/data/llms/
/data/indexes/```

### **Step 6 (Optional but Recommended): Pre-downloading the Embedding Model**

To avoid a "cold start" where the model is downloaded on first use (which can fail in offline environments), you can create a simple script to pre-cache it.

Create `scripts/download-model.ts`:
```typescript
// scripts/download-model.ts
import { pipeline } from '@xenova/transformers';

console.log('Downloading and caching embedding model...');

// This will download the model to the cache (~/node_modules/@xenova/transformers/.cache)
const embedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
await embedder('Pre-cache warm-up sentence.');

console.log('Model successfully cached.');
````

Add a script to your `package.json`:

````json
"scripts": {
    "postinstall": "bun run scripts/download-model.ts",
    // ... other scripts
}```
Now, `bun install` will automatically cache the model.

---

### **How It All Works Now: A Summary**

1.  **On `bun install`**: The embedding model is automatically downloaded and cached for offline use.
2.  **On `bun start`**:
    *   The API server starts up.
    *   In the background, `LLMService` quickly scans `output/jobs` and `data/indexes`, regenerating any artifacts that are out of date (e.g., if a crawl was run while the server was offline). This **does not block** the server from starting.
3.  **When a Crawl Job Runs**:
    *   A user or the CLI queues a crawl job.
    *   The worker picks it up and runs the crawl, producing `output/jobs/prisma.json`.
    *   Immediately after the job is marked complete, the worker calls `llmService.processJobOutput('prisma')`.
    *   The `LLMService` generates `data/llms/prisma.txt` and `data/indexes/prisma.index`, overwriting any old versions. It also purges the in-memory cache for `prisma` if it exists.
4.  **When an API Request Arrives**:
    *   `GET /get/prisma/llms.txt`: The full, up-to-date `prisma.txt` is streamed back.
    *   `GET /get/prisma/llms.txt?subject=findUniqueOrThrow&k=3`: The `LLMService` lazy-loads the `prisma.index` into memory (if not already cached), performs a semantic search for "findUniqueOrThrow", and returns the top 3 most relevant text chunks.
    *   `GET /llms/status`: You get a JSON response showing which jobs are indexed and when they were last updated, providing full visibility.

This final master plan provides a complete, robust, and production-ready system that is seamlessly integrated into your existing architecture.
````
