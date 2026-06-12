import path from "node:path";
import express from "express";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import { config } from "./config.js";
import { api } from "./routes.js";
import { seedArtwork } from "./seed-artwork.js";
import { backfillMediaDimensions } from "./media.js";

const app = express();
if (config.trustProxy) app.set("trust proxy", 1);

app.disable("x-powered-by");
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "blob:"],
      mediaSrc: ["'self'", "blob:"],
      connectSrc: ["'self'"]
    }
  },
  crossOriginResourcePolicy: { policy: "same-origin" }
}));
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));
app.use(cookieParser(config.cookieSecret));
app.use("/api", api);
app.use("/api", (_req, res) => res.status(404).json({ error: "接口不存在" }));
app.use((error: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (res.headersSent) return next(error);
  const message = error instanceof Error && error.message.includes("JSON") ? "请求内容不是有效的 JSON" : "服务器无法处理该请求";
  res.status(400).json({ error: message });
});

const clientDir = path.resolve(process.cwd(), "dist-client");
app.use(express.static(clientDir, { index: false, maxAge: config.nodeEnv === "production" ? "7d" : 0 }));
app.use((_req, res) => res.sendFile(path.join(clientDir, "index.html")));

await seedArtwork();
await backfillMediaDimensions();

app.listen(config.port, "0.0.0.0", () => {
  console.log(`M × J love journal is listening on http://0.0.0.0:${config.port}`);
});
