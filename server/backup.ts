import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import type { Response } from "express";
import { create, extract, list } from "tar";
import { config } from "./config.js";
import { db } from "./db.js";
import { backupFormat, backupTableColumns, backupVersion, buildBackupSummary, isSafeStoredFilename, parseBackupManifest, type BackupManifest, type BackupRow, type BackupTableName, type BackupTables } from "./backup-format.js";

const stagingRoot = config.backupStagingDir;
const pendingBackups = new Map<string, { directory: string; manifest: BackupManifest; filename: string; sizeBytes: number; expiresAt: number }>();
const pendingLifetimeMs = 30 * 60 * 1000;
const maxArchiveEntries = 20_000;
const maxExtractedBytes = 50 * 1024 * 1024 * 1024;
let fullBackupExportActive = false;
const backupExportStatusLifetimeMs = 24 * 60 * 60 * 1000;
const backupExportStatuses = new Map<string, { state: BackupExportLifecycleState; error?: string; expiresAt: number }>();

export type BackupExportLifecycleState = "ready" | "running" | "complete" | "failed";
export type BackupExportLifecycleStatus =
  | { state: Exclude<BackupExportLifecycleState, "failed"> }
  | { state: "failed"; error: string };

const backupExportFailureMessage = "备份导出失败，请稍后重试";

fs.mkdirSync(stagingRoot, { recursive: true });

function removeDirectory(target: string) {
  try { fs.rmSync(target, { recursive: true, force: true }); } catch { /* Stale staging files can be cleaned on the next run. */ }
}

const importDirectoryPattern = /^import-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const mediaUploadDirectoryPattern = /^media-[a-z0-9_-]{6}$/i;
const multerTemporaryFilePattern = /^[0-9a-f]{32}$/i;
const backupExportDirectoryPattern = /^\.backup-export-[a-z0-9]{6}$/i;
const backupExportCheckDirectoryPattern = /^\.backup-export-check-[a-z0-9]{6}$/i;

export function cleanupBackupStaging(root: string, protectedDirectories: Iterable<string> = []) {
  const resolvedRoot = path.resolve(root);
  const protectedPaths = new Set([...protectedDirectories].map((item) => path.resolve(item)));
  const removed: string[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(resolvedRoot, { withFileTypes: true });
  } catch {
    return removed;
  }

  for (const entry of entries) {
    const target = path.resolve(resolvedRoot, entry.name);
    if (path.dirname(target) !== resolvedRoot || protectedPaths.has(target)) continue;
    if (entry.isDirectory() && (importDirectoryPattern.test(entry.name) || mediaUploadDirectoryPattern.test(entry.name))) {
      removeDirectory(target);
      if (!fs.existsSync(target)) removed.push(target);
    } else if (entry.isFile() && multerTemporaryFilePattern.test(entry.name)) {
      try {
        fs.rmSync(target, { force: true });
        if (!fs.existsSync(target)) removed.push(target);
      } catch { /* A concurrently used upload must not prevent startup. */ }
    }
  }
  return removed;
}

cleanupBackupStaging(stagingRoot);

export function cleanupBackupExportDirectories(root: string) {
  const resolvedRoot = path.resolve(root);
  const removed: string[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(resolvedRoot, { withFileTypes: true });
  } catch {
    return removed;
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || (!backupExportDirectoryPattern.test(entry.name) && !backupExportCheckDirectoryPattern.test(entry.name))) continue;
    const target = path.resolve(resolvedRoot, entry.name);
    if (path.dirname(target) !== resolvedRoot) continue;
    removeDirectory(target);
    if (!fs.existsSync(target)) removed.push(target);
  }
  return removed;
}

cleanupBackupExportDirectories(config.uploadDir);

function cleanupExpiredBackupExportStatuses(now = Date.now()) {
  for (const [id, item] of backupExportStatuses) {
    if (item.expiresAt <= now) backupExportStatuses.delete(id);
  }
}

export function recordBackupExportStatus(id: string, state: BackupExportLifecycleState, now = Date.now()): BackupExportLifecycleStatus {
  cleanupExpiredBackupExportStatuses(now);
  const normalizedId = id.toLowerCase();
  if (state === "failed") {
    const status = { state, error: backupExportFailureMessage } as const;
    backupExportStatuses.set(normalizedId, { ...status, expiresAt: now + backupExportStatusLifetimeMs });
    return status;
  }
  const status = { state } as const;
  backupExportStatuses.set(normalizedId, { ...status, expiresAt: now + backupExportStatusLifetimeMs });
  return status;
}

export function getBackupExportStatus(id: string, now = Date.now()): BackupExportLifecycleStatus | null {
  cleanupExpiredBackupExportStatuses(now);
  const item = backupExportStatuses.get(id.toLowerCase());
  if (!item) return null;
  return item.state === "failed"
    ? { state: item.state, error: item.error ?? backupExportFailureMessage }
    : { state: item.state };
}

export function cleanupExpiredBackups(now = Date.now()) {
  for (const [token, item] of pendingBackups) {
    if (item.expiresAt <= now) {
      pendingBackups.delete(token);
      removeDirectory(item.directory);
    }
  }
}

setInterval(cleanupExpiredBackups, 5 * 60 * 1000).unref();

function readTables(): BackupTables {
  return Object.fromEntries((Object.entries(backupTableColumns) as Array<[BackupTableName, readonly string[]]>).map(([table, columns]) => [
    table,
    db.prepare(`SELECT ${columns.join(", ")} FROM ${table}`).all() as BackupRow[]
  ])) as BackupTables;
}

function mediaFilenames(tables: BackupTables) {
  return [...new Set(tables.media.flatMap((row) => [row.file_path, row.web_path, row.thumb_path]).filter((value): value is string => typeof value === "string" && value.length > 0))];
}

function inspectBackupExportSource() {
  const tables = readTables();
  const filenames = mediaFilenames(tables);
  let mediaBytes = 0;
  for (const filename of filenames) {
    if (!isSafeStoredFilename(filename)) throw new Error("数据库中存在不安全的媒体路径");
    const source = path.join(config.uploadDir, filename);
    let descriptor: number | undefined;
    try {
      descriptor = fs.openSync(source, "r");
      const stat = fs.fstatSync(descriptor);
      if (!stat.isFile()) throw new Error(`媒体文件不可读：${filename}`);
      mediaBytes += stat.size;
    } catch {
      throw new Error(`媒体文件缺失或不可读：${filename}`);
    } finally {
      if (descriptor !== undefined) {
        try { fs.closeSync(descriptor); } catch { /* Preserve the source validation error. */ }
      }
    }
  }
  return { tables, filenames, mediaBytes };
}

function archivePathIsSafe(value: string) {
  const normalized = value.replaceAll("\\", "/");
  return normalized === "manifest.json" || normalized === "media" || normalized === "media/" || (normalized.startsWith("media/") && isSafeStoredFilename(normalized.slice("media/".length)));
}

function makeBackupFilename(createdAt: Date) {
  const stamp = createdAt.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  return `m-j-site-backup-${stamp}.mjsite`;
}

export class BackupExportBusyError extends Error {
  constructor() {
    super("Backup export is already running");
    this.name = "BackupExportBusyError";
  }
}

export function preflightFullBackup() {
  if (fullBackupExportActive) throw new BackupExportBusyError();
  const directory = fs.mkdtempSync(path.join(config.uploadDir, ".backup-export-check-"));
  try {
    const probe = path.join(directory, ".write-probe");
    fs.writeFileSync(probe, "", { flag: "wx" });
    fs.rmSync(probe, { force: true });
    inspectBackupExportSource();
  } finally {
    removeDirectory(directory);
  }
}

export async function streamFullBackup(res: Response) {
  if (fullBackupExportActive) throw new BackupExportBusyError();
  fullBackupExportActive = true;
  let directory: string | undefined;
  try {
    directory = fs.mkdtempSync(path.join(config.uploadDir, ".backup-export-"));
    const mediaDirectory = path.join(directory, "media");
    fs.mkdirSync(mediaDirectory);
    const { tables, filenames, mediaBytes } = inspectBackupExportSource();
    for (const filename of filenames) {
      const source = path.join(config.uploadDir, filename);
      const target = path.join(mediaDirectory, filename);
      try { fs.linkSync(source, target); } catch { fs.copyFileSync(source, target); }
    }
    const createdAt = new Date();
    const manifest: BackupManifest = { format: backupFormat, version: backupVersion, createdAt: createdAt.toISOString(), summary: buildBackupSummary(tables, mediaBytes), tables };
    fs.writeFileSync(path.join(directory, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");
    res.setHeader("Content-Type", "application/gzip");
    res.setHeader("Content-Disposition", `attachment; filename="${makeBackupFilename(createdAt)}"`);
    res.setHeader("Cache-Control", "no-store");
    await pipeline(create({ cwd: directory, gzip: true, portable: true }, ["manifest.json", "media"]), res);
  } finally {
    if (directory) removeDirectory(directory);
    fullBackupExportActive = false;
  }
}

export async function inspectFullBackup(filePath: string, originalName: string) {
  cleanupExpiredBackups();
  const token = crypto.randomUUID();
  const directory = path.join(stagingRoot, `import-${token}`);
  fs.mkdirSync(directory, { recursive: true });
  try {
    let entries = 0;
    let extractedBytes = 0;
    await list({
      file: filePath,
      strict: true,
      onentry(entry) {
        entries += 1;
        extractedBytes += entry.size || 0;
        if (entries > maxArchiveEntries || extractedBytes > maxExtractedBytes) throw new Error("备份文件内容过大");
        if (!archivePathIsSafe(entry.path) || !["File", "OldFile", "Directory"].includes(entry.type)) throw new Error("备份文件包含不安全的内容");
      }
    });
    await extract({ file: filePath, cwd: directory, strict: true, preservePaths: false, noChmod: true, filter: archivePathIsSafe });
    const manifestPath = path.join(directory, "manifest.json");
    if (!fs.existsSync(manifestPath)) throw new Error("备份文件缺少 manifest.json");
    const manifest = parseBackupManifest(JSON.parse(fs.readFileSync(manifestPath, "utf8")));
    let mediaBytes = 0;
    for (const filename of mediaFilenames(manifest.tables)) {
      const target = path.join(directory, "media", filename);
      if (!fs.existsSync(target)) throw new Error(`备份缺少媒体文件：${filename}`);
      mediaBytes += fs.statSync(target).size;
    }
    manifest.summary = buildBackupSummary(manifest.tables, mediaBytes);
    const sizeBytes = fs.statSync(filePath).size;
    const expiresAt = Date.now() + pendingLifetimeMs;
    pendingBackups.set(token, { directory, manifest, filename: originalName, sizeBytes, expiresAt });
    return { token, filename: originalName, sizeBytes, format: manifest.format, version: manifest.version, createdAt: manifest.createdAt, summary: manifest.summary, expiresAt: new Date(expiresAt).toISOString() };
  } catch (error) {
    removeDirectory(directory);
    throw error;
  } finally {
    try { fs.rmSync(filePath, { force: true }); } catch { /* Multer temp files can be cleaned by the staging directory maintenance. */ }
  }
}

function insertRows(table: BackupTableName, rows: BackupRow[], overrides: (row: BackupRow) => BackupRow = (row) => row) {
  const columns = backupTableColumns[table];
  const statement = db.prepare(`INSERT INTO ${table} (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`);
  rows.forEach((rawRow) => {
    const row = overrides(rawRow);
    statement.run(...columns.map((column) => row[column] ?? null));
  });
}

function removeStoredFiles(filenames: Iterable<string>) {
  for (const filename of filenames) {
    if (!isSafeStoredFilename(filename)) continue;
    try { fs.rmSync(path.join(config.uploadDir, filename), { force: true }); } catch { /* Orphan cleanup can be retried manually without invalidating the restored database. */ }
  }
}

function cloneTables(tables: BackupTables): BackupTables {
  return Object.fromEntries((Object.keys(backupTableColumns) as BackupTableName[]).map((table) => [table, tables[table].map((row) => ({ ...row }))])) as BackupTables;
}

export function restoreInspectedBackup(token: string) {
  cleanupExpiredBackups();
  const pending = pendingBackups.get(token);
  if (!pending) throw new Error("备份确认已过期，请重新选择文件");
  pendingBackups.delete(token);
  const tables = cloneTables(pending.manifest.tables);
  const oldFiles = mediaFilenames(readTables());
  const newFiles: string[] = [];

  try {
    const renamed = new Map<string, string>();
    for (const sourceName of mediaFilenames(tables)) {
      const extension = path.extname(sourceName).toLowerCase();
      const targetName = `${crypto.randomUUID()}${extension}`;
      fs.copyFileSync(path.join(pending.directory, "media", sourceName), path.join(config.uploadDir, targetName));
      renamed.set(sourceName, targetName);
      newFiles.push(targetName);
    }
    tables.media.forEach((row) => {
      for (const column of ["file_path", "web_path", "thumb_path"] as const) {
        const value = row[column];
        if (typeof value === "string") row[column] = renamed.get(value) || value;
      }
    });

    const musicMediaId = tables.settings[0].music_media_id;
    const heroMediaId = tables.homepage_settings[0].hero_media_id;
    const albumCovers = new Map(tables.albums.map((row) => [row.id, row.cover_media_id]));

    db.exec("BEGIN");
    db.prepare("UPDATE settings SET music_media_id = NULL WHERE id = 1").run();
    db.prepare("UPDATE homepage_settings SET hero_media_id = NULL WHERE id = 1").run();
    db.prepare("UPDATE albums SET cover_media_id = NULL").run();
    db.prepare("UPDATE timeline_events SET media_id = NULL").run();
    db.prepare("UPDATE wishes SET media_id = NULL").run();
    for (const table of ["homepage_blocks", "homepage_modules", "homepage_secret_cards", "anniversaries", "timeline_events", "letters", "wishes", "media", "albums", "homepage_settings", "settings"] as BackupTableName[]) db.prepare(`DELETE FROM ${table}`).run();

    insertRows("settings", tables.settings, (row) => ({ ...row, music_media_id: null }));
    insertRows("anniversaries", tables.anniversaries);
    insertRows("albums", tables.albums, (row) => ({ ...row, cover_media_id: null }));
    insertRows("media", tables.media);
    insertRows("homepage_settings", tables.homepage_settings, (row) => ({ ...row, hero_media_id: null }));
    insertRows("homepage_modules", tables.homepage_modules);
    insertRows("homepage_blocks", tables.homepage_blocks);
    insertRows("homepage_secret_cards", tables.homepage_secret_cards);
    insertRows("timeline_events", tables.timeline_events);
    insertRows("letters", tables.letters);
    insertRows("wishes", tables.wishes);

    db.prepare("UPDATE settings SET music_media_id = ? WHERE id = 1").run(musicMediaId);
    db.prepare("UPDATE homepage_settings SET hero_media_id = ? WHERE id = 1").run(heroMediaId);
    const updateCover = db.prepare("UPDATE albums SET cover_media_id = ? WHERE id = ?");
    albumCovers.forEach((coverId, albumId) => updateCover.run(coverId, albumId));
    db.exec("COMMIT");
    removeStoredFiles(oldFiles);
    return { restoredAt: new Date().toISOString(), summary: buildBackupSummary(tables, pending.manifest.summary.mediaBytes) };
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch { /* Transaction may not have started. */ }
    removeStoredFiles(newFiles);
    throw error;
  } finally {
    removeDirectory(pending.directory);
  }
}
