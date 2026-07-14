import { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";

function sequelizeDetail(err: unknown): string {
  if (!err || typeof err !== "object") return "";
  const e = err as {
    name?: string;
    message?: string;
    parent?: { code?: string; sqlMessage?: string };
    original?: { code?: string; sqlMessage?: string };
    errors?: Array<{ message?: string; path?: string }>;
  };
  const sqlMsg = e.parent?.sqlMessage || e.original?.sqlMessage;
  const fieldMsgs = e.errors?.map((x) => `${x.path ?? "?"}: ${x.message ?? ""}`).join("; ");
  return [e.name, sqlMsg, fieldMsgs].filter(Boolean).join(" | ");
}

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
  const isUniqueConflict =
    name === "SequelizeUniqueConstraintError" || code === "ER_DUP_ENTRY";

  const statusCode = isDbTimeout
    ? 503
    : isUniqueConflict
      ? 409
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
    const detail = sequelizeDetail(err);
    console.error(
      "[API]",
      message,
      detail ? `(${detail})` : "",
      err instanceof Error ? err.stack : err
    );
  } else if (isDbTimeout) {
    console.warn("[API] DB unavailable:", message);
  } else if (isUniqueConflict) {
    console.warn("[API] Unique constraint:", message, sequelizeDetail(err));
  }

  return res.status(statusCode).json({
    ok: false,
    message: isDbTimeout
      ? "Database is slow or unreachable right now. Please retry in a few seconds."
      : isUniqueConflict
        ? "This record already exists. Please retry."
        : statusCode >= 500
          ? "Server error"
          : message
  });
}
