import type { Request, Response, NextFunction } from "express";
import { verifyAccessToken, VerifiedToken } from "./verifyAccessToken.js";
import { getConfig } from "../config.js";

declare global {
  namespace Express {
    interface Request {
      user?: VerifiedToken;
    }
  }
}

function buildWwwAuthenticate(resourceMetadataUrl: string, scope?: string) {
  // Per Apps SDK auth docs, include a WWW-Authenticate challenge that points at
  // the protected resource metadata URL so ChatGPT can discover it.
  // https://developers.openai.com/apps-sdk/build/auth/
  const parts = [
    `Bearer resource_metadata="${resourceMetadataUrl}"`,
  ];
  if (scope) parts.push(`scope="${scope}"`);
  return parts.join(", ");
}

export function requireScopes(required: string[]) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const token = await verifyAccessToken(req);
    if (!token) {
      const base = getConfig().PUBLIC_BASE_URL;
      res.setHeader(
        "WWW-Authenticate",
        buildWwwAuthenticate(`${base}/.well-known/oauth-protected-resource`, required.join(" "))
      );
      return res.status(401).json({ error: "unauthorized" });
    }

    // DEV mode: scopes ["*"] means allow all
    if (!token.scopes.includes("*")) {
      const ok = required.every((s) => token.scopes.includes(s));
      if (!ok) return res.status(403).json({ error: "insufficient_scope", required });
    }

    req.user = token;
    next();
  };
}
