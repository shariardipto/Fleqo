
import "dotenv/config";
import { defineConfig } from "prisma/config";

// `prisma generate` needs no database, so DATABASE_URL is optional here; migrate/studio
// commands fail with a clear error if it is missing.
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: process.env.DATABASE_URL ?? "",
  },
});
