# Context Crawler <!-- omit from toc -->

Crawl websites to generate knowledge files from one or multiple URLs.

- [Features](#features)
- [Get Started](#get-started)
  - [Prerequisites](#prerequisites)
  - [Installation](#installation)
  - [Configuration](#configuration)
    - [Adding a New Configuration](#adding-a-new-configuration)
  - [Usage](#usage)
    - [CLI Mode](#cli-mode)
    - [Batch Mode](#batch-mode)
    - [API Server](#api-server)
- [Configuration Options](#configuration-options)
- [Project Structure](#project-structure)
- [Output](#output)
- [Using the Output](#using-the-output)
- [Contributing](#contributing)

## Features

- **Multiple Operating Modes**: CLI interactive mode, batch processing, and REST API server
- **Flexible Configuration**: Named configurations with batch support for crawling multiple sites
- **Smart Output Management**: Automatic file splitting based on token limits and file size
- **Sitemap Support**: Can crawl from sitemaps or individual URLs
- **Resource Filtering**: Exclude specific resource types to optimize crawling
- **Cookie Support**: Handle authenticated pages with cookie configuration
- **XPath & CSS Selectors**: Extract content using either XPath or CSS selectors

## Get Started

### Prerequisites

- Node.js >= 16
- npm or equivalent package manager

### Installation

1. Clone the repository:

```sh
git clone <your-repository-url>
cd context-crawler
```

2. Install dependencies:

```sh
npm install
```

Playwright browsers will be installed automatically during the installation process.

### Configuration

The project uses a centralized configuration system. Configurations are defined in `src/config/batch-config.ts`.

#### Adding a New Configuration

Open `src/config/batch-config.ts` and add your configuration to one of the existing batches or create a new batch:

```ts
const myBatch = [
	{
		name: 'my-crawler',
		url: 'https://example.com/docs',
		match: 'https://example.com/docs/**',
		selector: 'article',
		maxPagesToCrawl: 50,
		outputFileName: 'data/example/output.json',
		maxTokens: 2000000,
	},
] as const satisfies readonly NamedConfig[];

export const batchConfigs = {
	react,
	nextJs,
	trpc,
	prisma,
	myBatch, // Add your new batch here
} as const;
```

### Usage

#### CLI Mode

Run the crawler interactively (you'll be prompted for configuration):

```sh
npm start
```

Or use a named configuration:

```sh
npm run start:cli -- --config my-crawler
```

Override configuration options via CLI flags:

```sh
npm run start:cli -- --config my-crawler --maxPagesToCrawl 100
```

#### Batch Mode

For processing multiple configurations sequentially, edit `src/config/main.ts`:

```ts
const batchName: BatchName = 'react'; // Change to your batch name
```

Then run:

```sh
npm run start:dev
```

For production:

```sh
npm run start:prod
```

#### API Server

Start the REST API server:

```sh
npm run start:server
```

The server runs on `http://localhost:5000` by default (configurable via `.env`).

**API Endpoints:**

- `POST /crawl` - Start a crawl job

  ```json
  {
  	"name": "react-19-reference"
  }
  ```

- `GET /crawl/status/:jobId` - Check job status
- `GET /crawl/results/:jobId` - Download results (streams JSON file)
- `GET /api-docs` - View Swagger API documentation

**Environment Configuration:**

Copy `.env.example` to `.env` and customize:

```env
API_PORT=5000
API_HOST=localhost
MAX_PAGES_TO_CRAWL=45
NODE_ENV=development
```

## Configuration Options

The configuration schema is defined in `src/schema.ts`. Key options include:

```ts
type Config = {
	/** Starting URL (supports sitemaps ending in .xml) */
	url: string;

	/** Pattern to match for crawling (glob format) */
	match: string | string[];

	/** CSS selector or XPath (starting with /) to extract content */
	selector: string;

	/** Maximum pages to crawl */
	maxPagesToCrawl: number;

	/** Output file path */
	outputFileName: string;

	/** Maximum tokens per output file (will split if exceeded) */
	maxTokens?: number;

	/** Maximum file size in MB (will split if exceeded) */
	maxFileSize?: number;

	/** Resource types to exclude during crawl */
	resourceExclusions?: string[];

	/** Timeout for waiting for selector (ms) */
	waitForSelectorTimeout?: number;

	/** Cookie configuration for authenticated pages */
	cookie?:
		| { name: string; value: string }
		| Array<{ name: string; value: string }>;

	/** URLs to exclude from crawling */
	exclude?: string | string[];

	/** Custom page visit handler */
	onVisitPage?: (context: {
		page: Page;
		pushData: (data: CrawledData) => Promise<void>;
	}) => Promise<void>;
};
```

## Project Structure

```
context-crawler/
├── src/
│   ├── config/
│   │   ├── batch-config.ts    # Batch crawl configurations
│   │   ├── index.ts           # Configuration utilities
│   │   └── main.ts            # Batch execution entry point
│   ├── cli.ts                 # CLI interface
│   ├── server.ts              # Express API server
│   ├── core.ts                # Core crawling logic
│   └── schema.ts              # Configuration schema & types
├── data/                      # Output directory for crawled data
├── storage/                   # Temporary crawl storage (auto-generated)
└── dist/                      # Compiled TypeScript output
```

## Output

Crawled data is saved in JSON format. Each entry contains:

```json
{
	"title": "Page Title",
	"url": "https://example.com/page",
	"html": "Extracted content text..."
}
```

Files are automatically split if they exceed `maxTokens` or `maxFileSize` limits, with filenames like:

- `output-1.json`
- `output-2.json`
- etc.

## Using the Output

The crawler generates JSON files that can be used as knowledge bases for various AI applications, chatbots, or custom assistants.

## Contributing

Contributions are welcome! Know how to improve this project? Send a PR!
