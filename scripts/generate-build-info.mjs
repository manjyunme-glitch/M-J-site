import { execFileSync } from "node:child_process";
import fs from "node:fs";

const repository = process.env.GITHUB_REPOSITORY || "manjyunme-glitch/M-J-site";
const branch = process.env.GITHUB_BRANCH || "main";

function git(...args) {
  try {
    return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
}

async function githubCommit() {
  const headers = { Accept: "application/vnd.github+json", "User-Agent": "m-j-site-build" };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const response = await fetch(`https://api.github.com/repos/${repository}/commits/${encodeURIComponent(branch)}`, {
    headers,
    signal: AbortSignal.timeout(10000)
  });
  if (!response.ok) throw new Error(`GitHub returned ${response.status}`);
  const data = await response.json();
  return {
    sha: data.sha || "",
    message: data.commit?.message?.split("\n")[0] || "",
    committedAt: data.commit?.committer?.date || data.commit?.author?.date || ""
  };
}

let source = "unknown";
let sha = process.env.APP_COMMIT_SHA || git("rev-parse", "HEAD");
let message = process.env.APP_COMMIT_MESSAGE || (sha ? git("log", "-1", "--format=%s") : "");
let committedAt = process.env.APP_COMMIT_TIME || (sha ? git("log", "-1", "--format=%cI") : "");

if (sha) source = process.env.APP_COMMIT_SHA ? "environment" : "git";
if (!sha) {
  try {
    const remote = await githubCommit();
    ({ sha, message, committedAt } = remote);
    source = "github-build-snapshot";
  } catch (error) {
    console.warn(`Build metadata unavailable: ${error instanceof Error ? error.message : String(error)}`);
  }
}

fs.writeFileSync("build-info.json", JSON.stringify({
  repository,
  branch,
  sha: sha || "",
  message: message || "",
  committedAt: committedAt || "",
  builtAt: new Date().toISOString(),
  source
}, null, 2));
