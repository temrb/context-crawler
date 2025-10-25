import { configSchema } from "../../src/schema.js";
import type { ConfigInput, NamedConfig } from "../../src/schema.js";

export type JobTasks = readonly NamedConfig[];

/**
 * Shape of the configuration object accepted by {@link defineJob}.
 * Each field mirrors {@link configSchema} while providing IDE-friendly documentation.
 */
export interface JobConfig extends ConfigInput {
  /**
   * Stable identifier for this crawl configuration.
   * Doubles as the dataset name and part of the generated output filename.
   */
  name: ConfigInput["name"];
  /**
   * Entry point URLs that seed the crawler.
   * Every URL listed here is queued before dynamic discovery kicks in.
   */
  urls: ConfigInput["urls"];
  /**
   * Glob or glob array describing which discovered URLs should be processed.
   * Use it to keep the crawl scoped to documentation content.
   */
  match: ConfigInput["match"];
  /**
   * Optional glob or glob array to explicitly skip certain URLs.
   * Handy for login pages, marketing content, or known noisy sections.
   */
  exclude?: ConfigInput["exclude"];
  /**
   * CSS selector that identifies the main content container to extract for each page.
   * The DOM is provided by Playwright after the page has fully loaded.
   */
  selector: ConfigInput["selector"];
  /**
   * When true, navigation links discovered via {@link discoverySelector} are added as extra seeds.
   * Defaults to true so docs suites remain connected even with shallow seed lists.
   */
  autoDiscoverNav?: ConfigInput["autoDiscoverNav"];
  /**
   * CSS selector used during navigation discovery.
   * Only relevant when {@link autoDiscoverNav} is enabled.
   */
  discoverySelector?: ConfigInput["discoverySelector"];
  /**
   * Overrides the generated filename used when writing the final crawl output.
   * Provide a relative path inside `output/jobs/` to keep conventions consistent.
   */
  outputFileName?: ConfigInput["outputFileName"];
  /**
   * Cookie or cookies injected into every browser context before navigation.
   * Useful for dismissing consent banners or unlocking gated docs.
   */
  cookie?: ConfigInput["cookie"];
  /**
   * Hook invoked with the active Playwright page before extraction.
   * Can be used to run custom logic such as in-page navigation or waiting for hydration.
   */
  onVisitPage?: ConfigInput["onVisitPage"];
  /**
   * Timeout (in milliseconds) applied when waiting for {@link selector} to appear.
   * Falls back to the Playwright default if omitted.
   */
  waitForSelectorTimeout?: ConfigInput["waitForSelectorTimeout"];
  /**
   * List of resource URL patterns that should be blocked while crawling.
   * Helps avoid downloading large assets that are irrelevant to content extraction.
   */
  resourceExclusions?: ConfigInput["resourceExclusions"];
  /**
   * Maximum size (in bytes) for fetched resources.
   * Requests exceeding the threshold are aborted to keep runs performant.
   */
  maxFileSize?: ConfigInput["maxFileSize"];
  /**
   * Storage directory used by Crawlee for session data.
   * Defaults to an auto-generated path; override to coordinate shared storage.
   */
  storageDir?: ConfigInput["storageDir"];
  /**
   * Dataset name registered with Crawlee.
   * Primarily used internally to segregate concurrent runs.
   */
  datasetName?: ConfigInput["datasetName"];
}

/**
 * Declares one or more crawl jobs and validates them against {@link configSchema}.
 * Accepts either a single {@link JobConfig} object or an array of them.
 */
export function defineJob(task: JobConfig): readonly [NamedConfig];
export function defineJob(tasks: readonly JobConfig[]): readonly NamedConfig[];
export function defineJob(
  job: ConfigInput | readonly ConfigInput[],
): readonly NamedConfig[] {
  const normalized = Array.isArray(job) ? job : [job];
  const parsed = normalized.map((task) => configSchema.parse(task));
  return Object.freeze(parsed) as readonly NamedConfig[];
}
