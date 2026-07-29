import assert from "node:assert/strict";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

const projectFile = (relativePath: string) => fileURLToPath(new URL(`../${relativePath}`, import.meta.url));

test("Docker entrypoint is stored with LF endings and protected by Git attributes", () => {
  const entrypoint = fs.readFileSync(projectFile("docker-entrypoint.sh"));
  const attributes = fs.readFileSync(projectFile(".gitattributes"), "utf8");

  assert.equal(entrypoint.includes(0x0d), false);
  assert.match(entrypoint.toString("utf8"), /^#!\/bin\/sh\n/);
  assert.match(attributes, /^\*\.sh text eol=lf$/m);
});

test("Docker build context excludes Git internals", () => {
  const ignoredPaths = fs.readFileSync(projectFile(".dockerignore"), "utf8").split(/\r?\n/);
  assert.equal(ignoredPaths.includes(".git"), true);
});
