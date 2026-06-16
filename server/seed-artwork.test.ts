import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "mj-seed-artwork-"));
process.env.DATABASE_PATH = path.join(tempDir, "love-journal.db");
process.env.UPLOAD_DIR = path.join(tempDir, "uploads");
process.env.BACKUP_STAGING_DIR = path.join(tempDir, "backup-staging");
process.env.SITE_PASSWORD_HASH = "test";
process.env.ADMIN_PASSWORD_HASH = "test";

const { shouldCreateDefaultArtwork } = await import("./seed-artwork.js");

test("default artwork is only created for a fresh empty database", () => {
  assert.equal(shouldCreateDefaultArtwork(true, 0), true);
  assert.equal(shouldCreateDefaultArtwork(false, 0), false);
  assert.equal(shouldCreateDefaultArtwork(true, 1), false);
});
