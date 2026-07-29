export const backupExportPollIntervalMs = 750;
export const backupExportStartTimeoutMs = 10_000;

export type BackupExportStatusPayload = {
  state: string;
  error?: unknown;
};

export type BackupExportPollDecision =
  | { kind: "wait" }
  | { kind: "complete" }
  | { kind: "error"; message: string };

export function backupExportUrl(id: string) {
  return `/api/admin/backup/export?id=${encodeURIComponent(id)}`;
}

export function backupExportStatusUrl(id: string) {
  return `/api/admin/backup/export/status/${encodeURIComponent(id)}`;
}

export function decideBackupExportPoll(
  payload: BackupExportStatusPayload,
  readyDeadline: number,
  now = Date.now()
): BackupExportPollDecision {
  if (payload.state === "ready") {
    return now < readyDeadline
      ? { kind: "wait" }
      : { kind: "error", message: "备份下载未能启动，请重试。" };
  }
  if (payload.state === "running") return { kind: "wait" };
  if (payload.state === "complete") return { kind: "complete" };
  if (payload.state === "failed") {
    const error = typeof payload.error === "string" ? payload.error.trim() : "";
    return { kind: "error", message: error || "备份导出失败，请重试。" };
  }
  return { kind: "error", message: "无法确认备份导出状态，请重试。" };
}
