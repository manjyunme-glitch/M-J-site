import { z } from "zod";

export const backupFormat = "m-j-site-backup" as const;
export const backupVersion = 1 as const;

export const backupTableColumns = {
  settings: ["id", "site_title", "subtitle", "hero_note", "met_date", "together_date", "man_name", "man_birthday", "woman_name", "woman_birthday", "music_media_id", "music_autoplay", "music_mode", "updated_at"],
  anniversaries: ["id", "title", "event_date", "annual", "description", "enabled", "sort_order", "created_at"],
  albums: ["id", "title", "event_date", "description", "cover_media_id", "published", "sort_order", "created_at"],
  media: ["id", "album_id", "kind", "original_name", "file_path", "web_path", "thumb_path", "mime_type", "display_name", "caption", "taken_date", "image_width", "image_height", "filter_preset", "playlist_enabled", "sort_order", "created_at"],
  homepage_settings: ["id", "hero_eyebrow", "hero_title", "hero_joiner", "hero_subtitle", "hero_media_id", "hero_media_caption", "hero_cta_label", "hero_cta_target", "man_quote", "woman_quote", "profiles_intro", "profiles_outro", "next_kicker", "next_prefix", "next_fallback", "secrets_eyebrow", "secrets_title", "secrets_description", "contents_eyebrow", "contents_title", "contents_description", "ending_kicker", "ending_headline", "ending_signature", "updated_at"],
  homepage_modules: ["module_key", "enabled", "sort_order"],
  homepage_blocks: ["id", "block_type", "enabled", "sort_order", "config_json", "created_at", "updated_at"],
  homepage_secret_cards: ["id", "number_text", "title", "body", "accent", "reveal_style", "enabled", "sort_order", "created_at"],
  timeline_events: ["id", "date_label", "event_date", "title", "body", "media_id", "published", "sort_order", "created_at"],
  letters: ["id", "title", "body", "published", "sort_order", "created_at", "updated_at"],
  wishes: ["id", "title", "description", "status", "target_date", "completed_date", "media_id", "sort_order", "created_at"]
} as const;

export type BackupTableName = keyof typeof backupTableColumns;
export type BackupValue = string | number | null;
export type BackupRow = Record<string, BackupValue>;
export type BackupTables = Record<BackupTableName, BackupRow[]>;

export type BackupSummary = {
  timeline: number;
  albums: number;
  images: number;
  audio: number;
  letters: number;
  wishes: number;
  anniversaries: number;
  mediaBytes: number;
};

export type BackupManifest = {
  format: typeof backupFormat;
  version: typeof backupVersion;
  createdAt: string;
  summary: BackupSummary;
  tables: BackupTables;
};

export function buildBackupSummary(tables: BackupTables, mediaBytes = 0): BackupSummary {
  return {
    timeline: tables.timeline_events.length,
    albums: tables.albums.length,
    images: tables.media.filter((item) => item.kind === "image").length,
    audio: tables.media.filter((item) => item.kind === "audio").length,
    letters: tables.letters.length,
    wishes: tables.wishes.length,
    anniversaries: tables.anniversaries.length,
    mediaBytes
  };
}

export function isSafeStoredFilename(value: string) {
  return Boolean(value) && value === value.replaceAll("\\", "/") && !value.includes("/") && value !== "." && value !== "..";
}

function isValidCalendarDate(value: string) {
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

function isValidTimestamp(value: string) {
  const match = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})?$/.exec(value);
  if (!match || !isValidCalendarDate(match[1])) return false;
  return Number(match[2]) <= 23 && Number(match[3]) <= 59 && Number(match[4]) <= 59;
}

const positiveId = z.number().int().positive();
const nullableId = positiveId.nullable();
const integer = z.number().int();
const booleanInteger = z.union([z.literal(0), z.literal(1)]);
const calendarDate = z.string().refine(isValidCalendarDate);
const nullableDate = calendarDate.nullable();
const timestamp = z.string().refine(isValidTimestamp);
const requiredString = (max: number) => z.string().min(1).max(max);
const optionalString = (max: number) => z.string().max(max);
const storedFilename = z.string().refine(isSafeStoredFilename);
const nullableStoredFilename = storedFilename.nullable();

const homepageCoreTypes = ["hero", "nextDate", "profiles", "secrets", "contents", "ending"] as const;
const homepageInteractiveTypes = ["questionDraw", "memoryMatch", "anniversaryDraw"] as const;
const homepageBlockTypes = [...homepageCoreTypes, ...homepageInteractiveTypes] as const;
const imageFilterPresets = ["original", "warm-pencil", "faded-book", "blue-diary", "soft-film"] as const;
const mediaMimes = ["image/jpeg", "image/png", "image/webp", "audio/mpeg", "audio/mp4", "audio/x-m4a", "audio/ogg"] as const;

const rowSchemas = {
  settings: z.object({
    id: z.literal(1),
    site_title: requiredString(120),
    subtitle: requiredString(240),
    hero_note: optionalString(2000),
    met_date: calendarDate,
    together_date: calendarDate,
    man_name: requiredString(80),
    man_birthday: calendarDate,
    woman_name: requiredString(80),
    woman_birthday: calendarDate,
    music_media_id: nullableId,
    music_autoplay: booleanInteger,
    music_mode: z.enum(["sequence", "repeat-one", "shuffle"]),
    updated_at: timestamp
  }),
  anniversaries: z.object({
    id: positiveId,
    title: requiredString(120),
    event_date: calendarDate,
    annual: booleanInteger,
    description: optionalString(1000),
    enabled: booleanInteger,
    sort_order: integer,
    created_at: timestamp
  }),
  albums: z.object({
    id: positiveId,
    title: requiredString(120),
    event_date: nullableDate,
    description: optionalString(1000),
    cover_media_id: nullableId,
    published: booleanInteger,
    sort_order: integer,
    created_at: timestamp
  }),
  media: z.object({
    id: positiveId,
    album_id: nullableId,
    kind: z.enum(["image", "audio"]),
    original_name: requiredString(255),
    file_path: storedFilename,
    web_path: nullableStoredFilename,
    thumb_path: nullableStoredFilename,
    mime_type: z.enum(mediaMimes),
    display_name: optionalString(160),
    caption: optionalString(1000),
    taken_date: nullableDate,
    image_width: nullableId,
    image_height: nullableId,
    filter_preset: z.enum(imageFilterPresets),
    playlist_enabled: booleanInteger,
    sort_order: integer,
    created_at: timestamp
  }),
  homepage_settings: z.object({
    id: z.literal(1),
    hero_eyebrow: optionalString(120),
    hero_title: optionalString(120),
    hero_joiner: optionalString(20),
    hero_subtitle: optionalString(300),
    hero_media_id: nullableId,
    hero_media_caption: optionalString(240),
    hero_cta_label: optionalString(80),
    hero_cta_target: z.string().regex(/^\/[A-Za-z0-9/_-]*$/),
    man_quote: optionalString(500),
    woman_quote: optionalString(500),
    profiles_intro: optionalString(160),
    profiles_outro: optionalString(160),
    next_kicker: optionalString(80),
    next_prefix: optionalString(80),
    next_fallback: optionalString(240),
    secrets_eyebrow: optionalString(120),
    secrets_title: optionalString(160),
    secrets_description: optionalString(300),
    contents_eyebrow: optionalString(120),
    contents_title: optionalString(160),
    contents_description: optionalString(300),
    ending_kicker: optionalString(160),
    ending_headline: optionalString(200),
    ending_signature: optionalString(200),
    updated_at: timestamp
  }),
  homepage_modules: z.object({
    module_key: z.enum(homepageCoreTypes),
    enabled: booleanInteger,
    sort_order: integer
  }),
  homepage_blocks: z.object({
    id: positiveId,
    block_type: z.enum(homepageBlockTypes),
    enabled: booleanInteger,
    sort_order: integer,
    config_json: z.string(),
    created_at: timestamp,
    updated_at: timestamp
  }),
  homepage_secret_cards: z.object({
    id: positiveId,
    number_text: requiredString(24),
    title: requiredString(120),
    body: requiredString(1200),
    accent: z.enum(["blue", "ticket", "red"]),
    reveal_style: z.enum(["flip", "envelope", "scratch", "ticket"]),
    enabled: booleanInteger,
    sort_order: integer,
    created_at: timestamp
  }),
  timeline_events: z.object({
    id: positiveId,
    date_label: requiredString(80),
    event_date: nullableDate,
    title: requiredString(120),
    body: requiredString(6000),
    media_id: nullableId,
    published: booleanInteger,
    sort_order: integer,
    created_at: timestamp
  }),
  letters: z.object({
    id: positiveId,
    title: requiredString(120),
    body: requiredString(20000),
    published: booleanInteger,
    sort_order: integer,
    created_at: timestamp,
    updated_at: timestamp
  }),
  wishes: z.object({
    id: positiveId,
    title: requiredString(120),
    description: optionalString(2000),
    status: z.enum(["pending", "completed"]),
    target_date: nullableDate,
    completed_date: nullableDate,
    media_id: nullableId,
    sort_order: integer,
    created_at: timestamp
  })
} as const;

const interactiveConfigSchemas = {
  questionDraw: z.object({
    eyebrow: optionalString(80),
    title: requiredString(120),
    description: optionalString(300),
    buttonLabel: requiredString(40),
    questions: z.array(requiredString(180)).min(2).max(30)
  }),
  memoryMatch: z.object({
    eyebrow: optionalString(80),
    title: requiredString(120),
    description: optionalString(300),
    pairs: z.array(requiredString(24)).min(2).max(8)
  }),
  anniversaryDraw: z.object({
    eyebrow: optionalString(80),
    title: requiredString(120),
    description: optionalString(300),
    buttonLabel: requiredString(40),
    options: z.array(requiredString(100)).min(2).max(20)
  })
} as const;

function numericIds(table: BackupTableName, rows: BackupRow[]) {
  const ids = rows.map((row) => row.id);
  if (ids.some((id) => typeof id !== "number" || !Number.isInteger(id) || id <= 0)) throw new Error(`${table} 包含无效 ID`);
  const normalized = ids as number[];
  if (new Set(normalized).size !== normalized.length) throw new Error(`${table} 包含重复 ID`);
  return new Set(normalized);
}

function assertReference(value: BackupValue, ids: Set<number>, label: string) {
  if (value === null) return;
  if (typeof value !== "number" || !ids.has(value)) throw new Error(`${label} 引用了不存在的内容`);
}

function assertImageReference(value: BackupValue, ids: Set<number>, mediaKinds: Map<BackupValue, BackupValue>, label: string) {
  assertReference(value, ids, label);
  if (value !== null && mediaKinds.get(value) !== "image") throw new Error(`${label} 引用的不是照片`);
}

function validateBlockConfig(row: BackupRow) {
  let config: unknown;
  try {
    config = JSON.parse(row.config_json as string);
  } catch {
    throw new Error("首页模块配置不是有效 JSON");
  }
  if (!config || typeof config !== "object" || Array.isArray(config)) throw new Error("首页模块配置格式不正确");
  const blockType = row.block_type as typeof homepageBlockTypes[number];
  if (homepageInteractiveTypes.includes(blockType as typeof homepageInteractiveTypes[number])) {
    const result = interactiveConfigSchemas[blockType as keyof typeof interactiveConfigSchemas].safeParse(config);
    if (!result.success) throw new Error(`${blockType} 配置不完整`);
  }
}

function validateRelationships(tables: BackupTables) {
  const albums = numericIds("albums", tables.albums);
  const media = numericIds("media", tables.media);
  for (const table of ["anniversaries", "homepage_blocks", "homepage_secret_cards", "timeline_events", "letters", "wishes"] as BackupTableName[]) numericIds(table, tables[table]);

  const moduleKeys = tables.homepage_modules.map((row) => row.module_key);
  if (tables.homepage_modules.length !== homepageCoreTypes.length
    || new Set(moduleKeys).size !== homepageCoreTypes.length
    || homepageCoreTypes.some((key) => !moduleKeys.includes(key))) {
    throw new Error("备份固定首页模块不完整");
  }

  if (tables.homepage_blocks.length < homepageCoreTypes.length || tables.homepage_blocks.length > 24) throw new Error("备份首页模块数量不正确");
  for (const type of homepageCoreTypes) {
    if (tables.homepage_blocks.filter((row) => row.block_type === type).length !== 1) throw new Error("固定首页模块必须各保留一个");
  }

  const mediaKinds = new Map<BackupValue, BackupValue>(tables.media.map((row) => [row.id, row.kind]));
  for (const row of tables.media) {
    assertReference(row.album_id, albums, "媒体相册");
    if (row.kind === "image") {
      if (row.web_path === null || row.thumb_path === null) throw new Error("照片缺少网页或缩略图文件");
      if (!["image/jpeg", "image/png", "image/webp"].includes(row.mime_type as string)) throw new Error("照片媒体类型不正确");
      if ((row.image_width === null) !== (row.image_height === null)) throw new Error("照片尺寸信息不完整");
      if (row.playlist_enabled !== 0) throw new Error("照片不能加入音乐歌单");
    } else {
      if (row.album_id !== null || row.web_path !== null || row.thumb_path !== null || row.image_width !== null || row.image_height !== null) throw new Error("音频包含不适用的图片字段");
      if (!["audio/mpeg", "audio/mp4", "audio/x-m4a", "audio/ogg"].includes(row.mime_type as string)) throw new Error("音频媒体类型不正确");
      if (row.filter_preset !== "original") throw new Error("音频滤镜配置不正确");
    }
  }

  const musicMediaId = tables.settings[0].music_media_id;
  assertReference(musicMediaId, media, "背景音乐");
  if (musicMediaId !== null && mediaKinds.get(musicMediaId) !== "audio") throw new Error("背景音乐引用的不是音频");
  assertImageReference(tables.homepage_settings[0].hero_media_id, media, mediaKinds, "首页主图");
  for (const row of tables.albums) assertImageReference(row.cover_media_id, media, mediaKinds, "相册封面");
  for (const row of [...tables.timeline_events, ...tables.wishes]) assertImageReference(row.media_id, media, mediaKinds, "内容配图");
  tables.homepage_blocks.forEach(validateBlockConfig);
}

export function parseBackupManifest(input: unknown): BackupManifest {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("备份清单格式不正确");
  const candidate = input as Record<string, unknown>;
  if (candidate.format !== backupFormat || candidate.version !== backupVersion) throw new Error("备份文件版本不受支持");
  if (typeof candidate.createdAt !== "string" || !isValidTimestamp(candidate.createdAt)) throw new Error("备份创建时间无效");
  if (!candidate.tables || typeof candidate.tables !== "object" || Array.isArray(candidate.tables)) throw new Error("备份数据不完整");

  const rawTables = candidate.tables as Record<string, unknown>;
  const tables = {} as BackupTables;
  for (const [table, columns] of Object.entries(backupTableColumns) as Array<[BackupTableName, readonly string[]]>) {
    const rows = rawTables[table];
    if (!Array.isArray(rows)) throw new Error(`备份缺少数据表：${table}`);
    const schema = rowSchemas[table];
    tables[table] = rows.map((row, index) => {
      if (!row || typeof row !== "object" || Array.isArray(row)) throw new Error(`${table} 第 ${index + 1} 条记录格式不正确`);
      const record = row as Record<string, unknown>;
      if (table === "settings" && !Object.prototype.hasOwnProperty.call(record, "music_autoplay")) record.music_autoplay = 0;
      const missing = columns.find((column) => !Object.prototype.hasOwnProperty.call(record, column));
      if (missing) throw new Error(`${table} 第 ${index + 1} 条记录缺少字段：${missing}`);
      const parsed = schema.safeParse(record);
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        const field = issue?.path[0] ? `.${String(issue.path[0])}` : "";
        throw new Error(`${table}${field} 第 ${index + 1} 条记录格式不正确`);
      }
      return Object.fromEntries(columns.map((column) => [column, record[column] as BackupValue])) as BackupRow;
    });
  }

  if (tables.settings.length !== 1 || tables.homepage_settings.length !== 1) throw new Error("备份缺少网站基础设置");
  validateRelationships(tables);

  return {
    format: backupFormat,
    version: backupVersion,
    createdAt: candidate.createdAt,
    summary: buildBackupSummary(tables),
    tables
  };
}
