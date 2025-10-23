import { type Config, type NamedConfig } from "./src/config";

/**
 * An array of named crawl configurations.
 * Each configuration object specifies the parameters for a crawl job.
 *
 * @type {NamedConfig[]}
 */
export const crawlConfigurations: NamedConfig[] = [
  {
    name: "builder-docs",
    url: "https://www.builder.io/c/docs/developers",
    match: "https://www.builder.io/c/docs/**",
    selector: ".docs-builder-container",
    maxPagesToCrawl: 50,
    outputFileName: "output.json",
    maxTokens: 2000000,
  },
  {
    name: "builder-docs-container",
    url: "https://www.builder.io/c/docs/developers",
    match: "https://www.builder.io/c/docs/**",
    selector: ".docs-builder-container",
    maxPagesToCrawl: 50,
    outputFileName: "../data/output.json", // Note the different path for container output
    maxTokens: 2000000,
  },
];

/**
 * Retrieves a crawl configuration by its name.
 * @param {string} name - The name of the configuration to find.
 * @returns {NamedConfig | undefined} The found configuration object or undefined if not found.
 */
export function getConfigurationByName(name: string): NamedConfig | undefined {
  return crawlConfigurations.find((config) => config.name === name);
}
