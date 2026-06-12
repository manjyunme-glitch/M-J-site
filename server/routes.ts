import path from "node:path";
import { Router } from "express";
import bcrypt from "bcryptjs";
import multer from "multer";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { config } from "./config.js";
import { db, camelizeRow } from "./db.js";
import { clearSessions, createAdminSession, createSiteSession, hasAdminAccess, hasSiteAccess, requireAdmin, requireSite } from "./auth.js";
import { getContent } from "./content.js";
import { persistUpload, removeMediaFiles, resolveMediaPath } from "./media.js";
import { getDeploymentStatus } from "./version.js";

export const api = Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 8,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "尝试次数太多，请稍后再试" }
});

const passwordSchema = z.object({ password: z.string().min(1).max(128) });

api.get("/auth/status", (req, res) => {
  res.json({ site: hasSiteAccess(req), admin: hasAdminAccess(req) });
});

api.post("/auth/site", loginLimiter, async (req, res) => {
  const parsed = passwordSchema.safeParse(req.body);
  if (!parsed.success || !(await bcrypt.compare(parsed.data.password, config.sitePasswordHash))) {
    return res.status(401).json({ error: "密码不正确，请重新输入" });
  }
  createSiteSession(res);
  res.json({ ok: true });
});

api.post("/auth/admin", loginLimiter, async (req, res) => {
  const parsed = passwordSchema.safeParse(req.body);
  if (!parsed.success || !(await bcrypt.compare(parsed.data.password, config.adminPasswordHash))) {
    return res.status(401).json({ error: "管理员密码不正确" });
  }
  createAdminSession(res);
  res.json({ ok: true });
});

api.post("/auth/logout", (req, res) => {
  clearSessions(res);
  res.json({ ok: true });
});

api.get("/content", requireSite, (_req, res) => res.json(getContent(false)));

api.get("/media/:id", requireSite, (req, res) => {
  const id = Number(req.params.id);
  const variant = typeof req.query.variant === "string" ? req.query.variant : "web";
  if (!Number.isInteger(id)) return res.status(404).end();
  const media = resolveMediaPath(id, variant);
  if (!media) return res.status(404).end();
  res.type(media.mime);
  res.setHeader("Cache-Control", "private, max-age=86400");
  res.sendFile(media.target);
});

api.get("/admin/content", requireAdmin, (_req, res) => res.json(getContent(true)));

const bool = z.union([z.boolean(), z.number(), z.string()]).transform((value) => value === true || value === 1 || value === "1" || value === "true" ? 1 : 0);
const nullableDate = z.string().max(32).nullable().optional().transform((value) => value || null);

const resourceDefinitions = {
  anniversaries: {
    table: "anniversaries",
    schema: z.object({ title: z.string().min(1).max(120), eventDate: z.string().min(4).max(32), annual: bool, description: z.string().max(1000).default(""), enabled: bool, sortOrder: z.coerce.number().int().default(0) }),
    columns: ["title", "event_date", "annual", "description", "enabled", "sort_order"]
  },
  timeline: {
    table: "timeline_events",
    schema: z.object({ dateLabel: z.string().min(1).max(80), eventDate: nullableDate, title: z.string().min(1).max(120), body: z.string().min(1).max(6000), mediaId: z.coerce.number().int().positive().nullable().optional().transform((value) => value || null), published: bool, sortOrder: z.coerce.number().int().default(0) }),
    columns: ["date_label", "event_date", "title", "body", "media_id", "published", "sort_order"]
  },
  albums: {
    table: "albums",
    schema: z.object({ title: z.string().min(1).max(120), eventDate: nullableDate, description: z.string().max(1000).default(""), coverMediaId: z.coerce.number().int().positive().nullable().optional().transform((value) => value || null), published: bool, sortOrder: z.coerce.number().int().default(0) }),
    columns: ["title", "event_date", "description", "cover_media_id", "published", "sort_order"]
  },
  letters: {
    table: "letters",
    schema: z.object({ title: z.string().min(1).max(120), body: z.string().min(1).max(20000), published: bool, sortOrder: z.coerce.number().int().default(0) }),
    columns: ["title", "body", "published", "sort_order"]
  },
  wishes: {
    table: "wishes",
    schema: z.object({ title: z.string().min(1).max(120), description: z.string().max(2000).default(""), status: z.enum(["pending", "completed"]), targetDate: nullableDate, completedDate: nullableDate, mediaId: z.coerce.number().int().positive().nullable().optional().transform((value) => value || null), sortOrder: z.coerce.number().int().default(0) }),
    columns: ["title", "description", "status", "target_date", "completed_date", "media_id", "sort_order"]
  }
} as const;

const toValues = (data: Record<string, unknown>, columns: readonly string[]): Array<string | number | null> => columns.map((column) => {
  const value = data[column.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase())];
  return typeof value === "string" || typeof value === "number" ? value : null;
});

api.post("/admin/:resource", requireAdmin, (req, res, next) => {
  const definition = resourceDefinitions[req.params.resource as keyof typeof resourceDefinitions];
  if (!definition) return next();
  const parsed = definition.schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || "内容格式不正确" });
  const placeholders = definition.columns.map(() => "?").join(", ");
  const result = db.prepare(`INSERT INTO ${definition.table} (${definition.columns.join(", ")}) VALUES (${placeholders})`).run(...toValues(parsed.data, definition.columns));
  const row = db.prepare(`SELECT * FROM ${definition.table} WHERE id = ?`).get(result.lastInsertRowid);
  res.status(201).json(camelizeRow(row));
});

api.put("/admin/:resource/:id", requireAdmin, (req, res, next) => {
  const definition = resourceDefinitions[req.params.resource as keyof typeof resourceDefinitions];
  const id = Number(req.params.id);
  if (!definition) return next();
  if (!Number.isInteger(id)) return res.status(404).json({ error: "内容不存在" });
  const parsed = definition.schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || "内容格式不正确" });
  const assignments = definition.columns.map((column) => `${column} = ?`).join(", ");
  db.prepare(`UPDATE ${definition.table} SET ${assignments} WHERE id = ?`).run(...toValues(parsed.data, definition.columns), id);
  const row = db.prepare(`SELECT * FROM ${definition.table} WHERE id = ?`).get(id);
  res.json(camelizeRow(row));
});

api.delete("/admin/:resource/:id", requireAdmin, (req, res, next) => {
  const definition = resourceDefinitions[req.params.resource as keyof typeof resourceDefinitions];
  const id = Number(req.params.id);
  if (!definition) return next();
  if (!Number.isInteger(id)) return res.status(404).json({ error: "内容不存在" });
  if (definition.table === "albums") {
    const mediaRows = db.prepare("SELECT id FROM media WHERE album_id = ?").all(id) as Array<{ id: number }>;
    mediaRows.forEach((row) => removeMediaFiles(row.id));
  }
  db.prepare(`DELETE FROM ${definition.table} WHERE id = ?`).run(id);
  res.json({ ok: true });
});

const settingsSchema = z.object({
  siteTitle: z.string().min(1).max(120),
  subtitle: z.string().min(1).max(240),
  heroNote: z.string().max(2000),
  metDate: z.string().min(4).max(32),
  togetherDate: z.string().min(4).max(32),
  manName: z.string().min(1).max(80),
  manBirthday: z.string().min(4).max(32),
  womanName: z.string().min(1).max(80),
  womanBirthday: z.string().min(4).max(32),
  musicMediaId: z.coerce.number().int().positive().nullable().optional().transform((value) => value || null)
});

api.put("/admin/settings", requireAdmin, (req, res) => {
  const parsed = settingsSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || "设置格式不正确" });
  db.prepare(`
    UPDATE settings SET site_title = ?, subtitle = ?, hero_note = ?, met_date = ?, together_date = ?,
      man_name = ?, man_birthday = ?, woman_name = ?, woman_birthday = ?, music_media_id = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = 1
  `).run(parsed.data.siteTitle, parsed.data.subtitle, parsed.data.heroNote, parsed.data.metDate, parsed.data.togetherDate, parsed.data.manName, parsed.data.manBirthday, parsed.data.womanName, parsed.data.womanBirthday, parsed.data.musicMediaId);
  res.json(camelizeRow(db.prepare("SELECT * FROM settings WHERE id = 1").get()));
});

api.get("/admin/deployment-status", requireAdmin, async (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json(await getDeploymentStatus());
});

const upload = multer({ storage: multer.memoryStorage(), limits: { files: 30, fileSize: 30 * 1024 * 1024 } });

api.post("/admin/media", requireAdmin, upload.array("files", 30), async (req, res) => {
  const files = (req.files || []) as Express.Multer.File[];
  if (!files.length) return res.status(400).json({ error: "请选择文件" });
  const albumId = req.body.albumId ? Number(req.body.albumId) : null;
  const fieldAt = (key: string, index: number) => {
    const value = req.body[key];
    return Array.isArray(value) ? value[index] : index === 0 ? value : undefined;
  };
  try {
    const ids = [];
    for (const [index, file] of files.entries()) {
      ids.push(await persistUpload(file, albumId, {
        displayName: fieldAt("displayNames", index),
        caption: fieldAt("captions", index),
        takenDate: fieldAt("takenDates", index) || null
      }));
    }
    const rows = ids.map((id) => camelizeRow(db.prepare("SELECT * FROM media WHERE id = ?").get(id)));
    res.status(201).json(rows);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "上传失败" });
  }
});

api.put("/admin/media/:id", requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const schema = z.object({ albumId: z.coerce.number().int().positive().nullable().optional().transform((value) => value || null), displayName: z.string().max(160).default(""), caption: z.string().max(1000).default(""), takenDate: nullableDate, sortOrder: z.coerce.number().int().default(0) });
  const parsed = schema.safeParse(req.body);
  if (!Number.isInteger(id) || !parsed.success) return res.status(400).json({ error: "媒体信息格式不正确" });
  db.prepare("UPDATE media SET album_id = ?, display_name = ?, caption = ?, taken_date = ?, sort_order = ? WHERE id = ?").run(parsed.data.albumId, parsed.data.displayName, parsed.data.caption, parsed.data.takenDate, parsed.data.sortOrder, id);
  res.json(camelizeRow(db.prepare("SELECT * FROM media WHERE id = ?").get(id)));
});

api.delete("/admin/media/:id", requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(404).end();
  removeMediaFiles(id);
  db.prepare("DELETE FROM media WHERE id = ?").run(id);
  res.json({ ok: true });
});

api.get("/health", (_req, res) => res.json({ ok: true }));
