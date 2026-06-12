import assert from "node:assert/strict";
import test from "node:test";
import type { NextFunction, Request, Response } from "express";
import { requireSite } from "./auth.js";

test("requireSite rejects anonymous requests before private content is read", () => {
  let statusCode = 200;
  let responseBody: unknown;
  let nextCalled = false;
  const request = { signedCookies: {} } as Request;
  const response = {
    status(code: number) {
      statusCode = code;
      return this;
    },
    json(body: unknown) {
      responseBody = body;
      return this;
    }
  } as unknown as Response;
  const next = (() => { nextCalled = true; }) as NextFunction;

  requireSite(request, response, next);

  assert.equal(statusCode, 401);
  assert.deepEqual(responseBody, { error: "请先解锁我们的纪念册" });
  assert.equal(nextCalled, false);
});
