import type { CorsOptions } from "cors";

/**
 * Allowed browser origins for admin web + Expo web.
 * Set CORS_ORIGINS in .env (comma-separated) for extra hosts.
 */
const EXTRA_ORIGINS = (process.env.CORS_ORIGINS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const DEFAULT_ORIGINS = [
  "https://www.infosensetechnologies.com",
  "https://infosensetechnologies.com",
  "http://www.infosensetechnologies.com",
  "http://infosensetechnologies.com",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:3001",
  "http://127.0.0.1:3001",
  "http://localhost:8081"
];

const allowedExact = new Set([...DEFAULT_ORIGINS, ...EXTRA_ORIGINS]);

/** Allow localhost and any infosensetechnologies.com host (with or without www). */
export function isAllowedOrigin(origin: string | undefined): boolean {
  if (!origin) return true;
  if (allowedExact.has(origin)) return true;
  try {
    const u = new URL(origin);
    const host = u.hostname.toLowerCase();
    if (host === "localhost" || host === "127.0.0.1") return true;
    if (host === "infosensetechnologies.com" || host.endsWith(".infosensetechnologies.com")) {
      return true;
    }
  } catch {
    return false;
  }
  return false;
}

export const corsOptions: CorsOptions = {
  origin(origin, callback) {
    if (!origin) {
      callback(null, true);
      return;
    }
    if (isAllowedOrigin(origin)) {
      // Echo the request origin (required when credentials: true)
      callback(null, origin);
      return;
    }
    console.warn("[CORS] Blocked origin:", origin);
    callback(null, false);
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Admin-Key", "Accept"],
  exposedHeaders: ["Content-Type"],
  optionsSuccessStatus: 204,
  maxAge: 86400
};
