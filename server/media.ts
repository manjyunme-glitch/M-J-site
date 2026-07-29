import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import sharp from "sharp";
import { config } from "./config.js";
import { db } from "./db.js";
import { normalizeUploadFilename } from "./filename.js";

const imageMimes = new Set(["image/jpeg", "image/png", "image/webp"]);
const audioMimes = new Set(["audio/mpeg", "audio/mp4", "audio/x-m4a", "audio/ogg"]);
export const imageFilterPresets = ["original", "warm-pencil", "faded-book", "blue-diary", "soft-film"] as const;
export type ImageFilterPreset = typeof imageFilterPresets[number];

export type UploadMetadata = {
  displayName?: string;
  caption?: string;
  takenDate?: string | null;
  filterPreset?: ImageFilterPreset;
};

type ValidatedUpload =
  | { kind: "image"; dimensions: { width: number | null; height: number | null } }
  | { kind: "audio" };

const warmMatrix = [
  [0.9, 0.08, 0.02],
  [0.05, 0.9, 0.05],
  [0.03, 0.14, 0.83]
];

const coolMatrix = [
  [0.78, 0.12, 0.08],
  [0.06, 0.86, 0.08],
  [0.04, 0.18, 0.9]
];

type UploadSource = Buffer | string;

function uploadSource(file: Express.Multer.File): UploadSource {
  if (typeof file.path === "string" && file.path && fs.existsSync(file.path)) return file.path;
  if (Buffer.isBuffer(file.buffer)) return file.buffer;
  throw new Error("上传暂存文件不存在");
}

function copyUploadSource(source: UploadSource, target: string) {
  if (typeof source === "string") fs.copyFileSync(source, target);
  else fs.writeFileSync(target, source);
}

async function filteredImage(input: UploadSource, preset: ImageFilterPreset, resize: Parameters<ReturnType<typeof sharp>["resize"]>[0]) {
  const resized = await sharp(input).rotate().resize(resize).toBuffer();
  if (preset === "warm-pencil") {
    return sharp(resized)
      .modulate({ brightness: 1.1, saturation: 0.82 })
      .recomb(warmMatrix)
      .sharpen(0.9)
      .linear(0.98, 4);
  }
  if (preset === "faded-book") {
    return sharp(resized).modulate({ brightness: 1.06, saturation: 0.52 }).recomb(warmMatrix).linear(0.9, 16);
  }
  if (preset === "blue-diary") {
    return sharp(resized).modulate({ brightness: 1.02, saturation: 0.68 }).recomb(coolMatrix).linear(0.94, 8);
  }
  if (preset === "soft-film") {
    return sharp(resized).modulate({ brightness: 1.04, saturation: 0.82 }).linear(0.88, 17).sharpen(0.45);
  }
  return sharp(resized);
}

async function writeImageVariants(input: UploadSource, webTarget: string, thumbTarget: string, preset: ImageFilterPreset) {
  const [web, thumb] = await Promise.all([
    filteredImage(input, preset, { width: 1800, height: 1800, fit: "inside", withoutEnlargement: true }),
    filteredImage(input, preset, { width: 560, height: 560, fit: "contain", background: { r: 245, g: 239, b: 223, alpha: 1 } })
  ]);
  await Promise.all([
    web.webp({ quality: 84 }).toFile(webTarget),
    thumb.webp({ quality: 78 }).toFile(thumbTarget)
  ]);
}

function normalizedDimensions(metadata: { width?: number; height?: number; orientation?: number }) {
  let width = metadata.width || null;
  let height = metadata.height || null;
  if (width && height && metadata.orientation && [5, 6, 7, 8].includes(metadata.orientation)) [width, height] = [height, width];
  return { width, height };
}

export async function validateUpload(file: Express.Multer.File): Promise<ValidatedUpload> {
  if (imageMimes.has(file.mimetype)) {
    if (file.size > 15 * 1024 * 1024) throw new Error("单张图片不能超过 15MB");
    const dimensions = normalizedDimensions(await sharp(uploadSource(file)).metadata());
    return { kind: "image", dimensions };
  }
  if (audioMimes.has(file.mimetype)) {
    if (file.size > 30 * 1024 * 1024) throw new Error("音乐文件不能超过 30MB");
    return { kind: "audio" };
  }
  throw new Error("仅支持 JPEG、PNG、WebP、MP3、M4A 和 OGG 文件");
}

function cleanupStoredPaths(relativePaths: string[]) {
  for (const relativePath of relativePaths) {
    const target = path.resolve(config.uploadDir, relativePath);
    if (!target.startsWith(config.uploadDir)) continue;
    try { fs.rmSync(target, { force: true }); } catch { /* Preserve the original upload error. */ }
  }
}

async function persistValidatedUpload(file: Express.Multer.File, validation: ValidatedUpload, albumId?: number | null, metadata: UploadMetadata = {}) {
  const id = crypto.randomUUID();
  const originalName = normalizeUploadFilename(file.originalname);
  const source = uploadSource(file);
  if (validation.kind === "image") {
    const originalExt = path.extname(originalName).toLowerCase() || ".jpg";
    const storedOriginalName = `${id}-original${originalExt}`;
    const webName = `${id}-web.webp`;
    const thumbName = `${id}-thumb.webp`;
    const filterPreset = metadata.filterPreset || "original";
    const storedPaths = [storedOriginalName, webName, thumbName];
    try {
      copyUploadSource(source, path.join(config.uploadDir, storedOriginalName));
      await writeImageVariants(source, path.join(config.uploadDir, webName), path.join(config.uploadDir, thumbName), filterPreset);
      const result = db.prepare(`
        INSERT INTO media (album_id, kind, original_name, file_path, web_path, thumb_path, mime_type, display_name, caption, taken_date, image_width, image_height, filter_preset)
        VALUES (?, 'image', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        albumId ?? null,
        originalName,
        storedOriginalName,
        webName,
        thumbName,
        file.mimetype,
        metadata.displayName || "",
        metadata.caption || "",
        metadata.takenDate || null,
        validation.dimensions.width,
        validation.dimensions.height,
        filterPreset
      );
      return Number(result.lastInsertRowid);
    } catch (error) {
      cleanupStoredPaths(storedPaths);
      throw error;
    }
  }

  const extension = file.mimetype === "audio/ogg" ? ".ogg" : file.mimetype === "audio/mpeg" ? ".mp3" : ".m4a";
  const storedName = `${id}${extension}`;
  try {
    copyUploadSource(source, path.join(config.uploadDir, storedName));
    const result = db.prepare(`
      INSERT INTO media (album_id, kind, original_name, file_path, mime_type)
      VALUES (NULL, 'audio', ?, ?, ?)
    `).run(originalName, storedName, file.mimetype);
    return Number(result.lastInsertRowid);
  } catch (error) {
    cleanupStoredPaths([storedName]);
    throw error;
  }
}

export async function persistUpload(file: Express.Multer.File, albumId?: number | null, metadata: UploadMetadata = {}) {
  return persistValidatedUpload(file, await validateUpload(file), albumId, metadata);
}

function rollbackPersistedUploads(ids: number[]) {
  if (!ids.length) return;
  const placeholders = ids.map(() => "?").join(",");
  const rows = db.prepare(`SELECT file_path, web_path, thumb_path FROM media WHERE id IN (${placeholders})`).all(...ids) as Array<{
    file_path: string;
    web_path?: string;
    thumb_path?: string;
  }>;
  try {
    db.exec("BEGIN");
    db.prepare(`UPDATE albums SET cover_media_id = NULL WHERE cover_media_id IN (${placeholders})`).run(...ids);
    db.prepare(`DELETE FROM media WHERE id IN (${placeholders})`).run(...ids);
    db.exec("COMMIT");
  } catch {
    try { db.exec("ROLLBACK"); } catch { /* The caller will preserve the original upload error. */ }
    return;
  }
  cleanupStoredPaths(rows.flatMap((row) => [row.file_path, row.web_path, row.thumb_path].filter((value): value is string => Boolean(value))));
}

export async function persistUploads(files: Express.Multer.File[], albumId: number | null, metadata: UploadMetadata[]) {
  if (albumId !== null) {
    const album = db.prepare("SELECT id FROM albums WHERE id = ?").get(albumId);
    if (!album) throw new Error("相册不存在");
  }

  const validations: ValidatedUpload[] = [];
  for (const file of files) validations.push(await validateUpload(file));

  const ids: number[] = [];
  try {
    for (const [index, file] of files.entries()) {
      ids.push(await persistValidatedUpload(file, validations[index], albumId, metadata[index]));
    }
    return ids;
  } catch (error) {
    rollbackPersistedUploads(ids);
    throw error;
  }
}

export async function updateImageFilter(id: number, preset: ImageFilterPreset) {
  const row = db.prepare("SELECT file_path, web_path, thumb_path FROM media WHERE id = ? AND kind = 'image'").get(id) as { file_path: string; web_path: string; thumb_path: string } | undefined;
  if (!row) throw new Error("照片不存在");
  const source = path.resolve(config.uploadDir, row.file_path);
  const webTarget = path.resolve(config.uploadDir, row.web_path);
  const thumbTarget = path.resolve(config.uploadDir, row.thumb_path);
  if (![source, webTarget, thumbTarget].every((target) => target.startsWith(config.uploadDir)) || !fs.existsSync(source)) throw new Error("照片原始文件不存在");
  await writeImageVariants(source, webTarget, thumbTarget, preset);
  db.prepare("UPDATE media SET filter_preset = ? WHERE id = ?").run(preset, id);
}

export function repairMediaFilenames() {
  const rows = db.prepare("SELECT id, original_name FROM media").all() as Array<{ id: number; original_name: string }>;
  const update = db.prepare("UPDATE media SET original_name = ? WHERE id = ?");
  for (const row of rows) {
    const normalized = normalizeUploadFilename(row.original_name);
    if (normalized !== row.original_name) update.run(normalized, row.id);
  }
}

export async function backfillMediaDimensions() {
  const rows = db.prepare("SELECT id, file_path, thumb_path FROM media WHERE kind = 'image' AND (image_width IS NULL OR image_height IS NULL)").all() as Array<{ id: number; file_path: string; thumb_path?: string }>;
  const update = db.prepare("UPDATE media SET image_width = ?, image_height = ? WHERE id = ?");
  for (const row of rows) {
    const target = path.resolve(config.uploadDir, row.file_path);
    if (!target.startsWith(config.uploadDir) || !fs.existsSync(target)) continue;
    try {
      const dimensions = normalizedDimensions(await sharp(target).metadata());
      if (row.thumb_path) {
        const thumbTarget = path.resolve(config.uploadDir, row.thumb_path);
        if (thumbTarget.startsWith(config.uploadDir)) {
          const presetRow = db.prepare("SELECT filter_preset AS filterPreset, web_path AS webPath FROM media WHERE id = ?").get(row.id) as { filterPreset?: ImageFilterPreset; webPath?: string };
          if (presetRow.webPath) {
            const webTarget = path.resolve(config.uploadDir, presetRow.webPath);
            await writeImageVariants(target, webTarget, thumbTarget, presetRow.filterPreset || "original");
          }
        }
      }
      if (dimensions.width && dimensions.height) update.run(dimensions.width, dimensions.height, row.id);
    } catch {
      // Keep serving the image even when an old file has unreadable metadata.
    }
  }
}

export function removeMediaFiles(id: number) {
  const row = db.prepare("SELECT file_path, web_path, thumb_path FROM media WHERE id = ?").get(id) as { file_path: string; web_path?: string; thumb_path?: string } | undefined;
  if (!row) return;
  for (const relativePath of [row.file_path, row.web_path, row.thumb_path]) {
    if (!relativePath) continue;
    const target = path.resolve(config.uploadDir, relativePath);
    if (target.startsWith(config.uploadDir) && fs.existsSync(target)) fs.unlinkSync(target);
  }
  db.prepare("UPDATE albums SET cover_media_id = NULL WHERE cover_media_id = ?").run(id);
}

export function isMediaPubliclyAccessible(id: number) {
  const row = db.prepare(`
    SELECT 1 AS allowed
    FROM media AS candidate
    WHERE candidate.id = ?
      AND (
        (
          candidate.kind = 'image'
          AND (
            EXISTS (
              SELECT 1 FROM albums
              WHERE albums.id = candidate.album_id AND albums.published = 1
            )
            OR EXISTS (
              SELECT 1 FROM albums
              WHERE albums.cover_media_id = candidate.id AND albums.published = 1
            )
            OR EXISTS (
              SELECT 1 FROM timeline_events
              WHERE timeline_events.media_id = candidate.id AND timeline_events.published = 1
            )
            OR EXISTS (
              SELECT 1 FROM wishes
              WHERE wishes.media_id = candidate.id
            )
            OR EXISTS (
              SELECT 1
              FROM homepage_settings
              JOIN homepage_blocks ON homepage_blocks.block_type = 'hero' AND homepage_blocks.enabled = 1
              WHERE homepage_settings.id = 1 AND homepage_settings.hero_media_id = candidate.id
            )
          )
        )
        OR (
          candidate.kind = 'audio'
          AND (
            candidate.playlist_enabled = 1
            OR (
              candidate.id = (SELECT music_media_id FROM settings WHERE id = 1)
              AND NOT EXISTS (
                SELECT 1 FROM media
                WHERE media.kind = 'audio' AND media.playlist_enabled = 1
              )
            )
          )
        )
      )
  `).get(id) as { allowed: number } | undefined;
  return Boolean(row?.allowed);
}

export function resolveMediaPath(id: number, variant: string) {
  const row = db.prepare("SELECT kind, file_path, web_path, thumb_path, mime_type FROM media WHERE id = ?").get(id) as {
    kind: "image" | "audio";
    file_path: string;
    web_path?: string;
    thumb_path?: string;
    mime_type: string;
  } | undefined;
  if (!row) return null;
  const relativePath = row.kind === "audio" ? row.file_path : variant === "thumb" ? row.thumb_path : variant === "original" ? row.file_path : row.web_path;
  if (!relativePath) return null;
  const target = path.resolve(config.uploadDir, relativePath);
  if (!target.startsWith(config.uploadDir) || !fs.existsSync(target)) return null;
  return { target, mime: row.kind === "image" && variant !== "original" ? "image/webp" : row.mime_type };
}
