/**
 * Minimal HTML sanitizer for admin-authored legal content.
 * Avoids introducing a new dependency while still stripping executable markup.
 */

const ALLOWED_TAGS = new Set([
  "p",
  "br",
  "hr",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "strong",
  "b",
  "em",
  "i",
  "u",
  "s",
  "blockquote",
  "ul",
  "ol",
  "li",
  "a",
  "table",
  "thead",
  "tbody",
  "tr",
  "th",
  "td",
  "img",
  "span",
  "div",
  "pre",
  "code"
]);

const GLOBAL_SAFE_ATTRS = new Set(["class", "title"]);
const TAG_ATTRS: Record<string, Set<string>> = {
  a: new Set(["href", "target", "rel", "title"]),
  img: new Set(["src", "alt", "title", "width", "height"]),
  td: new Set(["colspan", "rowspan"]),
  th: new Set(["colspan", "rowspan"])
};

function decodeAttr(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function encodeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function isSafeUrl(raw: string, allowDataImage = false): boolean {
  const value = raw.trim();
  if (!value) return false;
  if (value.startsWith("#") || value.startsWith("/")) return true;
  const lower = value.toLowerCase();
  if (lower.startsWith("https://") || lower.startsWith("http://") || lower.startsWith("mailto:")) {
    return true;
  }
  if (allowDataImage && /^data:image\/(png|jpe?g|gif|webp);base64,/i.test(value)) {
    return true;
  }
  return false;
}

function sanitizeAttributes(tag: string, attrText: string): string {
  const allowed = new Set([...(TAG_ATTRS[tag] ?? []), ...GLOBAL_SAFE_ATTRS]);
  const out: string[] = [];
  const attrRe = /([^\s=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/gi;
  let match: RegExpExecArray | null;
  while ((match = attrRe.exec(attrText))) {
    const name = match[1].toLowerCase();
    if (name.startsWith("on") || name === "style" || !allowed.has(name)) continue;
    const raw = decodeAttr(match[2] ?? match[3] ?? match[4] ?? "");
    if (name === "href" || name === "src") {
      if (!isSafeUrl(raw, name === "src")) continue;
      out.push(`${name}="${encodeAttr(raw)}"`);
      if (name === "href" && !/rel=/i.test(attrText)) {
        out.push('rel="noopener noreferrer"');
      }
      continue;
    }
    if (name === "target") {
      if (raw === "_blank" || raw === "_self") out.push(`${name}="${raw}"`);
      continue;
    }
    out.push(`${name}="${encodeAttr(raw)}"`);
  }
  return out.length ? ` ${out.join(" ")}` : "";
}

/** Strip scripts/events and disallow unknown tags while preserving legal structure. */
export function sanitizeLegalHtml(input: string): string {
  if (!input) return "";
  let html = String(input)
    .replace(/<\s*(script|style|iframe|object|embed|link|meta)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, "")
    .replace(/<\s*(script|style|iframe|object|embed|link|meta)[^>]*\/?\s*>/gi, "");

  html = html.replace(/<\/?([a-z0-9]+)([^>]*)>/gi, (full, rawTag: string, attrs: string) => {
    const tag = rawTag.toLowerCase();
    const closing = full.trimStart().startsWith("</");
    if (!ALLOWED_TAGS.has(tag)) return "";
    if (closing) return `</${tag}>`;
    const selfClosing = /\/>\s*$/.test(full) || tag === "br" || tag === "hr" || tag === "img";
    const safeAttrs = sanitizeAttributes(tag, attrs || "");
    return selfClosing ? `<${tag}${safeAttrs} />` : `<${tag}${safeAttrs}>`;
  });

  return html.trim();
}
