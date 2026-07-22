import cors from "cors";
import express, { type Express } from "express";
import "./config/env";
import { getApiMountPaths } from "./config/apiPath";
import { corsOptions } from "./config/cors";
import { corsPreflightMiddleware } from "./middlewares/corsPreflight.middleware";
import { asyncHandler } from "./middlewares/asyncHandler";
import { apiRouter } from "./routes";
import { errorHandler } from "./middlewares/error.middleware";
import { dbReady, dbFailed } from "./state";
import { razorpayWebhook } from "./controllers/MatrimonyPayment.controller";

export const app = express();

// Required behind Railway (or any reverse proxy): express-rate-limit needs req.ip from X-Forwarded-For
app.set("trust proxy", 1);

// Preflight first (before JSON parser and DB gate)
app.use(corsPreflightMiddleware);
app.use(cors(corsOptions));
app.options(/.*/, cors(corsOptions));

// Razorpay webhook needs raw body for signature verification (before express.json)
for (const mount of getApiMountPaths()) {
  app.post(
    `${mount}/matrimony/payments/webhook`,
    express.raw({ type: "application/json" }),
    asyncHandler(razorpayWebhook)
  );
}

app.use(express.json({ limit: process.env.JSON_BODY_LIMIT || "4mb" }));

// Root: some platforms hit / for health – respond quickly so Railway sees the app as up
app.get("/", (_req, res) => {
  res.status(200).json({ ok: true, service: "Digital House API" });
});

// Railway healthcheck: GET /health must return 200 so deploy succeeds (also accept /health/)
app.get(["/health", "/health/"], (_req, res) => {
  res.status(200).json({ ok: true });
});

const shouldLogRequests =
  process.env.LOG_REQUESTS === "true" || process.env.NODE_ENV === "development";

function registerApiMounts(application: Express, mount: string) {
  const healthPath = `${mount}/health`;

  application.get(healthPath, (_req, res) => {
    res.status(200).json({ ok: true, ready: dbReady, dbFailed });
  });

  application.use(mount, (req, res, next) => {
    if (req.method === "OPTIONS") return next();
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

  application.use(
    mount,
    (req, _res, next) => {
      if (shouldLogRequests) {
        console.log(`[${new Date().toISOString()}] ${req.method} ${mount}${req.path}`);
      }
      next();
    },
    apiRouter
  );
}

for (const mount of getApiMountPaths()) {
  registerApiMounts(app, mount);
}

app.use(errorHandler);
