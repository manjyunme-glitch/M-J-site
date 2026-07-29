import { execFileSync } from "node:child_process";
import fs from "node:fs";

const repository = process.env.GITHUB_REPOSITORY || "manjyunme-glitch/M-J-site";
const branch = process.env.GITHUB_BRANCH || "main";
const injectedSha = process.env.APP_COMMIT_SHA?.trim() || "";
const injectedDate = process.env.APP_COMMIT_DATE?.trim() || process.env.APP_COMMIT_TIME?.trim() || "";
const injectedRef = process.env.APP_COMMIT_REF?.trim() || "";

function git(...args) {
  try {
    return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
}

const gitSha = injectedSha ? "" : git("rev-parse", "HEAD");
const gitDirty = Boolean(gitSha && git("status", "--porcelain", "--untracked-files=normal"));
let source = "unknown";
const sha = injectedSha || (gitDirty ? "" : gitSha);
const message = process.env.APP_COMMIT_MESSAGE || (sha ? git("log", "-1", "--format=%s", sha) : "");
const committedAt = injectedDate || (sha ? git("log", "-1", "--format=%cI", sha) : "");
const ref = injectedRef || (sha ? git("symbolic-ref", "--quiet", "--short", "HEAD") : "");

if (sha) source = injectedSha ? "build-args" : "git";
else if (gitDirty) {
  source = "git-dirty";
  console.warn("Build metadata is not comparable because the Git worktree has uncommitted source");
}
else console.warn("Build metadata unavailable: provide APP_COMMIT_SHA when the build context has no Git metadata");

fs.writeFileSync("build-info.json", JSON.stringify({
  repository,
  branch,
  ref,
  sha: sha || "",
  message: message || "",
  committedAt: committedAt || "",
  builtAt: new Date().toISOString(),
  source
}, null, 2));
