import { glob } from "glob";
import { createReadStream, existsSync } from "fs";
import { mkdir, readFile, stat, writeFile } from "fs/promises";
import { join, parse } from "path";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { HNSWLib } from "@langchain/community/vectorstores/hnswlib";
import logger from "./logger.js";
import { CrawledData } from "./schema.js";
import { XenovaTransformersEmbeddings } from "./xenova-embeddings.js";

const LLMS_DIR = join(process.cwd(), "data", "llms");
const INDEXES_DIR = join(process.cwd(), "data", "indexes");
const JOBS_OUTPUT_DIR = join(process.cwd(), "output", "jobs");

const DEFAULT_CHUNK_SIZE = 1000;
const DEFAULT_CHUNK_OVERLAP = 100;

async function ensureDirectories(): Promise<void> {
  await mkdir(LLMS_DIR, { recursive: true });
  await mkdir(INDEXES_DIR, { recursive: true });
}

function parseEnvInt(
  value: string | undefined,
  defaultValue: number,
  { allowZero = false }: { allowZero?: boolean } = {},
): number {
  if (value === undefined || value.trim() === "") {
    return defaultValue;
  }

  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    return defaultValue;
  }

  if (allowZero) {
    return parsed < 0 ? defaultValue : parsed;
  }

  return parsed <= 0 ? defaultValue : parsed;
}

function getChunkingOptions(): { chunkSize: number; chunkOverlap: number } {
  const chunkSize = parseEnvInt(
    process.env.LLM_CHUNK_SIZE,
    DEFAULT_CHUNK_SIZE,
  );
  let chunkOverlap = parseEnvInt(
    process.env.LLM_CHUNK_OVERLAP,
    DEFAULT_CHUNK_OVERLAP,
    { allowZero: true },
  );

  if (chunkOverlap >= chunkSize) {
    chunkOverlap = Math.max(0, chunkSize - 1);
  }

  return { chunkSize, chunkOverlap };
}

class LLMService {
  private vectorStores: Map<string, HNSWLib> = new Map();

  private embeddings: XenovaTransformersEmbeddings;

  private isInitialized = false;

  constructor() {
    this.embeddings = new XenovaTransformersEmbeddings({
      model: "Xenova/all-MiniLM-L6-v2",
    });
    logger.info("LLMService initialized with embedding model.");
  }

  public async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    logger.info("Initializing LLMService: Checking for stale artifacts...");
    await ensureDirectories();

    const jobFiles = await glob(`${JOBS_OUTPUT_DIR}/*.json`);
    for (const jobFile of jobFiles) {
      const jobName = parse(jobFile).name;
      try {
        const shouldUpdate = await this.isArtifactStale(jobName, jobFile);
        if (shouldUpdate) {
          await this.generateArtifacts(jobName, jobFile);
        } else {
          logger.debug({ job: jobName }, "Artifacts up-to-date; skipping.");
        }
      } catch (error) {
        logger.error(
          { job: jobName, error: error instanceof Error ? error.message : error },
          "Failed initial artifact generation for job",
        );
      }
      await new Promise((resolve) => setImmediate(resolve));
    }
    this.isInitialized = true;
    logger.info("LLMService initialization scan complete.");
  }

  public async processJobOutput(jobName: string): Promise<void> {
    const jsonPath = join(JOBS_OUTPUT_DIR, `${jobName}.json`);
    if (!existsSync(jsonPath)) {
      throw new Error(
        `Job output file for '${jobName}' does not exist at ${jsonPath}.`,
      );
    }

    await ensureDirectories();
    await this.generateArtifacts(jobName, jsonPath);
  }

  private async generateArtifacts(jobName: string, jsonPath: string): Promise<void> {
    logger.info({ job: jobName }, `Generating/Updating LLM artifacts for ${jobName}...`);

    const llmTextPath = join(LLMS_DIR, `${jobName}.txt`);
    const rawJson = await readFile(jsonPath, "utf-8");
    const data = JSON.parse(rawJson) as CrawledData[];
    const formattedText = data
      .map((item) => `---
Title: ${item.title}
URL: ${item.url}
---
${item.html}`)
      .join("\n\n");
    await writeFile(llmTextPath, formattedText);
    logger.debug({ job: jobName, path: llmTextPath }, `Generated ${jobName}.txt`);

    const { chunkSize, chunkOverlap } = getChunkingOptions();
    const textSplitter = new RecursiveCharacterTextSplitter({
      chunkSize,
      chunkOverlap,
    });
    const docs = await textSplitter.createDocuments([formattedText]);
    const vectorStore = await HNSWLib.fromDocuments(docs, this.embeddings);
    const indexPath = join(INDEXES_DIR, `${jobName}.index`);
    await vectorStore.save(indexPath);
    logger.info({ job: jobName, path: indexPath }, "Saved vector index");

    this.vectorStores.delete(jobName);
    logger.debug({ job: jobName }, "Invalidated in-memory vector store cache.");
  }

  private async isArtifactStale(jobName: string, jsonPath: string): Promise<boolean> {
    const indexPath = join(INDEXES_DIR, `${jobName}.index`);
    if (!existsSync(indexPath)) {
      return true;
    }

    const jsonStats = await stat(jsonPath);
    const indexStats = await stat(indexPath);

    return jsonStats.mtime > indexStats.mtime;
  }

  public jobExists(jobName: string): boolean {
    return existsSync(join(LLMS_DIR, `${jobName}.txt`));
  }

  public getFullTextStream(jobName: string) {
    const llmTextPath = join(LLMS_DIR, `${jobName}.txt`);
    return createReadStream(llmTextPath, { encoding: "utf-8" });
  }

  public async search(jobName: string, query: string, k = 5): Promise<string> {
    if (!this.vectorStores.has(jobName)) {
      const indexPath = join(INDEXES_DIR, `${jobName}.index`);
      if (!existsSync(indexPath)) {
        logger.warn(
          { job: jobName },
          "Index not found for search. Attempting just-in-time generation.",
        );
        await this.processJobOutput(jobName);
        if (!existsSync(indexPath)) {
          throw new Error(
            `Index for job '${jobName}' could not be found or generated.`,
          );
        }
      }
      const loadedVectorStore = await HNSWLib.load(indexPath, this.embeddings);
      this.vectorStores.set(jobName, loadedVectorStore);
      logger.debug({ job: jobName }, "Lazy-loaded vector store into memory.");
    }

    const vectorStore = this.vectorStores.get(jobName)!;
    const results = await vectorStore.similaritySearch(query, k);
    if (results.length === 0) {
      return `No relevant information found for the subject: "${query}"`;
    }

    return results
      .map((doc, index) => `--- Result ${index + 1} ---\n${doc.pageContent}`)
      .join("\n\n");
  }
}

export const llmService = new LLMService();
