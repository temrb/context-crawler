# Context Crawler <!-- omit from toc -->

Crawl websites to generate knowledge files from one or multiple URLs. Built with a queue-based worker architecture for scalable, concurrent crawling.

- [Features](#features)
- [Get Started](#get-started)
  - [Prerequisites](#prerequisites)
  - [Installation](#installation)
  - [Configuration](#configuration)
    - [Global Configuration Setup](#global-configuration-setup)
    - [Adding Individual Configurations](#adding-individual-configurations)
  - [Usage](#usage)
    - [CLI Mode](#cli-mode)
    - [Batch Mode](#batch-mode)
    - [API Server](#api-server)
- [Configuration Options](#configuration-options)
  - [Individual Configuration Options](#individual-configuration-options)
  - [Global Configuration Options](#global-configuration-options)
- [Project Structure](#project-structure)
- [Output](#output)
- [Using the Output](#using-the-output)
- [Architecture Overview](#architecture-overview)
- [Utility Scripts](#utility-scripts)
- [Contributing](#contributing)

## Features

- **Queue-Based Worker Architecture**: Async job processing with persistent SQLite queue and job tracking
- **Multiple Operating Modes**: CLI interactive mode, batch processing, and REST API server
- **Flexible Configuration**: JSON-based configurations with auto-discovery and global settings
- **Concurrent Processing**: Configurable worker concurrency for parallel crawling
- **Smart Output Management**: Automatic file splitting based on global token limits and per-config file size
- **Sitemap Support**: Can crawl from sitemaps or individual URLs
- **Resource Filtering**: Exclude specific resource types to optimize crawling
- **Cookie Support**: Handle authenticated pages with cookie configuration
- **XPath & CSS Selectors**: Extract content using either XPath or CSS selectors
- **Structured Logging**: Pino-based logging with configurable levels

## Get Started

### Prerequisites

- Node.js >= 16
- npm or Bun package manager

### Installation

1. Clone the repository:

```sh
git clone <your-repository-url>
cd context-crawler
```

2. Install dependencies:

```sh
npm install
# or
bun install
```

Playwright browsers will be installed automatically during the installation process.

3. Create the global configuration file `configurations/.config.json`:

```json
{
	"maxPagesToCrawl": 500,
	"maxTokens": 2000000
}
```

This file is required and contains settings that apply to all crawl jobs.

### Configuration

The project uses a JSON-based configuration system with two types of configurations:

1. **Individual Configurations**: Crawl-specific settings (URL, selectors, etc.)
2. **Global Configuration**: Settings that apply to all crawl jobs (limits, tokens, etc.)

#### Global Configuration Setup

The global configuration file `configurations/.config.json` contains settings that apply to all crawl jobs. Create this file first:

```json
{
	"maxPagesToCrawl": 500,
	"maxTokens": 2000000
}
```

#### Adding Individual Configurations

Individual configurations are stored in `configurations/` subdirectories, organized by batch:

1. Create a batch directory:

```sh
mkdir -p configurations/my-batch
```

2. Create your configuration file (e.g., `configurations/my-batch/my-crawler.json`):

```json
{
	"name": "my-crawler",
	"url": "https://example.com/docs",
	"match": "https://example.com/docs/**",
	"selector": "article"
}
```

Configurations are automatically discovered from the directory structure. Each subdirectory in `configurations/` becomes a batch, containing one or more configuration files.

### Usage

#### CLI Mode

**List available configurations and batches:**

```sh
bun run cli -- list
```

**Run a single configuration (interactive):**

```sh
bun run cli -- single
```

**Run a specific named configuration:**

```sh
bun run cli -- single --config react-19-reference
```

**Override configuration options via CLI flags:**

```sh
bun run cli -- single --config my-crawler --outputFileName custom-output.json
```

#### Batch Mode

**Run batch crawls (interactive - choose batches and mode):**

```sh
bun run cli -- batch
# or for development
bun run dev
```

**Run specific batches directly:**

```sh
bun run cli -- batch react nextJs
```

**Queue batches for worker processing:**

```sh
bun run cli -- batch react --queue
```

The CLI will prompt you to choose between:
- **Run directly**: Execute crawls sequentially and wait for completion
- **Queue for worker**: Add jobs to queue for async processing by worker

#### API Server

**Start both server and worker:**

```sh
npm start
# or
bun start
```

This starts:
- API server on `http://localhost:5000` (or configured port)
- Worker process that polls the queue for jobs

**Start server only:**

```sh
npm run start:server
```

**Start worker only:**

```sh
npm run start:worker
```

**API Endpoints:**

- `POST /crawl` - Start a crawl job (with named config)

  ```json
  {
  	"name": "react-19-reference"
  }
  ```

  Or with custom config:

  ```json
  {
  	"config": {
  		"name": "custom-crawl",
  		"url": "https://example.com",
  		"match": "https://example.com/**",
  		"selector": "article"
  	}
  }
  ```

- `GET /crawl/status/:jobId` - Check job status
- `GET /crawl/results/:jobId` - Download results (streams JSON file)
- `GET /configurations` - List available configurations and batches
- `GET /api-docs` - View Swagger API documentation

**Environment Configuration:**

Copy `.env.example` to `.env` and customize:

```env
# API Server
API_PORT=5000
API_HOST=localhost

# API Key (Optional - leave unset for local development)
# API_KEY=your-secret-api-key-here

# Worker Configuration
WORKER_CONCURRENCY=2  # Number of concurrent crawl jobs
POLL_INTERVAL_MS=1000
MAX_POLL_INTERVAL_MS=10000
JOB_TIMEOUT_MS=1800000  # 30 minutes

# Logging
LOG_LEVEL=info
NODE_ENV=development
```

**API Authentication:**

When `API_KEY` is set in `.env`, all API endpoints require the `X-API-KEY` header:

```sh
curl -H "X-API-KEY: your-secret-api-key-here" \
  http://localhost:5000/crawl/status/job-id
```

## Configuration Options

The configuration system uses two types of configuration files, both defined in `src/schema.ts`:

### Individual Configuration Options

Each individual configuration file in `configurations/{batch-name}/` should contain:

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `name` | `string` | ✅ | Unique identifier for this configuration |
| `url` | `string` | ✅ | Starting URL (supports sitemaps ending in .xml) |
| `match` | `string \| string[]` | ✅ | URL pattern(s) to match for crawling (glob format) |
| `selector` | `string` | ✅ | CSS selector or XPath (starting with /) to extract content |
| `outputFileName` | `string` | | Output file path (auto-generated from URL if not provided) |
| `maxFileSize` | `number` | | Maximum file size in MB (will split if exceeded) |
| `exclude` | `string \| string[]` | | URL pattern(s) to exclude from crawling |
| `resourceExclusions` | `string[]` | | Resource types to exclude during crawl |
| `waitForSelectorTimeout` | `number` | | Timeout for waiting for selector (ms) |
| `cookie` | `object \| object[]` | | Cookie configuration for authenticated pages<br>`{ name: string, value: string }` |

**Example Individual Configuration:**

```json
{
	"name": "react-19-reference",
	"url": "https://react.dev/reference/react",
	"match": "https://react.dev/reference/react/**",
	"selector": "article"
}
```

### Global Configuration Options

Global settings in `configurations/.config.json` that apply to all crawl jobs:

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `maxPagesToCrawl` | `number` | ✅ | Maximum number of pages to crawl per job |
| `maxTokens` | `number` | ✅ | Maximum tokens per output file (will split if exceeded) |

**Example Global Configuration:**

```json
{
	"maxPagesToCrawl": 500,
	"maxTokens": 2000000
}
```

## Project Structure

```
context-crawler/
├── src/
│   ├── cli.ts                 # CLI interface with single/batch/list commands
│   ├── server.ts              # Express REST API server
│   ├── worker.ts              # Queue worker process
│   ├── core.ts                # Core crawling logic (Crawlee/Playwright)
│   ├── queue.ts               # SQLite-based job queue
│   ├── job-store.ts           # SQLite-based job persistence
│   ├── config.ts              # Configuration loader (auto-discovery)
│   ├── logger.ts              # Pino structured logger
│   └── schema.ts              # Zod configuration schema & types
├── configurations/            # JSON configuration files
│   ├── .config.json           # Global configuration (maxPagesToCrawl, maxTokens)
│   ├── react/                 # React documentation configs
│   ├── nextJs/                # Next.js documentation configs
│   ├── trpc/                  # tRPC documentation configs
│   └── prisma/                # Prisma documentation configs
├── data/                      # SQLite databases
│   ├── jobs.db                # Job tracking database
│   └── queue.db               # Job queue database
├── output/                    # Crawled data output (JSON files)
├── storage/                   # Temporary crawl storage (auto-generated per job)
├── scripts/                   # Utility scripts
│   └── clear-queue.js         # Queue management script
└── dist/                      # Compiled TypeScript output
```

**Key Components:**

- **CLI**: Interactive command-line interface for running crawls
- **Server**: REST API for submitting and monitoring crawl jobs
- **Worker**: Background process that executes queued crawl jobs
- **Queue**: Persistent SQLite queue with retry logic and concurrency control
- **Job Store**: Tracks job status, results, and metadata
- **Config Loader**: Auto-discovers individual configs from `configurations/` subdirectories and loads global settings from `.config.json`

## Output

Crawled data is saved in JSON format in the `output/` directory. Each entry contains:

```json
{
	"title": "Page Title",
	"url": "https://example.com/page",
	"html": "Extracted content text..."
}
```

**Output File Naming:**

- If `outputFileName` is specified in config, that path is used
- Otherwise, auto-generated based on URL: `output/{domain}/{path}.json`

**Automatic File Splitting:**

Files are automatically split when they exceed configured limits:
- **Token limit**: `maxTokens` (set in global config)
- **File size limit**: `maxFileSize` (set per-config in MB)

When splitting occurs, files are numbered sequentially:
- `output-1.json`
- `output-2.json`
- etc.

**Example Output Structure:**

```
output/
├── react/
│   └── reference.json
├── nextjs/
│   └── docs.json
├── trpc/
│   └── docs.json
└── prisma/
    └── docs.json
```

## Using the Output

The crawler generates JSON files that can be used as:
- Knowledge bases for AI applications
- Training data for chatbots
- Context for custom assistants (Claude, ChatGPT, etc.)
- Documentation search indices
- Content archives

## Architecture Overview

Context Crawler uses a queue-based worker architecture for scalable, concurrent crawling:

1. **Job Submission**: Jobs are submitted via CLI or API
2. **Queue Storage**: Jobs are persisted in SQLite queue (`data/queue.db`)
3. **Worker Polling**: Worker process polls queue for available jobs
4. **Concurrent Execution**: Multiple jobs run concurrently (configurable via `WORKER_CONCURRENCY`)
5. **Job Tracking**: Job status and results stored in `data/jobs.db`
6. **Retry Logic**: Failed jobs are automatically retried with exponential backoff
7. **Result Retrieval**: Results accessible via API or file system

This architecture enables:
- **Scalability**: Process multiple crawls concurrently
- **Reliability**: Jobs persist across restarts; automatic retry on failure
- **Monitoring**: Track job status and retrieve results via API
- **Flexibility**: Run directly or queue for async processing

## Utility Scripts

**Clear the job queue:**

```sh
npm run queue:clear
# or
bun run queue:clear
```

## Contributing

Contributions are welcome! Know how to improve this project? Send a PR!
