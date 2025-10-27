import { pipeline } from "@xenova/transformers";

async function downloadModel(): Promise<void> {
  console.log("Downloading and caching embedding model...");

  try {
    const embedder = await pipeline(
      "feature-extraction",
      "Xenova/all-MiniLM-L6-v2",
    );
    await embedder("Pre-cache warm-up sentence.");
    console.log("Model successfully cached.");
  } catch (error) {
    console.error("Failed to pre-download embedding model:", error);
    process.exitCode = 1;
  }
}

void downloadModel();
