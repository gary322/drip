import { createRemoteJWKSet, jwtVerify } from "jose";
import type { Request } from "express";
import { getConfig } from "../config.js";

export type VerifiedToken = {
  userId: string;
  scopes: string[];
};

function getBearerToken(req: Request): string | null {
  const h = req.headers.authorization;
  if (!h) return null;
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m?.[1] ?? null;
}

function parseScope(scopeClaim: unknown): string[] {
  if (typeof scopeClaim === "string") return scopeClaim.split(/\s+/).filter(Boolean);
  if (Array.isArray(scopeClaim)) return scopeClaim.filter((x) => typeof x === "string") as string[];
  return [];
}

/**
 * Verifies the request Authorization header and returns user context.
 *
 * - In AUTH_MODE=dev, accepts tokens like: "dev_user_123" (scopes = ["*"])
 * - In AUTH_MODE=oauth, validates JWT via JWKS and checks iss/aud/exp and scopes.
 */
export async function verifyAccessToken(req: Request): Promise<VerifiedToken | null> {
  const token = getBearerToken(req);
  if (!token) return null;

  const cfg = getConfig();
  const mode = cfg.AUTH_MODE;

  if (mode === "dev") {
    if (!token.startsWith("dev_")) return null;
    const userId = token.slice("dev_".length) || "user";
    return { userId, scopes: ["*"] };
  }

  // oauth mode
  const jwksUrl = cfg.JWKS_URL!;
  const issuer = cfg.JWT_ISSUER!;
  const audience = cfg.JWT_AUDIENCE!;

  const JWKS = createRemoteJWKSet(new URL(jwksUrl));
  const { payload } = await jwtVerify(token, JWKS, {
    issuer,
    audience,
  });

  const userId =
    (typeof payload.sub === "string" && payload.sub) ||
    (typeof (payload as any).uid === "string" && (payload as any).uid) ||
    "";

  if (!userId) return null;

  const scopes = parseScope((payload as any).scope ?? (payload as any).scp);

  return { userId, scopes };
}
