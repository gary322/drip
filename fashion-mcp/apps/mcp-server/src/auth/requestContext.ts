import { AsyncLocalStorage } from "node:async_hooks";
import type { VerifiedToken } from "./verifyAccessToken.js";

/**
 * AsyncLocalStorage-backed request context so tool handlers can safely access
 * the authenticated user for the current request.
 *
 * This avoids relying on framework-specific header propagation and works even when
 * the MCP SDK doesn't pass the raw HTTP request into tool handlers.
 */
const als = new AsyncLocalStorage<VerifiedToken>();

export function runWithAuth<T>(auth: VerifiedToken, fn: () => Promise<T>): Promise<T> {
  return als.run(auth, fn);
}

export function getAuth(): VerifiedToken | undefined {
  return als.getStore();
}
