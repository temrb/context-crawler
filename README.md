# GPT Crawler <!-- omit from toc -->

<!-- Keep these links. Translations will automatically update with the README. -->

[Deutsch](https://www.readme-i18n.com/BuilderIO/gpt-crawler?lang=de) |
[Español](https://www.readme-i18n.com/BuilderIO/gpt-crawler?lang=es) |
[français](https://www.readme-i18n.com/BuilderIO/gpt-crawler?lang=fr) |
[日本語](https://www.readme-i18n.com/BuilderIO/gpt-crawler?lang=ja) |
[한국어](https://www.readme-i18n.com/BuilderIO/gpt-crawler?lang=ko) |
[Português](https://www.readme-i18n.com/BuilderIO/gpt-crawler?lang=pt) |
[Русский](https://www.readme-i18n.com/BuilderIO/gpt-crawler?lang=ru) |
[中文](https://www.readme-i18n.com/BuilderIO/gpt-crawler?lang=zh)

Crawl websites to generate knowledge files for creating custom GPTs from one or multiple URLs.

![Gif showing the crawl run](https://github.com/BuilderIO/gpt-crawler/assets/844291/feb8763a-152b-4708-9c92-013b5c70d2f2)

- [Features](#features)
- [Example](#example)
- [Get Started](#get-started)
  - [Prerequisites](#prerequisites)
  - [Installation](#installation)
  - [Configuration](#configuration)
  - [Usage](#usage)
    - [CLI Mode](#cli-mode)
    - [Batch Mode](#batch-mode)
    - [API Server](#api-server)
- [Configuration Options](#configuration-options)
- [Project Structure](#project-structure)
- [Output](#output)
- [Upload to OpenAI](#upload-to-openai)
  - [Create a Custom GPT](#create-a-custom-gpt)
  - [Create a Custom Assistant](#create-a-custom-assistant)
- [Contributing](#contributing)

## Features

- **Multiple Operating Modes**: CLI interactive mode, batch processing, and REST API server
- **Flexible Configuration**: Named configurations with batch support for crawling multiple sites
- **Smart Output Management**: Automatic file splitting based on token limits and file size
- **Sitemap Support**: Can crawl from sitemaps or individual URLs
- **Resource Filtering**: Exclude specific resource types to optimize crawling
- **Cookie Support**: Handle authenticated pages with cookie configuration
- **XPath & CSS Selectors**: Extract content using either XPath or CSS selectors

## Example

[Here is a custom GPT](https://chat.openai.com/g/g-kywiqipmR-builder-io-assistant) that demonstrates crawling the Builder.io docs to create an AI assistant.

This project crawled the documentation and generated the knowledge file used as the basis for the custom GPT.

[Try it out yourself](https://chat.openai.com/g/g-kywiqipmR-builder-io-assistant) by asking questions about integrating Builder.io.

> Note: A paid ChatGPT plan may be required to access custom GPTs

## Get Started

### Prerequisites

- Node.js >= 16
- npm or equivalent package manager

### Installation

1. Clone the repository:
```sh
git clone https://github.com/builderio/gpt-crawler
cd gpt-crawler
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
  cookie?: { name: string; value: string } | Array<{ name: string; value: string }>;

  /** URLs to exclude from crawling */
  exclude?: string | string[];

  /** Custom page visit handler */
  onVisitPage?: (context: { page: Page; pushData: (data: CrawledData) => Promise<void> }) => Promise<void>;
};
```

## Project Structure

```
gpt-crawler/
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

## Upload to OpenAI

The crawler generates JSON files that can be uploaded to OpenAI for creating custom GPTs or Assistants.

### Create a Custom GPT

For UI-based access to your knowledge that you can share with others:

> Note: Requires a paid ChatGPT plan

1. Go to [https://chat.openai.com/](https://chat.openai.com/)
2. Click your name in the bottom left corner
3. Select "My GPTs"
4. Click "Create a GPT"
5. Choose "Configure"
6. Under "Knowledge", click "Upload a file" and upload your generated JSON file(s)
7. If the file is too large, use the `maxFileSize` or `maxTokens` options to split it into multiple files

![Gif of how to upload a custom GPT](https://github.com/BuilderIO/gpt-crawler/assets/844291/22f27fb5-6ca5-4748-9edd-6bcf00b408cf)

### Create a Custom Assistant

For API access to integrate into your products:

1. Go to [https://platform.openai.com/assistants](https://platform.openai.com/assistants)
2. Click "+ Create"
3. Choose "upload" and select your generated JSON file(s)

![Gif of how to upload to an assistant](https://github.com/BuilderIO/gpt-crawler/assets/844291/06e6ad36-e2ba-4c6e-8d5a-bf329140de49)

## Contributing

Contributions are welcome! Know how to improve this project? Send a PR!

<br>
<br>

<p align="center">
   <a href="https://www.builder.io/m/developers">
      <picture>
         <source media="(prefers-color-scheme: dark)" srcset="https://user-images.githubusercontent.com/844291/230786554-eb225eeb-2f6b-4286-b8c2-535b1131744a.png">
         <img width="250" alt="Made with love by Builder.io" src="https://user-images.githubusercontent.com/844291/230786555-a58479e4-75f3-4222-a6eb-74c5af953eac.png">
       </picture>
   </a>
</p>
