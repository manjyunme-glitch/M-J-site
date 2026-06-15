import assert from "node:assert/strict";
import test from "node:test";
import { backupFormat, backupTableColumns, backupVersion, buildBackupSummary, isSafeStoredFilename, parseBackupManifest, type BackupRow, type BackupTables } from "./backup-format.js";

const emptyTables = Object.fromEntries(Object.keys(backupTableColumns).map((table) => [table, []])) as unknown as BackupTables;

test("backup filenames must stay inside the media folder", () => {
  assert.equal(isSafeStoredFilename("photo-web.webp"), true);
  assert.equal(isSafeStoredFilename("../photo.webp"), false);
  assert.equal(isSafeStoredFilename("folder/photo.webp"), false);
  assert.equal(isSafeStoredFilename("folder\\photo.webp"), false);
});

test("backup summary counts configurable content", () => {
  const tables: BackupTables = {
    ...emptyTables,
    timeline_events: [{ id: 1 }],
    albums: [{ id: 1 }],
    media: [{ kind: "image" }, { kind: "audio" }],
    letters: [{ id: 1 }],
    wishes: [{ id: 1 }],
    anniversaries: [{ id: 1 }]
  };
  assert.deepEqual(buildBackupSummary(tables, 1024), { timeline: 1, albums: 1, images: 1, audio: 1, letters: 1, wishes: 1, anniversaries: 1, mediaBytes: 1024 });
});

test("backup manifest rejects unsafe media paths", () => {
  const tables: BackupTables = {
    ...emptyTables,
    settings: [Object.fromEntries(backupTableColumns.settings.map((column) => [column, column === "id" ? 1 : "value"]))],
    homepage_settings: [Object.fromEntries(backupTableColumns.homepage_settings.map((column) => [column, column === "id" ? 1 : "value"]))],
    media: [Object.fromEntries(backupTableColumns.media.map((column) => [column, column === "file_path" ? "../secret" : null]))]
  };
  assert.throws(() => parseBackupManifest({ format: backupFormat, version: backupVersion, createdAt: new Date().toISOString(), tables }), /不安全/);
});

test("backup manifest rejects broken media references", () => {
  const settings = Object.fromEntries(backupTableColumns.settings.map((column) => [column, null])) as BackupRow;
  settings.id = 1;
  settings.music_media_id = 99;
  const homepage = Object.fromEntries(backupTableColumns.homepage_settings.map((column) => [column, null])) as BackupRow;
  homepage.id = 1;
  const tables: BackupTables = { ...emptyTables, settings: [settings], homepage_settings: [homepage] };
  assert.throws(() => parseBackupManifest({ format: backupFormat, version: backupVersion, createdAt: new Date().toISOString(), tables }), /不存在/);
});
