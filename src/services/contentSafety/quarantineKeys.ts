import { QUARANTINE_MEDIA_MODULES, QUARANTINE_PREFIX } from "../../constants/contentSafety.constants";

const PUBLIC_ROOT = "digital-house/";

function normalizeKey(key: string): string {
  return key.replace(/^\//, "").trim();
}

export function needsUploadQuarantine(module: string, purpose?: string): boolean {
  if (purpose === "horoscope" || purpose === "identity" || purpose === "support" || purpose === "chat") {
    return false;
  }
  return (QUARANTINE_MEDIA_MODULES as readonly string[]).includes(module);
}

export function toQuarantineKey(publicKey: string): string {
  const key = normalizeKey(publicKey);
  if (key.startsWith(QUARANTINE_PREFIX)) return key;
  if (!key.startsWith(PUBLIC_ROOT)) return key;
  return `${QUARANTINE_PREFIX}${key.slice(PUBLIC_ROOT.length)}`;
}

export function publishedKeyFromQuarantine(key: string): string | null {
  const normalized = normalizeKey(key);
  if (!normalized.startsWith(QUARANTINE_PREFIX)) return null;
  return `${PUBLIC_ROOT}${normalized.slice(QUARANTINE_PREFIX.length)}`;
}
