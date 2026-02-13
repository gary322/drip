import test from "node:test";
import assert from "node:assert/strict";
import { getConfig, resetConfigForTests } from "./config.js";

function withEnv(temp: Record<string, string | undefined>, fn: () => void) {
  const original: Record<string, string | undefined> = {};
  for (const key of Object.keys(temp)) {
    original[key] = process.env[key];
    const next = temp[key];
    if (next == null) {
      delete process.env[key];
    } else {
      process.env[key] = next;
    }
  }

  try {
    resetConfigForTests();
    fn();
  } finally {
    for (const key of Object.keys(temp)) {
      const prev = original[key];
      if (prev == null) delete process.env[key];
      else process.env[key] = prev;
    }
    resetConfigForTests();
  }
}

test("getConfig parses development defaults", () => {
  withEnv(
    {
      NODE_ENV: "development",
      DATABASE_URL: "postgres://fashion:fashion@localhost:5432/fashion",
      AUTH_MODE: "dev",
    },
    () => {
      const config = getConfig();
      assert.equal(config.AUTH_MODE, "dev");
      assert.equal(config.PORT, 8787);
      assert.equal(config.APPROVAL_TTL_MINUTES, 60);
      assert.ok(config.ALLOWED_ORIGINS.length > 0);
    }
  );
});

test("getConfig enforces oauth required variables", () => {
  withEnv(
    {
      NODE_ENV: "development",
      DATABASE_URL: "postgres://fashion:fashion@localhost:5432/fashion",
      AUTH_MODE: "oauth",
      JWKS_URL: undefined,
      JWT_ISSUER: undefined,
      JWT_AUDIENCE: undefined,
    },
    () => {
      assert.throws(() => getConfig());
    }
  );
});

test("getConfig enforces stripe secret when checkout provider is stripe", () => {
  withEnv(
    {
      NODE_ENV: "development",
      DATABASE_URL: "postgres://fashion:fashion@localhost:5432/fashion",
      AUTH_MODE: "dev",
      CHECKOUT_PROVIDER: "stripe",
      STRIPE_SECRET_KEY: undefined,
    },
    () => {
      assert.throws(() => getConfig());
    }
  );
});
