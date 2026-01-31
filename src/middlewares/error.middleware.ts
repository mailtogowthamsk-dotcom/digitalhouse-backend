import { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ZodError) {
    return res.status(400).json({ ok: false, message: "Validation error", errors: err.flatten() });
  }
  const message = err instanceof Error ? err.message : "Server error";
  const status = message === "Unauthorized" ? 401 : message === "User not found" ? 404 : 400;
  return res.status(status).json({ ok: false, message });
}

