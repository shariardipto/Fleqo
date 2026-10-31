import "dotenv/config";
import { z } from "zod";

const csv = z
  .string()
  .transform((value) =>
    value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
  );

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),

  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  REDIS_URL: z.string().min(1).default("redis://localhost:6379"),
  QUEUE_PREFIX: z.string().min(1).default("fleqo"),

  // Public origin through which browsers reach Better Auth (the web app origin when proxied).
  BETTER_AUTH_URL: z.url().default("http://localhost:3000"),
  BETTER_AUTH_SECRET: z.string().min(32, "BETTER_AUTH_SECRET must be at least 32 characters"),
  WEB_ORIGINS: csv.default(["http://localhost:3000"]),
  // 32-byte key (base64) used to encrypt connection signing secrets at rest.
  ENCRYPTION_KEY: z
    .string()
    .refine((value) => Buffer.from(value, "base64").length === 32, "ENCRYPTION_KEY must be 32 bytes, base64-encoded"),

  TRUST_PROXY: z.coerce.number().int().min(0).default(0),
  RATE_LIMIT_API_PER_MIN: z.coerce.number().int().positive().default(600),
  RATE_LIMIT_WEBHOOK_PER_MIN: z.coerce.number().int().positive().default(1200),

  WEBHOOK_TOLERANCE_SECONDS: z.coerce.number().int().positive().default(300),
  WORKFLOW_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(4),
  WORKFLOW_BACKOFF_MS: z.coerce.number().int().min(10).default(2000),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(50).default(5),
  DISPATCH_POLL_MS: z.coerce.number().int().min(100).default(2000),
  RUN_LEASE_MS: z.coerce.number().int().min(1000).default(60_000),
});

export type Env = z.infer<typeof envSchema>;

const isLocalhost = (value: string) => ["localhost", "127.0.0.1", "[::1]"].includes(new URL(value).hostname);

/** Production must use HTTPS origins (localhost excepted for local production-mode checks) and verified TLS. */
function productionProblems(data: Env): string[] {
  const problems: string[] = [];
  for (const [name, value] of [["BETTER_AUTH_URL", data.BETTER_AUTH_URL], ...data.WEB_ORIGINS.map((o) => ["WEB_ORIGINS", o])]) {
    try {
      const url = new URL(value);
      if (url.protocol !== "https:" && !isLocalhost(value)) problems.push(`${name} must use https in production (${value})`);
    } catch {
      problems.push(`${name} is not a valid URL (${value})`);
    }
  }
  if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === "0") {
    problems.push("NODE_TLS_REJECT_UNAUTHORIZED=0 disables TLS certificate verification; remove it in production");
  }
  return problems;
}

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`).join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  if (parsed.data.NODE_ENV === "production") {
    const problems = productionProblems(parsed.data);
    if (problems.length > 0) throw new Error(`Unsafe production configuration:\n${problems.map((p) => `  - ${p}`).join("\n")}`);
  } else if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === "0" && parsed.data.NODE_ENV === "development") {
    console.warn("[fleqo] Warning: NODE_TLS_REJECT_UNAUTHORIZED=0 is set; TLS certificates are not verified in this process.");
  }
  return parsed.data;
}

export const env = loadEnv();
export const isProduction = env.NODE_ENV === "production";
