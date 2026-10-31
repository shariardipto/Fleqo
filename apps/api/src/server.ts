import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import { prisma } from "./lib/prisma.ts";

const app = express();

const PORT = Number(process.env.PORT ?? 4000);

app.use(helmet());

app.use(
  cors({
    origin: "http://localhost:3000",
    credentials: true,
  })
);

app.use(express.json({ limit: "1mb" }));

app.get("/api/health", (_req, res) => {
  res.status(200).json({
    success: true,
    message: "Fleqo API is running!",
    service: "fleqo-api",
  });
});


app.get("/api/db-health", async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;

    res.status(200).json({
      success: true,
      database: "connected",
      service: "fleqo-api",
    });
  } catch (error) {
    console.error("Database health check failed:", error);

    res.status(503).json({
      success: false,
      database: "unavailable",
    });
  }
});

app.listen(PORT, () => {
  console.log(`Fleqo API running on port ${PORT}`);
});
