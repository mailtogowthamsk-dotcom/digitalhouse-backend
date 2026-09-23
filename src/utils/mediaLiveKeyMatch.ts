/**
 * P4D: request-local live-key matching (no DB).
 * Mirrors resolveLiveMediaKey / findOwnedMediaFile family rules for batch hydration.
 */

import path from "path";
import { extractR2KeyFromUrl, isPrivateR2Object } from "./r2Client";
import { publishedKeyFromQuarantine } from "../services/contentSafety/quarantineKeys";

/** Basename used by findOwnedMediaFile LIKE patterns. */
export function ownedLookupBaseName(key: string): string {
  const fileName = path.basename(key);
  return fileName.replace(/_(full|md|thumb)\.webp$/i, "").replace(/\.webp$/i, "");
}

/** Basename used by resolveLiveMediaKey staging fallback. */
export function stagingLookupBaseName(key: string): string {
  return path.basename(key).replace(/\.[^.]+$/, "").replace(/_full$/, "").replace(/_opt$/, "");
}

export type MediaMatchRow = {
  id: number;
  objectKey?: string | null;
  fileUrl?: string | null;
  processingStatus?: string | null;
  safetyDecision?: string | null;
};

function publicPublishStorageKey(urlOrKey: string | null | undefined): string | null {
  if (!urlOrKey?.trim()) return null;
  const key = extractR2KeyFromUrl(urlOrKey.trim()) ?? urlOrKey.trim();
  const published = publishedKeyFromQuarantine(key);
  if (published) return published;
  if (isPrivateR2Object(key)) return null;
  return key;
}

export function liveObjectKeyFromMatchRow(row: MediaMatchRow): string {
  if (!row.objectKey) return "";
  if (row.safetyDecision === "SAFE" && !isPrivateR2Object(row.objectKey)) {
    return publicPublishStorageKey(row.objectKey) ?? row.objectKey;
  }
  return row.objectKey;
}

/**
 * In-memory equivalent of resolveLiveMediaKey against completed rows (id DESC).
 */
export function matchLiveMediaKeyFromRows(
  key: string,
  rowsDesc: MediaMatchRow[]
): string | null {
  if (!key || rowsDesc.length === 0) return null;

  for (const row of rowsDesc) {
    if (row.objectKey === key && row.processingStatus === "completed" && row.objectKey) {
      return liveObjectKeyFromMatchRow(row);
    }
  }

  const fileName = path.basename(key);
  const ownedBase = ownedLookupBaseName(key);
  for (const row of rowsDesc) {
    if (row.processingStatus && row.processingStatus !== "completed") continue;
    if (!row.objectKey) continue;
    const ok = row.objectKey;
    const fu = row.fileUrl || "";
    const fuKey = extractR2KeyFromUrl(fu) ?? fu;
    if (ownedBase) {
      if (ok.includes(`/${ownedBase}`) || fu.includes(`/${ownedBase}`) || fuKey.includes(`/${ownedBase}`)) {
        return liveObjectKeyFromMatchRow(row);
      }
    }
    if (fu.includes(fileName) || fuKey.includes(fileName) || fuKey === key) {
      return liveObjectKeyFromMatchRow(row);
    }
  }

  const stagingBase = stagingLookupBaseName(key);
  if (!stagingBase) return null;
  for (const row of rowsDesc) {
    if (row.processingStatus && row.processingStatus !== "completed") continue;
    if (!row.objectKey) continue;
    const ok = row.objectKey;
    const fu = row.fileUrl || "";
    if (
      ok.includes(`/${stagingBase}_full.webp`) ||
      ok.includes(`/${stagingBase}_opt.mp4`) ||
      ok.includes(`/${stagingBase}.`) ||
      fu.includes(`/${stagingBase}`)
    ) {
      return liveObjectKeyFromMatchRow(row);
    }
  }
  return null;
}
