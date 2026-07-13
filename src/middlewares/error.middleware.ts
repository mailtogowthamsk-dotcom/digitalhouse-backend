import { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (res.headersSent) return;
  if (err instanceof ZodError) {
    const msg = err.errors?.[0]?.message ?? "Invalid request";
    return res.status(400).json({ ok: false, message: msg });
  }
  const message = err instanceof Error ? err.message : "Server error";
  const name = err instanceof Error ? err.name : "";
  const explicit = (err as { status?: number; parent?: { code?: string }; code?: string })?.status;
  const code =
    (err as { code?: string })?.code ||
    (err as { parent?: { code?: string } })?.parent?.code ||
    "";
  const isDbTimeout =
    /ETIMEDOUT|ECONNRESET|ECONNREFUSED|Protocol loss|Connection lost|SequelizeConnection/i.test(
      `${message} ${name} ${code}`
    );

  const statusCode = isDbTimeout
    ? 503
    : explicit === 401 || message === "Unauthorized"
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

  if (statusCode >= 500) {
    console.error("[API]", message, err instanceof Error ? err.stack : err);
  } else if (isDbTimeout) {
    console.warn("[API] DB unavailable:", message);
  }

  return res.status(statusCode).json({
    ok: false,
    message: isDbTimeout
      ? "Database is slow or unreachable right now. Please retry in a few seconds."
      : statusCode >= 500
        ? "Server error"
        : message
  });
}

