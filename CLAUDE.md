# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Context Crawler is a website crawling tool that generates knowledge files from URLs. It uses a queue-based worker architecture with SQLite for persistent job storage and processing.

**Key Technologies:**
- TypeScript with strict mode enabled
- Crawlee + Playwright for web crawling
- SQLite (better-sqlite3) for queue and job persistence
- Express for REST API
- Pino for structured logging
- Zod for schema validation

## Development Commands

**Build:**
```bash
bun run build         # Compile TypeScript to dist/
bun run check         # Type-check without emitting files
```

**Run Application:**
```bash
# CLI modes
bun run cli -- list                      # List available configurations
bun run cli -- single                    # Run single config (interactive)
bun run cli -- single --config <name>    # Run specific named config
bun run cli -- batch                     # Run batch crawls (interactive)
bun run dev                              # Same as batch mode

# API server + worker
bun start                                # Build, generate swagger, start both server and worker
bun run start:server                     # Start API server only
bun run start:worker                     # Start worker only
```

**Utilities:**
```bash
bun run queue:clear      # Clear completed/failed jobs from queue
bun run swagger          # Generate Swagger API docs
bun run fmt              # Format code with Prettier
bun run prettier:check   # Check code formatting
```

**Important:** Playwright browsers are installed automatically during `npm install` via the preinstall hook.

## Architecture

### Three-Tier Architecture

1. **CLI Layer** (`src/cli.ts`): Commander-based CLI with three modes:
   - `list`: Display available configurations and batches
   - `single`: Run a single configuration (optionally queued)
   - `batch`: Run multiple configurations from a batch (optionally queued)

2. **API Layer** (`src/server.ts`): Express REST API for:
   - `POST /crawl`: Submit crawl jobs (by name or custom config)
   - `GET /crawl/status/:jobId`: Check job status
   - `GET /crawl/results/:jobId`: Download results (streams JSON)
   - `GET /configurations`: List available configs
   - Authentication via `X-API-KEY` header when `API_KEY` env var is set

3. **Worker Layer** (`src/worker.ts`): Background job processor:
   - Polls SQLite queue for pending jobs
   - Processes jobs concurrently (controlled by `WORKER_CONCURRENCY`)
   - Implements exponential backoff retry logic
   - Handles graceful shutdown and cleanup

### Core Components

**Queue System** (`src/queue.ts`):
- SQLite-based job queue with WAL mode for better concurrency
- Job states: `pending` → `claimed` → `completed`/`failed`
- Automatic retry with exponential backoff
- Priority support and claim timeouts

**Job Store** (`src/job-store.ts`):
- Persists job metadata, status, and results
- Tracks job lifecycle from submission to completion
- Stores output file paths and error information

**Configuration System** (`src/config.ts`):
- Auto-discovers configs from `configurations/` subdirectories
- Each subdirectory becomes a "batch" of related configs
- Global config: `configurations/config.json` (maxPagesToCrawl, maxTokens)
- Individual configs: `configurations/{batch-name}/{config-name}.json`

**Crawler Core** (`src/core.ts`):
- Uses Crawlee's PlaywrightCrawler for robust crawling
- Supports XPath (starting with `/`) and CSS selectors
- Handles cookies, resource exclusions, and wait timeouts
- Implements automatic file splitting based on token limits and file size
- Isolated storage per job to enable concurrent crawling

**Schema** (`src/schema.ts`):
- Zod schemas for config validation
- `globalConfigSchema`: Global settings (maxPagesToCrawl, maxTokens)
- `configSchema`: Individual crawl configuration
- Helper functions for generating names and file paths from URLs

### Data Flow

```
CLI/API → Job Store → Queue → Worker → Crawler → Output Files
                                  ↓
                            Job Store (status updates)
```

1. User submits crawl via CLI or API
2. Job created in Job Store with status `pending`
3. Job added to Queue
4. Worker claims job from Queue
5. Worker processes crawl using Crawler Core
6. Crawler writes output to `output/` directory
7. Worker updates Job Store with results/errors
8. Worker marks Queue job as completed/failed

### Concurrency and Isolation

**Per-Job Isolation:**
- Each crawl gets unique `storageDir` (e.g., `storage/job-{uuid}`)
- Each crawl gets unique `datasetName` (e.g., `crawl-{timestamp}-{random}`)
- Prevents Crawlee storage conflicts during concurrent crawling

**Worker Concurrency:**
- Default: 2 concurrent jobs (configurable via `WORKER_CONCURRENCY`)
- Reduced from 5 to prevent memory exhaustion and file system race conditions
- Each job runs in isolated storage to avoid conflicts

## Configuration Structure

**Global Config** (`configurations/config.json`):
```json
{
  "maxPagesToCrawl": 1000,
  "maxTokens": 2000000
}
```

**Individual Config** (`configurations/{batch}/{name}.json`):
```json
{
  "name": "react-19-reference",
  "url": "https://react.dev/reference/react",
  "match": "https://react.dev/reference/react/**",
  "selector": "article",
  "outputFileName": "output/react/reference.json",  // optional
  "maxFileSize": 50,                                 // optional (MB)
  "exclude": ["**/archive/**"],                      // optional
  "resourceExclusions": ["image", "font"],           // optional
  "waitForSelectorTimeout": 10000,                   // optional (ms)
  "cookie": { "name": "consent", "value": "yes" }    // optional
}
```

**Batch Organization:**
- Each subdirectory in `configurations/` is a batch
- Example batches: `react/`, `nextJs/`, `trpc/`, `prisma/`
- Batch names used in CLI: `bun run cli -- batch react nextJs`

## Output Management

**File Naming:**
- If `outputFileName` specified: uses that path
- Otherwise: auto-generated as `output/{domain}/{path}.json`

**Automatic Splitting:**
Files split when exceeding limits (creates numbered files: `output-1.json`, `output-2.json`, etc.):
- Token limit: `maxTokens` from global config (checked with `gpt-tokenizer`)
- File size limit: `maxFileSize` from individual config (in MB)

**Output Format:**
```json
[
  {
    "title": "Page Title",
    "url": "https://example.com/page",
    "html": "Extracted content..."
  }
]
```

## Environment Configuration

Copy `.env.example` to `.env`:

```env
# API Server
API_PORT=5000
API_HOST=localhost
API_KEY=                      # Optional: enables auth when set

# Worker
WORKER_CONCURRENCY=2          # Concurrent crawl jobs
POLL_INTERVAL_MS=1000         # Queue polling frequency
MAX_POLL_INTERVAL_MS=10000    # Max backoff when queue empty
JOB_TIMEOUT_MS=1800000        # Job timeout (30 min)
BACKOFF_DELAY_MS=5000         # Initial retry delay

# Logging
LOG_LEVEL=info
NODE_ENV=development
```

## TypeScript Configuration

- Extends `@apify/tsconfig`
- Strict mode enabled with all strictness flags
- `noUncheckedIndexedAccess: true` for safer array access
- ES2022 target and module system
- Output to `dist/` directory

## Important Implementation Details

**Crawlee Dataset Isolation:**
- Each crawl job must have unique `datasetName` and `storageDir`
- Generated in `src/core.ts` when not provided in config
- Critical for concurrent job processing without data corruption

**SQLite Configuration:**
- WAL (Write-Ahead Logging) mode enabled for better concurrency
- Two databases: `data/queue.db` (queue) and `data/jobs.db` (job metadata)
- Automatic directory creation for database paths

**Selector Support:**
- XPath selectors: Must start with `/` (e.g., `//article[@class="content"]`)
- CSS selectors: Everything else (e.g., `article.content`)
- Evaluation happens in browser context via Playwright

**Error Handling:**
- Failed jobs retry with exponential backoff
- Default max attempts: 3
- Retry delay doubles each attempt (starting at `BACKOFF_DELAY_MS`)
- Worker handles cleanup on job failure

**Graceful Shutdown:**
- Worker listens for SIGTERM/SIGINT
- Completes active jobs before exiting
- Releases claimed jobs back to queue if needed

## CLI Override Flags

Any config field can be overridden via CLI:
```bash
bun run cli -- single --config my-crawler \
  --outputFileName custom.json \
  --maxFileSize 100 \
  --waitForSelectorTimeout 5000
```

This allows quick config adjustments without editing JSON files.
