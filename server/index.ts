import path from "node:path";
import express from "express";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import { config } from "./config.js";
import { api } from "./routes.js";
import { seedArtwork } from "./seed-artwork.js";
import { backfillMediaDimensions, repairMediaFilenames } from "./media.js";
import { apiErrorHandler, mountClientAssets } from "./http.js";

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

mountClientAssets(app, path.resolve(process.cwd(), "dist-client"), config.nodeEnv === "production");
app.use(apiErrorHandler);

await seedArtwork();
repairMediaFilenames();
await backfillMediaDimensions();

app.listen(config.port, "0.0.0.0", () => {
  console.log(`M × J love journal is listening on http://0.0.0.0:${config.port}`);
});
