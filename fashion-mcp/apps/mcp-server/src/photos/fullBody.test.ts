import test from "node:test";
import assert from "node:assert/strict";
import { evaluateFullBodyFrame } from "./fullBody.js";
import { validateFullBodyPhotoUrl } from "./fullBody.js";
import { resetConfigForTests } from "../config.js";
import { Jimp } from "jimp";

function withEnv(temp: Record<string, string | undefined>, fn: () => Promise<void> | void) {
  const original: Record<string, string | undefined> = {};
  for (const key of Object.keys(temp)) {
    original[key] = process.env[key];
    const next = temp[key];
    if (next == null) delete process.env[key];
    else process.env[key] = next;
  }
  resetConfigForTests();
  return Promise.resolve(fn()).finally(() => {
    for (const key of Object.keys(temp)) {
      const prev = original[key];
      if (prev == null) delete process.env[key];
      else process.env[key] = prev;
    }
    resetConfigForTests();
  });
}

test("evaluateFullBodyFrame passes likely full-body portrait", () => {
  const result = evaluateFullBodyFrame({
    width: 900,
    height: 1600,
    minWidth: 512,
    minHeight: 900,
    minAspectRatio: 1.3,
  });
  assert.equal(result.ok, true);
  assert.equal(result.reason, "ok");
});

test("evaluateFullBodyFrame rejects low-aspect upper-body framing", () => {
  const result = evaluateFullBodyFrame({
    width: 900,
    height: 769,
    minWidth: 512,
    minHeight: 900,
    minAspectRatio: 1.3,
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "image_too_small");
});

test("evaluateFullBodyFrame rejects wide crop even at high resolution", () => {
  const result = evaluateFullBodyFrame({
    width: 1200,
    height: 1200,
    minWidth: 512,
    minHeight: 900,
    minAspectRatio: 1.3,
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "not_head_to_toe_likely");
});

test("validateFullBodyPhotoUrl uses strict validator reason codes when enabled", async () => {
  await withEnv(
    {
      DATABASE_URL: "postgres://fashion:fashion@localhost:5432/fashion",
      FULLBODY_VALIDATOR_MODE: "strict",
      FULLBODY_VALIDATOR_URL: "https://validator.example/validate",
      FULLBODY_REQUIRE_FEET_VISIBLE: "true",
      TRYON_MIN_FULL_BODY_WIDTH_PX: "512",
      TRYON_MIN_FULL_BODY_HEIGHT_PX: "900",
      TRYON_MIN_FULL_BODY_ASPECT_RATIO: "1.3",
    },
    async () => {
      const image = new Jimp({ width: 900, height: 1600, color: 0xffffffff });
      const imageBuffer = await image.getBuffer("image/png");
      const originalFetch = globalThis.fetch;

      globalThis.fetch = (async (input: URL | RequestInfo, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        if (url === "https://example.com/person.png") {
          return new Response(new Uint8Array(imageBuffer), {
            status: 200,
            headers: { "content-type": "image/png" },
          });
        }
        if (url === "https://validator.example/validate") {
          return new Response(
            JSON.stringify({
              approved: false,
              reasons: ["feet_missing"],
              metrics: { width: 900, height: 1600, aspectRatio: 1.7778 },
            }),
            { status: 200, headers: { "content-type": "application/json" } }
          );
        }
        return originalFetch(input as any, init);
      }) as typeof fetch;

      try {
        const result = await validateFullBodyPhotoUrl("https://example.com/person.png");
        assert.equal(result.ok, false);
        assert.equal(result.reason, "feet_missing");
        assert.equal(result.provider, "strict");
      } finally {
        globalThis.fetch = originalFetch;
      }
    }
  );
});
