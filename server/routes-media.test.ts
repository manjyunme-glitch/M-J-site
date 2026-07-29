import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";
import { Readable, Writable } from "node:stream";
import test from "node:test";
import bcrypt from "bcryptjs";
import cookieParser from "cookie-parser";
import express, { type Response } from "express";
import sharp from "sharp";

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "mj-routes-media-"));
const uploadDir = path.join(tempDir, "uploads");
const backupStagingDir = path.join(tempDir, "backup-staging");
const cookieSecret = "test-cookie-secret-with-enough-entropy";
process.env.DATABASE_PATH = path.join(tempDir, "love-journal.db");
process.env.UPLOAD_DIR = uploadDir;
process.env.BACKUP_STAGING_DIR = backupStagingDir;
process.env.COOKIE_SECRET = cookieSecret;
process.env.SITE_PASSWORD_HASH = bcrypt.hashSync("site-password", 4);
process.env.ADMIN_PASSWORD_HASH = bcrypt.hashSync("admin-password", 4);
process.env.SECURE_COOKIES = "false";

const { api, isValidCalendarDate } = await import("./routes.js");
const { db } = await import("./db.js");
const { isMediaPubliclyAccessible, persistUploads } = await import("./media.js");
const { config } = await import("./config.js");
const { apiErrorHandler } = await import("./http.js");
const { streamFullBackup } = await import("./backup.js");

class BlockingResponse extends Writable {
  private released = false;
  private callbacks: Array<(error?: Error | null) => void> = [];

  setHeader() {
    return this;
  }

  release() {
    this.released = true;
    this.callbacks.splice(0).forEach((callback) => callback());
  }

  override _write(_chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void) {
    if (this.released) callback();
    else this.callbacks.push(callback);
  }
}

function storedMedia(kind: "image" | "audio", name: string, albumId: number | null = null) {
  const filePath = `${name}-original.${kind === "image" ? "jpg" : "mp3"}`;
  const webPath = kind === "image" ? `${name}-web.webp` : null;
  const thumbPath = kind === "image" ? `${name}-thumb.webp` : null;
  for (const filename of [filePath, webPath, thumbPath]) {
    if (filename) fs.writeFileSync(path.join(uploadDir, filename), Buffer.from(filename));
  }
  const result = db.prepare(`
    INSERT INTO media (album_id, kind, original_name, file_path, web_path, thumb_path, mime_type)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(albumId, kind, `${name}.${kind === "image" ? "jpg" : "mp3"}`, filePath, webPath, thumbPath, kind === "image" ? "image/jpeg" : "audio/mpeg");
  return Number(result.lastInsertRowid);
}

function multerFile(name: string, mimetype: string, buffer: Buffer) {
  return {
    fieldname: "files",
    originalname: name,
    encoding: "7bit",
    mimetype,
    size: buffer.length,
    buffer,
    stream: Readable.from(buffer)
  } as Express.Multer.File;
}

function settingsPayload(siteTitle: string, musicMediaId: number) {
  return {
    siteTitle,
    subtitle: "测试副标题",
    heroNote: "测试寄语",
    metDate: "2025-05-20",
    togetherDate: "2026-03-14",
    manName: "M",
    manBirthday: "1998-11-26",
    womanName: "J",
    womanBirthday: "1999-11-22",
    musicMediaId,
    musicMode: "shuffle"
  };
}

async function login(baseUrl: string, role: "site" | "admin", password: string) {
  const response = await fetch(`${baseUrl}/api/auth/${role}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password })
  });
  assert.equal(response.status, 200);
  return response.headers.getSetCookie().map((value) => value.split(";", 1)[0]).join("; ");
}

test("media authorization, upload prevalidation, atomic settings, and calendar validation", async () => {
  const app = express();
  app.use(express.json());
  app.use(cookieParser(cookieSecret));
  app.use("/api", api);
  app.use(apiErrorHandler);
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    assert.equal(isValidCalendarDate("2024-02-29"), true);
    assert.equal(isValidCalendarDate("2026-02-29"), false);
    assert.equal(isValidCalendarDate("2026-04-31"), false);
    assert.equal(isValidCalendarDate("2026-4-01"), false);

    const settingsBeforeHealth = { ...(db.prepare("SELECT * FROM settings WHERE id = 1").get() as Record<string, unknown>) };
    let response = await fetch(`${baseUrl}/api/health`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true });
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual({ ...(db.prepare("SELECT * FROM settings WHERE id = 1").get() as Record<string, unknown>) }, settingsBeforeHealth);

    const originalUploadDir = config.uploadDir;
    config.uploadDir = path.join(tempDir, "missing-upload-directory");
    response = await fetch(`${baseUrl}/api/health`);
    config.uploadDir = originalUploadDir;
    assert.equal(response.status, 503);
    const unhealthyBody = await response.text();
    assert.deepEqual(JSON.parse(unhealthyBody), { ok: false });
    assert.equal(unhealthyBody.includes("missing-upload-directory"), false);

    const hiddenAlbum = Number(db.prepare(`
      INSERT INTO albums (title, description, published, sort_order)
      VALUES ('隐藏相册', '', 0, 999)
    `).run().lastInsertRowid);
    const hiddenImage = storedMedia("image", "hidden-image", hiddenAlbum);
    assert.equal(isMediaPubliclyAccessible(hiddenImage), false);

    const hiddenTimeline = Number(db.prepare(`
      INSERT INTO timeline_events (date_label, title, body, media_id, published, sort_order)
      VALUES ('隐藏', '隐藏时间线', '正文', ?, 0, 999)
    `).run(hiddenImage).lastInsertRowid);
    assert.equal(isMediaPubliclyAccessible(hiddenImage), false);

    const siteCookie = await login(baseUrl, "site", "site-password");
    response = await fetch(`${baseUrl}/api/media/${hiddenImage}?variant=web`, { headers: { Cookie: siteCookie } });
    assert.equal(response.status, 404);

    db.prepare("UPDATE timeline_events SET published = 1 WHERE id = ?").run(hiddenTimeline);
    assert.equal(isMediaPubliclyAccessible(hiddenImage), true);
    response = await fetch(`${baseUrl}/api/media/${hiddenImage}?variant=web`, { headers: { Cookie: siteCookie } });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "private, no-store");

    response = await fetch(`${baseUrl}/api/media/${hiddenImage}?variant=original`, { headers: { Cookie: siteCookie } });
    assert.equal(response.status, 404);
    const adminCookie = await login(baseUrl, "admin", "admin-password");
    response = await fetch(`${baseUrl}/api/media/${hiddenImage}?variant=original`, { headers: { Cookie: adminCookie } });
    assert.equal(response.status, 200);

    const completedExportId = crypto.randomUUID();
    response = await fetch(`${baseUrl}/api/admin/backup/export?id=${completedExportId}`, {
      method: "HEAD",
      headers: { Cookie: adminCookie }
    });
    assert.equal(response.status, 204);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(await response.text(), "");

    response = await fetch(`${baseUrl}/api/admin/backup/export/status/${completedExportId}`, {
      headers: { Cookie: adminCookie }
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), { state: "ready" });

    const hiddenOriginal = path.join(uploadDir, "hidden-image-original.jpg");
    const heldOriginal = path.join(uploadDir, "hidden-image-original.hold");
    const failedPreflightId = crypto.randomUUID();
    fs.renameSync(hiddenOriginal, heldOriginal);
    try {
      response = await fetch(`${baseUrl}/api/admin/backup/export?id=${failedPreflightId}`, {
        method: "HEAD",
        headers: { Cookie: adminCookie }
      });
    } finally {
      fs.renameSync(heldOriginal, hiddenOriginal);
    }
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(await response.text(), "");
    assert.equal(JSON.stringify([...response.headers]).includes("hidden-image"), false);

    response = await fetch(`${baseUrl}/api/admin/backup/export/status/${failedPreflightId}`, {
      headers: { Cookie: adminCookie }
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { state: "failed", error: "备份导出失败，请稍后重试" });

    const blockingResponse = new BlockingResponse();
    const heldExport = streamFullBackup(blockingResponse as unknown as Response);
    try {
      response = await fetch(`${baseUrl}/api/admin/backup/export`, {
        method: "HEAD",
        headers: { Cookie: adminCookie }
      });
      assert.equal(response.status, 409);
      assert.equal(await response.text(), "");

      const busyExportId = crypto.randomUUID();
      response = await fetch(`${baseUrl}/api/admin/backup/export?id=${busyExportId}`, {
        headers: { Cookie: adminCookie }
      });
      assert.equal(response.status, 409);
      assert.deepEqual(await response.json(), { error: "备份导出正在进行，请稍后再试" });

      response = await fetch(`${baseUrl}/api/admin/backup/export/status/${busyExportId}`, {
        headers: { Cookie: adminCookie }
      });
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { state: "failed", error: "备份导出失败，请稍后重试" });
    } finally {
      blockingResponse.release();
      await heldExport;
    }

    response = await fetch(`${baseUrl}/api/admin/backup/export`, {
      method: "HEAD",
      headers: { Cookie: adminCookie }
    });
    assert.equal(response.status, 204);

    response = await fetch(`${baseUrl}/api/admin/backup/export?id=${completedExportId}`, {
      headers: { Cookie: adminCookie }
    });
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /^application\/gzip/);
    assert.ok((await response.arrayBuffer()).byteLength > 0);

    response = await fetch(`${baseUrl}/api/admin/backup/export/status/${completedExportId}`, {
      headers: { Cookie: adminCookie }
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { state: "complete" });

    response = await fetch(`${baseUrl}/api/admin/backup/export/status/${crypto.randomUUID()}`, {
      headers: { Cookie: adminCookie }
    });
    assert.equal(response.status, 404);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), { error: "备份导出状态不存在或已过期" });

    response = await fetch(`${baseUrl}/api/admin/backup/export/status/not-a-uuid`, {
      headers: { Cookie: adminCookie }
    });
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { error: "备份导出状态不存在或已过期" });

    storedMedia("audio", "aborted-export");
    fs.writeFileSync(path.join(uploadDir, "aborted-export-original.mp3"), crypto.randomBytes(16 * 1024 * 1024));
    const abortedExportId = crypto.randomUUID();
    const abortedResponse = await fetch(`${baseUrl}/api/admin/backup/export?id=${abortedExportId}`, {
      headers: { Cookie: adminCookie }
    });
    assert.equal(abortedResponse.status, 200);

    response = await fetch(`${baseUrl}/api/admin/backup/export/status/${abortedExportId}`, {
      headers: { Cookie: adminCookie }
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { state: "running" });

    const abortedReader = abortedResponse.body?.getReader();
    assert.ok(abortedReader);
    const firstChunk = await abortedReader.read();
    assert.equal(firstChunk.done, false);
    await abortedReader.cancel();

    let abortedStatus: unknown;
    for (let attempt = 0; attempt < 50; attempt += 1) {
      response = await fetch(`${baseUrl}/api/admin/backup/export/status/${abortedExportId}`, {
        headers: { Cookie: adminCookie }
      });
      abortedStatus = await response.json();
      if ((abortedStatus as { state?: string }).state === "failed") break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.deepEqual(abortedStatus, { state: "failed", error: "备份导出失败，请稍后重试" });

    response = await fetch(`${baseUrl}/api/admin/backup/export`, {
      method: "HEAD",
      headers: { Cookie: adminCookie }
    });
    assert.equal(response.status, 204);

    const heroImage = storedMedia("image", "hero-image");
    db.prepare("UPDATE homepage_settings SET hero_media_id = ? WHERE id = 1").run(heroImage);
    assert.equal(isMediaPubliclyAccessible(heroImage), true);

    const wishImage = storedMedia("image", "wish-image");
    db.prepare("INSERT INTO wishes (title, status, media_id) VALUES ('带图愿望', 'pending', ?)").run(wishImage);
    assert.equal(isMediaPubliclyAccessible(wishImage), true);

    const music = storedMedia("audio", "legacy-music");
    db.prepare("UPDATE settings SET music_media_id = ? WHERE id = 1").run(music);
    assert.equal(isMediaPubliclyAccessible(music), true);
    db.prepare("UPDATE media SET playlist_enabled = 1 WHERE id = ?").run(music);
    assert.equal(isMediaPubliclyAccessible(music), true);

    const validImageBuffer = await sharp({
      create: { width: 2, height: 2, channels: 3, background: { r: 180, g: 60, b: 90 } }
    }).jpeg().toBuffer();

    const stagingEntriesBefore = fs.readdirSync(backupStagingDir).sort();
    const uploadForm = new FormData();
    uploadForm.append("files", new Blob([new Uint8Array(validImageBuffer)], { type: "image/jpeg" }), "disk-route.jpg");
    uploadForm.append("displayNames", "磁盘暂存上传");
    uploadForm.append("takenDates", "2026-07-29");
    uploadForm.append("captions", "");
    uploadForm.append("filterPresets", "original");
    response = await fetch(`${baseUrl}/api/admin/media`, {
      method: "POST",
      headers: { Cookie: adminCookie },
      body: uploadForm
    });
    assert.equal(response.status, 201);
    assert.deepEqual(fs.readdirSync(backupStagingDir).sort(), stagingEntriesBefore);

    const invalidMetadataForm = new FormData();
    invalidMetadataForm.append("files", new Blob([new Uint8Array(validImageBuffer)], { type: "image/jpeg" }), "invalid-metadata.jpg");
    invalidMetadataForm.append("filterPresets", "not-a-filter");
    response = await fetch(`${baseUrl}/api/admin/media`, {
      method: "POST",
      headers: { Cookie: adminCookie },
      body: invalidMetadataForm
    });
    assert.equal(response.status, 400);
    assert.deepEqual(fs.readdirSync(backupStagingDir).sort(), stagingEntriesBefore);

    const invalidTypeForm = new FormData();
    invalidTypeForm.append("files", new Blob([new Uint8Array([1, 2, 3])], { type: "text/plain" }), "invalid.txt");
    response = await fetch(`${baseUrl}/api/admin/media`, {
      method: "POST",
      headers: { Cookie: adminCookie },
      body: invalidTypeForm
    });
    assert.equal(response.status, 400);
    assert.deepEqual(fs.readdirSync(backupStagingDir).sort(), stagingEntriesBefore);

    const mixedCountBefore = Number((db.prepare("SELECT COUNT(*) AS count FROM media").get() as { count: number }).count);
    const mixedUploadForm = new FormData();
    mixedUploadForm.append("files", new Blob([new Uint8Array(validImageBuffer)], { type: "image/jpeg" }), "valid-before-invalid.jpg");
    mixedUploadForm.append("files", new Blob([new Uint8Array([1, 2, 3])], { type: "text/plain" }), "invalid-second.txt");
    response = await fetch(`${baseUrl}/api/admin/media`, {
      method: "POST",
      headers: { Cookie: adminCookie },
      body: mixedUploadForm
    });
    assert.equal(response.status, 400);
    assert.equal(Number((db.prepare("SELECT COUNT(*) AS count FROM media").get() as { count: number }).count), mixedCountBefore);
    assert.deepEqual(fs.readdirSync(backupStagingDir).sort(), stagingEntriesBefore);

    const tooManyFilesForm = new FormData();
    for (let index = 0; index < 31; index += 1) {
      tooManyFilesForm.append("files", new Blob([new Uint8Array(validImageBuffer)], { type: "image/jpeg" }), `too-many-${index}.jpg`);
    }
    response = await fetch(`${baseUrl}/api/admin/media`, {
      method: "POST",
      headers: { Cookie: adminCookie },
      body: tooManyFilesForm
    });
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: "上传文件数量或字段不正确" });
    assert.equal(Number((db.prepare("SELECT COUNT(*) AS count FROM media").get() as { count: number }).count), mixedCountBefore);
    assert.deepEqual(fs.readdirSync(backupStagingDir).sort(), stagingEntriesBefore);

    const oversizedAudioForm = new FormData();
    oversizedAudioForm.append(
      "files",
      new Blob([new Uint8Array(30 * 1024 * 1024 + 1)], { type: "audio/mpeg" }),
      "too-large.mp3"
    );
    response = await fetch(`${baseUrl}/api/admin/media`, {
      method: "POST",
      headers: { Cookie: adminCookie },
      body: oversizedAudioForm
    });
    assert.equal(response.status, 413);
    assert.deepEqual(await response.json(), { error: "文件大小超过限制" });
    assert.equal(Number((db.prepare("SELECT COUNT(*) AS count FROM media").get() as { count: number }).count), mixedCountBefore);
    assert.deepEqual(fs.readdirSync(backupStagingDir).sort(), stagingEntriesBefore);

    const oversizedImageBuffer = Buffer.alloc(15 * 1024 * 1024 + 1);
    const mediaCountBefore = Number((db.prepare("SELECT COUNT(*) AS count FROM media").get() as { count: number }).count);
    const filesBefore = fs.readdirSync(uploadDir).sort();
    await assert.rejects(
      persistUploads(
        [
          multerFile("valid.jpg", "image/jpeg", validImageBuffer),
          multerFile("too-large.jpg", "image/jpeg", oversizedImageBuffer)
        ],
        null,
        [{}, {}]
      ),
      /15MB/
    );
    const mediaCountAfter = Number((db.prepare("SELECT COUNT(*) AS count FROM media").get() as { count: number }).count);
    assert.equal(mediaCountAfter, mediaCountBefore);
    assert.deepEqual(fs.readdirSync(uploadDir).sort(), filesBefore);

    db.exec(`
      CREATE TRIGGER fail_second_test_upload
      BEFORE INSERT ON media
      WHEN NEW.original_name = 'fail.jpg'
      BEGIN
        SELECT RAISE(ABORT, 'forced upload failure');
      END;
    `);
    await assert.rejects(
      persistUploads(
        [
          multerFile("first.jpg", "image/jpeg", validImageBuffer),
          multerFile("fail.jpg", "image/jpeg", validImageBuffer)
        ],
        null,
        [{}, {}]
      ),
      /forced upload failure/
    );
    assert.equal(Number((db.prepare("SELECT COUNT(*) AS count FROM media").get() as { count: number }).count), mediaCountBefore);
    assert.deepEqual(fs.readdirSync(uploadDir).sort(), filesBefore);
    db.exec("DROP TRIGGER fail_second_test_upload");

    response = await fetch(`${baseUrl}/api/admin/settings`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({
        settings: settingsPayload("原子保存成功", music),
        tracks: [{ id: music, enabled: true, title: "测试歌曲", artist: "M × J", sortOrder: 10 }]
      })
    });
    assert.equal(response.status, 200);
    assert.equal((db.prepare("SELECT site_title FROM settings WHERE id = 1").get() as { site_title: string }).site_title, "原子保存成功");
    assert.deepEqual(
      { ...(db.prepare("SELECT display_name, playlist_enabled, sort_order FROM media WHERE id = ?").get(music) as Record<string, unknown>) },
      { display_name: "测试歌曲", playlist_enabled: 1, sort_order: 10 }
    );

    response = await fetch(`${baseUrl}/api/admin/settings`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({
        settings: settingsPayload("不应部分保存", music),
        tracks: [{ id: 999999, enabled: true, title: "不存在", artist: "", sortOrder: 10 }]
      })
    });
    assert.equal(response.status, 400);
    assert.equal((db.prepare("SELECT site_title FROM settings WHERE id = 1").get() as { site_title: string }).site_title, "原子保存成功");

    response = await fetch(`${baseUrl}/api/admin/settings`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({
        settings: { ...settingsPayload("无效日期不应保存", music), togetherDate: "2026-02-29" },
        tracks: [{ id: music, enabled: true, title: "测试歌曲", artist: "M × J", sortOrder: 10 }]
      })
    });
    assert.equal(response.status, 400);
    assert.equal((db.prepare("SELECT site_title FROM settings WHERE id = 1").get() as { site_title: string }).site_title, "原子保存成功");
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
