import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import { isCorsOriginAllowed } from "./config/cors";
import { env } from "./config/env";
import { leadsRouter } from "./routes/leads.routes";
import { errorHandler } from "./middlewares/errorHandler";
import { notFoundHandler } from "./middlewares/notFoundHandler";

export function createApp() {
  const app = express();

  app.use(helmet());
  app.use(
    cors({
      origin: (origin, callback) => {
        callback(null, isCorsOriginAllowed(origin, env.CORS_ORIGINS) ? origin : false);
      },
      credentials: true,
      methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"],
      allowedHeaders: ["Authorization", "Content-Type"],
      optionsSuccessStatus: 204,
    }),
  );
  app.options("*", (_req, res) => res.sendStatus(204));
  app.use(express.json({ limit: "1mb" }));
  app.use(morgan(env.NODE_ENV === "production" ? "combined" : "dev"));

  app.get("/health", (_req, res) => {
    res.json({ success: true, data: { status: "ok", uptime: process.uptime() } });
  });

  app.use("/api/leads", leadsRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
