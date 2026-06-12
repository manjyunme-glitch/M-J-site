import assert from "node:assert/strict";
import test from "node:test";

process.env.SITE_PASSWORD_HASH = "test";
process.env.ADMIN_PASSWORD_HASH = "test";

const { compareCommits } = await import("./version.js");

test("compareCommits identifies matching and different revisions", () => {
  assert.equal(compareCommits("abc", "abc"), "synced");
  assert.equal(compareCommits("abc", "def"), "outdated");
  assert.equal(compareCommits("", "def"), "unknown");
});
