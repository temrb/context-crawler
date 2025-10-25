import { crawlQueue } from "../dist/src/queue.js";

console.log("Clearing completed/failed jobs from queue...");

const count = crawlQueue.clearCompletedJobs();

if (count > 0) {
  console.log(`✓ Cleared ${count} completed/failed job(s) from queue`);
} else {
  console.log("No completed/failed jobs to clear");
}

// Display current queue stats
const stats = crawlQueue.getStats();
console.log("\nCurrent queue statistics:");
console.log(`  Pending: ${stats.pending}`);
console.log(`  Claimed: ${stats.claimed}`);
console.log(`  Completed: ${stats.completed}`);
console.log(`  Failed: ${stats.failed}`);
console.log(`  Total: ${stats.total}`);

crawlQueue.close();
process.exit(0);
