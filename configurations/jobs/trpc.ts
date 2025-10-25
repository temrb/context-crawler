import { defineJob } from "./types.js";

export default defineJob({
  name: "trpc-docs",
  urls: ["https://trpc.io/docs"],
  match: "https://trpc.io/docs/**",
  selector: "article",
});
