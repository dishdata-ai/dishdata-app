import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { SocialProvider } from "@/lib/api/database.types";
import { signingKey } from "./crypto";

/**
 * The OAuth `state` parameter: proves the callback belongs to a connect flow
 * WE started, for a specific org and user, within a short window. The callback
 * must also check `user` against the signed-in session, otherwise an attacker
 * could feed a victim a link that connects the attacker's account to the
 * victim's org.
 */
export interface OAuthState {
  org: string;
  user: string;
  provider: SocialProvider;
  nonce: string;
  /** Unix ms. */
  exp: number;
}

const TTL_MS = 10 * 60_000;

function mac(body: string): Buffer {
  return createHmac("sha256", signingKey("oauth-state")).update(body).digest();
}

export function signState(input: Pick<OAuthState, "org" | "user" | "provider">, now = Date.now()): string {
  const payload: OAuthState = { ...input, nonce: randomBytes(12).toString("base64url"), exp: now + TTL_MS };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${mac(body).toString("base64url")}`;
}

/** Returns the payload only when the signature is valid and it has not expired. */
export function verifyState(token: string, now = Date.now()): OAuthState | null {
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const given = Buffer.from(sig, "base64url");
  const expected = mac(body);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as OAuthState;
    if (typeof payload.exp !== "number" || payload.exp < now) return null;
    return payload;
  } catch {
    return null;
  }
}
