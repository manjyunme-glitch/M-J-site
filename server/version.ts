import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";

type CommitInfo = {
  sha: string;
  message: string;
  committedAt: string;
};

type BuildInfo = CommitInfo & {
  repository: string;
  branch: string;
  builtAt: string;
  source: string;
};

type SavedBaseline = CommitInfo & { buildId: string };

export type DeploymentStatus = {
  repository: string;
  branch: string;
  status: "synced" | "outdated" | "unknown";
  current: BuildInfo;
  latest: CommitInfo | null;
  checkedAt: string;
  errorMessage?: string;
};

const emptyBuild = (): BuildInfo => ({
  repository: config.githubRepository,
  branch: config.githubBranch,
  sha: process.env.APP_COMMIT_SHA || "",
  message: process.env.APP_COMMIT_MESSAGE || "",
  committedAt: process.env.APP_COMMIT_TIME || "",
  builtAt: "",
  source: process.env.APP_COMMIT_SHA ? "environment" : "unknown"
});

export function readBuildInfo(): BuildInfo {
  const filePath = path.resolve(process.cwd(), "build-info.json");
  if (!fs.existsSync(filePath)) return emptyBuild();
  try {
    return { ...emptyBuild(), ...JSON.parse(fs.readFileSync(filePath, "utf8")) } as BuildInfo;
  } catch {
    return emptyBuild();
  }
}

export function compareCommits(currentSha: string, latestSha: string): DeploymentStatus["status"] {
  if (!currentSha || !latestSha) return "unknown";
  return currentSha === latestSha ? "synced" : "outdated";
}

function baselinePath() {
  return path.join(path.dirname(config.databasePath), "deployment-version.json");
}

function resolveCurrentBuild(current: BuildInfo, latest: CommitInfo): BuildInfo {
  if (current.sha) return current;
  const buildId = current.builtAt || "development";
  try {
    const saved = JSON.parse(fs.readFileSync(baselinePath(), "utf8")) as SavedBaseline;
    if (saved.buildId === buildId && saved.sha) return { ...current, ...saved, source: "runtime-baseline" };
  } catch {
    // A missing baseline is expected on the first run of a new image.
  }
  const baseline = { ...latest, buildId };
  fs.writeFileSync(baselinePath(), JSON.stringify(baseline, null, 2));
  return { ...current, ...latest, source: "runtime-baseline" };
}

export async function getDeploymentStatus(): Promise<DeploymentStatus> {
  const current = readBuildInfo();
  const checkedAt = new Date().toISOString();
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "m-j-site-update-check"
  };
  if (config.githubToken) headers.Authorization = `Bearer ${config.githubToken}`;

  try {
    const response = await fetch(`https://api.github.com/repos/${config.githubRepository}/commits/${encodeURIComponent(config.githubBranch)}`, {
      headers,
      signal: AbortSignal.timeout(10000)
    });
    if (!response.ok) throw new Error(response.status === 404 ? "GitHub 返回 404；私有仓库请配置只读 GITHUB_TOKEN" : `GitHub API 返回 ${response.status}`);
    const data = await response.json() as {
      sha?: string;
      commit?: { message?: string; committer?: { date?: string }; author?: { date?: string } };
    };
    const latest = {
      sha: data.sha || "",
      message: data.commit?.message?.split("\n")[0] || "",
      committedAt: data.commit?.committer?.date || data.commit?.author?.date || ""
    };
    const resolvedCurrent = resolveCurrentBuild(current, latest);
    return {
      repository: config.githubRepository,
      branch: config.githubBranch,
      status: compareCommits(resolvedCurrent.sha, latest.sha),
      current: resolvedCurrent,
      latest,
      checkedAt
    };
  } catch (error) {
    return {
      repository: config.githubRepository,
      branch: config.githubBranch,
      status: "unknown",
      current,
      latest: null,
      checkedAt,
      errorMessage: error instanceof Error ? error.message : "无法连接 GitHub"
    };
  }
}
