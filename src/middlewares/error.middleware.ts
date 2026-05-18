import { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (res.headersSent) return;
  if (err instanceof ZodError) {
    const msg = err.errors?.[0]?.message ?? "Invalid request";
    return res.status(400).json({ ok: false, message: msg });
  }
  const message = err instanceof Error ? err.message : "Server error";
  const explicit = (err as { status?: number })?.status;
  const statusCode =
    explicit === 401 || message === "Unauthorized"
      ? 401
      : explicit === 404 || message === "User not found"
        ? 404
        : explicit === 403
          ? 403
          : explicit === 400
            ? 400
            : explicit != null && explicit >= 400 && explicit < 600
              ? explicit
              : 500;
  return res.status(statusCode).json({ ok: false, message });
}

