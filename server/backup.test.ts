import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import { create } from "tar";
import { backupFormat, backupTableColumns, backupVersion, buildBackupSummary, type BackupRow, type BackupTableName, type BackupTables } from "./backup-format.js";

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "mj-backup-"));
const stagingDir = path.join(tempDir, "backup-staging");
const uploadDir = path.join(tempDir, "uploads");
fs.mkdirSync(stagingDir, { recursive: true });
fs.mkdirSync(uploadDir, { recursive: true });

const startupOrphan = path.join(stagingDir, `import-${crypto.randomUUID()}`);
const startupMediaUpload = path.join(stagingDir, "media-Ab12_x");
const startupMulterFile = path.join(stagingDir, "0123456789abcdef0123456789abcdef");
const startupUnrelated = path.join(stagingDir, "keep-me.txt");
fs.mkdirSync(startupOrphan);
fs.mkdirSync(startupMediaUpload);
fs.writeFileSync(path.join(startupOrphan, "manifest.json"), "{}");
fs.writeFileSync(path.join(startupMediaUpload, "partial"), "partial upload");
fs.writeFileSync(startupMulterFile, "partial upload");
fs.writeFileSync(startupUnrelated, "unrelated");

const startupExport = path.join(uploadDir, ".backup-export-Ab12X9");
const startupExportCheck = path.join(uploadDir, ".backup-export-check-z9Y8x7");
const startupOtherHidden = path.join(uploadDir, ".backup-export-not-six");
const startupOtherDirectory = path.join(uploadDir, ".other-hidden");
fs.mkdirSync(startupExport);
fs.mkdirSync(startupExportCheck);
fs.mkdirSync(startupOtherHidden);
fs.mkdirSync(startupOtherDirectory);

process.env.DATABASE_PATH = path.join(tempDir, "love-journal.db");
process.env.UPLOAD_DIR = uploadDir;
process.env.BACKUP_STAGING_DIR = stagingDir;
process.env.SITE_PASSWORD_HASH = "site-hash";
process.env.ADMIN_PASSWORD_HASH = "admin-hash";
process.env.COOKIE_SECRET = "cookie-secret";

const { cleanupBackupStaging, cleanupExpiredBackups, getBackupExportStatus, inspectFullBackup, preflightFullBackup, recordBackupExportStatus, restoreInspectedBackup } = await import("./backup.js");
const { db } = await import("./db.js");

after(() => {
  db.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

function readTables(): BackupTables {
  return Object.fromEntries((Object.entries(backupTableColumns) as Array<[BackupTableName, readonly string[]]>).map(([table, columns]) => [
    table,
    db.prepare(`SELECT ${columns.join(", ")} FROM ${table}`).all() as BackupRow[]
  ])) as BackupTables;
}

async function writeArchive(target: string, updateTables: (tables: BackupTables) => void = () => undefined) {
  const source = fs.mkdtempSync(path.join(tempDir, "archive-source-"));
  fs.mkdirSync(path.join(source, "media"));
  const tables = readTables();
  updateTables(tables);
  fs.writeFileSync(path.join(source, "manifest.json"), JSON.stringify({
    format: backupFormat,
    version: backupVersion,
    createdAt: new Date().toISOString(),
    summary: buildBackupSummary(tables),
    tables
  }));
  try {
    await create({ cwd: source, file: target, gzip: true, portable: true }, ["manifest.json", "media"]);
  } finally {
    fs.rmSync(source, { recursive: true, force: true });
  }
}

test("startup removes only stale import directories and Multer temporary files", () => {
  assert.equal(fs.existsSync(startupOrphan), false);
  assert.equal(fs.existsSync(startupMediaUpload), false);
  assert.equal(fs.existsSync(startupMulterFile), false);
  assert.equal(fs.existsSync(startupUnrelated), true);
  assert.equal(fs.existsSync(startupExport), false);
  assert.equal(fs.existsSync(startupExportCheck), false);
  assert.equal(fs.existsSync(startupOtherHidden), true);
  assert.equal(fs.existsSync(startupOtherDirectory), true);
});

test("staging cleanup preserves protected pending imports and unrelated entries", () => {
  const root = fs.mkdtempSync(path.join(tempDir, "cleanup-"));
  const stale = path.join(root, `import-${crypto.randomUUID()}`);
  const protectedImport = path.join(root, `import-${crypto.randomUUID()}`);
  const staleMediaUpload = path.join(root, "media-Z9_yX1");
  const multerFile = path.join(root, "abcdefabcdefabcdefabcdefabcdefab");
  const unrelatedDirectory = path.join(root, "import-not-a-token");
  const unrelatedFile = path.join(root, "notes.txt");
  fs.mkdirSync(stale);
  fs.mkdirSync(protectedImport);
  fs.mkdirSync(staleMediaUpload);
  fs.mkdirSync(unrelatedDirectory);
  fs.writeFileSync(multerFile, "partial");
  fs.writeFileSync(unrelatedFile, "keep");

  const removed = cleanupBackupStaging(root, [protectedImport]);

  assert.equal(fs.existsSync(stale), false);
  assert.equal(fs.existsSync(multerFile), false);
  assert.equal(fs.existsSync(staleMediaUpload), false);
  assert.equal(fs.existsSync(protectedImport), true);
  assert.equal(fs.existsSync(unrelatedDirectory), true);
  assert.equal(fs.existsSync(unrelatedFile), true);
  assert.deepEqual(new Set(removed), new Set([stale, staleMediaUpload, multerFile]));
});

test("backup export preflight checks sources and removes its writable-directory probe", () => {
  const before = fs.readdirSync(uploadDir).sort();
  preflightFullBackup();
  assert.deepEqual(fs.readdirSync(uploadDir).sort(), before);

  const missing = db.prepare(`
    INSERT INTO media (
      album_id, kind, original_name, file_path, web_path, thumb_path, mime_type,
      display_name, caption, taken_date, image_width, image_height, filter_preset,
      playlist_enabled, sort_order
    ) VALUES (NULL, 'image', 'missing.jpg', 'missing-original.jpg', 'missing-web.webp',
      'missing-thumb.webp', 'image/jpeg', '', '', NULL, 10, 10, 'original', 0, 0)
  `).run();
  try {
    assert.throws(() => preflightFullBackup(), /缺失或不可读/);
    assert.deepEqual(fs.readdirSync(uploadDir).sort(), before);
  } finally {
    db.prepare("DELETE FROM media WHERE id = ?").run(missing.lastInsertRowid);
  }
});

test("backup export lifecycle status transitions and expires lazily", () => {
  const id = crypto.randomUUID();
  const now = Date.now();

  assert.equal(getBackupExportStatus(id, now), null);
  assert.deepEqual(recordBackupExportStatus(id, "ready", now), { state: "ready" });
  assert.deepEqual(getBackupExportStatus(id.toUpperCase(), now), { state: "ready" });
  assert.deepEqual(recordBackupExportStatus(id, "running", now + 1), { state: "running" });
  assert.deepEqual(recordBackupExportStatus(id, "complete", now + 2), { state: "complete" });
  assert.deepEqual(recordBackupExportStatus(id, "failed", now + 3), {
    state: "failed",
    error: "备份导出失败，请稍后重试"
  });
  assert.equal(getBackupExportStatus(id, now + 25 * 60 * 60 * 1000), null);
});

test("a successfully inspected backup is retained until its exact expiration", async () => {
  const uploadPath = path.join(stagingDir, "11111111111111111111111111111111");
  await writeArchive(uploadPath);

  const inspected = await inspectFullBackup(uploadPath, "valid.mjsite");
  const pendingDirectory = path.join(stagingDir, `import-${inspected.token}`);

  assert.equal(fs.existsSync(uploadPath), false);
  assert.equal(fs.existsSync(pendingDirectory), true);
  cleanupExpiredBackups(Date.parse(inspected.expiresAt) - 1);
  assert.equal(fs.existsSync(pendingDirectory), true);
  cleanupExpiredBackups(Date.parse(inspected.expiresAt));
  assert.equal(fs.existsSync(pendingDirectory), false);
  assert.throws(() => restoreInspectedBackup(inspected.token), /已过期/);
});

test("inspection failures remove both the Multer file and extraction directory", async () => {
  const uploadPath = path.join(stagingDir, "22222222222222222222222222222222");
  fs.writeFileSync(uploadPath, "not a gzip archive");
  const before = new Set(fs.readdirSync(stagingDir).filter((item) => item.startsWith("import-")));

  await assert.rejects(inspectFullBackup(uploadPath, "broken.mjsite"));

  const afterEntries = fs.readdirSync(stagingDir).filter((item) => item.startsWith("import-"));
  assert.equal(fs.existsSync(uploadPath), false);
  assert.deepEqual(new Set(afterEntries), before);
});

test("inspection rejects an empty memory-match configuration and cleans its staging files", async () => {
  const uploadPath = path.join(stagingDir, "33333333333333333333333333333333");
  await writeArchive(uploadPath, (tables) => {
    tables.homepage_blocks.push({
      id: 999,
      block_type: "memoryMatch",
      enabled: 1,
      sort_order: 999,
      config_json: "{}",
      created_at: "2026-07-29 10:20:30",
      updated_at: "2026-07-29 10:20:30"
    });
  });
  const before = new Set(fs.readdirSync(stagingDir).filter((item) => item.startsWith("import-")));

  await assert.rejects(inspectFullBackup(uploadPath, "empty-memory.mjsite"), /memoryMatch 配置不完整/);

  const afterEntries = fs.readdirSync(stagingDir).filter((item) => item.startsWith("import-"));
  assert.equal(fs.existsSync(uploadPath), false);
  assert.deepEqual(new Set(afterEntries), before);
});
