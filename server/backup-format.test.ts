import assert from "node:assert/strict";
import test from "node:test";
import { backupFormat, backupTableColumns, backupVersion, buildBackupSummary, isSafeStoredFilename, parseBackupManifest, type BackupTables } from "./backup-format.js";

const timestamp = "2026-07-29 10:20:30";
const coreTypes = ["hero", "nextDate", "profiles", "secrets", "contents", "ending"] as const;

function validTables(): BackupTables {
  return {
    settings: [{
      id: 1,
      site_title: "我们的故事",
      subtitle: "纪念册",
      hero_note: "",
      met_date: "2025-05-20",
      together_date: "2026-03-14",
      man_name: "M",
      man_birthday: "1998-11-26",
      woman_name: "J",
      woman_birthday: "1999-11-22",
      music_media_id: 2,
      music_autoplay: 0,
      music_mode: "sequence",
      updated_at: timestamp
    }],
    anniversaries: [{
      id: 1,
      title: "相识纪念日",
      event_date: "2025-05-20",
      annual: 1,
      description: "",
      enabled: 1,
      sort_order: 10,
      created_at: timestamp
    }],
    albums: [{
      id: 1,
      title: "故事的开始",
      event_date: "2025-05-20",
      description: "",
      cover_media_id: 1,
      published: 1,
      sort_order: 10,
      created_at: timestamp
    }],
    media: [
      {
        id: 1,
        album_id: 1,
        kind: "image",
        original_name: "photo.jpg",
        file_path: "photo-original.jpg",
        web_path: "photo-web.webp",
        thumb_path: "photo-thumb.webp",
        mime_type: "image/jpeg",
        display_name: "",
        caption: "",
        taken_date: "2025-05-20",
        image_width: 1200,
        image_height: 800,
        filter_preset: "original",
        playlist_enabled: 0,
        sort_order: 10,
        created_at: timestamp
      },
      {
        id: 2,
        album_id: null,
        kind: "audio",
        original_name: "song.mp3",
        file_path: "song.mp3",
        web_path: null,
        thumb_path: null,
        mime_type: "audio/mpeg",
        display_name: "Song",
        caption: "Artist",
        taken_date: null,
        image_width: null,
        image_height: null,
        filter_preset: "original",
        playlist_enabled: 1,
        sort_order: 20,
        created_at: timestamp
      }
    ],
    homepage_settings: [{
      id: 1,
      hero_eyebrow: "OUR STORY",
      hero_title: "",
      hero_joiner: "与",
      hero_subtitle: "纪念册",
      hero_media_id: 1,
      hero_media_caption: "",
      hero_cta_label: "开始阅读",
      hero_cta_target: "/stories",
      man_quote: "",
      woman_quote: "",
      profiles_intro: "",
      profiles_outro: "",
      next_kicker: "",
      next_prefix: "",
      next_fallback: "",
      secrets_eyebrow: "",
      secrets_title: "",
      secrets_description: "",
      contents_eyebrow: "",
      contents_title: "",
      contents_description: "",
      ending_kicker: "",
      ending_headline: "",
      ending_signature: "",
      updated_at: timestamp
    }],
    homepage_modules: coreTypes.map((module_key, index) => ({ module_key, enabled: 1, sort_order: (index + 1) * 10 })),
    homepage_blocks: [
      ...coreTypes.map((block_type, index) => ({
        id: index + 1,
        block_type,
        enabled: 1,
        sort_order: (index + 1) * 10,
        config_json: "{}",
        created_at: timestamp,
        updated_at: timestamp
      })),
      {
        id: 7,
        block_type: "memoryMatch",
        enabled: 1,
        sort_order: 70,
        config_json: JSON.stringify({ eyebrow: "", title: "记忆配对", description: "", pairs: ["散步", "晚饭"] }),
        created_at: timestamp,
        updated_at: timestamp
      }
    ],
    homepage_secret_cards: [{
      id: 1,
      number_text: "520",
      title: "故事开始",
      body: "第一天",
      accent: "blue",
      reveal_style: "flip",
      enabled: 1,
      sort_order: 10,
      created_at: timestamp
    }],
    timeline_events: [{
      id: 1,
      date_label: "2025.05.20",
      event_date: "2025-05-20",
      title: "相识",
      body: "故事开始",
      media_id: 1,
      published: 1,
      sort_order: 10,
      created_at: timestamp
    }],
    letters: [{
      id: 1,
      title: "一封信",
      body: "正文",
      published: 1,
      sort_order: 10,
      created_at: timestamp,
      updated_at: timestamp
    }],
    wishes: [{
      id: 1,
      title: "一起旅行",
      description: "",
      status: "pending",
      target_date: null,
      completed_date: null,
      media_id: 1,
      sort_order: 10,
      created_at: timestamp
    }]
  };
}

function validManifest(tables = validTables()) {
  return { format: backupFormat, version: backupVersion, createdAt: "2026-07-29T10:20:30.000Z", tables };
}

test("backup filenames must stay inside the media folder", () => {
  assert.equal(isSafeStoredFilename("photo-web.webp"), true);
  assert.equal(isSafeStoredFilename("../photo.webp"), false);
  assert.equal(isSafeStoredFilename("folder/photo.webp"), false);
  assert.equal(isSafeStoredFilename("folder\\photo.webp"), false);
});

test("backup summary counts configurable content", () => {
  const tables = validTables();
  assert.deepEqual(buildBackupSummary(tables, 1024), {
    timeline: 1,
    albums: 1,
    images: 1,
    audio: 1,
    letters: 1,
    wishes: 1,
    anniversaries: 1,
    mediaBytes: 1024
  });
});

test("a complete version 1 backup remains accepted", () => {
  const parsed = parseBackupManifest(validManifest());
  assert.equal(parsed.version, 1);
  assert.equal(parsed.tables.homepage_blocks.length, 7);
  assert.equal(parsed.summary.mediaBytes, 0);
});

test("backup manifest defaults missing music_autoplay for older files", () => {
  const tables = validTables();
  delete tables.settings[0].music_autoplay;
  const parsed = parseBackupManifest(validManifest(tables));
  assert.equal(parsed.tables.settings[0].music_autoplay, 0);
});

test("backup manifest requires every declared table column", () => {
  const tables = validTables();
  delete tables.settings[0].site_title;
  assert.throws(() => parseBackupManifest(validManifest(tables)), /缺少字段：site_title/);
});

test("backup manifest rejects invalid booleans, enums, and calendar dates", () => {
  const invalidBoolean = validTables();
  invalidBoolean.anniversaries[0].annual = 2;
  assert.throws(() => parseBackupManifest(validManifest(invalidBoolean)), /anniversaries\.annual/);

  const invalidEnum = validTables();
  invalidEnum.settings[0].music_mode = "loop";
  assert.throws(() => parseBackupManifest(validManifest(invalidEnum)), /settings\.music_mode/);

  const invalidDate = validTables();
  invalidDate.wishes[0].target_date = "2026-02-30";
  assert.throws(() => parseBackupManifest(validManifest(invalidDate)), /wishes\.target_date/);
});

test("backup manifest rejects unsafe media paths and inconsistent media fields", () => {
  const unsafe = validTables();
  unsafe.media[0].file_path = "../secret";
  assert.throws(() => parseBackupManifest(validManifest(unsafe)), /media\.file_path/);

  const incompleteImage = validTables();
  incompleteImage.media[0].thumb_path = null;
  assert.throws(() => parseBackupManifest(validManifest(incompleteImage)), /照片缺少/);
});

test("backup manifest rejects broken and wrong-kind media references", () => {
  const missing = validTables();
  missing.settings[0].music_media_id = 99;
  assert.throws(() => parseBackupManifest(validManifest(missing)), /不存在/);

  const wrongKind = validTables();
  wrongKind.timeline_events[0].media_id = 2;
  assert.throws(() => parseBackupManifest(validManifest(wrongKind)), /不是照片/);
});

test("interactive homepage blocks must contain their existing configuration schema", () => {
  const tables = validTables();
  tables.homepage_blocks[6].config_json = "{}";
  assert.throws(() => parseBackupManifest(validManifest(tables)), /memoryMatch 配置不完整/);
});

test("fixed homepage modules and blocks must each remain complete", () => {
  const missingLegacyModule = validTables();
  missingLegacyModule.homepage_modules.pop();
  assert.throws(() => parseBackupManifest(validManifest(missingLegacyModule)), /固定首页模块不完整/);

  const missingBlock = validTables();
  missingBlock.homepage_blocks = missingBlock.homepage_blocks.filter((row) => row.block_type !== "ending");
  assert.throws(() => parseBackupManifest(validManifest(missingBlock)), /首页模块数量不正确|固定首页模块/);
});

test("the declared version 1 table list stays covered by the fixture", () => {
  assert.deepEqual(Object.keys(validTables()).sort(), Object.keys(backupTableColumns).sort());
});
