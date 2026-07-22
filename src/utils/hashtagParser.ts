/** Max length of a normalized hashtag (without #). */
export const HASHTAG_MAX_LEN = 64;

/** Max hashtags stored per post after merge + dedupe. */
export const HASHTAGS_PER_POST_MAX = 20;

/**
 * Matches #TagName in free text.
 * Letters, digits, underscore; starts with a letter or digit.
 */
const INLINE_HASHTAG_RE = /#([A-Za-z0-9_]{1,64})/g;

/**
 * Normalize a raw hashtag or token to storage form.
 * "#Temple" / "TEMPLE" / " temple " → "temple"
 */
export function normalizeHashtag(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let s = String(raw).trim();
  if (!s) return null;
  if (s.startsWith("#")) s = s.slice(1);
  s = s.trim().toLowerCase();
  if (!s) return null;
  if (!/^[a-z0-9_]{1,64}$/.test(s)) return null;
  return s.slice(0, HASHTAG_MAX_LEN);
}

/** Extract unique normalized hashtags from free text (description/title). */
export function extractHashtagsFromText(text: string | null | undefined): string[] {
  if (!text) return [];
  const found: string[] = [];
  const seen = new Set<string>();
  INLINE_HASHTAG_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = INLINE_HASHTAG_RE.exec(text)) !== null) {
    const n = normalizeHashtag(m[1]);
    if (!n || seen.has(n)) continue;
    seen.add(n);
    found.push(n);
  }
  return found;
}

/** Normalize an explicit hashtag list from the client. */
export function normalizeHashtagList(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    const n = normalizeHashtag(typeof item === "string" ? item : String(item ?? ""));
    if (!n || seen.has(n)) continue;
    seen.add(n);
    out.push(n);
    if (out.length >= HASHTAGS_PER_POST_MAX) break;
  }
  return out;
}

/** Merge multiple hashtag sources, dedupe, cap. */
export function mergeHashtags(...sources: Array<string[] | null | undefined>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const source of sources) {
    if (!source) continue;
    for (const tag of source) {
      const n = normalizeHashtag(tag);
      if (!n || seen.has(n)) continue;
      seen.add(n);
      out.push(n);
      if (out.length >= HASHTAGS_PER_POST_MAX) return out;
    }
  }
  return out;
}

/**
 * Tokenize an explore search query into keywords.
 * "#Temple Blood" → ["temple", "blood"]
 */
export function tokenizeSearchQuery(q: string): string[] {
  const trimmed = q.trim();
  if (!trimmed) return [];
  const parts = trimmed.split(/\s+/).filter(Boolean);
  const tokens: string[] = [];
  const seen = new Set<string>();
  for (const part of parts) {
    const stripped = part.startsWith("#") ? part.slice(1) : part;
    const token = stripped.trim().toLowerCase().replace(/[%_]/g, "");
    if (!token || token.length < 1) continue;
    if (seen.has(token)) continue;
    seen.add(token);
    tokens.push(token.slice(0, 64));
    if (tokens.length >= 8) break;
  }
  return tokens;
}

/** Escape LIKE wildcards for safe substring search. */
export function escapeLike(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}
