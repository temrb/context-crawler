#!/usr/bin/env node

import { program } from "commander";
import { randomUUID } from "crypto";
import inquirer from "inquirer";
import { createRequire } from "node:module";
import {
  getAllJobNames,
  getAllTaskNames,
  getTasksByJobName,
  getTaskByName,
  type JobName,
} from "./config.js";
import ContextCrawlerCore from "./core.js";
import { jobStore } from "./job-store.js";
import logger from "./logger.js";
import { crawlQueue } from "./queue.js";
import { Config, configSchema, NamedConfig } from "./schema.js";

const require = createRequire(import.meta.url);
const { version, description } = require("../../package.json");

const messages = {
  urls: "Enter starting URLs (comma-separated for multiple):",
  match: "What is the URL pattern you want to match?",
  selector: "What is the CSS selector you want to match?",
  outputFileName: "What is the name of the output file?",
  config: "Name of the crawl configuration to use",
};

async function handler(cliOptions: Partial<Config> & { config?: string }) {
  try {
    let config: Partial<Config> = {};

    // Load configuration from file if a name is provided
    if (cliOptions.config) {
      const namedConfig = getTaskByName(cliOptions.config);
      if (!namedConfig) {
        logger.error(
          { config: cliOptions.config },
          `Task '${cliOptions.config}' not found`,
        );
        logger.info(
          `Available tasks: ${getAllTaskNames().join(", ")}`,
        );
        process.exit(1);
      }
      config = { ...namedConfig };
    } else {
      // If no config is specified, prompt the user to select one
      const availableTasks = getAllTaskNames();
      if (availableTasks.length > 0) {
        const taskAnswer = await inquirer.prompt({
          type: "list",
          name: "taskName",
          message: "Select a task:",
          choices: availableTasks,
        });
        const namedConfig = getTaskByName(taskAnswer.taskName);
        if (namedConfig) {
          config = { ...namedConfig };
        }
      }
    }

    // Override with any explicit CLI arguments
    Object.keys(cliOptions).forEach((key) => {
      if (
        cliOptions[key as keyof typeof cliOptions] !== undefined &&
        key !== "config" &&
        key in configSchema.shape
      ) {
        let value = cliOptions[key as keyof typeof cliOptions];

        // Special handling for urls - parse comma-separated string
        if (key === "urls" && typeof value === "string") {
          value = value
            .split(",")
            .map((url: string) => url.trim())
            .filter((url: string) => url.length > 0) as any;
        }

        config[key as keyof Config] = value as any;
      }
    });

    if (!config.urls || !config.match || !config.selector) {
      const answers: Partial<Config> = {};

      if (!config.urls) {
        const urlsAnswer = await inquirer.prompt({
          type: "input",
          name: "urls",
          message: messages.urls,
        });
        // Parse comma-separated URLs into array
        answers.urls = urlsAnswer.urls
          .split(",")
          .map((url: string) => url.trim())
          .filter((url: string) => url.length > 0);
      }

      if (!config.match) {
        const matchAnswer = await inquirer.prompt({
          type: "input",
          name: "match",
          message: messages.match,
        });
        answers.match = matchAnswer.match;
      }

      if (!config.selector) {
        const selectorAnswer = await inquirer.prompt({
          type: "input",
          name: "selector",
          message: messages.selector,
        });
        answers.selector = selectorAnswer.selector;
      }

      config = {
        ...config,
        ...answers,
      };
    }

    // Validate and use the config
    const finalConfig = config as Config;

    // Use ContextCrawlerCore for isolated dataset management
    const crawler = new ContextCrawlerCore(finalConfig);
    await crawler.crawl();
    await crawler.write();
  } catch (error) {
    logger.error({ error }, "Error during crawl");
    process.exit(1);
  }
}

program.version(version).description(description);

// Single crawl command
program
  .command("single")
  .description("Crawl a single configuration")
  .option("-c, --config <string>", messages.config)
  .option("-u, --urls <string>", messages.urls)
  .option("-m, --match <string>", messages.match)
  .option("-s, --selector <string>", messages.selector)
  .option("-o, --outputFileName <string>", messages.outputFileName)
  .option("--no-auto-discover-nav", "Disable automatic navigation discovery")
  .action(handler);

// Batch crawl command
program
  .command("batch [names...]")
  .description("Run one or more predefined batches of crawl configurations")
  .option("-q, --queue", "Queue jobs for worker instead of running directly")
  .action(async (names: string[], options: { queue?: boolean }) => {
    let selectedBatches: string[];

    // If no job names provided, show interactive picker
    if (!names || names.length === 0) {
      const availableJobs = getAllJobNames();
      if (availableJobs.length === 0) {
        logger.error("No jobs found in configurations");
        process.exit(1);
      }

      const jobChoices = availableJobs.map((name) => {
        const count = getTasksByJobName(name as JobName).length;
        return {
          name: `${name} (${count} ${count === 1 ? "task" : "tasks"})`,
          value: name,
        };
      });

      const jobAnswer = await inquirer.prompt({
        type: "checkbox",
        name: "jobs",
        message: "Select jobs to crawl:",
        choices: jobChoices,
        validate: (answer) => {
          if ((answer as unknown as string[]).length === 0) {
            return "You must select at least one job";
          }
          return true;
        },
      });

      selectedBatches = jobAnswer.jobs;
    } else {
      selectedBatches = names;
    }

    // Validate all selected jobs exist
    for (const name of selectedBatches) {
      const jobTasks = getTasksByJobName(name as JobName);
      if (!jobTasks || jobTasks.length === 0) {
        logger.error(
          { job: name },
          `Job '${name}' not found or is empty`,
        );
        const availableJobs = getAllJobNames();
        logger.info(`Available jobs: ${availableJobs.join(", ")}`);
        process.exit(1);
      }
    }

    // If --queue flag not provided, ask user
    let useQueue = options.queue ?? false;
    if (options.queue === undefined) {
      const modeAnswer = await inquirer.prompt({
        type: "list",
        name: "mode",
        message: "How do you want to run the crawl?",
        choices: [
          {
            name: "Run directly (wait for completion)",
            value: "direct",
          },
          {
            name: "Queue for worker (async)",
            value: "queue",
          },
        ],
      });
      useQueue = modeAnswer.mode === "queue";
    }

    // Collect all tasks from selected jobs
    const allConfigs: Array<{ jobName: string; config: NamedConfig }> = [];
    for (const jobName of selectedBatches) {
      const jobTasks = getTasksByJobName(jobName as JobName);
      for (const config of jobTasks) {
        allConfigs.push({ jobName, config });
      }
    }

    logger.info(
      {
        jobs: selectedBatches.join(", "),
        totalTasks: allConfigs.length,
        mode: useQueue ? "queue" : "direct",
      },
      `Starting crawl for ${selectedBatches.length} ${
        selectedBatches.length === 1 ? "job" : "jobs"
      } (${allConfigs.length} total ${
        allConfigs.length === 1 ? "task" : "tasks"
      })`,
    );

    if (useQueue) {
      // Queue mode: add all configs to queue
      const jobIds: string[] = [];

      for (const { config } of allConfigs) {
        const jobId = randomUUID();

        // Create job in persistent store
        jobStore.createJob(jobId, config);

        // Add job to queue
        await crawlQueue.add("crawl", { config }, { jobId });

        jobIds.push(jobId);

        logger.info(
          { jobId, config: config.name },
          `Queued: ${config.name} (job ID: ${jobId})`,
        );
      }

      logger.info(
        { totalJobs: jobIds.length },
        `Successfully queued ${jobIds.length} ${
          jobIds.length === 1 ? "job" : "jobs"
        }`,
      );
      logger.info("Worker will process these jobs asynchronously");
      logger.info("Check job status via API: GET /crawl/status/{jobId}");
    } else {
      // Direct mode: run each task sequentially with aggregation per job
      const jobResults: Record<
        string,
        {
          successful: Array<{ config: NamedConfig; outputFile: string | null }>;
          failed: Array<{ config: NamedConfig; error: string }>;
          crawlers: ContextCrawlerCore[];
        }
      > = {};

      // Initialize job results tracking
      for (const jobName of selectedBatches) {
        jobResults[jobName] = {
          successful: [],
          failed: [],
          crawlers: [],
        };
      }

      // Execute all tasks
      for (let i = 0; i < allConfigs.length; i++) {
        const { jobName, config } = allConfigs[i]!;
        logger.info(
          {
            progress: `${i + 1}/${allConfigs.length}`,
            job: jobName,
            task: config.name,
          },
          `Crawling: ${config.name} (from ${jobName})`,
        );

        try {
          // For batch mode, write to temp storage instead of final output
          const { join } = await import("path");
          const tempOutputPath = join(
            process.cwd(),
            "storage",
            "temp",
            `${config.name}-${Date.now()}.json`,
          );
          const tempConfig = { ...config, outputFileName: tempOutputPath };
          const crawler = new ContextCrawlerCore(tempConfig);
          jobResults[jobName]!.crawlers.push(crawler);

          await crawler.crawl();
          const outputFile = await crawler.write();

          jobResults[jobName]!.successful.push({
            config,
            outputFile: outputFile ? outputFile.toString() : null,
          });

          logger.info(
            {
              progress: `${i + 1}/${allConfigs.length}`,
              job: jobName,
              task: config.name,
            },
            `Completed: ${config.name}`,
          );
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : "Unknown error";

          jobResults[jobName]!.failed.push({
            config,
            error: errorMessage,
          });

          logger.error(
            {
              progress: `${i + 1}/${allConfigs.length}`,
              job: jobName,
              task: config.name,
              error: errorMessage,
            },
            `Failed: ${config.name}`,
          );
        }
      }

      // Aggregate results for each job
      for (const jobName of selectedBatches) {
        const results = jobResults[jobName]!;
        const successCount = results.successful.length;
        const failCount = results.failed.length;
        const totalCount = successCount + failCount;

        logger.info(
          { job: jobName, successCount, failCount, totalCount },
          `Job '${jobName}' completed: ${successCount}/${totalCount} successful, ${failCount} failed`,
        );

        // Aggregate successful outputs into single file
        if (successCount > 0) {
          try {
            const aggregatedData: unknown[] = [];
            const tempFilesRead: string[] = [];

            // Read all successful output files
            for (const { outputFile } of results.successful) {
              if (outputFile) {
                const { readFileSync, existsSync } = await import("fs");

                // Check if file exists before reading
                if (!existsSync(outputFile)) {
                  logger.warn(
                    { job: jobName, file: outputFile },
                    `Temp file not found: ${outputFile}`,
                  );
                  continue;
                }

                const content = readFileSync(outputFile, "utf-8");
                const data = JSON.parse(content);
                tempFilesRead.push(outputFile);

                // Handle both array and single object
                if (Array.isArray(data)) {
                  aggregatedData.push(...data);
                } else {
                  aggregatedData.push(data);
                }
              }
            }

            logger.info(
              {
                job: jobName,
                tempFilesFound: tempFilesRead.length,
                tempFilesExpected: results.successful.filter(r => r.outputFile).length,
              },
              `Read ${tempFilesRead.length} temp files for job '${jobName}'`,
            );

            // Only write output if we have data
            if (aggregatedData.length > 0) {
              // Write aggregated output
              const aggregatedOutputPath = `output/jobs/${jobName}.json`;
              const { writeFileSync, mkdirSync } = await import("fs");
              const { dirname } = await import("path");
              mkdirSync(dirname(aggregatedOutputPath), { recursive: true });
              writeFileSync(
                aggregatedOutputPath,
                JSON.stringify(aggregatedData, null, 2),
              );

              logger.info(
                {
                  job: jobName,
                  itemCount: aggregatedData.length,
                  outputFile: aggregatedOutputPath,
                },
                `Aggregated ${aggregatedData.length} items to ${aggregatedOutputPath}`,
              );
            } else {
              logger.info(
                { job: jobName },
                `Skipping output file creation for '${jobName}' - no items crawled`,
              );
            }
          } catch (error) {
            logger.error(
              {
                job: jobName,
                error: error instanceof Error ? error.message : error,
              },
              `Failed to aggregate outputs for job '${jobName}'`,
            );
          }
        } else {
          logger.info(
            { job: jobName },
            `Skipping aggregation for '${jobName}' - no successful tasks`,
          );
        }

        // Clean up temporary storage directories
        for (const crawler of results.crawlers) {
          try {
            await crawler.cleanup();
          } catch (error) {
            logger.warn(
              {
                error: error instanceof Error ? error.message : error,
              },
              "Failed to cleanup crawler storage",
            );
          }
        }
      }

      // Clean up temp output directory after ALL batches are aggregated
      try {
        const { rm } = await import("fs/promises");
        const { join } = await import("path");
        const tempDir = join(process.cwd(), "storage", "temp");
        await rm(tempDir, { recursive: true, force: true });
        logger.debug({ tempDir }, "Cleaned up temp output directory");
      } catch (error) {
        logger.warn(
          {
            error: error instanceof Error ? error.message : error,
          },
          "Failed to cleanup temp output directory",
        );
      }

      // Final summary
      const totalSuccessful = Object.values(jobResults).reduce(
        (sum, r) => sum + r.successful.length,
        0,
      );
      const totalFailed = Object.values(jobResults).reduce(
        (sum, r) => sum + r.failed.length,
        0,
      );

      logger.info(
        {
          jobs: selectedBatches.join(", "),
          totalSuccessful,
          totalFailed,
          total: allConfigs.length,
        },
        `All jobs completed: ${totalSuccessful}/${allConfigs.length} successful, ${totalFailed} failed`,
      );
    }
  });

// List command
program
  .command("list")
  .description("List all available jobs and tasks")
  .action(() => {
    const {
      getAllJobNames,
      getTasksByJobName,
      getAllTaskNames,
    } = require("./config.js");

    const jobNames = getAllJobNames();
    const taskNames = getAllTaskNames();

    console.log("\nAvailable Jobs:");
    if (jobNames.length === 0) {
      console.log("  (none found)");
    } else {
      jobNames.forEach((jobName: string) => {
        const tasks = getTasksByJobName(jobName);
        const taskCount = tasks.length;
        console.log(
          `  - ${jobName} (${taskCount} ${taskCount === 1 ? "task" : "tasks"})`,
        );
      });
    }

    console.log("\nAll Available Tasks:");
    if (taskNames.length === 0) {
      console.log("  (none found)");
    } else {
      taskNames.forEach((name: string) => {
        console.log(`  - ${name}`);
      });
    }

    console.log();
  });

program.parse();
