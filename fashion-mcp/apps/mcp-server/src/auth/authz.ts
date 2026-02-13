import { getAuth } from "./requestContext.js";

export class AuthzError extends Error {
  readonly statusCode: number;
  readonly requiredScopes: string[];

  constructor(message: string, statusCode: number, requiredScopes: string[] = []) {
    super(message);
    this.name = "AuthzError";
    this.statusCode = statusCode;
    this.requiredScopes = requiredScopes;
  }
}

export function requireToolScopes(requiredScopes: string[]): void {
  const auth = getAuth();
  if (!auth) {
    throw new AuthzError("unauthorized", 401, requiredScopes);
  }

  if (requiredScopes.length === 0 || auth.scopes.includes("*")) {
    return;
  }

  const hasAll = requiredScopes.every((scope) => auth.scopes.includes(scope));
  if (!hasAll) {
    throw new AuthzError("insufficient_scope", 403, requiredScopes);
  }
}

