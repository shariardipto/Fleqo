import { execSync } from "node:child_process";
import pg from "pg";

/** Creates the dedicated test database if needed and applies migrations to it. Never touches the dev database. */
export default async function globalSetup() {
  const databaseUrl = process.env.TEST_DATABASE_URL;
  if (!databaseUrl) throw new Error("TEST_DATABASE_URL was not derived");

  const url = new URL(databaseUrl);
  const databaseName = url.pathname.replace(/^\//, "");
  if (!databaseName.endsWith("_test")) {
    throw new Error(`Refusing to run tests against non-test database "${databaseName}"`);
  }

  const adminUrl = new URL(databaseUrl);
  adminUrl.pathname = "/postgres";
  adminUrl.search = "";
  const client = new pg.Client({ connectionString: adminUrl.toString() });
  await client.connect();
  try {
    const existing = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [databaseName]);
    if (existing.rowCount === 0) {
      await client.query(`CREATE DATABASE "${databaseName.replace(/"/g, "")}"`);
    }
  } finally {
    await client.end();
  }

  execSync("npx prisma migrate deploy", {
    stdio: "pipe",
    env: { ...process.env, DATABASE_URL: databaseUrl },
  });
}
