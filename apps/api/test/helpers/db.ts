import { randomUUID } from "node:crypto";
import { prisma } from "../../src/lib/prisma.ts";

/** Empties every table in the test database. Guarded so it can never run against a non-test database. */
export async function resetDatabase() {
  const [{ current_database: name }] = await prisma.$queryRaw<{ current_database: string }[]>`SELECT current_database()`;
  if (!name.endsWith("_test")) throw new Error(`Refusing to truncate non-test database "${name}"`);

  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (tables.length === 0) return;
  const list = tables.map((table) => `"public"."${table.tablename}"`).join(", ");
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}

/** Inserts an organization (and optionally a user + membership) directly, bypassing Better Auth. */
export async function createOrgFixture(name = "Test Org") {
  const id = randomUUID();
  return prisma.organization.create({
    data: { id, name, slug: `${name.toLowerCase().replace(/\W+/g, "-")}-${id.slice(0, 8)}`, createdAt: new Date() },
  });
}

export async function createUserFixture(email = `user-${randomUUID().slice(0, 8)}@example.test`) {
  return prisma.user.create({ data: { id: randomUUID(), name: "Test User", email } });
}
