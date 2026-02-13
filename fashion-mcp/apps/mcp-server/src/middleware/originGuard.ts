import type { Request, Response, NextFunction } from "express";
import { getConfig } from "../config.js";

let cachedAllowedOrigins: Set<string> | null = null;
function getAllowedOrigins(): Set<string> {
  // getConfig() depends on DATABASE_URL being set; avoid calling it at module load.
  if (!cachedAllowedOrigins) {
    cachedAllowedOrigins = new Set(getConfig().ALLOWED_ORIGINS);
  }
  return cachedAllowedOrigins;
}

export function isAllowedOrigin(origin: string): boolean {
  return getAllowedOrigins().has(origin);
}

/**
 * Streamable HTTP transport security: validate Origin to mitigate DNS rebinding.
 * See MCP spec: servers MUST validate Origin header on all incoming connections.
 */
export function originGuard(req: Request, res: Response, next: NextFunction) {
  const origin = req.headers.origin;
  if (!origin) return next();

  if (!isAllowedOrigin(origin)) {
    return res.status(403).json({ error: "forbidden_origin" });
  }
  // If you want strict CORS, you can also set allowed origin headers here:
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  next();
}
