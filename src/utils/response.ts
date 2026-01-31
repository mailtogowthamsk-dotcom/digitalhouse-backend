import { Response } from "express";

/** Standard success response */
export function success(res: Response, data: object, status = 200) {
  return res.status(status).json({ ok: true, ...data });
}

/** Standard error response */
export function error(res: Response, message: string, status = 400) {
  return res.status(status).json({ ok: false, message });
}
