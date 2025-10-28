import { Document } from '@langchain/core/documents';
import { HNSWLib } from '@langchain/community/vectorstores/hnswlib';
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import { createReadStream, existsSync } from 'fs';
import { mkdir, readFile, stat, writeFile } from 'fs/promises';
import { join } from 'path';
import logger from './logger.js';
import { PATHS } from './paths.js';
import { CrawledData } from './schema.js';
import { XenovaTransformersEmbeddings } from './xenova-embeddings.js';

const LLMS_DIR = PATHS.llms;
const INDEXES_DIR = PATHS.indexes;
const JOBS_OUTPUT_DIR = PATHS.jobsOutput;

const DEFAULT_CHUNK_SIZE = 10000;
const DEFAULT_CHUNK_OVERLAP = 100;
const CHUNK_SEPARATORS = ['\n---\n', '\n\n', '\n', ' '];
const ARTIFACT_METADATA_VERSION = 2;

type ArtifactMetadata = {
	version: number;
	chunkSize: number;
	chunkOverlap: number;
	separators: string[];
};

async function ensureDirectories(): Promise<void> {
	await mkdir(LLMS_DIR, { recursive: true });
	await mkdir(INDEXES_DIR, { recursive: true });
}

function parseEnvInt(
	value: string | undefined,
	defaultValue: number,
	{ allowZero = false }: { allowZero?: boolean } = {}
): number {
	if (value === undefined || value.trim() === '') {
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
	const chunkSize = parseEnvInt(process.env.LLM_CHUNK_SIZE, DEFAULT_CHUNK_SIZE);
	let chunkOverlap = parseEnvInt(
		process.env.LLM_CHUNK_OVERLAP,
		DEFAULT_CHUNK_OVERLAP,
		{ allowZero: true }
	);

	if (chunkOverlap >= chunkSize) {
		chunkOverlap = Math.max(0, chunkSize - 1);
	}

	return { chunkSize, chunkOverlap };
}

class LLMService {
	private vectorStores: Map<string, HNSWLib> = new Map();

	private embeddings: XenovaTransformersEmbeddings;

	private initializationPromise: Promise<void>;

	constructor() {
		this.embeddings = new XenovaTransformersEmbeddings({
			model: 'Xenova/all-MiniLM-L6-v2',
		});
		this.initializationPromise = ensureDirectories().catch((error) => {
			logger.error(
				{ error: error instanceof Error ? error.message : error },
				'Failed to create LLM data directories'
			);
			throw error;
		});
		logger.info('LLMService initialized with embedding model.');
	}

	public async processJobOutput(jobName: string): Promise<void> {
		await this.initializationPromise;
		const jsonPath = join(JOBS_OUTPUT_DIR, `${jobName}.json`);
		if (!existsSync(jsonPath)) {
			throw new Error(
				`Job output file for '${jobName}' does not exist at ${jsonPath}.`
			);
		}

		await this.generateArtifacts(jobName, jsonPath);
	}

	public async generateArtifacts(
		jobName: string,
		jsonPath: string
	): Promise<void> {
		await this.initializationPromise;
		logger.info(
			{ job: jobName },
			`Generating/Updating LLM artifacts for ${jobName}...`
		);

		const llmTextPath = join(LLMS_DIR, `${jobName}.txt`);
		const rawJson = await readFile(jsonPath, 'utf-8');
		const data = JSON.parse(rawJson) as CrawledData[];
		const formattedText = data
			.map(
				(item) => `---
Title: ${item.title}
URL: ${item.url}
---
${item.html}`
			)
			.join('\n\n');
		await writeFile(llmTextPath, formattedText);
		logger.debug(
			{ job: jobName, path: llmTextPath },
			`Generated ${jobName}.txt`
		);

		const { chunkSize, chunkOverlap } = getChunkingOptions();
		const textSplitter = new RecursiveCharacterTextSplitter({
			chunkSize,
			chunkOverlap,
			separators: CHUNK_SEPARATORS,
		});
		const documents = data.map(
			(item) =>
				new Document({
					pageContent: `Title: ${item.title}\nURL: ${item.url}\n\n${item.html}`,
					metadata: {
						title: item.title,
						url: item.url,
					},
				})
		);
		const docs = await textSplitter.splitDocuments(documents);
		const vectorStore = await HNSWLib.fromDocuments(docs, this.embeddings);
		const indexPath = join(INDEXES_DIR, `${jobName}.index`);
		const metadataPath = join(INDEXES_DIR, `${jobName}.meta.json`);
		await vectorStore.save(indexPath);
		const metadata: ArtifactMetadata = {
			version: ARTIFACT_METADATA_VERSION,
			chunkSize,
			chunkOverlap,
			separators: CHUNK_SEPARATORS,
		};
		await writeFile(metadataPath, JSON.stringify(metadata, null, 2));
		logger.info({ job: jobName, path: indexPath }, 'Saved vector index');

		this.vectorStores.delete(jobName);
		logger.debug({ job: jobName }, 'Invalidated in-memory vector store cache.');
	}

	public async isArtifactStale(
		jobName: string,
		jsonPath: string
	): Promise<boolean> {
		const indexPath = join(INDEXES_DIR, `${jobName}.index`);
		const metadataPath = join(INDEXES_DIR, `${jobName}.meta.json`);
		if (!existsSync(indexPath) || !existsSync(metadataPath)) {
			return true;
		}

		let metadata: ArtifactMetadata | undefined;
		try {
			const rawMetadata = await readFile(metadataPath, 'utf-8');
			metadata = JSON.parse(rawMetadata) as ArtifactMetadata;
		} catch (error) {
			logger.warn(
				{ job: jobName, error: error instanceof Error ? error.message : error },
				'Failed to read artifact metadata. Forcing regeneration.'
			);
			return true;
		}

		const { chunkSize, chunkOverlap } = getChunkingOptions();

		if (
			metadata.version !== ARTIFACT_METADATA_VERSION ||
			metadata.chunkSize !== chunkSize ||
			metadata.chunkOverlap !== chunkOverlap ||
			!Array.isArray(metadata.separators) ||
			metadata.separators.join('||') !== CHUNK_SEPARATORS.join('||')
		) {
			return true;
		}

		const jsonStats = await stat(jsonPath);
		const indexStats = await stat(indexPath);
		const metadataStats = await stat(metadataPath);

		const thresholdMs = 1000; // Allow for coarse filesystem timestamp resolution
		const jsonMtime = jsonStats.mtime.getTime();

		return (
			jsonMtime > indexStats.mtime.getTime() + thresholdMs ||
			jsonMtime > metadataStats.mtime.getTime() + thresholdMs
		);
	}

	public jobExists(jobName: string): boolean {
		return existsSync(join(LLMS_DIR, `${jobName}.txt`));
	}

	public getFullTextStream(jobName: string) {
		const llmTextPath = join(LLMS_DIR, `${jobName}.txt`);
		return createReadStream(llmTextPath, { encoding: 'utf-8' });
	}

	public async search(jobName: string, query: string, k = 5): Promise<string> {
		await this.initializationPromise;
		if (!this.vectorStores.has(jobName)) {
			const indexPath = join(INDEXES_DIR, `${jobName}.index`);
			if (!existsSync(indexPath)) {
				logger.warn(
					{ job: jobName },
					'Index not found for search. Attempting just-in-time generation.'
				);
				await this.processJobOutput(jobName);
				if (!existsSync(indexPath)) {
					throw new Error(
						`Index for job '${jobName}' could not be found or generated.`
					);
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
			.map((doc, index) => {
				const metadata = (doc.metadata ?? {}) as Record<string, unknown>;
				const title =
					typeof metadata.title === 'string' ? metadata.title : 'Untitled';
				const url = typeof metadata.url === 'string' ? metadata.url : 'Unknown';

				return [
					`--- Result ${index + 1} ---`,
					`Title: ${title}`,
					`URL: ${url}`,
					'',
					doc.pageContent,
				].join('\n');
			})
			.join('\n\n');
	}
}

export const llmService = new LLMService();
