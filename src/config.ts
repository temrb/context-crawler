import { readdirSync, readFileSync, statSync, existsSync } from "fs";
import { join } from "path";
import { GlobalConfig, globalConfigSchema, NamedConfig } from "./schema.js";

const CONFIGURATIONS_DIR = "./configurations";
const JOBS_DIR = join(CONFIGURATIONS_DIR, "jobs");
const GLOBAL_CONFIG_PATH = join(CONFIGURATIONS_DIR, "config.json");

/**
 * Cache for loaded configurations
 */
let tasksCache: NamedConfig[] | null = null;
let jobsCache: Record<string, NamedConfig[]> | null = null;
let globalConfigCache: GlobalConfig | null = null;

/**
 * Loads tasks from a single job file
 * Supports both single object and array of objects
 */
function loadTasksFromFile(filePath: string): NamedConfig[] {
  const content = readFileSync(filePath, "utf-8");
  const parsed = JSON.parse(content);

  // Handle both single object and array formats
  const tasks = Array.isArray(parsed) ? parsed : [parsed];

  // Validate that all tasks have required 'name' property
  for (const task of tasks) {
    if (!task.name) {
      throw new Error(
        `Task in file '${filePath}' is missing required 'name' property`,
      );
    }
  }

  return tasks as NamedConfig[];
}

/**
 * Loads all tasks from the jobs directory
 * Validates that all task names are unique across all jobs
 */
function loadAllTasks(): NamedConfig[] {
  if (tasksCache) {
    return tasksCache;
  }

  const tasks: NamedConfig[] = [];
  const seenNames = new Set<string>();

  if (!existsSync(JOBS_DIR)) {
    throw new Error(
      `Jobs directory not found at ${JOBS_DIR}. Please ensure configurations/jobs/ exists.`,
    );
  }

  const entries = readdirSync(JOBS_DIR);

  for (const entry of entries) {
    if (!entry.endsWith(".json")) {
      continue;
    }

    const fullPath = join(JOBS_DIR, entry);
    const stat = statSync(fullPath);

    if (stat.isFile()) {
      const jobTasks = loadTasksFromFile(fullPath);

      // Validate unique names
      for (const task of jobTasks) {
        if (seenNames.has(task.name)) {
          throw new Error(
            `Duplicate task name '${task.name}' found in ${entry}. All task names must be unique across all jobs.`,
          );
        }
        seenNames.add(task.name);
        tasks.push(task);
      }
    }
  }

  tasksCache = tasks;
  return tasks;
}

/**
 * Loads all job definitions (job name -> tasks mapping)
 */
function loadAllJobs(): Record<string, NamedConfig[]> {
  if (jobsCache) {
    return jobsCache;
  }

  jobsCache = {};

  if (!existsSync(JOBS_DIR)) {
    throw new Error(
      `Jobs directory not found at ${JOBS_DIR}. Please ensure configurations/jobs/ exists.`,
    );
  }

  const entries = readdirSync(JOBS_DIR);

  for (const entry of entries) {
    if (!entry.endsWith(".json")) {
      continue;
    }

    const fullPath = join(JOBS_DIR, entry);
    const stat = statSync(fullPath);

    if (stat.isFile()) {
      const jobName = entry.replace(".json", "");
      jobsCache[jobName] = loadTasksFromFile(fullPath);
    }
  }

  return jobsCache;
}

/**
 * Union type of all available job names.
 */
const jobs = loadAllJobs();
export type JobName = keyof typeof jobs;

/**
 * Union type of all available task names.
 */
const tasks = loadAllTasks();
export type TaskName = (typeof tasks)[number]["name"];

// ============================================================================
// NEW API (Job/Task based)
// ============================================================================

/**
 * Retrieves a task by its name.
 * @param {TaskName} name - The name of the task to find.
 * @returns {NamedConfig | undefined} The found task or undefined if not found.
 */
export function getTaskByName(name: TaskName): NamedConfig | undefined {
  const allTasks = loadAllTasks();
  return allTasks.find((task) => task.name === name);
}

/**
 * Retrieves all tasks for a specific job.
 * @param {JobName} jobName - The name of the job.
 * @returns {readonly NamedConfig[]} The array of tasks in the job.
 */
export function getTasksByJobName(jobName: JobName): readonly NamedConfig[] {
  const allJobs = loadAllJobs();
  return allJobs[jobName] ?? [];
}

/**
 * Gets all available task names
 * @returns {string[]} Array of task names
 */
export function getAllTaskNames(): string[] {
  const allTasks = loadAllTasks();
  return allTasks.map((task) => task.name);
}

/**
 * Gets all available job names
 * @returns {string[]} Array of job names
 */
export function getAllJobNames(): string[] {
  const allJobs = loadAllJobs();
  return Object.keys(allJobs);
}

/**
 * Gets all tasks
 * @returns {NamedConfig[]} Array of all tasks
 */
export function getAllTasks(): NamedConfig[] {
  return loadAllTasks();
}


/**
 * Loads the global configuration from .config.json
 * @returns {GlobalConfig} The global configuration object
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
