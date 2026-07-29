import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";

export type CommitInfo = {
  sha: string;
  message: string;
  committedAt: string;
};

export type BuildInfo = CommitInfo & {
  repository: string;
  branch: string;
  ref: string;
  builtAt: string;
  source: string;
};

export type DeploymentStatus = {
  repository: string;
  branch: string;
  status: "synced" | "outdated" | "unknown";
  current: BuildInfo;
  latest: CommitInfo | null;
  checkedAt: string;
  errorMessage?: string;
};

const emptyBuild = (): BuildInfo => {
  const sha = process.env.APP_COMMIT_SHA?.trim() || "";
  return {
    repository: config.githubRepository,
    branch: config.githubBranch,
    ref: process.env.APP_COMMIT_REF?.trim() || "",
    sha,
    message: process.env.APP_COMMIT_MESSAGE || "",
    committedAt: process.env.APP_COMMIT_DATE?.trim() || process.env.APP_COMMIT_TIME?.trim() || "",
    builtAt: "",
    source: sha ? "environment" : "unknown"
  };
};

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

export function createDeploymentStatus(current: BuildInfo, latest: CommitInfo, checkedAt: string): DeploymentStatus {
  return {
    repository: config.githubRepository,
    branch: config.githubBranch,
    status: compareCommits(current.sha, latest.sha),
    current,
    latest,
    checkedAt
  };
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
    if (!response.ok) {
      const messages: Record<number, string> = {
        401: "GitHub Token 无效或已过期，请在 Portainer 中重新填写 GITHUB_TOKEN",
        403: "GitHub 拒绝访问，请检查 Token 的仓库范围和 Contents: Read-only 权限",
        404: "GitHub 返回 404；私有仓库请确认 Token 已授权访问此仓库"
      };
      throw new Error(messages[response.status] || `GitHub API 返回 ${response.status}`);
    }
    const data = await response.json() as {
      sha?: string;
      commit?: { message?: string; committer?: { date?: string }; author?: { date?: string } };
    };
    const latest = {
      sha: data.sha || "",
      message: data.commit?.message?.split("\n")[0] || "",
      committedAt: data.commit?.committer?.date || data.commit?.author?.date || ""
    };
    return createDeploymentStatus(current, latest, checkedAt);
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
