import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { Router, type NextFunction, type Request, type Response } from "express";
import bcrypt from "bcryptjs";
import multer from "multer";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { config } from "./config.js";
import { db, camelizeRow } from "./db.js";
import { clearSessions, createAdminSession, createSiteSession, hasAdminAccess, hasSiteAccess, requireAdmin, requireSite } from "./auth.js";
import { getContent } from "./content.js";
import { imageFilterPresets, isMediaPubliclyAccessible, persistUploads, removeMediaFiles, resolveMediaPath, updateImageFilter } from "./media.js";
import { getDeploymentStatus } from "./version.js";
import { BackupExportBusyError, getBackupExportStatus, inspectFullBackup, preflightFullBackup, recordBackupExportStatus, restoreInspectedBackup, streamFullBackup } from "./backup.js";
import { RequestTooLargeError } from "./http.js";

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
  const admin = hasAdminAccess(req);
  if (!Number.isInteger(id) || !["web", "thumb", "original"].includes(variant)) return res.status(404).end();
  if (variant === "original" && !admin) return res.status(404).end();
  if (!admin && !isMediaPubliclyAccessible(id)) return res.status(404).end();
  const media = resolveMediaPath(id, variant);
  if (!media) return res.status(404).end();
  res.type(media.mime);
  res.setHeader("Cache-Control", "private, no-store");
  res.sendFile(path.basename(media.target), { root: path.dirname(media.target) });
});

api.get("/admin/content", requireAdmin, (_req, res) => res.json(getContent(true)));

const bool = z.union([z.boolean(), z.number(), z.string()]).transform((value) => value === true || value === 1 || value === "1" || value === "true" ? 1 : 0);

export function isValidCalendarDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= daysInMonth[month - 1];
}

const calendarDate = z.string().refine(isValidCalendarDate, "请输入有效的日期");
const nullableDate = z.string().refine((value) => !value || isValidCalendarDate(value), "请输入有效的日期").nullable().optional().transform((value) => value || null);

const resourceDefinitions = {
  anniversaries: {
    table: "anniversaries",
    schema: z.object({ title: z.string().min(1).max(120), eventDate: calendarDate, annual: bool, description: z.string().max(1000).default(""), enabled: bool, sortOrder: z.coerce.number().int().default(0) }),
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
  },
  homeSecrets: {
    table: "homepage_secret_cards",
    schema: z.object({ numberText: z.string().min(1).max(24), title: z.string().min(1).max(120), body: z.string().min(1).max(1200), accent: z.enum(["blue", "ticket", "red"]), revealStyle: z.enum(["flip", "envelope", "scratch", "ticket"]), enabled: bool, sortOrder: z.coerce.number().int().default(0) }),
    columns: ["number_text", "title", "body", "accent", "reveal_style", "enabled", "sort_order"]
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
  metDate: calendarDate,
  togetherDate: calendarDate,
  manName: z.string().min(1).max(80),
  manBirthday: calendarDate,
  womanName: z.string().min(1).max(80),
  womanBirthday: calendarDate,
  musicMediaId: z.coerce.number().int().positive().nullable().optional().transform((value) => value || null),
  musicMode: z.enum(["sequence", "repeat-one", "shuffle"]).default("sequence")
});

const musicTracksSchema = z.array(z.object({
  id: z.coerce.number().int().positive(),
  enabled: bool,
  title: z.string().max(160).default(""),
  artist: z.string().max(160).default(""),
  sortOrder: z.coerce.number().int().default(0)
})).max(200).superRefine((tracks, context) => {
  const ids = tracks.map((item) => item.id);
  if (new Set(ids).size !== ids.length) context.addIssue({ code: "custom", message: "歌单中不能重复包含同一首歌曲" });
});

const musicLibrarySchema = z.object({ tracks: musicTracksSchema });
const settingsWithMusicSchema = z.object({ settings: settingsSchema, tracks: musicTracksSchema });
type SettingsInput = z.infer<typeof settingsSchema>;
type MusicTrackInput = z.infer<typeof musicTracksSchema>[number];

function validateMusicReferences(settings: SettingsInput | null, tracks: MusicTrackInput[] | null) {
  if (settings?.musicMediaId) {
    const music = db.prepare("SELECT id FROM media WHERE id = ? AND kind = 'audio'").get(settings.musicMediaId);
    if (!music) return "背景音乐不存在或不是音频";
  }
  if (tracks) {
    const ids = tracks.map((item) => item.id);
    const existing = ids.length
      ? db.prepare(`SELECT id FROM media WHERE kind = 'audio' AND id IN (${ids.map(() => "?").join(",")})`).all(...ids) as Array<{ id: number }>
      : [];
    if (existing.length !== ids.length) return "歌单中包含不存在的歌曲";
  }
  return null;
}

function updateSettings(settings: SettingsInput) {
  db.prepare(`
    UPDATE settings SET site_title = ?, subtitle = ?, hero_note = ?, met_date = ?, together_date = ?,
      man_name = ?, man_birthday = ?, woman_name = ?, woman_birthday = ?, music_media_id = ?, music_mode = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = 1
  `).run(
    settings.siteTitle,
    settings.subtitle,
    settings.heroNote,
    settings.metDate,
    settings.togetherDate,
    settings.manName,
    settings.manBirthday,
    settings.womanName,
    settings.womanBirthday,
    settings.musicMediaId,
    settings.musicMode
  );
}

function updateMusicLibrary(tracks: MusicTrackInput[]) {
  db.prepare("UPDATE media SET playlist_enabled = 0 WHERE kind = 'audio'").run();
  const update = db.prepare("UPDATE media SET display_name = ?, caption = ?, playlist_enabled = ?, sort_order = ? WHERE id = ? AND kind = 'audio'");
  tracks.forEach((item) => update.run(item.title, item.artist, item.enabled, item.sortOrder, item.id));
}

function inTransaction(work: () => void) {
  db.exec("BEGIN");
  try {
    work();
    db.exec("COMMIT");
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch { /* Preserve the original database error. */ }
    throw error;
  }
}

api.put("/admin/settings", requireAdmin, (req, res) => {
  const combinedRequest = Boolean(req.body && typeof req.body === "object" && !Array.isArray(req.body) && ("settings" in req.body || "tracks" in req.body));
  const parsed = combinedRequest ? settingsWithMusicSchema.safeParse(req.body) : settingsSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || "设置格式不正确" });
  const settings = combinedRequest ? (parsed.data as z.infer<typeof settingsWithMusicSchema>).settings : parsed.data as SettingsInput;
  const tracks = combinedRequest ? (parsed.data as z.infer<typeof settingsWithMusicSchema>).tracks : null;
  const referenceError = validateMusicReferences(settings, tracks);
  if (referenceError) return res.status(400).json({ error: referenceError });
  try {
    inTransaction(() => {
      updateSettings(settings);
      if (tracks) updateMusicLibrary(tracks);
    });
  } catch (error) {
    return res.status(400).json({ error: error instanceof Error ? error.message : "设置保存失败" });
  }
  res.json(camelizeRow(db.prepare("SELECT * FROM settings WHERE id = 1").get()));
});

api.put("/admin/music", requireAdmin, (req, res) => {
  const parsed = musicLibrarySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || "歌曲信息格式不正确" });
  const referenceError = validateMusicReferences(null, parsed.data.tracks);
  if (referenceError) return res.status(400).json({ error: referenceError });
  try {
    inTransaction(() => updateMusicLibrary(parsed.data.tracks));
  } catch (error) {
    return res.status(400).json({ error: error instanceof Error ? error.message : "歌曲库保存失败" });
  }
  res.json({ ok: true });
});

const homepageCoreTypes = ["hero", "nextDate", "profiles", "secrets", "contents", "ending"] as const;
const homepageInteractiveTypes = ["questionDraw", "memoryMatch", "anniversaryDraw"] as const;
const homepageBlockTypes = [...homepageCoreTypes, ...homepageInteractiveTypes] as const;
const questionDrawConfigSchema = z.object({ eyebrow: z.string().max(80), title: z.string().min(1).max(120), description: z.string().max(300), buttonLabel: z.string().min(1).max(40), questions: z.array(z.string().min(1).max(180)).min(2).max(30) });
const memoryMatchConfigSchema = z.object({ eyebrow: z.string().max(80), title: z.string().min(1).max(120), description: z.string().max(300), pairs: z.array(z.string().min(1).max(24)).min(2).max(8) });
const anniversaryDrawConfigSchema = z.object({ eyebrow: z.string().max(80), title: z.string().min(1).max(120), description: z.string().max(300), buttonLabel: z.string().min(1).max(40), options: z.array(z.string().min(1).max(100)).min(2).max(20) });
const blockConfigSchemas = { questionDraw: questionDrawConfigSchema, memoryMatch: memoryMatchConfigSchema, anniversaryDraw: anniversaryDrawConfigSchema } as const;
const defaultBlockConfigs = {
  questionDraw: { eyebrow: "ONE QUESTION", title: "今天想问彼此什么？", description: "抽一张问题纸条，轮流认真回答。", buttonLabel: "抽一张", questions: ["最近哪一刻让你觉得被在意？", "下一次约会最想去哪里？", "有哪句话一直想对我说？"] },
  memoryMatch: { eyebrow: "MEMORY PAIRS", title: "把我们的记忆配成一对", description: "翻开相同的词语，把普通日子重新想一遍。", pairs: ["奶茶", "散步", "晚饭", "晚安"] },
  anniversaryDraw: { eyebrow: "DATE DRAW", title: "下一次约会做什么？", description: "从我们都愿意做的小事里抽一张。", buttonLabel: "开始抽签", options: ["一起看日落", "散步后吃甜品", "挑一部电影", "去没走过的街道"] }
} as const;
const homepageBlockSchema = z.object({ id: z.coerce.number().int().positive(), blockType: z.enum(homepageBlockTypes), enabled: bool, sortOrder: z.coerce.number().int(), config: z.record(z.string(), z.unknown()).default({}) });
const homepageSchema = z.object({
  settings: z.object({
    heroEyebrow: z.string().max(120),
    heroTitle: z.string().max(120),
    heroJoiner: z.string().max(20),
    heroSubtitle: z.string().max(300),
    heroMediaId: z.coerce.number().int().positive().nullable().optional().transform((value) => value || null),
    heroMediaCaption: z.string().max(240),
    heroCtaLabel: z.string().max(80),
    heroCtaTarget: z.string().regex(/^\/[A-Za-z0-9/_-]*$/, "按钮目标必须是站内路径"),
    manQuote: z.string().max(500),
    womanQuote: z.string().max(500),
    profilesIntro: z.string().max(160),
    profilesOutro: z.string().max(160),
    nextKicker: z.string().max(80),
    nextPrefix: z.string().max(80),
    nextFallback: z.string().max(240),
    secretsEyebrow: z.string().max(120),
    secretsTitle: z.string().max(160),
    secretsDescription: z.string().max(300),
    contentsEyebrow: z.string().max(120),
    contentsTitle: z.string().max(160),
    contentsDescription: z.string().max(300),
    endingKicker: z.string().max(160),
    endingHeadline: z.string().max(200),
    endingSignature: z.string().max(200)
  }),
  modules: z.array(homepageBlockSchema).min(homepageCoreTypes.length).max(24)
});

api.put("/admin/homepage", requireAdmin, (req, res) => {
  const parsed = homepageSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || "首页配置格式不正确" });
  for (const type of homepageCoreTypes) {
    if (parsed.data.modules.filter((item) => item.blockType === type).length !== 1) return res.status(400).json({ error: "固定首页模块必须各保留一个" });
  }
  const normalizedModules = [];
  for (const module of parsed.data.modules) {
    const schema = blockConfigSchemas[module.blockType as keyof typeof blockConfigSchemas];
    if (!schema) normalizedModules.push({ ...module, config: {} });
    else {
      const config = schema.safeParse(module.config);
      if (!config.success) return res.status(400).json({ error: `${module.blockType} 配置不完整` });
      normalizedModules.push({ ...module, config: config.data });
    }
  }
  if (parsed.data.settings.heroMediaId) {
    const media = db.prepare("SELECT id FROM media WHERE id = ? AND kind = 'image'").get(parsed.data.settings.heroMediaId);
    if (!media) return res.status(400).json({ error: "首页主图不存在或不是图片" });
  }
  const values = parsed.data.settings;
  try {
    db.exec("BEGIN");
    db.prepare(`
      UPDATE homepage_settings SET
        hero_eyebrow = ?, hero_title = ?, hero_joiner = ?, hero_subtitle = ?, hero_media_id = ?, hero_media_caption = ?,
        hero_cta_label = ?, hero_cta_target = ?, man_quote = ?, woman_quote = ?, profiles_intro = ?, profiles_outro = ?,
        next_kicker = ?, next_prefix = ?, next_fallback = ?, secrets_eyebrow = ?, secrets_title = ?, secrets_description = ?,
        contents_eyebrow = ?, contents_title = ?, contents_description = ?, ending_kicker = ?, ending_headline = ?, ending_signature = ?,
        updated_at = CURRENT_TIMESTAMP WHERE id = 1
    `).run(
      values.heroEyebrow, values.heroTitle, values.heroJoiner, values.heroSubtitle, values.heroMediaId, values.heroMediaCaption,
      values.heroCtaLabel, values.heroCtaTarget, values.manQuote, values.womanQuote, values.profilesIntro, values.profilesOutro,
      values.nextKicker, values.nextPrefix, values.nextFallback, values.secretsEyebrow, values.secretsTitle, values.secretsDescription,
      values.contentsEyebrow, values.contentsTitle, values.contentsDescription, values.endingKicker, values.endingHeadline, values.endingSignature
    );
    const updateModule = db.prepare("UPDATE homepage_blocks SET enabled = ?, sort_order = ?, config_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND block_type = ?");
    normalizedModules.forEach((item) => updateModule.run(item.enabled, item.sortOrder, JSON.stringify(item.config), item.id, item.blockType));
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    return res.status(400).json({ error: error instanceof Error ? error.message : "首页配置保存失败" });
  }
  res.json({ ok: true });
});

api.post("/admin/homepage/modules", requireAdmin, (req, res) => {
  const parsed = z.object({ blockType: z.enum(homepageInteractiveTypes) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "请选择可添加的互动模块" });
  const blockCount = Number((db.prepare("SELECT COUNT(*) AS value FROM homepage_blocks").get() as { value: number }).value);
  if (blockCount >= 24) return res.status(400).json({ error: "首页最多保留 24 个模块" });
  const sortOrder = Number((db.prepare("SELECT COALESCE(MAX(sort_order), 0) AS value FROM homepage_blocks").get() as { value: number }).value) + 10;
  const result = db.prepare("INSERT INTO homepage_blocks (block_type, enabled, sort_order, config_json) VALUES (?, 1, ?, ?)").run(parsed.data.blockType, sortOrder, JSON.stringify(defaultBlockConfigs[parsed.data.blockType]));
  res.status(201).json({ id: Number(result.lastInsertRowid) });
});

api.delete("/admin/homepage/modules/:id", requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare("SELECT block_type FROM homepage_blocks WHERE id = ?").get(id) as { block_type: string } | undefined;
  if (!row) return res.status(404).json({ error: "首页模块不存在" });
  if ((homepageCoreTypes as readonly string[]).includes(row.block_type)) return res.status(400).json({ error: "固定模块只能隐藏，不能删除" });
  db.prepare("DELETE FROM homepage_blocks WHERE id = ?").run(id);
  res.json({ ok: true });
});

api.get("/admin/deployment-status", requireAdmin, async (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json(await getDeploymentStatus());
});

const optionalBackupExportIdSchema = z.union([z.string().uuid(), z.undefined()]);
const missingBackupExportStatusMessage = "备份导出状态不存在或已过期";

api.get("/admin/backup/export/status/:id", requireAdmin, (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const parsed = z.string().uuid().safeParse(req.params.id);
  if (!parsed.success) return res.status(404).json({ error: missingBackupExportStatusMessage });
  const status = getBackupExportStatus(parsed.data);
  if (!status) return res.status(404).json({ error: missingBackupExportStatusMessage });
  res.json(status);
});

api.head("/admin/backup/export", requireAdmin, (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const parsedId = optionalBackupExportIdSchema.safeParse(req.query.id);
  if (!parsedId.success) return res.status(400).json({ error: "备份导出标识无效" });
  const exportId = parsedId.data;
  try {
    preflightFullBackup();
    if (exportId) recordBackupExportStatus(exportId, "ready");
    res.status(204).end();
  } catch (error) {
    if (exportId) recordBackupExportStatus(exportId, "failed");
    if (error instanceof BackupExportBusyError) return res.status(409).json({ error: "备份导出正在进行，请稍后再试" });
    res.status(503).json({ error: "备份导出暂不可用" });
  }
});

api.get("/admin/backup/export", requireAdmin, async (req, res) => {
  const parsedId = optionalBackupExportIdSchema.safeParse(req.query.id);
  if (!parsedId.success) return res.status(400).json({ error: "备份导出标识无效" });
  const exportId = parsedId.data;
  if (exportId) recordBackupExportStatus(exportId, "running");
  try {
    await streamFullBackup(res);
    if (exportId) recordBackupExportStatus(exportId, "complete");
  } catch (error) {
    if (exportId) recordBackupExportStatus(exportId, "failed");
    if (!res.headersSent && error instanceof BackupExportBusyError) res.status(409).json({ error: "备份导出正在进行，请稍后再试" });
    else if (!res.headersSent) res.status(500).json({ error: "备份生成失败" });
    else res.destroy();
  }
});

const backupUpload = multer({ dest: config.backupStagingDir, limits: { files: 1, fileSize: 20 * 1024 * 1024 * 1024 } });

api.post("/admin/backup/inspect", requireAdmin, backupUpload.single("backup"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "请选择备份文件" });
  try {
    res.json(await inspectFullBackup(req.file.path, req.file.originalname));
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "备份文件无法读取" });
  }
});

api.post("/admin/backup/restore", requireAdmin, (req, res) => {
  const parsed = z.object({ token: z.string().uuid(), confirmation: z.literal("覆盖当前网站") }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "请输入“覆盖当前网站”确认恢复" });
  try {
    res.json(restoreInspectedBackup(parsed.data.token));
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "备份恢复失败" });
  }
});

const mediaUploadLimits = {
  files: 30,
  fileBytes: 30 * 1024 * 1024,
  totalFileBytes: 300 * 1024 * 1024,
  requestBytes: 305 * 1024 * 1024,
  fields: 121,
  fieldBytes: 16 * 1024,
  parts: 151
} as const;

type MediaUploadState = { directory: string; totalBytes: number };
const mediaUploadStates = new WeakMap<Request, MediaUploadState>();

function mediaUploadState(req: Request) {
  const current = mediaUploadStates.get(req);
  if (current) return current;
  const state = {
    directory: fs.mkdtempSync(path.join(config.backupStagingDir, "media-")),
    totalBytes: 0
  };
  mediaUploadStates.set(req, state);
  return state;
}

class MediaDiskStorage implements multer.StorageEngine {
  _handleFile(req: Request, file: Express.Multer.File, callback: (error?: unknown, info?: Partial<Express.Multer.File>) => void) {
    let state: MediaUploadState;
    try {
      state = mediaUploadState(req);
    } catch (error) {
      callback(error);
      return;
    }
    const filename = crypto.randomUUID();
    const target = path.join(state.directory, filename);
    const output = fs.createWriteStream(target, { flags: "wx" });
    let fileBytes = 0;
    const limiter = new Transform({
      transform(chunk: Buffer, _encoding, done) {
        state.totalBytes += chunk.length;
        fileBytes += chunk.length;
        if (state.totalBytes > mediaUploadLimits.totalFileBytes) done(new RequestTooLargeError());
        else done(null, chunk);
      }
    });

    void pipeline(file.stream, limiter, output).then(() => {
      callback(undefined, {
        destination: state.directory,
        filename,
        path: target,
        size: fileBytes
      });
    }).catch((error: unknown) => {
      fs.rm(target, { force: true }, () => callback(error));
    });
  }

  _removeFile(_req: Request, file: Express.Multer.File, callback: (error: Error | null) => void) {
    if (typeof file.path !== "string" || !file.path) return callback(null);
    fs.rm(file.path, { force: true }, callback);
  }
}

function cleanupMediaUpload(req: Request) {
  const state = mediaUploadStates.get(req);
  mediaUploadStates.delete(req);
  if (!state) return;
  const root = path.resolve(config.backupStagingDir);
  const directory = path.resolve(state.directory);
  if (path.dirname(directory) !== root || !path.basename(directory).startsWith("media-")) return;
  try { fs.rmSync(directory, { recursive: true, force: true }); } catch { /* Startup staging cleanup can retry after an interrupted request. */ }
}

const upload = multer({
  storage: new MediaDiskStorage(),
  limits: {
    files: mediaUploadLimits.files,
    fileSize: mediaUploadLimits.fileBytes,
    fields: mediaUploadLimits.fields,
    fieldSize: mediaUploadLimits.fieldBytes,
    parts: mediaUploadLimits.parts
  }
});
const parseMediaUpload = upload.array("files", mediaUploadLimits.files);

function mediaUploadMiddleware(req: Request, res: Response, next: NextFunction) {
  const contentLength = Number(req.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > mediaUploadLimits.requestBytes) return next(new RequestTooLargeError());
  parseMediaUpload(req, res, (error) => {
    if (error) cleanupMediaUpload(req);
    next(error);
  });
}

const uploadAlbumId = z.preprocess(
  (value) => value === undefined || value === null || value === "" ? null : value,
  z.coerce.number().int().positive().nullable()
);
const uploadMetadataSchema = z.object({
  displayName: z.string().max(160).default(""),
  caption: z.string().max(1000).default(""),
  takenDate: nullableDate,
  filterPreset: z.enum(imageFilterPresets).default("original")
});

api.post("/admin/media", requireAdmin, mediaUploadMiddleware, async (req, res) => {
  try {
    const files = (req.files || []) as Express.Multer.File[];
    if (!files.length) return res.status(400).json({ error: "请选择文件" });
    const parsedAlbumId = uploadAlbumId.safeParse(req.body.albumId);
    if (!parsedAlbumId.success) return res.status(400).json({ error: "相册信息格式不正确" });
    const fieldAt = (key: string, index: number) => {
      const value = req.body[key];
      return Array.isArray(value) ? value[index] : index === 0 ? value : undefined;
    };
    const metadata: Array<z.infer<typeof uploadMetadataSchema>> = [];
    for (const index of files.keys()) {
      const parsedMetadata = uploadMetadataSchema.safeParse({
        displayName: fieldAt("displayNames", index),
        caption: fieldAt("captions", index),
        takenDate: fieldAt("takenDates", index),
        filterPreset: fieldAt("filterPresets", index)
      });
      if (!parsedMetadata.success) {
        return res.status(400).json({ error: parsedMetadata.error.issues[0]?.message || "媒体信息格式不正确" });
      }
      metadata.push(parsedMetadata.data);
    }
    const ids = await persistUploads(files, parsedAlbumId.data, metadata);
    const rows = ids.map((id) => camelizeRow(db.prepare("SELECT * FROM media WHERE id = ?").get(id)));
    return res.status(201).json(rows);
  } catch (error) {
    return res.status(400).json({ error: error instanceof Error ? error.message : "上传失败" });
  } finally {
    cleanupMediaUpload(req);
  }
});

api.put("/admin/media/:id", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const schema = z.object({ albumId: z.coerce.number().int().positive().nullable().optional().transform((value) => value || null), displayName: z.string().max(160).default(""), caption: z.string().max(1000).default(""), takenDate: nullableDate, filterPreset: z.enum(imageFilterPresets).default("original"), sortOrder: z.coerce.number().int().default(0) });
  const parsed = schema.safeParse(req.body);
  if (!Number.isInteger(id) || !parsed.success) return res.status(400).json({ error: "媒体信息格式不正确" });
  const current = db.prepare("SELECT filter_preset AS filterPreset FROM media WHERE id = ? AND kind = 'image'").get(id) as { filterPreset: string } | undefined;
  if (!current) return res.status(404).json({ error: "照片不存在" });
  try {
    if (current.filterPreset !== parsed.data.filterPreset) await updateImageFilter(id, parsed.data.filterPreset);
    db.prepare("UPDATE media SET album_id = ?, display_name = ?, caption = ?, taken_date = ?, sort_order = ? WHERE id = ?").run(parsed.data.albumId, parsed.data.displayName, parsed.data.caption, parsed.data.takenDate, parsed.data.sortOrder, id);
  } catch (error) {
    return res.status(400).json({ error: error instanceof Error ? error.message : "滤镜处理失败" });
  }
  res.json(camelizeRow(db.prepare("SELECT * FROM media WHERE id = ?").get(id)));
});

api.delete("/admin/media/:id", requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(404).end();
  removeMediaFiles(id);
  db.prepare("DELETE FROM media WHERE id = ?").run(id);
  res.json({ ok: true });
});

function directoryIsWritable(directory: string) {
  const probe = path.join(directory, `.health-${crypto.randomUUID()}`);
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(probe, "wx", 0o600);
    fs.closeSync(descriptor);
    descriptor = undefined;
    fs.rmSync(probe, { force: true });
    return true;
  } catch {
    if (descriptor !== undefined) {
      try { fs.closeSync(descriptor); } catch { /* Preserve the health failure. */ }
    }
    try { fs.rmSync(probe, { force: true }); } catch { /* The response must not expose filesystem details. */ }
    return false;
  }
}

export function serviceIsHealthy() {
  let transactionStarted = false;
  try {
    db.prepare("SELECT 1 AS ok").get();
    db.exec("BEGIN IMMEDIATE");
    transactionStarted = true;
    db.prepare("UPDATE settings SET id = id WHERE id = 1").run();
    db.exec("ROLLBACK");
    transactionStarted = false;
    return directoryIsWritable(config.uploadDir) && directoryIsWritable(config.backupStagingDir);
  } catch {
    if (transactionStarted) {
      try { db.exec("ROLLBACK"); } catch { /* Keep the service unhealthy if the write probe cannot be rolled back. */ }
    }
    return false;
  }
}

api.get("/health", (_req, res) => {
  const ok = serviceIsHealthy();
  res.setHeader("Cache-Control", "no-store");
  res.status(ok ? 200 : 503).json({ ok });
});
