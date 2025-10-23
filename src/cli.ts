#!/usr/bin/env node

import { program } from "commander";
import { Config, configSchema } from "./config.js";
import { crawl, write } from "./core.js";
import { createRequire } from "node:module";
import inquirer from "inquirer";
import { getConfigurationByName } from "../config.js";

const require = createRequire(import.meta.url);
const { version, description } = require("../../package.json");

const messages = {
  url: "What is the first URL of the website you want to crawl?",
  match: "What is the URL pattern you want to match?",
  selector: "What is the CSS selector you want to match?",
  maxPagesToCrawl: "How many pages do you want to crawl?",
  outputFileName: "What is the name of the output file?",
  config: "Name of the crawl configuration to use",
};

async function handler(cliOptions: Partial<Config> & { config?: string }) {
  try {
    let config: Partial<Config> = {};

    // Load configuration from file if a name is provided
    if (cliOptions.config) {
      const namedConfig = getConfigurationByName(cliOptions.config);
      if (!namedConfig) {
        console.error(
          `Error: Configuration '${cliOptions.config}' not found in config.ts`
        );
        process.exit(1);
      }
      config = { ...namedConfig };
    }

    // Override with any explicit CLI arguments
    Object.keys(cliOptions).forEach((key) => {
      if (
        cliOptions[key as keyof typeof cliOptions] !== undefined &&
        key !== "config" &&
        key in configSchema.shape
      ) {
        config[key as keyof Config] = cliOptions[key as keyof typeof cliOptions] as any;
      }
    });

    if (!config.url || !config.match || !config.selector) {
      const answers: Partial<Config> = {};

      if (!config.url) {
        const urlAnswer = await inquirer.prompt({
          type: "input",
          name: "url",
          message: messages.url,
        });
        answers.url = urlAnswer.url;
      }

      if (!config.match) {
        const matchAnswer = await inquirer.prompt({
          type: "input",
          name: "match",
          message: messages.match,
        });
        answers.match = matchAnswer.match;
      }

      if (!config.selector) {
        const selectorAnswer = await inquirer.prompt({
          type: "input",
          name: "selector",
          message: messages.selector,
        });
        answers.selector = selectorAnswer.selector;
      }

      config = {
        ...config,
        ...answers,
      };
    }

    // Apply defaults for any remaining undefined options
    const finalConfig: Config = {
      maxPagesToCrawl: 50,
      outputFileName: "output.json",
      ...config,
    } as Config;

    await crawl(finalConfig);
    await write(finalConfig);
  } catch (error) {
    console.log(error);
  }
}

program.version(version).description(description);

program
  .option("-c, --config <string>", messages.config)
  .option("-u, --url <string>", messages.url)
  .option("-m, --match <string>", messages.match)
  .option("-s, --selector <string>", messages.selector)
  .option("-p, --maxPagesToCrawl <number>", messages.maxPagesToCrawl, parseInt)
  .option("-o, --outputFileName <string>", messages.outputFileName)
  .action(handler);

program.parse();
