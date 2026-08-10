import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

function key() {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw || !/^[a-f0-9]{64}$/i.test(raw)) {
    throw new Error("ENCRYPTION_KEY must be 64 hex characters (32 bytes).");
  }
  return Buffer.from(raw, "hex");
}

export function encrypt(plaintext) {
  if (plaintext === null || plaintext === undefined) return null;
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const ct = Buffer.concat([c.update(String(plaintext), "utf8"), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]).toString("base64");
}

export function decrypt(stored) {
  if (!stored) return null;
  const buf = Buffer.from(stored, "base64");
  const d = createDecipheriv("aes-256-gcm", key(), buf.subarray(0, 12));
  d.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString("utf8");
}