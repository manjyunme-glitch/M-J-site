import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import { config } from "./config.js";

export const databaseWasEmpty = !fs.existsSync(config.databasePath) || fs.statSync(config.databasePath).size === 0;
export const db = new DatabaseSync(config.databasePath);

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    site_title TEXT NOT NULL,
    subtitle TEXT NOT NULL,
    hero_note TEXT NOT NULL,
    met_date TEXT NOT NULL,
    together_date TEXT NOT NULL,
    man_name TEXT NOT NULL,
    man_birthday TEXT NOT NULL,
    woman_name TEXT NOT NULL,
    woman_birthday TEXT NOT NULL,
    music_media_id INTEGER,
    music_autoplay INTEGER NOT NULL DEFAULT 0,
    music_mode TEXT NOT NULL DEFAULT 'sequence',
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (music_media_id) REFERENCES media(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS anniversaries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    event_date TEXT NOT NULL,
    annual INTEGER NOT NULL DEFAULT 1,
    description TEXT NOT NULL DEFAULT '',
    enabled INTEGER NOT NULL DEFAULT 1,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS albums (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    event_date TEXT,
    description TEXT NOT NULL DEFAULT '',
    cover_media_id INTEGER,
    published INTEGER NOT NULL DEFAULT 1,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS media (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    album_id INTEGER,
    kind TEXT NOT NULL CHECK (kind IN ('image', 'audio')),
    original_name TEXT NOT NULL,
    file_path TEXT NOT NULL,
    web_path TEXT,
    thumb_path TEXT,
    mime_type TEXT NOT NULL,
    display_name TEXT NOT NULL DEFAULT '',
    caption TEXT NOT NULL DEFAULT '',
    taken_date TEXT,
    image_width INTEGER,
    image_height INTEGER,
    filter_preset TEXT NOT NULL DEFAULT 'original',
    playlist_enabled INTEGER NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (album_id) REFERENCES albums(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS homepage_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    hero_eyebrow TEXT NOT NULL,
    hero_title TEXT NOT NULL DEFAULT '',
    hero_joiner TEXT NOT NULL,
    hero_subtitle TEXT NOT NULL,
    hero_media_id INTEGER,
    hero_media_caption TEXT NOT NULL,
    hero_cta_label TEXT NOT NULL,
    hero_cta_target TEXT NOT NULL,
    man_quote TEXT NOT NULL,
    woman_quote TEXT NOT NULL,
    profiles_intro TEXT NOT NULL,
    profiles_outro TEXT NOT NULL,
    next_kicker TEXT NOT NULL,
    next_prefix TEXT NOT NULL,
    next_fallback TEXT NOT NULL,
    secrets_eyebrow TEXT NOT NULL,
    secrets_title TEXT NOT NULL,
    secrets_description TEXT NOT NULL,
    contents_eyebrow TEXT NOT NULL,
    contents_title TEXT NOT NULL,
    contents_description TEXT NOT NULL,
    ending_kicker TEXT NOT NULL,
    ending_headline TEXT NOT NULL,
    ending_signature TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (hero_media_id) REFERENCES media(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS homepage_modules (
    module_key TEXT PRIMARY KEY CHECK (module_key IN ('hero', 'nextDate', 'profiles', 'secrets', 'contents', 'ending')),
    enabled INTEGER NOT NULL DEFAULT 1,
    sort_order INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS homepage_blocks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    block_type TEXT NOT NULL CHECK (block_type IN ('hero', 'nextDate', 'profiles', 'secrets', 'contents', 'ending', 'questionDraw', 'memoryMatch', 'anniversaryDraw')),
    enabled INTEGER NOT NULL DEFAULT 1,
    sort_order INTEGER NOT NULL DEFAULT 0,
    config_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE UNIQUE INDEX IF NOT EXISTS homepage_blocks_singletons
  ON homepage_blocks(block_type)
  WHERE block_type IN ('hero', 'nextDate', 'profiles', 'secrets', 'contents', 'ending');

  CREATE TABLE IF NOT EXISTS homepage_secret_cards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    number_text TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    accent TEXT NOT NULL DEFAULT 'blue' CHECK (accent IN ('blue', 'ticket', 'red')),
    reveal_style TEXT NOT NULL DEFAULT 'flip' CHECK (reveal_style IN ('flip', 'envelope', 'scratch', 'ticket')),
    enabled INTEGER NOT NULL DEFAULT 1,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS timeline_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date_label TEXT NOT NULL,
    event_date TEXT,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    media_id INTEGER,
    published INTEGER NOT NULL DEFAULT 1,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (media_id) REFERENCES media(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS letters (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    published INTEGER NOT NULL DEFAULT 1,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS wishes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed')),
    target_date TEXT,
    completed_date TEXT,
    media_id INTEGER,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (media_id) REFERENCES media(id) ON DELETE SET NULL
  );
`);

const ensureColumn = (table: string, column: string, definition: string) => {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!columns.some((item) => item.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
};

ensureColumn("albums", "event_date", "TEXT");
ensureColumn("media", "display_name", "TEXT NOT NULL DEFAULT ''");
ensureColumn("media", "image_width", "INTEGER");
ensureColumn("media", "image_height", "INTEGER");
ensureColumn("media", "filter_preset", "TEXT NOT NULL DEFAULT 'original'");
ensureColumn("media", "playlist_enabled", "INTEGER NOT NULL DEFAULT 0");
ensureColumn("settings", "music_mode", "TEXT NOT NULL DEFAULT 'sequence'");
ensureColumn("settings", "music_autoplay", "INTEGER NOT NULL DEFAULT 0");
ensureColumn("homepage_secret_cards", "reveal_style", "TEXT NOT NULL DEFAULT 'flip'");

const seedSettings = db.prepare(`
  INSERT OR IGNORE INTO settings (
    id, site_title, subtitle, hero_note, met_date, together_date,
    man_name, man_birthday, woman_name, woman_birthday
  ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
seedSettings.run(
  "M × J · 我们的故事",
  "从 520 的巧合，到每一次认真选择彼此",
  "平淡的下午、晚饭后的散步，还有那些终于说出口的话，都值得被好好记住。",
  "2025-05-20",
  "2026-03-14",
  "ManJyun",
  "1998-11-26",
  "Jshaorii",
  "1999-11-22"
);

const legacyMusic = db.prepare("SELECT music_media_id AS musicMediaId FROM settings WHERE id = 1").get() as { musicMediaId: number | null };
const enabledMusicCount = Number((db.prepare("SELECT COUNT(*) AS count FROM media WHERE kind = 'audio' AND playlist_enabled = 1").get() as { count: number }).count);
if (legacyMusic.musicMediaId && enabledMusicCount === 0) {
  db.prepare("UPDATE media SET playlist_enabled = 1 WHERE id = ? AND kind = 'audio'").run(legacyMusic.musicMediaId);
}

const currentSettings = db.prepare("SELECT subtitle FROM settings WHERE id = 1").get() as { subtitle: string };

db.prepare(`
  INSERT OR IGNORE INTO homepage_settings (
    id, hero_eyebrow, hero_title, hero_joiner, hero_subtitle, hero_media_caption,
    hero_cta_label, hero_cta_target, man_quote, woman_quote, profiles_intro, profiles_outro,
    next_kicker, next_prefix, next_fallback, secrets_eyebrow, secrets_title, secrets_description,
    contents_eyebrow, contents_title, contents_description, ending_kicker, ending_headline, ending_signature
  ) VALUES (1, ?, '', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`).run(
  "OUR LITTLE ARCHIVE · NO. 0520",
  "与",
  currentSettings.subtitle,
  "红与蓝，牵住同一颗心",
  "从第一页开始",
  "/stories",
  "会慢慢学会，把在意说得更清楚。",
  "认真感受，也认真期待被坚定选择。",
  "两个普通的人",
  "写一本不普通的故事",
  "NEXT PAGE",
  "距离",
  "今天也值得被纪念。",
  "THREE SECRET NUMBERS",
  "故事留下的暗号",
  "有些数字，只有我们知道它为什么特别。",
  "CONTENTS",
  "每段记忆，都有自己的页面",
  "首页只保留最近的线索，完整内容放进各自的章节里。",
  "故事没有写完。",
  "下一页，还是我们。",
  "MANJYUN × JSHAORII · 2025—FOREVER"
);

const count = (table: string) => Number((db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count);

if (count("homepage_modules") === 0) {
  const insert = db.prepare("INSERT INTO homepage_modules (module_key, enabled, sort_order) VALUES (?, 1, ?)");
  ["hero", "nextDate", "profiles", "secrets", "contents", "ending"].forEach((key, index) => insert.run(key, (index + 1) * 10));
}

if (count("homepage_blocks") === 0) {
  const insert = db.prepare("INSERT INTO homepage_blocks (block_type, enabled, sort_order, config_json) VALUES (?, ?, ?, '{}')");
  const legacyModules = db.prepare("SELECT module_key, enabled, sort_order FROM homepage_modules ORDER BY sort_order").all() as Array<{ module_key: string; enabled: number; sort_order: number }>;
  legacyModules.forEach((module) => insert.run(module.module_key, module.enabled, module.sort_order));
}

if (count("homepage_secret_cards") === 0) {
  const insert = db.prepare("INSERT INTO homepage_secret_cards (number_text, title, body, accent, enabled, sort_order) VALUES (?, ?, ?, ?, 1, ?)");
  insert.run("520", "故事开始的日子", "加上微信的那一天。是巧合，还是故事提前写好的第一行？", "blue", 10);
  insert.run("167", "奶茶小票", "取餐号码落在手里，刚好聊到那些还没开窍的感情。粤语里，它好像还藏着另一句话。", "ticket", 20);
  insert.run("3·14", "终于说出口", "鼓起勇气表白以后才知道，原来这一天也是白色情人节。", "red", 30);
}

if (count("anniversaries") === 0) {
  const insert = db.prepare("INSERT INTO anniversaries (title, event_date, annual, description, enabled, sort_order) VALUES (?, ?, ?, ?, 1, ?)");
  insert.run("相识纪念日", "2025-05-20", 1, "微信里出现彼此名字的那一天，也是 520。", 10);
  insert.run("恋爱纪念日", "2026-03-14", 1, "鼓起勇气说出口，也刚好是白色情人节。", 20);
  insert.run("ManJyun 的生日", "1998-11-26", 1, "今天要把他放在最重要的位置。", 30);
  insert.run("Jshaorii 的生日", "1999-11-22", 1, "今天只负责让她开心。", 40);
}

if (count("timeline_events") === 0) {
  const insert = db.prepare("INSERT INTO timeline_events (date_label, event_date, title, body, published, sort_order) VALUES (?, ?, ?, ?, 1, ?)");
  const events = [
    ["2025.05.20", "2025-05-20", "故事从 520 开始", "我们在微信上加上了彼此。偏偏是 520，这个日子是巧合，还是故事提前留下的暗号？"],
    ["相识后的第一个周末", null, "号码 167 的奶茶", "第一次见面，我们点了奶茶。我去取餐时拿到号码 167，当时还刚好聊起我那些尚未开窍的旧故事。这个号码，后来越想越像一句藏在粤语里的玩笑。"],
    ["许多个普通下午", null, "平淡得刚刚好", "下午见面，散步或玩游戏；晚上吃饭，饭后再走一段路，然后各自回家。没有惊天动地，却一点一点习惯了身边有彼此。"],
    ["2026.02.14", "2026-02-14", "那天没有说出口", "我原本想在这一天表白。也许时机还没到，也许你刚好不舒服。那句准备好的话，被我暂时留到了下一个更合适的日子。"],
    ["2026.03.14", "2026-03-14", "白色情人节的答案", "一起出来的这一天，我终于鼓起勇气表白。后来才知道，3 月 14 日也是白色情人节。又一次刚刚好的巧合，像是天意替我选了日期。"],
    ["2026.05.16", "2026-05-16", "差一点错过彼此", "唱完 K、吃过久违的天妇罗，散步时我们第一次认真面对“不合适”的可能。关于与异性的边界，我曾把顺路载同事看成小事，却没有理解它带给你的不安；而一些重要感受没有及时说出口，也在独处时越积越重。那晚我们没有仓促结束，而是选择先回去想清楚。"],
    ["2026.05.17", "2026-05-17", "把心里话好好说完", "第二天，我主动再约你出来，把最真实的重视和认真说给你听。我们都看见了需要改变的地方：清晰的边界、及时的沟通，以及不要让对方猜自己在心里的位置。我们选择继续，不是因为没发生过问题，而是愿意一起解决。"],
    ["2026.05.20", "2026-05-20", "一周年的红与蓝", "相识一周年，又是 520。我送给你一条爱心项链，一蓝一红。你的那一半是红色，从此红蓝不只是颜色，也是我们认真牵住彼此的记号。"]
  ] as const;
  events.forEach((event, index) => insert.run(event[0], event[1], event[2], event[3], (index + 1) * 10));
}

if (count("albums") === 0) {
  const insert = db.prepare("INSERT INTO albums (title, event_date, description, published, sort_order) VALUES (?, ?, ?, 1, ?)");
  insert.run("故事的开始", "2025-05-20", "奶茶、散步和那些普通却珍贵的下午。", 10);
  insert.run("成为我们以后", "2026-03-14", "从 3·14 开始，收藏每一个共同画面。", 20);
}

if (count("letters") === 0) {
  db.prepare("INSERT INTO letters (title, body, published, sort_order) VALUES (?, ?, 1, 10)").run(
    "写给 Jshaorii",
    "有些感情不是因为一直顺利才珍贵，而是在看见彼此的不安和不足以后，仍愿意认真靠近。\n\n谢谢你没有让我们的故事停在 2026 年 5 月 16 日。以后我会更清楚地守住边界，也会更及时地让你知道：你在我心里从来不是可以淡淡放下的人。\n\n愿我们还有很多平淡的下午，很多顿晚饭，很多段饭后的散步。"
  );
}

if (count("wishes") === 0) {
  const insert = db.prepare("INSERT INTO wishes (title, description, status, sort_order) VALUES (?, ?, 'pending', ?)");
  insert.run("一起看一次日出", "在天亮以前出发，带上热饮和相机。", 10);
  insert.run("去一座没去过的城市", "不赶行程，只慢慢散步和吃喜欢的东西。", 20);
  insert.run("拍一组真正属于我们的照片", "以后替换掉这里的插画占位，留下真实的我们。", 30);
}

export function camelizeRow(row: unknown): unknown {
  if (Array.isArray(row)) return row.map(camelizeRow);
  if (!row || typeof row !== "object") return row;
  return Object.fromEntries(Object.entries(row as Record<string, unknown>).map(([key, value]) => [
    key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase()),
    value
  ]));
}
