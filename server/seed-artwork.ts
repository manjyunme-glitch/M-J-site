import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { config } from "./config.js";
import { db } from "./db.js";

const artwork = [
  { file: "01-afternoon-walk.png", caption: "许多个平淡得刚刚好的下午", album: 1, timelineOrder: 10 },
  { file: "02-milktea-167.png", caption: "取到号码 167 的那杯奶茶", album: 1, timelineOrder: 20 },
  { file: "03-games-dinner.png", caption: "游戏、晚饭和饭后的散步", album: 1, timelineOrder: 30 },
  { file: "04-white-day.png", caption: "白色情人节终于说出口", album: 2, timelineOrder: 50 },
  { file: "05-night-turning-point.png", caption: "认真面对分歧的那个夜晚", album: 2, timelineOrder: 60 },
  { file: "06-red-blue-necklace.png", caption: "一蓝一红的爱心项链", album: 2, timelineOrder: 80 }
];

export async function seedArtwork() {
  const seedDir = path.resolve(process.cwd(), "seed-assets");
  const albums = db.prepare("SELECT id FROM albums ORDER BY sort_order, id").all() as Array<{ id: number }>;
  if (!albums.length) return;

  for (const [index, item] of artwork.entries()) {
    const source = path.join(seedDir, item.file);
    if (!fs.existsSync(source)) continue;
    const originalName = `seed:${item.file}`;
    let row = db.prepare("SELECT id FROM media WHERE original_name = ?").get(originalName) as { id: number } | undefined;
    if (!row) {
      const stem = path.parse(item.file).name;
      const originalFile = `${stem}-original.png`;
      const webFile = `${stem}-web.webp`;
      const thumbFile = `${stem}-thumb.webp`;
      fs.copyFileSync(source, path.join(config.uploadDir, originalFile));
      await Promise.all([
        sharp(source).resize({ width: 1800, height: 1800, fit: "inside", withoutEnlargement: true }).webp({ quality: 86 }).toFile(path.join(config.uploadDir, webFile)),
        sharp(source).resize({ width: 560, height: 560, fit: "cover" }).webp({ quality: 80 }).toFile(path.join(config.uploadDir, thumbFile))
      ]);
      const albumId = albums[Math.min(item.album - 1, albums.length - 1)]?.id ?? null;
      const inserted = db.prepare(`
        INSERT INTO media (album_id, kind, original_name, file_path, web_path, thumb_path, mime_type, caption, sort_order)
        VALUES (?, 'image', ?, ?, ?, ?, 'image/png', ?, ?)
      `).run(albumId, originalName, originalFile, webFile, thumbFile, item.caption, (index + 1) * 10);
      row = { id: Number(inserted.lastInsertRowid) };
    }
    db.prepare("UPDATE timeline_events SET media_id = COALESCE(media_id, ?) WHERE sort_order = ?").run(row.id, item.timelineOrder);
    if (index === 1) db.prepare("UPDATE albums SET cover_media_id = COALESCE(cover_media_id, ?) WHERE id = ?").run(row.id, albums[0]?.id);
    if (index === 5 && albums[1]) db.prepare("UPDATE albums SET cover_media_id = COALESCE(cover_media_id, ?) WHERE id = ?").run(row.id, albums[1].id);
  }
}
