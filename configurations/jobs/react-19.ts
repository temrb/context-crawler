import { defineJob } from "./types.js";

export default defineJob({
  name: "react-19-reference",
  urls: ["https://react.dev/reference/react"],
  match: "https://react.dev/reference/**",
  selector: "article",
});
