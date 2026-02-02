import cors from "cors";
import express from "express";
import "./config/env";
import { apiRouter } from "./routes";
import { errorHandler } from "./middlewares/error.middleware";
import { dbReady, dbFailed } from "./state";

export const app = express();

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

// Root: some platforms hit / for health – respond quickly so Railway sees the app as up
app.get("/", (_req, res) => {
  res.status(200).json({ ok: true, service: "Digital House API" });
});

// Railway healthcheck uses GET /health (no /api) – must return 200 so deploy succeeds
app.get("/health", (_req, res) => {
  res.status(200).json({ ok: true });
});

// Health check: responds immediately so Railway doesn't show "Application Failed to respond"
app.get("/api/health", (_req, res) => {
  res.status(200).json({ ok: true, ready: dbReady, dbFailed });
});

// Return 503 until DB is ready (cold start) or if DB failed; mobile can retry
app.use("/api", (req, res, next) => {
  if (req.path === "/health" || req.path === "/landing") return next();
  if (!dbReady) {
    return res.status(503).json({
      ok: false,
      message: dbFailed
        ? "Database unavailable. Please check server configuration."
        : "Server is starting up. Please try again in a few seconds."
    });
  }
  next();
});

// Log every API request so you can see if the phone hits the backend
app.use("/api", (req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
}, apiRouter);

app.use(errorHandler);

