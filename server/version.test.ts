import assert from "node:assert/strict";
import test from "node:test";
import type { BuildInfo, CommitInfo } from "./version.js";

process.env.SITE_PASSWORD_HASH = "test";
process.env.ADMIN_PASSWORD_HASH = "test";

const { compareCommits, createDeploymentStatus } = await import("./version.js");

test("compareCommits identifies matching and different revisions", () => {
  assert.equal(compareCommits("abc", "abc"), "synced");
  assert.equal(compareCommits("abc", "def"), "outdated");
  assert.equal(compareCommits("", "def"), "unknown");
});

test("deployment status keeps an unidentified build unknown instead of adopting the remote commit", () => {
  const current: BuildInfo = {
    repository: "owner/repository",
    branch: "main",
    ref: "",
    sha: "",
    message: "",
    committedAt: "",
    builtAt: "2026-07-29T06:00:00.000Z",
    source: "unknown"
  };
  const latest: CommitInfo = {
    sha: "remote-latest",
    message: "Remote commit",
    committedAt: "2026-07-29T07:00:00.000Z"
  };

  const result = createDeploymentStatus(current, latest, "2026-07-29T08:00:00.000Z");

  assert.equal(result.status, "unknown");
  assert.equal(result.current.sha, "");
  assert.equal(result.current.source, "unknown");
  assert.equal(result.latest?.sha, "remote-latest");
});
