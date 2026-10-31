import { pino } from "pino";
import { env } from "../config/env.ts";

// Structured JSON logs. Credentials, cookies and webhook signatures are redacted.
export const logger = pino({
  level: env.NODE_ENV === "test" ? "silent" : env.LOG_LEVEL,
  base: { service: process.env.FLEQO_SERVICE ?? "fleqo-api" },
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      "req.headers['x-fleqo-signature']",
      'res.headers["set-cookie"]',
      "secret",
      "*.secret",
      "*.password",
      "*.token",
    ],
    censor: "[redacted]",
  },
});
