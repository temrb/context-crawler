import pino from "pino";

const isDevelopment = process.env.NODE_ENV === "development";

/**
 * Singleton logger instance using pino for structured logging
 */
export const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  transport: isDevelopment
    ? {
        target: "pino-pretty",
        options: {
          colorize: true,
          translateTime: "HH:MM:ss Z",
          ignore: "pid,hostname",
        },
      }
    : undefined,
});

export default logger;
