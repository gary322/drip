import test from "node:test";
import assert from "node:assert/strict";
import { Jimp } from "jimp";
import { detectImageExtension } from "./imageFormat.js";

test("detectImageExtension detects png and jpg", async () => {
  const sample = new Jimp({ width: 32, height: 32, color: 0xff0000ff });
  const [png, jpg] = await Promise.all([
    sample.getBuffer("image/png"),
    sample.getBuffer("image/jpeg"),
  ]);

  assert.equal(detectImageExtension(png), "png");
  assert.equal(detectImageExtension(jpg), "jpg");
});

test("detectImageExtension falls back to jpg for unknown bytes", () => {
  const random = Buffer.from("not-an-image");
  assert.equal(detectImageExtension(random), "jpg");
});
