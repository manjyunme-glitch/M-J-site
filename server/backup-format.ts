export const backupFormat = "m-j-site-backup" as const;
export const backupVersion = 1 as const;

export const backupTableColumns = {
  settings: ["id", "site_title", "subtitle", "hero_note", "met_date", "together_date", "man_name", "man_birthday", "woman_name", "woman_birthday", "music_media_id", "music_mode", "updated_at"],
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

function validateRelationships(tables: BackupTables) {
  const albums = numericIds("albums", tables.albums);
  const media = numericIds("media", tables.media);
  for (const table of ["anniversaries", "homepage_blocks", "homepage_secret_cards", "timeline_events", "letters", "wishes"] as BackupTableName[]) numericIds(table, tables[table]);
  if (tables.settings[0].id !== 1 || tables.homepage_settings[0].id !== 1) throw new Error("备份基础设置 ID 不正确");

  const mediaKinds = new Map(tables.media.map((row) => [row.id, row.kind]));
  tables.media.forEach((row) => {
    if (row.kind !== "image" && row.kind !== "audio") throw new Error("备份包含未知媒体类型");
    assertReference(row.album_id, albums, "媒体相册");
  });
  assertReference(tables.settings[0].music_media_id, media, "背景音乐");
  if (tables.settings[0].music_media_id !== null && mediaKinds.get(tables.settings[0].music_media_id) !== "audio") throw new Error("背景音乐引用的不是音频");
  assertReference(tables.homepage_settings[0].hero_media_id, media, "首页主图");
  if (tables.homepage_settings[0].hero_media_id !== null && mediaKinds.get(tables.homepage_settings[0].hero_media_id) !== "image") throw new Error("首页主图引用的不是照片");
  for (const row of tables.albums) assertReference(row.cover_media_id, media, "相册封面");
  for (const row of [...tables.timeline_events, ...tables.wishes]) assertReference(row.media_id, media, "内容配图");
  for (const row of tables.homepage_blocks) {
    if (typeof row.config_json !== "string") throw new Error("首页模块配置格式不正确");
    try { JSON.parse(row.config_json); } catch { throw new Error("首页模块配置不是有效 JSON"); }
  }
}

export function parseBackupManifest(input: unknown): BackupManifest {
  if (!input || typeof input !== "object") throw new Error("备份清单格式不正确");
  const candidate = input as Record<string, unknown>;
  if (candidate.format !== backupFormat || candidate.version !== backupVersion) throw new Error("备份文件版本不受支持");
  if (typeof candidate.createdAt !== "string" || Number.isNaN(Date.parse(candidate.createdAt))) throw new Error("备份创建时间无效");
  if (!candidate.tables || typeof candidate.tables !== "object") throw new Error("备份数据不完整");

  const rawTables = candidate.tables as Record<string, unknown>;
  const tables = {} as BackupTables;
  for (const [table, columns] of Object.entries(backupTableColumns) as Array<[BackupTableName, readonly string[]]>) {
    const rows = rawTables[table];
    if (!Array.isArray(rows)) throw new Error(`备份缺少数据表：${table}`);
    tables[table] = rows.map((row, index) => {
      if (!row || typeof row !== "object" || Array.isArray(row)) throw new Error(`${table} 第 ${index + 1} 条记录格式不正确`);
      const record = row as Record<string, unknown>;
      const normalized: BackupRow = {};
      for (const column of columns) {
        const value = record[column];
        if (value !== null && typeof value !== "string" && typeof value !== "number") throw new Error(`${table}.${column} 包含无效数据`);
        normalized[column] = value ?? null;
      }
      return normalized;
    });
  }

  if (tables.settings.length !== 1 || tables.homepage_settings.length !== 1) throw new Error("备份缺少网站基础设置");
  const mediaPaths = tables.media.flatMap((row) => [row.file_path, row.web_path, row.thumb_path]).filter((value): value is string => typeof value === "string" && value.length > 0);
  if (!mediaPaths.every(isSafeStoredFilename)) throw new Error("备份包含不安全的媒体路径");
  validateRelationships(tables);

  return {
    format: backupFormat,
    version: backupVersion,
    createdAt: candidate.createdAt,
    summary: buildBackupSummary(tables),
    tables
  };
}
