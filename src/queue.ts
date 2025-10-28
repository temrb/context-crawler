import Database from "better-sqlite3";
import { mkdir } from "fs/promises";
import { dirname } from "path";
import { PATHS } from "./paths.js";
import { Config } from "./schema.js";

// Define the job data interface
export interface CrawlJobData {
  config: Config;
  jobName: string;
}

export interface QueueJobOptions {
  jobId: string;
  priority?: number;
  maxAttempts?: number;
  backoffDelay?: number; // Initial delay in ms for exponential backoff
}

interface QueueJobRecord {
  id: string;
  jobId: string; // Reference to jobs table
  status: "pending" | "claimed" | "completed" | "failed";
  data: string; // JSON stringified CrawlJobData
  priority: number;
  attempts: number;
  maxAttempts: number;
  nextRetryAt: string | null; // ISO datetime
  claimedAt: string | null;
  completedAt: string | null;
  error: string | null;
  createdAt: string;
}

export interface QueueJob {
  id: string;
  jobId: string;
  data: CrawlJobData;
  attempts: number;
  maxAttempts: number;
}

class SQLiteQueue {
  private db!: Database.Database;
  private dbPath: string;
  private initialized = false;

  constructor(dbPath: string = PATHS.queueDb) {
    this.dbPath = dbPath;
  }

  /**
   * Initialize the database and ensure tables exist
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    // Ensure the directory exists
    const dir = dirname(this.dbPath);
    await mkdir(dir, { recursive: true });

    // Open the database connection
    this.db = new Database(this.dbPath);
    this.db.pragma("journal_mode = WAL"); // Better concurrency

    // Create queue table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS queue (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        jobId TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL DEFAULT 'pending',
        data TEXT NOT NULL,
        priority INTEGER NOT NULL DEFAULT 0,
        attempts INTEGER NOT NULL DEFAULT 0,
        maxAttempts INTEGER NOT NULL DEFAULT 3,
        nextRetryAt TEXT,
        claimedAt TEXT,
        completedAt TEXT,
        error TEXT,
        createdAt TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_queue_status ON queue(status);
      CREATE INDEX IF NOT EXISTS idx_queue_priority ON queue(priority DESC);
      CREATE INDEX IF NOT EXISTS idx_queue_nextRetryAt ON queue(nextRetryAt);
    `);

    this.initialized = true;
  }

  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error("Queue not initialized. Call initialize() first.");
    }
  }

  public isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Add a new job to the queue
   */
  async add(
    _queueName: string, // Kept for API compatibility but not used
    data: CrawlJobData,
    options: QueueJobOptions,
  ): Promise<void> {
    const {
      jobId,
      priority = 0,
      maxAttempts = 3,
      backoffDelay = 1000,
    } = options;

    this.ensureInitialized();

    const stmt = this.db.prepare(`
      INSERT INTO queue (jobId, status, data, priority, maxAttempts, createdAt)
      VALUES (?, 'pending', ?, ?, ?, ?)
    `);

    try {
      stmt.run(
        jobId,
        JSON.stringify(data),
        priority,
        maxAttempts,
        new Date().toISOString(),
      );
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        (error as { code?: string }).code === "SQLITE_CONSTRAINT"
      ) {
        throw new Error(`Job with ID ${jobId} already exists in queue`);
      }
      throw error;
    }
  }

  /**
   * Claim the next available job atomically
   * Returns null if no job is available
   */
  claimNextJob(): QueueJob | null {
    this.ensureInitialized();
    const now = new Date().toISOString();

    // Use a transaction to atomically claim a job
    const claimJob = this.db.transaction(() => {
      // Find the next available job
      const findStmt = this.db.prepare(`
        SELECT * FROM queue
        WHERE status = 'pending'
          AND (nextRetryAt IS NULL OR nextRetryAt <= ?)
        ORDER BY priority DESC, createdAt ASC
        LIMIT 1
      `);

      const record = findStmt.get(now) as QueueJobRecord | undefined;

      if (!record) {
        return null;
      }

      // Claim the job
      const updateStmt = this.db.prepare(`
        UPDATE queue
        SET status = 'claimed',
            claimedAt = ?,
            attempts = attempts + 1
        WHERE id = ?
      `);

      updateStmt.run(now, record.id);

      // Return the claimed job
      return {
        id: record.id.toString(),
        jobId: record.jobId,
        data: JSON.parse(record.data) as CrawlJobData,
        attempts: record.attempts + 1,
        maxAttempts: record.maxAttempts,
      };
    });

    return claimJob();
  }

  /**
   * Mark a job as completed
   */
  markCompleted(queueJobId: string): void {
    this.ensureInitialized();
    const stmt = this.db.prepare(`
      UPDATE queue
      SET status = 'completed',
          completedAt = ?
      WHERE id = ?
    `);

    stmt.run(new Date().toISOString(), queueJobId);
  }

  /**
   * Mark a job as failed and optionally retry
   */
  markFailed(
    queueJobId: string,
    error: string,
    shouldRetry: boolean,
    backoffDelay: number = 1000,
  ): void {
    this.ensureInitialized();
    const record = this.db
      .prepare("SELECT * FROM queue WHERE id = ?")
      .get(queueJobId) as QueueJobRecord | undefined;

    if (!record) {
      return;
    }

    // Check if we should retry
    if (shouldRetry && record.attempts < record.maxAttempts) {
      // Calculate next retry time with exponential backoff
      const delay = backoffDelay * Math.pow(2, record.attempts - 1);
      const nextRetryAt = new Date(Date.now() + delay).toISOString();

      const stmt = this.db.prepare(`
        UPDATE queue
        SET status = 'pending',
            nextRetryAt = ?,
            error = ?
        WHERE id = ?
      `);

      stmt.run(nextRetryAt, error, queueJobId);
    } else {
      // Max attempts reached or retry disabled
      const stmt = this.db.prepare(`
        UPDATE queue
        SET status = 'failed',
            completedAt = ?,
            error = ?
        WHERE id = ?
      `);

      stmt.run(new Date().toISOString(), error, queueJobId);
    }
  }

  /**
   * Reset stuck jobs (claimed but not completed for too long)
   */
  resetStuckJobs(timeoutMs: number = 30 * 60 * 1000): number {
    this.ensureInitialized();
    const cutoffTime = new Date(Date.now() - timeoutMs).toISOString();

    const stmt = this.db.prepare(`
      UPDATE queue
      SET status = 'pending',
          claimedAt = NULL
      WHERE status = 'claimed'
        AND claimedAt < ?
    `);

    const result = stmt.run(cutoffTime);
    return result.changes;
  }

  /**
   * Clean up old completed/failed jobs
   */
  cleanupOldJobs(ageMs: number = 7 * 24 * 60 * 60 * 1000): number {
    this.ensureInitialized();
    const cutoffTime = new Date(Date.now() - ageMs).toISOString();

    const stmt = this.db.prepare(`
      DELETE FROM queue
      WHERE status IN ('completed', 'failed')
        AND completedAt < ?
    `);

    const result = stmt.run(cutoffTime);
    return result.changes;
  }

  /**
   * Clear all completed/failed jobs immediately (regardless of age)
   */
  clearCompletedJobs(): number {
    this.ensureInitialized();
    const stmt = this.db.prepare(`
      DELETE FROM queue
      WHERE status IN ('completed', 'failed')
    `);

    const result = stmt.run();
    return result.changes;
  }

  /**
   * Get queue statistics
   */
  getStats(): {
    pending: number;
    claimed: number;
    completed: number;
    failed: number;
    total: number;
  } {
    this.ensureInitialized();
    const stmt = this.db.prepare(`
      SELECT
        status,
        COUNT(*) as count
      FROM queue
      GROUP BY status
    `);

    const results = stmt.all() as Array<{ status: string; count: number }>;

    const stats = {
      pending: 0,
      claimed: 0,
      completed: 0,
      failed: 0,
      total: 0,
    };

    results.forEach((row) => {
      const status = row.status as keyof typeof stats;
      if (status in stats) {
        stats[status] = row.count;
      }
      stats.total += row.count;
    });

    return stats;
  }

  /**
   * Close the database connection
   */
  close(): void {
    if (!this.initialized) {
      return;
    }
    this.db.close();
    this.initialized = false;
  }
}

// Export a singleton instance
export const crawlQueue = new SQLiteQueue();
