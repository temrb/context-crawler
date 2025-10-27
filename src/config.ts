import type { JobRegistry } from "../configurations/index.js";
import { jobs as configuredJobs } from "../configurations/index.js";
import { globalConfig } from "../configurations/global.config.js";
import { NamedConfig } from "./schema.js";

/**
 * Global configuration for the crawler.
 * Edit configurations/global.config.ts to modify these values.
 */
export { globalConfig };

/**
 * All available jobs, loaded from typed configuration modules.
 * The registry is frozen to prevent accidental mutation at runtime.
 */
const jobs = Object.freeze(configuredJobs) as Readonly<JobRegistry>;

export type JobName = keyof JobRegistry;

const jobNames = Object.freeze(Object.keys(jobs)) as readonly JobName[];
const jobNameSet = new Set<string>(jobNames);

// ============================================================================
// Job-based API
// ============================================================================

/**
 * Check if a value is a valid job name.
 * @param {string} value - The value to check.
 * @returns {boolean} True if the value is a valid job name.
 */
export function isJobName(value: string): value is JobName {
  return jobNameSet.has(value);
}

/**
 * Retrieves all configurations for a specific job.
 * @param {JobName} jobName - The name of the job.
 * @returns {readonly NamedConfig[]} The array of configurations in the job.
 */
export function getJobConfigs(
  jobName: JobName,
): readonly NamedConfig[];
export function getJobConfigs(
  jobName: string,
): readonly NamedConfig[];
export function getJobConfigs(
  jobName: string,
): readonly NamedConfig[] {
  if (!isJobName(jobName)) {
    return [];
  }

  return jobs[jobName];
}

/**
 * Gets all available job names.
 * @returns {string[]} Array of job names.
 */
export function getAllJobNames(): string[] {
  return Array.from(jobNames);
}

/**
 * Gets all configurations from all jobs (flattened).
 * Useful for debugging or migration purposes.
 * @returns {NamedConfig[]} Array of all configurations.
 */
export function getAllConfigs(): NamedConfig[] {
  const entries = Object.entries(jobs) as Array<
    [keyof JobRegistry, readonly NamedConfig[]]
  >;

  const aggregated: NamedConfig[] = [];

  for (const [_jobName, jobConfigs] of entries) {
    for (const config of jobConfigs) {
      aggregated.push(config);
    }
  }

  return aggregated;
}
