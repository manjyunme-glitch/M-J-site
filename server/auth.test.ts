import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import type { NextFunction, Request, Response } from "express";

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "mj-auth-"));
process.env.DATABASE_PATH = path.join(tempDir, "love-journal.db");
process.env.UPLOAD_DIR = path.join(tempDir, "uploads");
process.env.BACKUP_STAGING_DIR = path.join(tempDir, "backup-staging");
process.env.SITE_PASSWORD_HASH = "site-hash-a";
process.env.ADMIN_PASSWORD_HASH = "admin-hash-a";
process.env.COOKIE_SECRET = "cookie-secret-a";

const { config } = await import("./config.js");
const { createAdminSession, createSiteSession, hasAdminAccess, hasSiteAccess, requireSite } = await import("./auth.js");
after(() => fs.rmSync(tempDir, { recursive: true, force: true }));

type RecordedCookie = { value: string; options: Record<string, unknown> };

function cookieRecorder() {
  const cookies = new Map<string, RecordedCookie>();
  const response = {
    cookie(name: string, value: string, options: Record<string, unknown>) {
      cookies.set(name, { value, options });
      return this;
    }
  } as unknown as Response;
  return { cookies, response };
}

function requestWith(cookies: Map<string, RecordedCookie>) {
  return {
    signedCookies: Object.fromEntries([...cookies].map(([name, cookie]) => [name, cookie.value]))
  } as Request;
}

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

test("site sessions are invalidated by site hash or cookie secret rotation without exposing the hash", () => {
  config.sitePasswordHash = "site-hash-a";
  config.cookieSecret = "cookie-secret-a";
  const { cookies, response } = cookieRecorder();
  createSiteSession(response);
  const request = requestWith(cookies);
  const raw = cookies.get("mj_site_session")?.value || "";

  assert.equal(hasSiteAccess(request), true);
  assert.equal(hasAdminAccess(request), false);
  assert.equal(raw.includes(config.sitePasswordHash), false);
  assert.equal(JSON.parse(raw).credential, "site");

  config.sitePasswordHash = "site-hash-b";
  assert.equal(hasSiteAccess(request), false);

  config.sitePasswordHash = "site-hash-a";
  assert.equal(hasSiteAccess(request), true);
  config.cookieSecret = "cookie-secret-b";
  assert.equal(hasSiteAccess(request), false);
});

test("admin-derived site access is scoped to the admin password hash", () => {
  config.sitePasswordHash = "site-hash-a";
  config.adminPasswordHash = "admin-hash-a";
  config.cookieSecret = "cookie-secret-a";
  const { cookies, response } = cookieRecorder();
  createAdminSession(response);
  const request = requestWith(cookies);
  const sitePayload = JSON.parse(cookies.get("mj_site_session")?.value || "{}") as Record<string, unknown>;
  const adminPayload = JSON.parse(cookies.get("mj_admin_session")?.value || "{}") as Record<string, unknown>;

  assert.equal(sitePayload.credential, "admin");
  assert.equal(adminPayload.credential, "admin");
  assert.equal(hasSiteAccess(request), true);
  assert.equal(hasAdminAccess(request), true);
  assert.equal(JSON.stringify(sitePayload).includes(config.adminPasswordHash), false);
  assert.equal(JSON.stringify(adminPayload).includes(config.adminPasswordHash), false);

  config.adminPasswordHash = "admin-hash-b";
  assert.equal(hasAdminAccess(request), false);
  assert.equal(hasSiteAccess(request), false);
});

test("legacy session payloads without a password-bound version are rejected", () => {
  const request = {
    signedCookies: {
      mj_site_session: JSON.stringify({ role: "site", exp: Date.now() + 60_000 })
    }
  } as unknown as Request;
  assert.equal(hasSiteAccess(request), false);
});
