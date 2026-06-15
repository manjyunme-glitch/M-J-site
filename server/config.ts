import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

function loadDotEnv(filePath: string) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index < 1) continue;
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim().replace(/^['"]|['"]$/g, "");
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadDotEnv(path.resolve(process.cwd(), ".env"));

const required = (key: string) => {
  const value = process.env[key];
  if (!value) throw new Error(`Missing required environment variable: ${key}`);
  return value;
};

const requiredHash = (key: string) => required(key).replaceAll("$$", "$");

export const config = {
  port: Number(process.env.PORT || 1314),
  nodeEnv: process.env.NODE_ENV || "development",
  timezone: process.env.TZ || "Asia/Shanghai",
  databasePath: path.resolve(process.env.DATABASE_PATH || "./data/love-journal.db"),
  uploadDir: path.resolve(process.env.UPLOAD_DIR || "./uploads"),
  backupStagingDir: path.resolve(process.env.BACKUP_STAGING_DIR || path.join(path.dirname(process.env.DATABASE_PATH || "./data/love-journal.db"), "backup-staging")),
  cookieSecret: process.env.COOKIE_SECRET || crypto.randomBytes(32).toString("hex"),
  sitePasswordHash: requiredHash("SITE_PASSWORD_HASH"),
  adminPasswordHash: requiredHash("ADMIN_PASSWORD_HASH"),
  secureCookies: process.env.SECURE_COOKIES === "true",
  trustProxy: process.env.TRUST_PROXY === "true",
  githubRepository: process.env.GITHUB_REPOSITORY?.trim() || "manjyunme-glitch/M-J-site",
  githubBranch: process.env.GITHUB_BRANCH?.trim() || "main",
  githubToken: process.env.GITHUB_TOKEN?.trim() || ""
};

fs.mkdirSync(path.dirname(config.databasePath), { recursive: true });
fs.mkdirSync(config.uploadDir, { recursive: true });
fs.mkdirSync(config.backupStagingDir, { recursive: true });
