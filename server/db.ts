import { DatabaseSync } from "node:sqlite";
import { config } from "./config.js";

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
    caption TEXT NOT NULL DEFAULT '',
    taken_date TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (album_id) REFERENCES albums(id) ON DELETE CASCADE
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

const count = (table: string) => Number((db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count);

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
  const insert = db.prepare("INSERT INTO albums (title, description, published, sort_order) VALUES (?, ?, 1, ?)");
  insert.run("故事的开始", "奶茶、散步和那些普通却珍贵的下午。", 10);
  insert.run("成为我们以后", "从 3·14 开始，收藏每一个共同画面。", 20);
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
