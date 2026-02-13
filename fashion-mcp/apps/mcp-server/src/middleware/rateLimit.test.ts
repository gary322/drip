import test from "node:test";
import assert from "node:assert/strict";
import type { Request, Response } from "express";
import { createInMemoryRateLimit } from "./rateLimit.js";

function createMockResponse() {
  const headers: Record<string, string> = {};
  const state = {
    statusCode: 200,
    body: null as unknown,
  };

  const response = {
    setHeader(name: string, value: string) {
      headers[name.toLowerCase()] = value;
      return response;
    },
    status(code: number) {
      state.statusCode = code;
      return response;
    },
    json(payload: unknown) {
      state.body = payload;
      return response;
    },
  } as unknown as Response;

  return { response, headers, state };
}

test("rate limiter allows requests under threshold", () => {
  const limiter = createInMemoryRateLimit({
    windowMs: 1000,
    max: 2,
    keyPrefix: "test",
  });
  const req = { ip: "127.0.0.1", headers: {} } as Request;
  const res1 = createMockResponse();
  const res2 = createMockResponse();
  let nextCount = 0;

  limiter(req, res1.response, () => {
    nextCount += 1;
  });
  limiter(req, res2.response, () => {
    nextCount += 1;
  });

  assert.equal(nextCount, 2);
});

test("rate limiter blocks requests over threshold", () => {
  const limiter = createInMemoryRateLimit({
    windowMs: 1000,
    max: 1,
    keyPrefix: "test",
  });
  const req = { ip: "127.0.0.1", headers: {} } as Request;
  const first = createMockResponse();
  const second = createMockResponse();

  limiter(req, first.response, () => {});
  limiter(req, second.response, () => {});

  assert.equal(second.state.statusCode, 429);
  assert.equal(typeof second.state.body, "object");
  assert.ok(second.headers["retry-after"]);
});

