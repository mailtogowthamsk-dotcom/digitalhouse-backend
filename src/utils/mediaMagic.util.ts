/**
 * Magic-byte / extension helpers for upload finalize (no architecture change).
 */

const EXECUTABLE_MAGIC: Array<{ name: string; bytes: number[] }> = [
  { name: "exe_mz", bytes: [0x4d, 0x5a] },
  { name: "elf", bytes: [0x7f, 0x45, 0x4c, 0x46] },
  { name: "macho_32", bytes: [0xfe, 0xed, 0xfa, 0xce] },
  { name: "macho_64", bytes: [0xfe, 0xed, 0xfa, 0xcf] },
  { name: "java_class", bytes: [0xca, 0xfe, 0xba, 0xbe] },
  { name: "shell_hashbang", bytes: [0x23, 0x21] } // #!
];

function startsWith(buf: Buffer, magic: number[]): boolean {
  if (buf.length < magic.length) return false;
  for (let i = 0; i < magic.length; i++) {
    if (buf[i] !== magic[i]) return false;
  }
  return true;
}

export function isExecutableOrScriptMagic(buf: Buffer): boolean {
  return EXECUTABLE_MAGIC.some((m) => startsWith(buf, m.bytes));
}

/** Detect image/video MIME from file header; null if unknown. */
export function detectMediaMimeFromBytes(buf: Buffer): string | null {
  if (buf.length >= 3 && startsWith(buf, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (buf.length >= 8 && startsWith(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return "image/png";
  }
  if (buf.length < 12) return null;
  // RIFF....WEBP
  if (
    buf.toString("ascii", 0, 4) === "RIFF" &&
    buf.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "image/webp";
  }
  // ISO BMFF (mp4/m4v/mov) — ftyp at offset 4
  if (buf.toString("ascii", 4, 8) === "ftyp") {
    const brand = buf.toString("ascii", 8, 12).toLowerCase();
    if (brand.startsWith("qt")) return "video/quicktime";
    return "video/mp4";
  }
  return null;
}

export function guessMimeFromObjectKey(objectKey: string, fileType: string): string | null {
  const lower = objectKey.toLowerCase();
  const ext = lower.includes(".") ? lower.slice(lower.lastIndexOf(".")) : "";
  if (fileType === "image") {
    if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
    if (ext === ".png") return "image/png";
    if (ext === ".webp") return "image/webp";
    return null;
  }
  if (fileType === "video") {
    if (ext === ".mp4" || ext === ".m4v") return "video/mp4";
    if (ext === ".mov") return "video/quicktime";
    return null;
  }
  return null;
}
