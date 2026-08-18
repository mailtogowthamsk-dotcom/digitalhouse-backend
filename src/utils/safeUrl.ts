const BLOCKED_PROTOCOLS = new Set(["javascript:", "data:", "file:", "vbscript:", "blob:"]);

function isPrivateHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host === "::1" || host.endsWith(".local")) return true;
  if (host === "0.0.0.0" || host === "127.0.0.1") return true;
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!ipv4) return false;
  const a = Number(ipv4[1]);
  const b = Number(ipv4[2]);
  if (a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  return false;
}

/**
 * Validate a public http(s) destination URL.
 * Blocks open-redirect primitives, credentials, and private/local hosts.
 */
export function assertSafeHttpUrl(raw: string, maxLength = 2048): string {
  const value = String(raw || "").trim();
  if (!value) {
    throw Object.assign(new Error("Destination URL is required"), {
      status: 400,
      code: "INVALID_URL"
    });
  }
  if (value.length > maxLength) {
    throw Object.assign(new Error("Destination URL is too long"), {
      status: 400,
      code: "INVALID_URL"
    });
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw Object.assign(new Error("Destination URL is invalid"), {
      status: 400,
      code: "INVALID_URL"
    });
  }
  const protocol = parsed.protocol.toLowerCase();
  if (BLOCKED_PROTOCOLS.has(protocol) || (protocol !== "http:" && protocol !== "https:")) {
    throw Object.assign(new Error("Only http and https URLs are allowed"), {
      status: 400,
      code: "DANGEROUS_URL"
    });
  }
  if (parsed.username || parsed.password) {
    throw Object.assign(new Error("URLs with credentials are not allowed"), {
      status: 400,
      code: "DANGEROUS_URL"
    });
  }
  if (!parsed.hostname || isPrivateHostname(parsed.hostname)) {
    throw Object.assign(new Error("Destination host is not allowed"), {
      status: 400,
      code: "DANGEROUS_URL"
    });
  }
  return parsed.toString();
}

export function isSafeHttpUrl(raw: string): boolean {
  try {
    assertSafeHttpUrl(raw);
    return true;
  } catch {
    return false;
  }
}
