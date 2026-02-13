import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { verifyWhatsAppSignature } from "./whatsapp.js";

test("verifyWhatsAppSignature validates sha256 HMAC", () => {
  const rawBody = Buffer.from(JSON.stringify({ hello: "world" }));
  const secret = "test_secret";
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");

  assert.equal(
    verifyWhatsAppSignature({
      appSecret: secret,
      rawBody,
      signatureHeader: `sha256=${expected}`,
    }),
    true
  );

  assert.equal(
    verifyWhatsAppSignature({
      appSecret: secret,
      rawBody,
      signatureHeader: `sha256=${"0".repeat(64)}`,
    }),
    false
  );
});

