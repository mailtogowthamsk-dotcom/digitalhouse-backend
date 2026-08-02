import cors from "cors";
import compression from "compression";
import helmet from "helmet";
import express, { type Express } from "express";
import "./config/env";
import { getApiMountPaths } from "./config/apiPath";
import { corsOptions } from "./config/cors";
import { corsPreflightMiddleware } from "./middlewares/corsPreflight.middleware";
import { asyncHandler } from "./middlewares/asyncHandler";
import { apiRouter } from "./routes";
import { errorHandler } from "./middlewares/error.middleware";
import { apiLimiter } from "./middlewares/rateLimit.middleware";
import { slowApiLogger } from "./middlewares/slowApi.middleware";
import { dbReady, dbFailed } from "./state";
import { razorpayWebhook } from "./controllers/MatrimonyPayment.controller";
import { getDbPoolSnapshot, DB_POOL_CONFIG } from "./config/db";
import { getPoolDebugCounters } from "./config/dbPoolMonitor";

export const app = express();

// Required behind Railway (or any reverse proxy): express-rate-limit needs req.ip from X-Forwarded-For
app.set("trust proxy", 1);

// Preflight first (before JSON parser and DB gate)
app.use(corsPreflightMiddleware);
app.use(cors(corsOptions));
app.options(/.*/, cors(corsOptions));

app.use(
  helmet({
    // API returns JSON — deny document embedding; keep CORP cross-origin for mobile/CDN clients
    contentSecurityPolicy:
      process.env.NODE_ENV === "production"
        ? {
            useDefaults: false,
            directives: {
              defaultSrc: ["'none'"],
              frameAncestors: ["'none'"],
              baseUri: ["'none'"],
              formAction: ["'none'"]
            }
          }
        : false,
    crossOriginResourcePolicy: { policy: "cross-origin" },
    crossOriginOpenerPolicy: { policy: "same-origin" },
    crossOriginEmbedderPolicy: false,
    originAgentCluster: true,
    referrerPolicy: { policy: "no-referrer" },
    frameguard: { action: "deny" },
    hidePoweredBy: true,
    ieNoOpen: true,
    noSniff: true,
    xssFilter: false,
    hsts:
      process.env.NODE_ENV === "production"
        ? { maxAge: 31536000, includeSubDomains: true, preload: true }
        : false,
    permittedCrossDomainPolicies: { permittedPolicies: "none" }
  })
);

// Permissions-Policy (Helmet 8 does not bundle this middleware)
app.use((_req, res, next) => {
  res.setHeader(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()"
  );
  next();
});

// Gzip JSON/API responses (skip already-compressed payloads)
app.use(
  compression({
    filter: (req, res) => {
      if (req.headers["x-no-compression"]) return false;
      return compression.filter(req, res);
    },
    threshold: 1024
  })
);

// Razorpay webhook needs raw body for signature verification (before express.json)
for (const mount of getApiMountPaths()) {
  app.post(
    `${mount}/matrimony/payments/webhook`,
    express.raw({ type: "application/json" }),
    asyncHandler(razorpayWebhook)
  );
}

app.use(express.json({ limit: process.env.JSON_BODY_LIMIT || "4mb" }));
app.use(slowApiLogger);

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
    const body: Record<string, unknown> = { ok: true, ready: dbReady, dbFailed };
    if (process.env.DB_POOL_DEBUG === "true") {
      body.pool = getDbPoolSnapshot();
      body.poolConfig = DB_POOL_CONFIG;
      body.poolCounters = getPoolDebugCounters();
    }
    res.status(200).json(body);
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
      const isGoogleAuth = req.path === "/auth/google" || req.path.endsWith("/auth/google");
      if (shouldLogRequests || isGoogleAuth) {
        console.log(`[${new Date().toISOString()}] ${req.method} ${mount}${req.path}`);
      }
      next();
    },
    apiLimiter,
    apiRouter
  );
}

for (const mount of getApiMountPaths()) {
  registerApiMounts(app, mount);
}

app.use(errorHandler);
