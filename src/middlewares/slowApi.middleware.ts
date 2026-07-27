import type { Request, Response, NextFunction } from "express";

const SLOW_MS = Number(process.env.SLOW_API_MS || 800);

/**
 * Logs requests that exceed SLOW_API_MS (default 800ms).
 * Does not change responses. Enable always in production for ops visibility.
 */
export function slowApiLogger(req: Request, res: Response, next: NextFunction) {
  const start = process.hrtime.bigint();
  res.on("finish", () => {
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    if (ms >= SLOW_MS) {
      console.warn(
        `[slow-api] ${ms.toFixed(0)}ms ${req.method} ${req.originalUrl} status=${res.statusCode}`
      );
    }
  });
  next();
}
