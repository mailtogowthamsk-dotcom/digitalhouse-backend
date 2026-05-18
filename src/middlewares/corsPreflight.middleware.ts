import type { Request, Response, NextFunction } from "express";
import { isAllowedOrigin } from "../config/cors";

const ALLOW_METHODS = "GET,POST,PUT,PATCH,DELETE,OPTIONS";
const ALLOW_HEADERS = "Content-Type, Authorization, X-Admin-Key, Accept";

/**
 * Answer CORS preflight before redirects/503 middleware.
 * Fixes browsers failing when Apache or proxies mishandle OPTIONS.
 */
export function corsPreflightMiddleware(req: Request, res: Response, next: NextFunction): void {
  const origin = req.headers.origin as string | undefined;

  if (origin && isAllowedOrigin(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Access-Control-Allow-Methods", ALLOW_METHODS);
    res.setHeader("Access-Control-Allow-Headers", ALLOW_HEADERS);
    res.setHeader("Access-Control-Max-Age", "86400");
    res.setHeader("Vary", "Origin");
  }

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  next();
}
