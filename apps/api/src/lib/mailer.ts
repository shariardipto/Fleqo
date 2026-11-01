import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { env } from "../config/env.ts";
import { logger } from "./logger.ts";

export interface Email {
  to: string;
  subject: string;
  text: string;
  html: string;
}

type Transport = (email: Email) => Promise<void>;

/** Resend's HTTPS API (no SMTP: hosts block SMTP ports on some plans, e.g. Render's free web services). */
function resendTransport(apiKey: string, from: string): Transport {
  return async (email) => {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [email.to], subject: email.subject, text: email.text, html: email.html }),
      signal: AbortSignal.timeout(10_000),
    });
    // The response body can echo request details; only the status is logged.
    if (!response.ok) throw new Error(`Resend rejected the email (HTTP ${response.status})`);
  };
}

/** Development: print the message (including its link) to the API log. Refused in production. */
const logTransport: Transport = async (email) => {
  logger.info({ to: email.to, subject: email.subject, text: email.text }, "Email (log transport, not sent)");
};

/** Tests and E2E: one JSON file per message. Refused in production. */
function fileTransport(dir: string): Transport {
  return async (email) => {
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, `${Date.now()}-${randomUUID()}.json`), JSON.stringify(email, null, 2));
  };
}

function createTransport(): Transport | null {
  switch (env.EMAIL_PROVIDER) {
    case "resend":
      return resendTransport(env.RESEND_API_KEY!, env.EMAIL_FROM!);
    case "log":
      return logTransport;
    case "file":
      return fileTransport(path.resolve(env.EMAIL_FILE_DIR));
    default:
      return null;
  }
}

const transport = createTransport();

export const mailer = {
  enabled: transport !== null,
  /**
   * Sends without blocking the caller's response, so response timing never reveals whether an
   * address has an account. Failures are logged without the message body (it holds a token).
   */
  dispatch(email: Email, kind: string) {
    if (!transport) return;
    transport(email).catch((error: unknown) => {
      logger.error({ err: error instanceof Error ? { message: error.message } : error, kind }, "Email could not be sent");
    });
  },
};
