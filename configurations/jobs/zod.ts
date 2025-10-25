import { defineJob } from "./types.js";

export default defineJob({
  name: "zod-docs",
  urls: ["https://zod.dev"],
  match: "https://zod.dev/**",
  selector: "article",
});
