#!/usr/bin/env node

import { configDotenv } from "dotenv";
import ContextCrawlerCore from "./core.js";
import { jobStore } from "./job-store.js";
import logger from "./logger.js";
import { crawlQueue, QueueJob } from "./queue.js";

configDotenv();

// Worker configuration
const WORKER_CONCURRENCY = Number(process.env.WORKER_CONCURRENCY) || 2;
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS) || 1000;
const MAX_POLL_INTERVAL_MS = Number(process.env.MAX_POLL_INTERVAL_MS) || 10000;
const JOB_TIMEOUT_MS = Number(process.env.JOB_TIMEOUT_MS) || 30 * 60 * 1000; // 30 minutes
const BACKOFF_DELAY_MS = Number(process.env.BACKOFF_DELAY_MS) || 5000; // Increased from 1s to 5s

// Track active jobs and worker state
const activeJobs = new Set<Promise<void>>();
let isShuttingDown = false;
let pollIntervalId: NodeJS.Timeout | null = null;
let currentPollInterval = POLL_INTERVAL_MS;

/**
 * Process a single crawl job from the queue
 */
async function processCrawlJob(job: QueueJob): Promise<void> {
  const { config } = job.data;
  const { jobId } = job;

  logger.info(
    {
      jobId,
      queueJobId: job.id,
      attempt: job.attempts,
      maxAttempts: job.maxAttempts,
    },
    "Processing crawl job",
  );

  // Create crawler instance (null if error occurs during setup)
  let crawler: ContextCrawlerCore | null = null;

  try {
    // Update job status to running in job store
    jobStore.updateJobStatus(jobId, "running");

    // Instantiate the crawler
    crawler = new ContextCrawlerCore(config);

    // Run the crawl
    await crawler.crawl();

    // Write the output
    const outputFileName = await crawler.write();

    // Clean up job storage
    await crawler.cleanup();

    // Mark queue job as completed
    crawlQueue.markCompleted(job.id);

    // Update job store status to completed
    jobStore.updateJobStatus(jobId, "completed", {
      outputFile: outputFileName || undefined,
      completedAt: new Date(),
    });

    // Auto-clear completed jobs from queue
    const clearedCount = crawlQueue.clearCompletedJobs();
    if (clearedCount > 0) {
      logger.debug(
        { clearedCount },
        "Auto-cleared completed/failed jobs from queue",
      );
    }

    logger.info(
      { jobId, queueJobId: job.id, outputFile: outputFileName },
      "Crawl job completed successfully",
    );
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error occurred";

    logger.error(
      { jobId, queueJobId: job.id, error: errorMessage, attempt: job.attempts },
      "Crawl job failed",
    );

    // Clean up storage before retry (important for file system race conditions)
    if (crawler) {
      try {
        await crawler.cleanup();
      } catch (cleanupError) {
        logger.warn(
          {
            jobId,
            error:
              cleanupError instanceof Error
                ? cleanupError.message
                : cleanupError,
          },
          "Failed to cleanup storage after error",
        );
      }
    }

    // Determine if we should retry
    const shouldRetry = job.attempts < job.maxAttempts;

    // Calculate exponential backoff with jitter (reduces thundering herd)
    const backoffWithJitter =
      BACKOFF_DELAY_MS *
      Math.pow(2, job.attempts - 1) *
      (0.5 + Math.random() * 0.5);

    // Mark queue job as failed (will retry if attempts remaining)
    crawlQueue.markFailed(job.id, errorMessage, shouldRetry, backoffWithJitter);

    // Only update job store to failed if we won't retry
    if (!shouldRetry) {
      jobStore.updateJobStatus(jobId, "failed", {
        error: errorMessage,
        completedAt: new Date(),
      });

      // Auto-clear completed/failed jobs from queue
      const clearedCount = crawlQueue.clearCompletedJobs();
      if (clearedCount > 0) {
        logger.debug(
          { clearedCount },
          "Auto-cleared completed/failed jobs from queue",
        );
      }
    }
  }
}

/**
 * Poll the queue for available jobs and process them concurrently
 */
async function pollQueue(): Promise<void> {
  if (isShuttingDown) {
    return;
  }

  // Check if we have capacity for more jobs
  if (activeJobs.size >= WORKER_CONCURRENCY) {
    return;
  }

  // Try to claim jobs up to concurrency limit
  let jobClaimed = false;
  const jobsToStart: QueueJob[] = [];

  while (activeJobs.size + jobsToStart.length < WORKER_CONCURRENCY) {
    const job = crawlQueue.claimNextJob();

    if (!job) {
      break;
    }

    jobClaimed = true;
    jobsToStart.push(job);
  }

  // Start all claimed jobs
  for (const job of jobsToStart) {
    const jobPromise = processCrawlJob(job)
      .catch((error) => {
        logger.error(
          { error: error instanceof Error ? error.message : error },
          "Unhandled error in job processing",
        );
      })
      .finally(() => {
        activeJobs.delete(jobPromise);
      });

    activeJobs.add(jobPromise);
  }

  // Adjust poll interval based on whether jobs were found
  if (jobClaimed) {
    // Reset to minimum interval when jobs are available
    currentPollInterval = POLL_INTERVAL_MS;
  } else {
    // Exponentially back off when queue is empty (up to max)
    currentPollInterval = Math.min(
      currentPollInterval * 1.5,
      MAX_POLL_INTERVAL_MS,
    );
  }
}

/**
 * Start the worker polling loop
 */
function startWorker(): void {
  logger.info(
    {
      concurrency: WORKER_CONCURRENCY,
      pollInterval: POLL_INTERVAL_MS,
      jobTimeout: JOB_TIMEOUT_MS,
    },
    "Worker starting...",
  );

  // Reset any stuck jobs from previous runs
  const resetCount = crawlQueue.resetStuckJobs(JOB_TIMEOUT_MS);
  if (resetCount > 0) {
    logger.info({ count: resetCount }, "Reset stuck jobs from previous run");
  }

  // Clean up old completed/failed jobs
  const cleanedCount = crawlQueue.cleanupOldJobs(7 * 24 * 60 * 60 * 1000); // 7 days
  if (cleanedCount > 0) {
    logger.info({ count: cleanedCount }, "Cleaned up old jobs");
  }

  // Log queue stats
  const stats = crawlQueue.getStats();
  logger.info({ stats }, "Queue statistics");

  // Start polling
  const poll = () => {
    pollQueue()
      .catch((error) => {
        logger.error(
          { error: error instanceof Error ? error.message : error },
          "Error during queue polling",
        );
      })
      .finally(() => {
        if (!isShuttingDown) {
          pollIntervalId = setTimeout(poll, currentPollInterval);
        }
      });
  };

  poll();

  logger.info("Worker is ready and waiting for jobs");
}

/**
 * Gracefully shut down the worker
 */
async function shutdown(): Promise<void> {
  if (isShuttingDown) {
    return;
  }

  isShuttingDown = true;
  logger.info("Worker shutting down gracefully...");

  // Stop polling
  if (pollIntervalId) {
    clearTimeout(pollIntervalId);
    pollIntervalId = null;
  }

  // Wait for all active jobs to complete
  if (activeJobs.size > 0) {
    logger.info(
      { activeJobCount: activeJobs.size },
      "Waiting for active jobs to complete...",
    );
    await Promise.all(Array.from(activeJobs));
  }

  // Close queue connection
  crawlQueue.close();

  // Close job store connection
  jobStore.close();

  logger.info("Worker shut down complete");
  process.exit(0);
}

// Handle shutdown signals
process.on("SIGTERM", () => {
  logger.info("SIGTERM received");
  shutdown();
});

process.on("SIGINT", () => {
  logger.info("SIGINT received");
  shutdown();
});

// Handle uncaught errors
process.on("uncaughtException", (error) => {
  logger.error(
    { error: error.message, stack: error.stack },
    "Uncaught exception",
  );
  shutdown();
});

process.on("unhandledRejection", (reason) => {
  logger.error(
    { reason: reason instanceof Error ? reason.message : reason },
    "Unhandled rejection",
  );
  shutdown();
});

// Start the worker
startWorker();
