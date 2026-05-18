/** Optional prefix when Node receives full URL path (e.g. cPanel app at /digitalhouse/backend). */
export function getApiBasePath(): string {
  return (process.env.API_BASE_PATH || "").replace(/\/+$/, "");
}

/** Express mount path for API routes (always ends with /api). */
export function apiMountAt(prefix: string): string {
  const p = prefix.replace(/\/+$/, "");
  return p ? `${p}/api` : "/api";
}

/** Mount points: /api (Apache proxy strip) and /digitalhouse/backend/api when API_BASE_PATH is set. */
export function getApiMountPaths(): string[] {
  const paths = ["/api"];
  const base = getApiBasePath();
  if (base) {
    const prefixed = apiMountAt(base);
    if (!paths.includes(prefixed)) paths.push(prefixed);
  }
  return paths;
}
