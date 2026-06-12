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
  res.sendFile(path.basename(media.target), { root: path.dirname(media.target) });
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
