# Context Crawler

Context Crawler is a powerful and flexible web crawling toolkit designed to generate structured knowledge bases from websites. It features a robust, queue-based architecture for asynchronous processing, a REST API for programmatic control, and a rich command-line interface for direct execution.

Its core purpose is to extract meaningful content and transform it into a format ready for Large Language Models (LLMs), complete with automatic embedding generation and a built-in semantic search API.

## ✨ Features

- **Multiple Operation Modes**: Use the interactive CLI, the REST API, or run the background worker for maximum flexibility.
- **Asynchronous & Resilient**: A queue-based worker system (powered by SQLite) ensures reliable, concurrent, and fault-tolerant crawling.
- **LLM-Ready Artifacts**: Automatically generates text embeddings and vector indexes from crawled content for powerful semantic search.
- **Semantic Search API**: Query your crawled knowledge base using natural language directly via a simple API endpoint.
- **Rich Configuration**: Define complex crawl jobs with fine-grained control over URLs to match/exclude, content selectors (CSS & XPath), and more.
- **Persistent Job Store**: Keeps a complete history of all crawl jobs, their status, and links to their output.
- **Automatic Data Handling**: Intelligently splits large outputs based on token count or file size to respect LLM context limits.
- **Developer Friendly**: Built with TypeScript, Zod for validation, and Pino for structured logging.

---

## 🚀 Getting Started

### Prerequisites

- **Bun**: This project uses Bun as the package manager and runtime.
- **Node.js**: While Bun is used, having a recent Node.js version is recommended.
- **Windows Users**: It is highly recommended to use [Windows Subsystem for Linux (WSL)](https://learn.microsoft.com/en-us/windows/wsl/install) for compatibility.

### Installation

1. **Clone the repository:**

   ```bash
   git clone <your-repository-url>
   cd <repository-directory>
   ```

2. **Install dependencies:**
   This command will also download the necessary Playwright browser binaries.

   ```bash
   bun install
   ```

3. **Set up your environment:**
   Copy the example environment file and customize it as needed.

   ```bash
   cp .env.example .env
   ```

   Key variables in `.env`:
   - `API_PORT`: Port for the API server.
   - `API_KEY`: An optional secret key to protect your API endpoints.
   - `WORKER_CONCURRENCY`: Number of crawl jobs the worker can run in parallel.

### Quick Start: Crawl, Index, and Search

Let's run a pre-defined job, generate its LLM artifacts, and query it.

1. **List available crawl jobs:**

   ```bash
   bun run cli list
   ```

2. **Run a single job:**
   This command runs all configurations for the `zod` job and saves the output to `output/jobs/zod.json`.

   ```bash
   bun run cli single zod
   ```

3. **Generate LLM artifacts:**
   This script processes the JSON output, creates a text file, generates embeddings, and saves a vector index.

   ```bash
   bun run generate:llm-artifacts
   ```

4. **Start the API server:**

   ```bash
   bun run start:server
   ```

5. **Perform a semantic search:**
   Query the indexed `zod` documentation for information about "refinements".

   ```bash
   curl "http://localhost:5000/get/zod/llms.txt?subject=what%20are%20refinements"
   ```

---

## 🛠️ Usage

Context Crawler can be operated in three main ways:

### 1. Command-Line Interface (CLI)

The CLI is ideal for direct control and running jobs synchronously.

- **List all jobs:**

  ```bash
  bun run cli list
  ```

- **Run a single job (e.g., `react-19`):**
  The CLI will run all configs found in `react-19.ts` and aggregate the results.

  ```bash
  bun run cli single react-19
  ```

- **Run a batch of specific jobs:**
  This runs the `prisma` and `trpc` jobs sequentially.

  ```bash
  bun run cli batch prisma trpc
  ```

- **Run in interactive mode:**
  Running `single` or `batch` without arguments will launch an interactive prompt to select jobs.

  ```bash
  bun run cli batch
  ```

### 2. API Server & Worker

For automated workflows, the API server and worker provide a robust, asynchronous system.

1. **Start the Worker:**
   The worker polls the queue for new jobs to process.

   ```bash
   bun run start:worker
   ```

2. **Start the API Server:**
   The server exposes endpoints to queue jobs and check their status.

   ```bash
   bun run start:server
   ```

3. **(Optional) Start Both:**

   ```bash
   bun start
   ```

**Key API Endpoints:**

- `POST /crawl`: Queue a crawl job by name (e.g., `{ "name": "zod" }`).
- `GET /crawl/status/:jobId`: Check the status of a job (`pending`, `running`, `completed`, `failed`).
- `GET /crawl/results/:jobId`: Download the JSON output of a completed job.
- `GET /get/:jobName/llms.txt`: Stream the full text knowledge file.
- `GET /get/:jobName/llms.txt?subject=<query>`: Perform a semantic search on the knowledge file.

Check out the full OpenAPI documentation, available at `/api-docs` when the server is running.

### 3. LLM Features

The core value of Context Crawler is its ability to create searchable knowledge bases.

- **Artifacts**: For each job, the system generates "LLM artifacts":
  - `data/llms/{job-name}.txt`: A clean, concatenated text version of all crawled content.
  - `data/indexes/{job-name}.index`: An HNSWLib vector index for fast semantic search.
- **Generation**: Artifacts are generated automatically when a job completes via the worker. You can also generate or update them manually:

  ```bash
  # Generate artifacts for any outdated job outputs
  bun run generate:llm-artifacts

  # Check if any artifacts are out of sync with their source files
  bun run check:llm-artifacts
  ```

---

## ⚙️ Configuration

All crawl jobs are defined as TypeScript files in the `configurations/jobs/` directory.

### Job vs. Config

- A **Job** is a file in `configurations/jobs/`, like `prisma.ts`. Its name is derived from the filename (e.g., `prisma`).
- A **Config** is a single crawl configuration object within a job file. A job file can export a single config or an array of configs.

**Example: A Single-Config Job (`zod.ts`)**

```typescript
import { defineJob } from '../types.js';

export default defineJob({
	entry: 'https://zod.dev',
	match: [
		'https://zod.dev/basics',
		'https://zod.dev/api',
		// ... more URLs
	],
	selector: 'article',
});
```

**Example: A Multi-Config Job (`next-js-16.ts`)**

```typescript
import { defineJob } from '../types.js';

export default defineJob([
	{
		entry: 'https://nextjs.org/docs/app/getting-started/proxy',
		match: ['https://nextjs.org/docs/app/api-reference/**'],
		selector: 'article',
	},
	{
		entry: 'https://nextjs.org/docs/architecture/accessibility',
		match: ['https://nextjs.org/docs/architecture/accessibility'],
		selector: 'article',
	},
]);
```

### Main Configuration Fields

| Field            | Description                                                              |
| ---------------- | ------------------------------------------------------------------------ |
| `entry`          | **Required.** The starting URL for the crawl.                            |
| `match`          | **Required.** A glob pattern or array of patterns for URLs to crawl.     |
| `selector`       | **Required.** A CSS selector or XPath to extract content from each page. |
| `exclude`        | An optional glob pattern or array of patterns to exclude from the crawl. |
| `outputFileName` | A custom filename for the output JSON. Defaults to `{job-name}.json`.    |
| `maxFileSize`    | Max output file size in MB before splitting.                             |
| `onVisitPage`    | A custom function to perform actions on a page (e.g., click buttons).    |

### Global Configuration

Global settings like `maxPagesToCrawl` and `maxTokens` (for output splitting) can be adjusted in `configurations/global.config.ts`.

---

## 💻 Development Commands

- `bun run build`: Compile TypeScript to the `dist/` directory.
- `bun run dev`: Run the CLI in batch mode (interactive).
- `bun run fmt`: Format the codebase with Prettier.
- `bun run swagger`: Regenerate the Swagger/OpenAPI documentation.
- `bun run generate:jobs`: **Important:** Run this after adding or removing a job file to update the central job registry.
