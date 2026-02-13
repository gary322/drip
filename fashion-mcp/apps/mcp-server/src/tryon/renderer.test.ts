import test from "node:test";
import assert from "node:assert/strict";
import { Jimp } from "jimp";
import { renderTryonComposite, renderTryonImage } from "./renderer.js";
import { resetConfigForTests } from "../config.js";

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

test("renderTryonComposite returns rendered jpeg with user dimensions", async () => {
  const user = new Jimp({ width: 320, height: 480, color: 0xffffffff });
  const garment = new Jimp({ width: 200, height: 200, color: 0xff2222ff });

  const [userBuffer, garmentBuffer] = await Promise.all([
    user.getBuffer("image/png"),
    garment.getBuffer("image/png"),
  ]);

  const output = await renderTryonComposite({
    userImageBuffer: userBuffer,
    garmentImageBuffer: garmentBuffer,
  });
  assert.ok(output.length > 0);

  const rendered = await Jimp.read(output);
  assert.equal(rendered.bitmap.width, 320);
  assert.equal(rendered.bitmap.height, 480);
});

test("renderTryonImage does not fall back to local compositor when Vertex fails", async () => {
  await withEnv(
    {
      NODE_ENV: "development",
      DATABASE_URL: "postgres://fashion:fashion@localhost:5432/fashion",
      TRYON_PROVIDER: "google_vertex",
      GOOGLE_CLOUD_PROJECT: "test-project",
      GOOGLE_CLOUD_LOCATION: "us-central1",
      GOOGLE_OAUTH_ACCESS_TOKEN: "test_token",
      GOOGLE_VERTEX_TIMEOUT_MS: "2000",
    },
    async () => {
      const user = new Jimp({ width: 64, height: 96, color: 0xffffffff });
      const garment = new Jimp({ width: 64, height: 64, color: 0xff2222ff });
      const [userBuffer, garmentBuffer] = await Promise.all([
        user.getBuffer("image/png"),
        garment.getBuffer("image/png"),
      ]);

      const originalFetch = globalThis.fetch;
      globalThis.fetch = (async (input: any) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input?.url;
        if (typeof url === "string" && url.includes("aiplatform.googleapis.com")) {
          return new Response("vertex_fail", { status: 500 });
        }
        return originalFetch(input);
      }) as any;

      try {
        await assert.rejects(
          () => renderTryonImage({ userImageBuffer: userBuffer, garmentImageBuffer: garmentBuffer }),
          /google_vertex_tryon_request_failed/
        );
      } finally {
        globalThis.fetch = originalFetch;
      }
    }
  );
});
