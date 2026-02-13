import test from "node:test";
import assert from "node:assert/strict";
import { buildTextFromParts, pickFirstImage } from "./messageFormat.js";

test("buildTextFromParts merges text and links", () => {
  const text = buildTextFromParts([
    { type: "text", text: "Hello" },
    { type: "link", url: "https://example.com" },
    { type: "text", text: "Bye" },
  ] as any);
  assert.equal(text, "Hello\nhttps://example.com\nBye");
});

test("pickFirstImage returns first image part", () => {
  const image = pickFirstImage([
    { type: "text", text: "x" },
    { type: "image", imageUrl: "https://example.com/a.jpg", caption: "cap" },
    { type: "image", imageUrl: "https://example.com/b.jpg" },
  ] as any);
  assert.deepEqual(image, { imageUrl: "https://example.com/a.jpg", caption: "cap" });
});

