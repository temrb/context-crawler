import { defineJob } from "./types.js";

export default defineJob([
  {
    name: "app-router",
    urls: ["https://nextjs.org/docs/app/"],
    match: "https://nextjs.org/docs/app/**",
    selector: "article",
  },
  {
    name: "architecture-accessibility",
    urls: ["https://nextjs.org/docs/architecture/accessibility"],
    match: "https://nextjs.org/docs/architecture/accessibility/**",
    selector: "article",
  },
]);
