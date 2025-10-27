import { Embeddings, type EmbeddingsParams } from "@langchain/core/embeddings";
import { chunkArray } from "@langchain/core/utils/chunk_array";
import { pipeline, type Tensor } from "@xenova/transformers";

type FeatureExtractionPipeline = (
  inputs: string | string[],
  options?: Record<string, unknown>,
) => Promise<Tensor>;

export interface XenovaEmbeddingsParams extends EmbeddingsParams {
  model: string;
  batchSize?: number;
  stripNewLines?: boolean;
  pipelineOptions?: Record<string, unknown>;
  pretrainedOptions?: Record<string, unknown>;
}

/**
 * Lightweight wrapper around the @xenova/transformers feature extraction pipeline
 * that satisfies LangChain's Embeddings interface without requiring the
 * @huggingface/transformers dependency.
 */
export class XenovaTransformersEmbeddings extends Embeddings {
  private model: string;

  private batchSize: number;

  private stripNewLines: boolean;

  private pipelineOptions: Record<string, unknown>;

  private pretrainedOptions: Record<string, unknown>;

  private pipelinePromise?: Promise<FeatureExtractionPipeline>;

  constructor(params?: Partial<XenovaEmbeddingsParams>) {
    super(params ?? {});
    this.model = params?.model ?? "Xenova/all-MiniLM-L6-v2";
    this.batchSize = params?.batchSize ?? 512;
    this.stripNewLines = params?.stripNewLines ?? true;
    this.pipelineOptions = {
      pooling: "mean",
      normalize: true,
      ...params?.pipelineOptions,
    };
    this.pretrainedOptions = params?.pretrainedOptions ?? {};
  }

  async embedDocuments(texts: string[]): Promise<number[][]> {
    const normalizedTexts = this.normalizeInputs(texts);
    const batches = chunkArray(normalizedTexts, this.batchSize);
    const embeddings: number[][] = [];

    for (const batch of batches) {
      const batchEmbeddings = await this.runEmbedding(batch);
      embeddings.push(...batchEmbeddings);
    }

    return embeddings;
  }

  async embedQuery(text: string): Promise<number[]> {
    const [embedding] = await this.runEmbedding(this.normalizeInputs([text]));
    if (!embedding) {
      throw new Error("Failed to compute embedding for query text.");
    }
    return embedding;
  }

  private async runEmbedding(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) {
      return [];
    }

    const pipe = await this.getPipeline();
    const tensor = (await this.caller.call(() =>
      pipe(texts as string | string[], this.pipelineOptions),
    )) as Tensor;

    if (typeof tensor.tolist !== "function") {
      throw new Error("Unexpected embedding pipeline output format.");
    }

    const result = tensor.tolist() as number[][] | number[];

    if (Array.isArray(result) && result.length > 0 && Array.isArray(result[0])) {
      return result as number[][];
    }

    return [result as number[]];
  }

  private async getPipeline(): Promise<FeatureExtractionPipeline> {
    if (!this.pipelinePromise) {
      this.pipelinePromise = pipeline(
        "feature-extraction",
        this.model,
        this.pretrainedOptions,
      ) as Promise<FeatureExtractionPipeline>;
    }

    return this.pipelinePromise;
  }

  private normalizeInputs(texts: string[]): string[] {
    if (!this.stripNewLines) {
      return texts;
    }
    return texts.map((text) => text.replace(/\n/g, " "));
  }
}
