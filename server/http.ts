import path from "node:path";
import express, { type ErrorRequestHandler, type Express } from "express";
import multer from "multer";

type RequestError = Error & {
  code?: string;
  status?: number;
  statusCode?: number;
  type?: string;
};

export class RequestTooLargeError extends Error {
  code = "LIMIT_REQUEST_SIZE";
  status = 413;

  constructor() {
    super("Request body is too large");
    this.name = "RequestTooLargeError";
  }
}

function clientError(error: RequestError) {
  if (error instanceof multer.MulterError) {
    if (error.code === "LIMIT_FILE_SIZE") return { status: 413, message: "文件大小超过限制" };
    if (error.code === "LIMIT_FIELD_VALUE") return { status: 413, message: "表单内容超过限制" };
    if (error.code === "LIMIT_FILE_COUNT" || error.code === "LIMIT_UNEXPECTED_FILE") return { status: 400, message: "上传文件数量或字段不正确" };
    return { status: 400, message: "上传表单格式不正确" };
  }
  if (error.code === "LIMIT_REQUEST_SIZE" || error.type === "entity.too.large" || error.status === 413 || error.statusCode === 413) {
    return { status: 413, message: "请求内容超过大小限制" };
  }
  if (error.type === "entity.parse.failed" || (error instanceof SyntaxError && (error.status === 400 || error.statusCode === 400))) {
    return { status: 400, message: "请求内容不是有效的 JSON" };
  }
  const status = error.statusCode ?? error.status;
  if (typeof status === "number" && Number.isInteger(status) && status >= 400 && status < 500) {
    return { status, message: status === 415 ? "请求内容编码不受支持" : "请求内容格式不正确" };
  }
  return null;
}

export const apiErrorHandler: ErrorRequestHandler = (error: unknown, _req, res, next) => {
  if (res.headersSent) return next(error);
  const normalized = error instanceof Error ? error as RequestError : new Error("Unknown request error");
  const response = clientError(normalized);
  if (response) return res.status(response.status).json({ error: response.message });
  return res.status(500).json({ error: "服务器无法处理该请求" });
};

export function mountClientAssets(app: Express, clientDir: string, production: boolean) {
  app.use("/assets", express.static(path.join(clientDir, "assets"), {
    index: false,
    immutable: production,
    maxAge: production ? "1y" : 0,
    setHeaders(res) {
      if (!production) res.setHeader("Cache-Control", "no-cache");
    }
  }));
  app.use(express.static(clientDir, {
    index: false,
    maxAge: 0,
    setHeaders(res) {
      res.setHeader("Cache-Control", "no-cache");
    }
  }));
  app.use((_req, res) => {
    res.setHeader("Cache-Control", "no-cache");
    res.sendFile(path.join(clientDir, "index.html"));
  });
}
