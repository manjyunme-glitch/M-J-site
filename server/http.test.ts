import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";
import test from "node:test";
import express from "express";
import multer from "multer";
import { apiErrorHandler, mountClientAssets } from "./http.js";

async function listen(app: express.Express) {
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve()))
  };
}

test("request errors map common client failures to 4xx without leaking server errors", async () => {
  const app = express();
  app.use(express.json({ limit: "32b" }));
  app.post("/json", (req, res) => res.json(req.body));
  app.get("/multer-size", (_req, _res, next) => next(new multer.MulterError("LIMIT_FILE_SIZE", "files")));
  app.get("/multer-count", (_req, _res, next) => next(new multer.MulterError("LIMIT_FILE_COUNT", "files")));
  app.get("/client-error", (_req, _res, next) => next(Object.assign(new Error("private validation detail"), { status: 422 })));
  app.get("/server-error", (_req, _res, next) => next(new Error("E:\\private\\database.sqlite")));
  app.use(apiErrorHandler);
  const server = await listen(app);

  try {
    let response = await fetch(`${server.baseUrl}/json`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{\"broken\":"
    });
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: "请求内容不是有效的 JSON" });

    response = await fetch(`${server.baseUrl}/json`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: "x".repeat(100) })
    });
    assert.equal(response.status, 413);
    assert.deepEqual(await response.json(), { error: "请求内容超过大小限制" });

    response = await fetch(`${server.baseUrl}/multer-size`);
    assert.equal(response.status, 413);
    assert.deepEqual(await response.json(), { error: "文件大小超过限制" });

    response = await fetch(`${server.baseUrl}/multer-count`);
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: "上传文件数量或字段不正确" });

    response = await fetch(`${server.baseUrl}/client-error`);
    assert.equal(response.status, 422);
    assert.deepEqual(await response.json(), { error: "请求内容格式不正确" });

    response = await fetch(`${server.baseUrl}/server-error`);
    assert.equal(response.status, 500);
    const body = await response.text();
    assert.equal(body.includes("database.sqlite"), false);
    assert.deepEqual(JSON.parse(body), { error: "服务器无法处理该请求" });
  } finally {
    await server.close();
  }
});

test("production Vite assets are immutable while entry responses revalidate", async () => {
  const clientDir = fs.mkdtempSync(path.join(os.tmpdir(), "mj-static-"));
  fs.mkdirSync(path.join(clientDir, "assets"));
  fs.writeFileSync(path.join(clientDir, "index.html"), "<!doctype html><main>entry</main>");
  fs.writeFileSync(path.join(clientDir, "assets", "index-Ab12Cd34.js"), "console.log('asset')");
  fs.writeFileSync(path.join(clientDir, "manifest.txt"), "entry metadata");
  const app = express();
  mountClientAssets(app, clientDir, true);
  const server = await listen(app);

  try {
    let response = await fetch(`${server.baseUrl}/assets/index-Ab12Cd34.js`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("cache-control") || "", /public/);
    assert.match(response.headers.get("cache-control") || "", /max-age=31536000/);
    assert.match(response.headers.get("cache-control") || "", /immutable/);

    response = await fetch(`${server.baseUrl}/`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-cache");

    response = await fetch(`${server.baseUrl}/stories`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-cache");
    assert.match(await response.text(), /entry/);

    response = await fetch(`${server.baseUrl}/manifest.txt`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-cache");
  } finally {
    await server.close();
    fs.rmSync(clientDir, { recursive: true, force: true });
  }
});
