import { readFileSync } from "fs";
import { join } from "path";
import type { JobRegistry } from "../configurations/jobs/index.js";
import { jobs as configuredJobs } from "../configurations/jobs/index.js";
import { GlobalConfig, globalConfigSchema, NamedConfig } from "./schema.js";

const CONFIGURATIONS_DIR = "./configurations";
const GLOBAL_CONFIG_PATH = join(CONFIGURATIONS_DIR, "config.json");

/**
 * Cache for the global configuration
 */
let globalConfigCache: GlobalConfig | null = null;

/**
 * All available jobs, loaded from typed configuration modules.
 * The registry is frozen to prevent accidental mutation at runtime.
 */
const jobs = Object.freeze(configuredJobs) as Readonly<JobRegistry>;

/**
 * Flattened list of all tasks across every job.
 * Performs duplicate name validation during initialization.
 */
const tasks = (() => {
  const entries = Object.entries(jobs) as Array<
    [keyof JobRegistry, readonly NamedConfig[]]
  >;

  const seenNames = new Map<string, string>();
  const aggregated: NamedConfig[] = [];

  for (const [jobName, jobTasks] of entries) {
    for (const task of jobTasks) {
      const existingJob = seenNames.get(task.name);
      if (existingJob) {
        throw new Error(
          `Duplicate task name '${task.name}' found in jobs '${existingJob}' and '${String(jobName)}'. All task names must be unique across all jobs.`,
        );
      }

      seenNames.set(task.name, String(jobName));
      aggregated.push(task);
    }
  }

  return Object.freeze(aggregated) as readonly NamedConfig[];
})();

export type JobName = keyof JobRegistry;
export type TaskName = (typeof tasks)[number]["name"];

const jobNames = Object.freeze(Object.keys(jobs)) as readonly JobName[];
const taskNames = Object.freeze(
  tasks.map((task) => task.name),
) as readonly TaskName[];
const jobNameSet = new Set<string>(jobNames);
const taskNameSet = new Set<string>(taskNames);

// ============================================================================
// NEW API (Job/Task based)
// ============================================================================

/**
 * Retrieves a task by its name.
 * @param {TaskName} name - The name of the task to find.
 * @returns {NamedConfig | undefined} The found task or undefined if not found.
 */
export function isJobName(value: string): value is JobName {
  return jobNameSet.has(value);
}

export function isTaskName(value: string): value is TaskName {
  return taskNameSet.has(value);
}

export function getTaskByName(name: TaskName): NamedConfig | undefined;
export function getTaskByName(name: string): NamedConfig | undefined;
export function getTaskByName(name: string): NamedConfig | undefined {
  return tasks.find((task) => task.name === name);
}

/**
 * Retrieves all tasks for a specific job.
 * @param {JobName} jobName - The name of the job.
 * @returns {readonly NamedConfig[]} The array of tasks in the job.
 */
export function getTasksByJobName(
  jobName: JobName,
): readonly NamedConfig[];
export function getTasksByJobName(
  jobName: string,
): readonly NamedConfig[];
export function getTasksByJobName(
  jobName: string,
): readonly NamedConfig[] {
  if (!isJobName(jobName)) {
    return [];
  }

  return jobs[jobName];
}

/**
 * Gets all available task names.
 * @returns {string[]} Array of task names.
 */
export function getAllTaskNames(): string[] {
  return Array.from(taskNames);
}

/**
 * Gets all available job names.
 * @returns {string[]} Array of job names.
 */
export function getAllJobNames(): string[] {
  return Array.from(jobNames);
}

/**
 * Gets all tasks.
 * @returns {NamedConfig[]} Array of all tasks.
 */
export function getAllTasks(): NamedConfig[] {
  return Array.from(tasks);
}

/**
 * Loads the global configuration from configurations/config.json.
 * @returns {GlobalConfig} The global configuration object.
 */
export function getGlobalConfig(): GlobalConfig {
  if (globalConfigCache) {
    return globalConfigCache;
  }

  try {
    const content = readFileSync(GLOBAL_CONFIG_PATH, "utf-8");
    const config = JSON.parse(content);
    globalConfigCache = globalConfigSchema.parse(config);
    return globalConfigCache;
  } catch (error) {
    throw new Error(
      `Failed to load global configuration from ${GLOBAL_CONFIG_PATH}: ${error instanceof Error ? error.message : error}`,
    );
  }
}
