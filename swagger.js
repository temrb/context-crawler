import swaggerAutogen from "swagger-autogen";

const doc = {
  info: {
    title: "Context Crawler API",
    description: "Context Crawler",
  },
  host: "localhost:5000",
};

const outputFile = "swagger-output.json";
const routes = ["./src/server.ts"];

swaggerAutogen()(outputFile, routes, doc);
