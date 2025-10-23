import { getConfigurationByName } from "../config.js";
import { crawl, write } from "./core.js";

const configName = "builder-docs";
const configToRun = getConfigurationByName(configName);

if (!configToRun) {
  console.error(
    `Error: Default configuration '${configName}' not found in config.ts`
  );
  process.exit(1);
}

await crawl(configToRun);
await write(configToRun);
