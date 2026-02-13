import test from "node:test";
import assert from "node:assert/strict";
import { AuthzError, requireToolScopes } from "./authz.js";
import { runWithAuth } from "./requestContext.js";

test("requireToolScopes throws unauthorized when auth context is missing", () => {
  assert.throws(
    () => requireToolScopes(["profile:read"]),
    (error: unknown) =>
      error instanceof AuthzError &&
      error.statusCode === 401 &&
      error.requiredScopes.includes("profile:read")
  );
});

test("requireToolScopes allows wildcard scope", async () => {
  await runWithAuth({ userId: "user_a", scopes: ["*"] }, async () => {
    assert.doesNotThrow(() => requireToolScopes(["orders:write"]));
  });
});

test("requireToolScopes rejects missing required scope", async () => {
  await runWithAuth({ userId: "user_a", scopes: ["profile:read"] }, async () => {
    assert.throws(
      () => requireToolScopes(["orders:write"]),
      (error: unknown) =>
        error instanceof AuthzError &&
        error.statusCode === 403 &&
        error.requiredScopes.includes("orders:write")
    );
  });
});

