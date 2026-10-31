import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { env } from "../config/env.ts";

const key = Buffer.from(env.ENCRYPTION_KEY, "base64");

/** AES-256-GCM encryption for secrets at rest. Format: v1.<iv>.<tag>.<ciphertext> (base64url). */
export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", iv.toString("base64url"), tag.toString("base64url"), ciphertext.toString("base64url")].join(".");
}

export function decryptSecret(payload: string): string {
  const [version, iv, tag, ciphertext] = payload.split(".");
  if (version !== "v1" || !iv || !tag || !ciphertext) throw new Error("Unsupported secret format");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]).toString("utf8");
}

export const generateSigningSecret = () => `whsec_${randomBytes(32).toString("base64url")}`;
export const generatePublicId = (prefix: string) => `${prefix}_${randomBytes(12).toString("base64url")}`;

/** HMAC-SHA256 over `<timestamp>.<raw body bytes>`, hex encoded. */
export function signWebhook(secret: string, timestamp: number, rawBody: Buffer | string): string {
  return createHmac("sha256", secret)
    .update(`${timestamp}.`)
    .update(typeof rawBody === "string" ? Buffer.from(rawBody, "utf8") : rawBody)
    .digest("hex");
}

/** Constant-time comparison of a hex signature against the expected value. */
export function verifyWebhookSignature(secret: string, timestamp: number, rawBody: Buffer, signature: string): boolean {
  if (!/^[0-9a-f]{64}$/i.test(signature)) return false;
  const expected = Buffer.from(signWebhook(secret, timestamp, rawBody), "hex");
  const received = Buffer.from(signature, "hex");
  return expected.length === received.length && timingSafeEqual(expected, received);
}

export const sha256Hex = (data: Buffer | string) => createHash("sha256").update(data).digest("hex");

/** JSON with recursively sorted object keys, so equal documents hash equally (JSONB reorders keys). */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.keys(value as Record<string, unknown>)
      .sort()
      .filter((key) => (value as Record<string, unknown>)[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value);
}
