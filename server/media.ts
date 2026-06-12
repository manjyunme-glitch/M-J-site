import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import sharp from "sharp";
import { config } from "./config.js";
import { db } from "./db.js";
import { normalizeUploadFilename } from "./filename.js";

const imageMimes = new Set(["image/jpeg", "image/png", "image/webp"]);
const audioMimes = new Set(["audio/mpeg", "audio/mp4", "audio/x-m4a", "audio/ogg"]);

type UploadMetadata = {
  displayName?: string;
  caption?: string;
  takenDate?: string | null;
};

function normalizedDimensions(metadata: { width?: number; height?: number; orientation?: number }) {
  let width = metadata.width || null;
  let height = metadata.height || null;
  if (width && height && metadata.orientation && [5, 6, 7, 8].includes(metadata.orientation)) [width, height] = [height, width];
  return { width, height };
}

export async function persistUpload(file: Express.Multer.File, albumId?: number | null, metadata: UploadMetadata = {}) {
  const id = crypto.randomUUID();
  const originalName = normalizeUploadFilename(file.originalname);
  if (imageMimes.has(file.mimetype)) {
    if (file.size > 15 * 1024 * 1024) throw new Error("单张图片不能超过 15MB");
    const originalExt = path.extname(originalName).toLowerCase() || ".jpg";
    const storedOriginalName = `${id}-original${originalExt}`;
    const webName = `${id}-web.webp`;
    const thumbName = `${id}-thumb.webp`;
    const dimensions = normalizedDimensions(await sharp(file.buffer).metadata());
    fs.writeFileSync(path.join(config.uploadDir, storedOriginalName), file.buffer);
    await Promise.all([
      sharp(file.buffer).rotate().resize({ width: 1800, height: 1800, fit: "inside", withoutEnlargement: true }).webp({ quality: 84 }).toFile(path.join(config.uploadDir, webName)),
      sharp(file.buffer).rotate().resize({ width: 560, height: 560, fit: "contain", background: { r: 245, g: 239, b: 223, alpha: 1 } }).webp({ quality: 78 }).toFile(path.join(config.uploadDir, thumbName))
    ]);
    const result = db.prepare(`
      INSERT INTO media (album_id, kind, original_name, file_path, web_path, thumb_path, mime_type, display_name, caption, taken_date, image_width, image_height)
      VALUES (?, 'image', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(albumId ?? null, originalName, storedOriginalName, webName, thumbName, file.mimetype, metadata.displayName || "", metadata.caption || "", metadata.takenDate || null, dimensions.width, dimensions.height);
    return Number(result.lastInsertRowid);
  }

  if (audioMimes.has(file.mimetype)) {
    if (file.size > 30 * 1024 * 1024) throw new Error("音乐文件不能超过 30MB");
    const extension = file.mimetype === "audio/ogg" ? ".ogg" : file.mimetype === "audio/mpeg" ? ".mp3" : ".m4a";
    const storedName = `${id}${extension}`;
    fs.writeFileSync(path.join(config.uploadDir, storedName), file.buffer);
    const result = db.prepare(`
      INSERT INTO media (album_id, kind, original_name, file_path, mime_type)
      VALUES (NULL, 'audio', ?, ?, ?)
    `).run(originalName, storedName, file.mimetype);
    return Number(result.lastInsertRowid);
  }

  throw new Error("仅支持 JPEG、PNG、WebP、MP3、M4A 和 OGG 文件");
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
          await sharp(target).rotate().resize({ width: 560, height: 560, fit: "contain", background: { r: 245, g: 239, b: 223, alpha: 1 } }).webp({ quality: 78 }).toFile(thumbTarget);
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
