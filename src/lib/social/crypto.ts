import "server-only";
import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";

/**
 * Token encryption for social_credentials. AES-256-GCM with a fresh 12-byte IV
 * per value; the blob is `v1.<iv>.<tag>.<ciphertext>` (base64url) so the format
 * can be versioned if the key ever rotates.
 *
 * SOCIAL_TOKEN_KEY = 32 random bytes, base64:  openssl rand -base64 32
 * Losing or changing it makes stored tokens undecryptable — accounts then have
 * to be reconnected, nothing else breaks.
 */
export function masterKey(): Buffer {
  const raw = process.env.SOCIAL_TOKEN_KEY;
  if (!raw) throw new Error("SOCIAL_TOKEN_KEY is not set (32 random bytes, base64).");
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) throw new Error("SOCIAL_TOKEN_KEY must decode to exactly 32 bytes.");
  return key;
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", masterKey(), iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ct.toString("base64url")].join(".");
}

export function decryptSecret(blob: string): string {
  const [version, iv, tag, ct] = blob.split(".");
  if (version !== "v1" || !iv || !tag || !ct) throw new Error("Unrecognised secret format.");
  const decipher = createDecipheriv("aes-256-gcm", masterKey(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ct, "base64url")), decipher.final()]).toString("utf8");
}

/** Sub-key for signing, so the same master key is never used for two purposes. */
export function signingKey(purpose: string): Buffer {
  return createHmac("sha256", masterKey()).update(purpose).digest();
}
