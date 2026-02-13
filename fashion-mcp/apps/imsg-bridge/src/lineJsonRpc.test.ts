import test from "node:test";
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { LineJsonRpcClient } from "./lineJsonRpc.js";

test("LineJsonRpcClient resolves a call with result", async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  const client = new LineJsonRpcClient(input, output);

  const written: string[] = [];
  output.on("data", (chunk) => written.push(String(chunk)));

  const callPromise = client.call("ping", { ok: true }, 5_000);

  // Wait for the request to be written.
  await new Promise<void>((resolve) => {
    const timer = setInterval(() => {
      if (written.join("").includes("\n")) {
        clearInterval(timer);
        resolve();
      }
    }, 5);
  });

  const requestLine = written.join("").trim().split("\n")[0];
  const req = JSON.parse(requestLine);
  assert.equal(req.jsonrpc, "2.0");
  assert.equal(req.method, "ping");
  assert.deepEqual(req.params, { ok: true });

  input.write(`${JSON.stringify({ jsonrpc: "2.0", id: req.id, result: { pong: 1 } })}\n`);

  const result = await callPromise;
  assert.deepEqual(result, { pong: 1 });
});

test("LineJsonRpcClient forwards notifications", async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  const client = new LineJsonRpcClient(input, output);

  let seen: any = null;
  client.onNotification((note) => {
    seen = note;
  });

  input.write(`${JSON.stringify({ jsonrpc: "2.0", method: "message", params: { x: 1 } })}\n`);
  await new Promise((r) => setTimeout(r, 10));

  assert.equal(seen?.method, "message");
  assert.deepEqual(seen?.params, { x: 1 });
});

