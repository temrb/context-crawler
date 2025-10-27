import { glob } from "glob";
import { parse } from "path";
import logger from "../logger.js";
import { llmService } from "../llm-service.js";

const JOBS_OUTPUT_GLOB = "output/jobs/*.json";

async function checkAllArtifacts(): Promise<void> {
  const jobFiles = await glob(JOBS_OUTPUT_GLOB);
  const staleJobs: string[] = [];

  for (const jobFile of jobFiles) {
    const jobName = parse(jobFile).name;
    const isStale = await llmService.isArtifactStale(jobName, jobFile);
    if (isStale) {
      staleJobs.push(jobName);
    }
  }

  if (staleJobs.length > 0) {
    const messages = [
      "Warning: LLM artifacts are out of sync!",
      `Stale jobs: ${staleJobs.join(", ")}`,
      "Run 'npm run generate:llm-artifacts' to update them.",
    ];
    const contentWidth = messages.reduce(
      (max, line) => Math.max(max, line.length),
      0,
    );
    const border = `+${"-".repeat(contentWidth + 4)}+`;

    console.warn("");
    console.warn(border);
    messages.forEach((line) => {
      const paddedLine = line.padEnd(contentWidth, " ");
      console.warn(`|  ${paddedLine}  |`);
    });
    console.warn(border);
    console.warn("");

    logger.warn({ staleJobs }, "Stale LLM artifacts detected.");
  } else {
    logger.info("LLM artifacts are up-to-date.");
  }
}

checkAllArtifacts().catch((error) => {
  logger.error({ error }, "Failed to check LLM artifact status.");
  process.exit(1);
});
