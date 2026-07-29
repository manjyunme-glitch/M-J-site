import assert from "node:assert/strict";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

const packagePath = fileURLToPath(new URL("../package.json", import.meta.url));

test("production dependencies contain only packages imported by the server runtime", () => {
  const manifest = JSON.parse(fs.readFileSync(packagePath, "utf8")) as {
    dependencies?: Record<string, string>;
  };
  const expectedRuntimePackages = [
    "bcryptjs",
    "cookie-parser",
    "express",
    "express-rate-limit",
    "helmet",
    "multer",
    "sharp",
    "tar",
    "zod"
  ];

  assert.deepEqual(Object.keys(manifest.dependencies || {}).sort(), expectedRuntimePackages);
});
