/**
 * Stories runtime config — storage, signing, content-safety acknowledgment.
 * Fail-fast helpers used at startup and by StoryLocalStorage.
 */
import fs from "fs";
import path from "path";
import { STORIES_MEDIA_SIGNING_SECRET_MIN_LEN } from "../constants/stories.constants";

const WEAK_STORIES_SECRETS = new Set([
  "",
  "dev-stories-media-secret",
  "change_me",
  "secret",
  "stories-secret",
  "changeme"
]);

function isProd(): boolean {
  return process.env.NODE_ENV === "production";
}

const DEFAULT_STORAGE_DIR = path.join(process.cwd(), "storage", "stories");

/** Absolute stories media root. */
export function getStoriesStorageDir(): string {
  const raw = (process.env.STORIES_STORAGE_DIR || "").trim();
  return path.resolve(raw || DEFAULT_STORAGE_DIR);
}

export function isWeakStoriesMediaSecret(secret: string): boolean {
  const s = secret.trim();
  if (!s || s.length < STORIES_MEDIA_SIGNING_SECRET_MIN_LEN) return true;
  return WEAK_STORIES_SECRETS.has(s.toLowerCase());
}

/**
 * Resolve HMAC secret for signed story media URLs.
 * Production must set STORIES_MEDIA_SIGNING_SECRET (validated at startup).
 * Dev may fall back to JWT secret — never a hardcoded weak default in production.
 */
export function resolveStoriesMediaSigningSecret(): string {
  const dedicated = (process.env.STORIES_MEDIA_SIGNING_SECRET || "").trim();
  if (dedicated && !isWeakStoriesMediaSecret(dedicated)) {
    return dedicated;
  }
  if (isProd()) {
    throw Object.assign(
      new Error(
        "STORIES_MEDIA_SIGNING_SECRET is missing or too weak. Set a strong secret (≥32 chars) shared by all API nodes."
      ),
      { status: 500, code: "STORIES_MEDIA_SECRET_MISSING" }
    );
  }
  if (dedicated) {
    console.warn(
      "[stories] STORIES_MEDIA_SIGNING_SECRET is weak — generate a stronger secret for production."
    );
    return dedicated;
  }
  const jwt = (
    process.env.JWT_ACCESS_SECRET ||
    process.env.JWT_SECRET ||
    ""
  ).trim();
  if (jwt.length >= 16) {
    console.warn(
      "[stories] STORIES_MEDIA_SIGNING_SECRET unset — using JWT_ACCESS_SECRET for media HMAC (dev only)."
    );
    return jwt;
  }
  console.warn(
    "[stories] No STORIES_MEDIA_SIGNING_SECRET or JWT secret — using process-local ephemeral secret (dev only)."
  );
  const g = globalThis as { __dhStoriesDevSecret?: string };
  if (!g.__dhStoriesDevSecret) {
    g.__dhStoriesDevSecret = `dev_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
  }
  return g.__dhStoriesDevSecret;
}

/**
 * Content-safety mode for Stories.
 * Stories are intentionally skipped from the quarantine pipeline unless product enables later.
 * Production must set STORIES_CONTENT_SAFETY_MODE=disabled (explicit acknowledgment).
 */
export type StoriesContentSafetyMode = "disabled" | "enabled";

export function getStoriesContentSafetyMode(): StoriesContentSafetyMode {
  const raw = (process.env.STORIES_CONTENT_SAFETY_MODE || "").trim().toLowerCase();
  if (raw === "enabled") return "enabled";
  return "disabled";
}

export function logStoriesContentSafetyMode(): void {
  const mode = getStoriesContentSafetyMode();
  if (mode === "enabled") {
    console.warn(
      "[stories] STORIES_CONTENT_SAFETY_MODE=enabled requested, but Stories remain outside the quarantine scan pipeline (CONTENT_SAFETY_SKIP_MODULES). Treat as unmoderated until a Stories safety integration ships."
    );
  } else {
    console.info(
      "[stories] Content safety mode=disabled — Stories media are not scanned by content-safety/quarantine."
    );
  }
}

/**
 * Ensure storage directory exists. Local disk is single-node unless shared mount + ack.
 */
export function ensureStoriesStorageReady(): void {
  const dir = getStoriesStorageDir();
  fs.mkdirSync(dir, { recursive: true });
  try {
    fs.accessSync(dir, fs.constants.R_OK | fs.constants.W_OK);
  } catch {
    throw new Error(
      `STORIES_STORAGE_DIR is not writable: ${dir}. Fix permissions or set STORIES_STORAGE_DIR.`
    );
  }
  console.info(`[stories] Storage root ready: ${dir}`);
}

/**
 * Multi-API-instance guard for local-only story storage.
 * Prefer explicit API_INSTANCES (set by ecosystem when scaling).
 * Do NOT treat NODE_APP_INSTANCE alone as multi-node — PM2 can set
 * NODE_APP_INSTANCE=0 even for a single fork/cluster worker.
 */
export function assertStoriesStorageTopologySafe(): void {
  const apiInstances = Number(process.env.API_INSTANCES || 1);
  const multiNode = Number.isFinite(apiInstances) && apiInstances > 1;
  if (!multiNode) {
    console.info(
      "[stories] Single-node local storage assumed. All API instances must share STORIES_STORAGE_DIR (NFS/shared volume) OR migrate Stories media to object storage before scaling API workers > 1."
    );
    return;
  }
  const ack = (process.env.STORIES_SHARED_STORAGE_ACK || "").trim().toLowerCase();
  if (ack === "true" || ack === "1" || ack === "yes") {
    console.warn(
      "[stories] Multi-node API detected — STORIES_SHARED_STORAGE_ACK accepted. Ensure STORIES_STORAGE_DIR is a shared filesystem visible to every API process."
    );
    return;
  }
  throw new Error(
    "Stories media uses local disk (STORIES_STORAGE_DIR). Multiple API instances detected without STORIES_SHARED_STORAGE_ACK=true. " +
      "Either keep API instances=1, mount shared storage and set STORIES_SHARED_STORAGE_ACK=true, or migrate Stories to object storage."
  );
}

/** Collect production startup errors for stories (mutates errors array). */
export function collectStoriesProductionEnvErrors(errors: string[]): void {
  const secret = (process.env.STORIES_MEDIA_SIGNING_SECRET || "").trim();
  if (!secret || isWeakStoriesMediaSecret(secret)) {
    errors.push(
      `STORIES_MEDIA_SIGNING_SECRET is required in production (≥${STORIES_MEDIA_SIGNING_SECRET_MIN_LEN} chars, not a weak default). Generate with: openssl rand -hex 32`
    );
  }

  const storage = (process.env.STORIES_STORAGE_DIR || "").trim();
  if (!storage) {
    errors.push(
      "STORIES_STORAGE_DIR is required in production (absolute path on shared or single-node disk)."
    );
  } else if (!path.isAbsolute(storage)) {
    errors.push("STORIES_STORAGE_DIR must be an absolute path in production.");
  }

  const mode = (process.env.STORIES_CONTENT_SAFETY_MODE || "").trim().toLowerCase();
  if (!mode) {
    errors.push(
      'STORIES_CONTENT_SAFETY_MODE is required in production (set to "disabled" to acknowledge Stories are not content-safety scanned).'
    );
  } else if (mode !== "disabled" && mode !== "enabled") {
    errors.push('STORIES_CONTENT_SAFETY_MODE must be "disabled" or "enabled".');
  }

  const apiInstances = Number(process.env.API_INSTANCES || 1);
  if (Number.isFinite(apiInstances) && apiInstances > 1) {
    const ack = (process.env.STORIES_SHARED_STORAGE_ACK || "").trim().toLowerCase();
    if (ack !== "true" && ack !== "1" && ack !== "yes") {
      errors.push(
        "API_INSTANCES>1 requires STORIES_SHARED_STORAGE_ACK=true and a shared STORIES_STORAGE_DIR (or object-storage migration)."
      );
    }
  }
}
