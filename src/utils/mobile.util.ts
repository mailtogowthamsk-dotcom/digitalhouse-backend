/**
 * Normalize / validate member mobile numbers for registration & Google profile.
 * Accepts common India formats: 9876543210, 09876543210, +919876543210, 91xxxxxxxxxx.
 * Stores canonical 10-digit local number (no country prefix).
 */

export function digitsOnly(raw: string | null | undefined): string {
  return String(raw ?? "").replace(/\D/g, "");
}

/** Returns canonical 10-digit Indian mobile, or null if invalid. */
export function normalizeMobile(raw: string | null | undefined): string | null {
  let d = digitsOnly(raw);
  if (!d) return null;
  // Strip leading 0
  if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
  // Strip country code 91
  if (d.length === 12 && d.startsWith("91")) d = d.slice(2);
  // Strip 091
  if (d.length === 13 && d.startsWith("091")) d = d.slice(3);
  if (d.length !== 10) return null;
  // Indian mobile: starts with 6–9
  if (!/^[6-9]\d{9}$/.test(d)) return null;
  return d;
}

export function assertValidMobile(raw: string | null | undefined): string {
  const normalized = normalizeMobile(raw);
  if (!normalized) {
    throw Object.assign(
      new Error("Please enter a valid 10-digit Indian mobile number."),
      { status: 400, code: "MOBILE_INVALID" }
    );
  }
  return normalized;
}
