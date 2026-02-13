import type { Response } from "express";
import { getConfig } from "../config.js";

export function sendAuthChallenge(res: Response, scopes: string[]) {
  const base = getConfig().PUBLIC_BASE_URL;
  const resourceMetadataUrl = `${base}/.well-known/oauth-protected-resource`;
  const scope = scopes.join(" ");

  // Apps SDK auth guide recommends WWW-Authenticate with resource_metadata and scope.
  // https://developers.openai.com/apps-sdk/build/auth/
  res.setHeader(
    "WWW-Authenticate",
    `Bearer resource_metadata="${resourceMetadataUrl}", scope="${scope}"`
  );
  res.status(401).json({ error: "unauthorized" });
}
