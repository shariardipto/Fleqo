import { PrismaPg } from "@prisma/adapter-pg";
import { env } from "../config/env.ts";
import { PrismaClient } from "../generated/prisma/client.ts";

const adapter = new PrismaPg({ connectionString: env.DATABASE_URL });

export const prisma = new PrismaClient({
  adapter,
  transactionOptions: { timeout: env.DB_TRANSACTION_TIMEOUT_MS, maxWait: env.DB_TRANSACTION_MAX_WAIT_MS },
});

/** Client usable inside `prisma.$transaction(async (tx) => ...)`. */
export type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];
