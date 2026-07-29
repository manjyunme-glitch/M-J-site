import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const scriptPath = fileURLToPath(new URL("../scripts/generate-build-info.mjs", import.meta.url));

test("build info accepts commit metadata injected by Docker build args", (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mj-build-info-"));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));

  execFileSync(process.execPath, [scriptPath], {
    cwd: directory,
    env: {
      ...process.env,
      APP_COMMIT_SHA: "0123456789abcdef",
      APP_COMMIT_DATE: "2026-07-29T06:00:00.000Z",
      APP_COMMIT_REF: "refs/heads/main",
      APP_COMMIT_MESSAGE: "",
      GITHUB_REPOSITORY: "owner/repository",
      GITHUB_BRANCH: "main"
    },
    stdio: "pipe"
  });

  const info = JSON.parse(fs.readFileSync(path.join(directory, "build-info.json"), "utf8")) as Record<string, unknown>;
  assert.equal(info.repository, "owner/repository");
  assert.equal(info.branch, "main");
  assert.equal(info.ref, "refs/heads/main");
  assert.equal(info.sha, "0123456789abcdef");
  assert.equal(info.message, "");
  assert.equal(info.committedAt, "2026-07-29T06:00:00.000Z");
  assert.equal(info.source, "build-args");
});

test("build info remains unknown when neither build args nor Git metadata identify the source", (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mj-build-info-"));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const env = { ...process.env };
  for (const key of ["APP_COMMIT_SHA", "APP_COMMIT_DATE", "APP_COMMIT_TIME", "APP_COMMIT_REF", "APP_COMMIT_MESSAGE"]) {
    delete env[key];
  }

  execFileSync(process.execPath, [scriptPath], {
    cwd: directory,
    env,
    stdio: "pipe"
  });

  const info = JSON.parse(fs.readFileSync(path.join(directory, "build-info.json"), "utf8")) as Record<string, unknown>;
  assert.equal(info.sha, "");
  assert.equal(info.ref, "");
  assert.equal(info.source, "unknown");
});

test("build info refuses to label uncommitted source as the clean Git HEAD", (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mj-build-info-git-"));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.writeFileSync(path.join(directory, ".gitignore"), "build-info.json\n");
  fs.writeFileSync(path.join(directory, "tracked.txt"), "clean\n");
  execFileSync("git", ["init"], { cwd: directory, stdio: "pipe" });
  execFileSync("git", ["add", ".gitignore", "tracked.txt"], { cwd: directory, stdio: "pipe" });
  execFileSync("git", [
    "-c", "user.name=Build Test",
    "-c", "user.email=build-test@example.invalid",
    "-c", "commit.gpgsign=false",
    "commit", "-m", "clean source"
  ], { cwd: directory, stdio: "pipe" });

  const env = { ...process.env };
  for (const key of ["APP_COMMIT_SHA", "APP_COMMIT_DATE", "APP_COMMIT_TIME", "APP_COMMIT_REF", "APP_COMMIT_MESSAGE"]) {
    delete env[key];
  }

  execFileSync(process.execPath, [scriptPath], { cwd: directory, env, stdio: "pipe" });
  const clean = JSON.parse(fs.readFileSync(path.join(directory, "build-info.json"), "utf8")) as Record<string, unknown>;
  assert.equal(clean.sha, execFileSync("git", ["rev-parse", "HEAD"], { cwd: directory, encoding: "utf8" }).trim());
  assert.equal(clean.source, "git");

  fs.writeFileSync(path.join(directory, "tracked.txt"), "dirty\n");
  execFileSync(process.execPath, [scriptPath], { cwd: directory, env, stdio: "pipe" });
  const dirty = JSON.parse(fs.readFileSync(path.join(directory, "build-info.json"), "utf8")) as Record<string, unknown>;
  assert.equal(dirty.sha, "");
  assert.equal(dirty.ref, "");
  assert.equal(dirty.source, "git-dirty");
});
