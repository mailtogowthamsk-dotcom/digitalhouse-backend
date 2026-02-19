import { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (res.headersSent) return;
  if (err instanceof ZodError) {
    const msg = err.errors?.[0]?.message ?? "Invalid request";
    return res.status(400).json({ ok: false, message: msg });
  }
  const message = err instanceof Error ? err.message : "Server error";
  const status =
    message === "Unauthorized" ? 401
    : message === "User not found" ? 404
    : (err as any)?.status === 404 ? 404
    : (err as any)?.status === 403 ? 403
    : 400;
  const statusCode = status >= 400 && status < 600 ? status : 500;
  return res.status(statusCode).json({ ok: false, message });
}

