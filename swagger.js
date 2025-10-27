import { configDotenv } from "dotenv";
import { existsSync } from "fs";
import swaggerAutogen from "swagger-autogen";

configDotenv();

const DEFAULT_PORT = 5000;
const API_HOST = process.env.API_HOST || "localhost";
const API_PORT =
  process.env.API_PORT ||
  process.env.PORT ||
  String(DEFAULT_PORT);

const doc = {
  info: {
    title: "Context0 API",
    description: "Context0",
  },
  host: `${API_HOST}:${API_PORT}`,
};

const outputFile = "dist/swagger-output.json";
const serverEntry = existsSync("dist/src/server.js")
  ? "./dist/src/server.js"
  : "./src/server.ts";
const routes = [serverEntry];

swaggerAutogen()(outputFile, routes, doc);
