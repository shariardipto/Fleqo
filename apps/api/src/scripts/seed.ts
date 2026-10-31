/**
 * Idempotent local demo seed: one user, a "Demo Store" organization, the three mock connections,
 * an active Order Sync workflow and offline synthetic customers/products.
 *
 *   SEED_DEMO_PASSWORD=<choose one> npm run db:seed
 *
 * No default password exists on purpose; nothing privileged is published with the repository.
 * The Mock Store signing secret is not printed; rotate it from the Connections page to view one.
 */
import { auth } from "../lib/auth.ts";
import { prisma } from "../lib/prisma.ts";
import { createConnection } from "../modules/connections/connections.routes.ts";
import { runImport } from "../modules/demo/import.service.ts";
import { ACTIONS, defaultMapping } from "../engine/mapping.ts";
import { env } from "../config/env.ts";

async function main() {
  if (env.NODE_ENV === "production") throw new Error("The demo seed is for local/staging use only");
  const email = (process.env.SEED_DEMO_EMAIL ?? "demo@fleqo.local").toLowerCase();
  const password = process.env.SEED_DEMO_PASSWORD;
  if (!password || password.length < 8) throw new Error("Set SEED_DEMO_PASSWORD (min 8 characters) to seed the demo user");

  let user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    await auth.api.signUpEmail({ body: { email, password, name: "Demo Operator" } });
    user = await prisma.user.findUniqueOrThrow({ where: { email } });
    console.log(`Created user ${email}`);
  } else {
    console.log(`User ${email} already exists (password unchanged)`);
  }

  let membership = await prisma.member.findFirst({ where: { userId: user.id }, orderBy: { createdAt: "asc" } });
  if (!membership) {
    await auth.api.createOrganization({ body: { name: "Demo Store", slug: `demo-store-${user.id.slice(0, 6).toLowerCase()}`, userId: user.id } });
    membership = await prisma.member.findFirstOrThrow({ where: { userId: user.id } });
    console.log("Created organization Demo Store");
  }
  const organizationId = membership.organizationId;

  for (const provider of ["mock_store", "mock_crm", "mock_sheet"] as const) {
    const exists = await prisma.integrationConnection.findUnique({ where: { organizationId_provider: { organizationId, provider } } });
    if (!exists) {
      await createConnection(organizationId, user.id, provider);
      console.log(`Connected ${provider}`);
    }
  }

  const workflowExists = await prisma.workflow.findFirst({ where: { organizationId, name: "Order Sync", status: { not: "archived" } } });
  if (!workflowExists) {
    const connections = await prisma.integrationConnection.findMany({ where: { organizationId } });
    const connectionId = (provider: string) => connections.find((c) => c.provider === provider)!.id;
    await prisma.workflow.create({
      data: {
        organizationId,
        name: "Order Sync",
        description: "Seeded demo: new order → CRM customer upsert → sheet order row",
        status: "active",
        createdById: user.id,
        trigger: {
          create: { organizationId, provider: "mock_store", eventType: "order.created", connectionId: connectionId("mock_store") },
        },
        actions: {
          create: (["mock_crm.upsert_customer", "mock_sheet.append_order"] as const).map((key, index) => ({
            organizationId,
            position: index + 1,
            provider: ACTIONS[key].provider,
            actionType: ACTIONS[key].actionType,
            connectionId: connectionId(ACTIONS[key].provider),
            mapping: defaultMapping(key),
            config: key === "mock_sheet.append_order" ? { sheetName: "Orders" } : {},
          })),
        },
      },
    });
    console.log("Created active Order Sync workflow");
  }

  const result = await runImport({ organizationId, actorUserId: user.id, source: "fleqo_synthetic", limit: 30 });
  console.log(`Synthetic import: ${result.created} created, ${result.updated} updated`);
  console.log(`Done. Sign in as ${email} with the password you provided.`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
