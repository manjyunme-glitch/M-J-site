import assert from "node:assert/strict";
import test from "node:test";
import {
  backupExportStartTimeoutMs,
  backupExportStatusUrl,
  backupExportUrl,
  decideBackupExportPoll
} from "../src/backup-export.ts";

test("backup export URLs reuse the same encoded request id", () => {
  const id = "request id/1";
  assert.equal(backupExportUrl(id), "/api/admin/backup/export?id=request%20id%2F1");
  assert.equal(backupExportStatusUrl(id), "/api/admin/backup/export/status/request%20id%2F1");
});

test("ready has a bounded startup window while running can wait without a deadline", () => {
  const startedAt = 1_000;
  const deadline = startedAt + backupExportStartTimeoutMs;
  assert.deepEqual(decideBackupExportPoll({ state: "ready" }, deadline, deadline - 1), { kind: "wait" });
  assert.deepEqual(decideBackupExportPoll({ state: "ready" }, deadline, deadline), {
    kind: "error",
    message: "备份下载未能启动，请重试。"
  });
  assert.deepEqual(decideBackupExportPoll({ state: "running" }, deadline, deadline + 60_000), { kind: "wait" });
});

test("terminal export states produce an explicit completion or safe error", () => {
  assert.deepEqual(decideBackupExportPoll({ state: "complete" }, 0, 0), { kind: "complete" });
  assert.deepEqual(decideBackupExportPoll({ state: "failed", error: "导出文件写入失败" }, 0, 0), {
    kind: "error",
    message: "导出文件写入失败"
  });
  assert.deepEqual(decideBackupExportPoll({ state: "failed" }, 0, 0), {
    kind: "error",
    message: "备份导出失败，请重试。"
  });
  assert.deepEqual(decideBackupExportPoll({ state: "unexpected" }, 0, 0), {
    kind: "error",
    message: "无法确认备份导出状态，请重试。"
  });
});
