import { PrismaPg } from "@prisma/adapter-pg";
import { env } from "../config/env.ts";
import { PrismaClient } from "../generated/prisma/client.ts";

const adapter = new PrismaPg({ connectionString: env.DATABASE_URL });

export const prisma = new PrismaClient({ adapter });

/** Client usable inside `prisma.$transaction(async (tx) => ...)`. */
export type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];
