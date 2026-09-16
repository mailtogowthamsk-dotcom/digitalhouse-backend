import { QUARANTINE_PREFIX } from "../../constants/contentSafety.constants";
import { collectMediaArtifactKeys } from "../../utils/mediaArtifactKeys";
import {
  copyR2Object,
  deleteR2ObjectByKey,
  extractR2KeyFromUrl
} from "../../utils/r2Client";
import { publishedKeyFromQuarantine } from "./quarantineKeys";

export { needsUploadQuarantine, toQuarantineKey, publishedKeyFromQuarantine } from "./quarantineKeys";

export function rewriteStoredKey(urlOrKey: string | null | undefined, mapping: Map<string, string>): string | null {
  if (!urlOrKey) return urlOrKey ?? null;
  const key = extractR2KeyFromUrl(urlOrKey) ?? urlOrKey;
  return mapping.get(key) ?? urlOrKey;
}

export async function promoteQuarantineKeys(
  keys: Array<string | null | undefined>,
  variantsJson?: string | null
): Promise<Map<string, string>> {
  const mapping = new Map<string, string>();
  const candidates = new Set<string>();
  for (const raw of keys) {
    if (!raw) continue;
    const key = extractR2KeyFromUrl(raw) ?? raw;
    if (!key.startsWith(QUARANTINE_PREFIX)) continue;
    for (const artifact of collectMediaArtifactKeys(key, variantsJson)) {
      if (artifact.startsWith(QUARANTINE_PREFIX)) candidates.add(artifact);
    }
  }
  const copied = new Set<string>();
  for (const src of candidates) {
    const dest = publishedKeyFromQuarantine(src);
    if (!dest) continue;
    try {
      await copyR2Object(src, dest);
      mapping.set(src, dest);
      copied.add(src);
    } catch (err) {
      const status = Number((err as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode ?? 0);
      if (status === 404) continue;
      throw err;
    }
  }

  // Staging originals are deleted after Sharp/FFmpeg. Clients often still store the staging
  // key — map missing staging → published _full / sibling that did copy successfully.
  for (const src of candidates) {
    if (mapping.has(src)) continue;
    const dest = publishedKeyFromQuarantine(src);
    if (!dest) continue;
    for (const artifact of collectMediaArtifactKeys(src, variantsJson)) {
      if (!copied.has(artifact)) continue;
      const publishedArtifact = publishedKeyFromQuarantine(artifact);
      if (publishedArtifact) {
        mapping.set(src, publishedArtifact);
        break;
      }
    }
  }
  return mapping;
}

export async function deletePromotedQuarantineKeys(mapping: Map<string, string>): Promise<void> {
  await Promise.all(
    [...mapping.keys()].map((src) =>
      deleteR2ObjectByKey(src).catch(() => undefined)
    )
  );
}
