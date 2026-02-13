import type { Request, Response } from "express";
import { getConfig } from "../config.js";

/**
 * OAuth protected resource metadata endpoint.
 * ChatGPT discovers your auth server and supported scopes here.
 *
 * Docs: https://developers.openai.com/apps-sdk/build/auth/
 */
export function oauthProtectedResource(_req: Request, res: Response) {
  const cfg = getConfig();

  res.json({
    resource: cfg.PUBLIC_BASE_URL,
    authorization_servers: cfg.AUTHORIZATION_SERVERS,
    scopes_supported: [
      "profile:read",
      "profile:write",
      "photos:write",
      "tryon:write",
      "tryon:read",
      "feedback:write",
      "catalog:read",
      "stylemap:read",
      "plans:write",
      "plans:read",
      "orders:write"
    ],
    resource_documentation: "https://yourdomain.com/docs/mcp"
  });
}
