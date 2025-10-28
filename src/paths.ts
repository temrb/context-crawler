import { join } from "path";

const ROOT_DIR = process.cwd();

function resolvePath(envVar: string | undefined, fallback: string): string {
  return envVar && envVar.trim().length > 0 ? envVar : fallback;
}

const dataDir = resolvePath(process.env.DATA_DIR, join(ROOT_DIR, "data"));
const outputDir = resolvePath(process.env.OUTPUT_DIR, join(ROOT_DIR, "output"));
const storageDir = resolvePath(
  process.env.STORAGE_DIR,
  join(ROOT_DIR, "storage"),
);

export const PATHS = {
  root: ROOT_DIR,
  data: dataDir,
  output: outputDir,
  storage: storageDir,
  llms: resolvePath(process.env.LLMS_DIR, join(dataDir, "llms")),
  indexes: resolvePath(process.env.INDEXES_DIR, join(dataDir, "indexes")),
  queueDb: resolvePath(process.env.QUEUE_DB_PATH, join(dataDir, "queue.db")),
  jobsDb: resolvePath(process.env.JOBS_DB_PATH, join(dataDir, "jobs.db")),
  jobsOutput: resolvePath(
    process.env.JOBS_OUTPUT_DIR,
    join(outputDir, "jobs"),
  ),
} as const;

export type PathKey = keyof typeof PATHS;

export function getPath(key: PathKey): string {
  return PATHS[key];
}
