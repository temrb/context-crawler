import Database from 'better-sqlite3';
import { PathLike } from 'fs';
import { mkdirSync } from 'fs';
import { dirname } from 'path';
import { Config } from './schema.js';

export type JobStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface Job {
	id: string;
	status: JobStatus;
	config: Config;
	outputFile?: PathLike | null;
	error?: string;
	createdAt: Date;
	completedAt?: Date;
}

export interface JobRecord {
	id: string;
	status: JobStatus;
	config: string; // JSON string
	outputFile: string | null;
	error: string | null;
	createdAt: string; // ISO datetime string
	completedAt: string | null; // ISO datetime string
}

class JobStore {
	private db: Database.Database;

	constructor(dbPath: string = './data/jobs.db') {
		// Ensure the directory exists
		const dir = dirname(dbPath);
		mkdirSync(dir, { recursive: true });

		this.db = new Database(dbPath);
		this.db.pragma('journal_mode = WAL'); // Better concurrency
		this.initialize();
	}

	/**
	 * Creates the database file and jobs table if they don't exist
	 */
	private initialize(): void {
		this.db.exec(`
      CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        config TEXT NOT NULL,
        outputFile TEXT,
        error TEXT,
        createdAt TEXT NOT NULL,
        completedAt TEXT
      )
    `);
	}

	/**
	 * Inserts a new job record with status: 'pending'
	 */
	createJob(jobId: string, config: Config): void {
		const stmt = this.db.prepare(`
      INSERT INTO jobs (id, status, config, createdAt)
      VALUES (?, ?, ?, ?)
    `);

		stmt.run(
			jobId,
			'pending',
			JSON.stringify(config),
			new Date().toISOString()
		);
	}

	/**
	 * Retrieves a job record by ID
	 */
	getJobById(jobId: string): Job | undefined {
		const stmt = this.db.prepare('SELECT * FROM jobs WHERE id = ?');
		const record = stmt.get(jobId) as JobRecord | undefined;

		if (!record) {
			return undefined;
		}

		return this.recordToJob(record);
	}

	/**
	 * Updates a job's status and other fields
	 */
	updateJobStatus(
		jobId: string,
		status: JobStatus,
		data?: {
			outputFile?: PathLike;
			error?: string;
			completedAt?: Date;
		}
	): void {
		const job = this.getJobById(jobId);
		if (!job) {
			throw new Error(`Job with id ${jobId} not found`);
		}

		const updates: string[] = ['status = ?'];
		const params: (string | null)[] = [status];

		if (data?.outputFile !== undefined) {
			updates.push('outputFile = ?');
			params.push(String(data.outputFile));
		}

		if (data?.error !== undefined) {
			updates.push('error = ?');
			params.push(data.error);
		}

		if (data?.completedAt !== undefined) {
			updates.push('completedAt = ?');
			params.push(data.completedAt.toISOString());
		}

		params.push(jobId);

		const stmt = this.db.prepare(`
      UPDATE jobs
      SET ${updates.join(', ')}
      WHERE id = ?
    `);

		stmt.run(...params);
	}

	/**
	 * Gets all jobs (useful for listing/debugging)
	 */
	getAllJobs(): Job[] {
		const stmt = this.db.prepare('SELECT * FROM jobs ORDER BY createdAt DESC');
		const records = stmt.all() as JobRecord[];
		return records.map((record) => this.recordToJob(record));
	}

	/**
	 * Deletes a job by ID
	 */
	deleteJob(jobId: string): void {
		const stmt = this.db.prepare('DELETE FROM jobs WHERE id = ?');
		stmt.run(jobId);
	}

	/**
	 * Closes the database connection
	 */
	close(): void {
		this.db.close();
	}

	/**
	 * Converts a database record to a Job object
	 */
	private recordToJob(record: JobRecord): Job {
		return {
			id: record.id,
			status: record.status,
			config: JSON.parse(record.config) as Config,
			outputFile: record.outputFile,
			error: record.error ?? undefined,
			createdAt: new Date(record.createdAt),
			completedAt: record.completedAt ? new Date(record.completedAt) : undefined,
		};
	}
}

// Export a singleton instance
export const jobStore = new JobStore();
