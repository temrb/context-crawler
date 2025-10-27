import { glob } from "glob";
import { parse } from "path";
import logger from "../logger.js";
import { llmService } from "../llm-service.js";

const JOBS_OUTPUT_GLOB = "output/jobs/*.json";

async function generateAllArtifacts(): Promise<void> {
  logger.info("Starting LLM artifact generation process...");

  const jobFiles = await glob(JOBS_OUTPUT_GLOB);

  if (jobFiles.length === 0) {
    logger.warn("No job output files found. Nothing to generate.");
    return;
  }

  let generatedCount = 0;
  let skippedCount = 0;

  for (const jobFile of jobFiles) {
    const jobName = parse(jobFile).name;
    try {
      const shouldUpdate = await llmService.isArtifactStale(jobName, jobFile);
      if (shouldUpdate) {
        await llmService.generateArtifacts(jobName, jobFile);
        generatedCount += 1;
      } else {
        logger.debug({ job: jobName }, "Artifacts are up-to-date. Skipping.");
        skippedCount += 1;
      }
    } catch (error) {
      logger.error(
        { job: jobName, error: error instanceof Error ? error.message : error },
        `Failed to generate artifacts for job '${jobName}'`,
      );
    }
    await new Promise((resolve) => setImmediate(resolve));
  }

  logger.info("LLM artifact generation complete.");
  logger.info(
    `Summary: ${generatedCount} generated/updated, ${skippedCount} skipped.`,
  );
}

generateAllArtifacts().catch((error) => {
  logger.fatal(
    { error },
    "An unexpected error occurred during artifact generation.",
  );
  process.exit(1);
});
