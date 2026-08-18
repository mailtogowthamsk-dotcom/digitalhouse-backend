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
  for (const src of candidates) {
    const dest = publishedKeyFromQuarantine(src);
    if (!dest) continue;
    try {
      await copyR2Object(src, dest);
      mapping.set(src, dest);
    } catch (err) {
      const status = Number((err as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode ?? 0);
      if (status === 404) continue;
      throw err;
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
