/**
 * Cloudflare R2 client (S3-compatible API).
 * Uploads remain private writes via pre-signed PUT URLs.
 * Public media is delivered through the configured Cloudflare custom domain.
 * Private media uses time-limited pre-signed GET URLs.
 * Do NOT expose R2 credentials to client.
 */

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { R2_CACHE_CONTROL_IMMUTABLE } from "../config/r2Cache.config";

const accountId = process.env.R2_ACCOUNT_ID;
const accessKeyId = process.env.R2_ACCESS_KEY_ID;
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
const bucketName = process.env.R2_BUCKET_NAME;
export const MEDIA_DELIVERY_MODE = (process.env.MEDIA_DELIVERY_MODE || "public")
  .trim()
  .toLowerCase();
const region = "auto"; // R2 uses "auto" for region
/** S3-compatible client for R2. Only used server-side; never expose to client. */
function getR2Client(): S3Client {
  if (!accountId || !accessKeyId || !secretAccessKey) {
    throw new Error("R2 credentials not configured (R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY)");
  }
  const endpoint = `https://${accountId}.r2.cloudflarestorage.com`;
  return new S3Client({
    region,
    endpoint,
    credentials: {
      accessKeyId,
      secretAccessKey
    },
    forcePathStyle: true
  });
}

/**
 * Generate a pre-signed PUT URL so the client can upload directly to R2.
 * Bucket stays private; no public write.
 */
export async function getPresignedPutUrl(
  key: string,
  contentType: string,
  expiresInSeconds = 900
): Promise<string> {
  if (!bucketName) throw new Error("R2_BUCKET_NAME not set");
  const client = getR2Client();
  // Content-Type only on client PUT — Cache-Control is applied server-side after optimize
  // so mobile uploads do not need matching signed headers.
  const command = new PutObjectCommand({
    Bucket: bucketName,
    Key: key,
    ContentType: contentType
  });
  return getSignedUrl(client, command, { expiresIn: expiresInSeconds });
}

/**
 * Build the public CDN URL for a given R2 key.
 * Set R2_CDN_PUBLIC_URL to your custom domain or R2 public bucket URL.
 */
export function getCdnPublicUrl(key: string): string {
  const base = process.env.R2_CDN_PUBLIC_URL;
  if (!base) throw new Error("R2_CDN_PUBLIC_URL not set");
  const trimmed = base.replace(/\/$/, "");
  const normalizedKey = key.startsWith("/") ? key.slice(1) : key;
  return `${trimmed}/${normalizedKey}`;
}

/**
 * Return a stable Cloudflare CDN URL for public media.
 * This helper never generates a pre-signed GET URL.
 */
export function toPublicUrlIfR2(
  url: string | null | undefined
): string | null {
  if (!url || typeof url !== "string" || !url.trim()) return null;
  const u = url.trim();
  let key = extractR2KeyFromUrl(u);
  if (!key) return u;
  key = normalizeR2ObjectKey(key);

  return getCdnPublicUrl(key);
}

/**
 * Canonical value to persist for R2-hosted media: the object key.
 * Values we cannot map to a key (external avatars, unknown hosts) pass through
 * unchanged so legacy rows and third-party URLs keep working.
 */
export function toStorageKeyIfR2(url: string | null | undefined): string | null {
  if (!url || typeof url !== "string" || !url.trim()) return null;
  const u = url.trim();
  const cdnBase = process.env.R2_CDN_PUBLIC_URL?.replace(/\/$/, "");
  if (cdnBase && u.startsWith(cdnBase)) {
    const pathPart = u.slice(cdnBase.length).split("?")[0].replace(/^\//, "");
    if (pathPart) return normalizeR2ObjectKey(decodeIfEncoded(pathPart));
  }
  const key = extractR2KeyFromUrl(u);
  return key ? normalizeR2ObjectKey(key) : u;
}

/** Whether a stored key/URL is protected by the media-edge private-prefix rule. */
export function isPrivateR2Object(url: string | null | undefined): boolean {
  const key = toStorageKeyIfR2(url);
  if (!key) return false;
  return (
    key.toLowerCase().startsWith("digital-house/private/") ||
    /^digital-house\/profile\/[^/]+\/horoscope\//i.test(key)
  );
}

/**
 * Generate a pre-signed GET URL for private bucket.
 * Use when serving media so the app can load images/videos (bucket stays private).
 */
export async function getPresignedGetUrl(key: string, expiresInSeconds = 3600): Promise<string> {
  if (!bucketName) throw new Error("R2_BUCKET_NAME not set");
  const client = getR2Client();
  const command = new GetObjectCommand({
    Bucket: bucketName,
    Key: key
  });
  return getSignedUrl(client, command, { expiresIn: expiresInSeconds });
}

/**
 * Extract R2 object key from a URL or path.
 * Upload uses keys like digital-house/profile-photos/{userId}/{file}; retrieve needs the same key.
 * Handles: full URL, path-only, and URL-encoded path.
 */
export function extractR2KeyFromUrl(u: string): string | null {
  const trimmed = u.replace(/^\//, "").trim();
  if (trimmed.startsWith("digital-house/")) return normalizeR2ObjectKey(trimmed);
  try {
    const pathMatch = u.match(/^(https?:\/\/[^/]+)(\/.*)$/);
    if (!pathMatch) return null;
    const pathWithQuery = pathMatch[2];
    const path = pathWithQuery.split("?")[0].replace(/^\//, "");
    if (path.includes("digital-house/")) {
      const idx = path.indexOf("digital-house/");
      return normalizeR2ObjectKey(path.slice(idx));
    }
    return null;
  } catch {
    return null;
  }
}

function decodeIfEncoded(path: string): string {
  try {
    if (path.includes("%")) return decodeURIComponent(path);
  } catch {
    /* ignore decode errors */
  }
  return path;
}

/**
 * Path-style R2 URLs often look like /{bucket}/digital-house/... while PutObject Key is digital-house/...
 * Collapse accidental duplicate bucket + prefix segments so signed GET uses the real object key.
 */
export function normalizeR2ObjectKey(keyOrPath: string): string {
  let k = decodeIfEncoded(keyOrPath.replace(/^\//, "").trim());
  if (!k) return k;

  const bucket = bucketName?.trim();
  if (bucket) {
    const doublePrefix = `${bucket}/${bucket}/`;
    if (k.startsWith(doublePrefix)) {
      k = k.slice(bucket.length + 1);
    } else if (k.startsWith(`${bucket}/`) && k.slice(bucket.length + 1).startsWith("digital-house/")) {
      k = k.slice(bucket.length + 1);
    }
  }

  while (k.startsWith("digital-house/digital-house/")) {
    k = k.replace(/^digital-house\//, "");
  }

  return k;
}

/** Default expiry for signed GET URLs (1 hour) so app can display R2 images. */
const SIGNED_GET_EXPIRY_SEC = Math.max(
  600,
  Number(process.env.R2_SIGNED_GET_EXPIRY_SEC || 21600)
);

/** Cache signed URLs until near expiry to cut CPU. Set R2_SIGNED_URL_CACHE_MS=0 to disable. */
const SIGNED_URL_CACHE_TTL_MS = (() => {
  const raw = process.env.R2_SIGNED_URL_CACHE_MS;
  if (raw === "0") return 0;
  return Math.max(
    60_000,
    Number(raw || (SIGNED_GET_EXPIRY_SEC - 300) * 1000)
  );
})();

/**
 * Private delivery only: turn a stored R2 URL/key into a signed GET URL.
 * Do not use this for posts, profile photos, marketplace/help galleries, or
 * prominent-people media; those must use toPublicUrlIfR2.
 */
/** Best-effort delete of an R2 object referenced by CDN URL or key. */
/** Download object bytes from R2 (server-side only). */
export async function getR2ObjectBuffer(
  key: string,
  maxBytes: number
): Promise<Buffer> {
  if (!bucketName) throw new Error("R2_BUCKET_NAME not set");
  const client = getR2Client();
  const configuredTimeout = Number(process.env.R2_DOWNLOAD_TIMEOUT_MS || 120_000);
  const timeoutMs = Number.isFinite(configuredTimeout)
    ? Math.max(10_000, configuredTimeout)
    : 120_000;
  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), timeoutMs);
  timeout.unref();
  try {
    const response = await client.send(
      new GetObjectCommand({ Bucket: bucketName, Key: key }),
      { abortSignal: abortController.signal }
    );
    const contentLength = response.ContentLength ?? 0;
    if (contentLength > maxBytes) {
      throw new Error(`Object exceeds max download size (${maxBytes} bytes)`);
    }
    const body = response.Body;
    const byteArrayBody = body as
      | { transformToByteArray?: () => Promise<Uint8Array> }
      | undefined;
    if (typeof byteArrayBody?.transformToByteArray !== "function") {
      throw new Error("Empty R2 response body");
    }
    const bytes = await byteArrayBody.transformToByteArray();
    const buf = Buffer.from(bytes);
    if (buf.length > maxBytes) {
      throw new Error(`Object exceeds max download size (${maxBytes} bytes)`);
    }
    return buf;
  } finally {
    clearTimeout(timeout);
  }
}

/** Validate that an uploaded R2 object exists without downloading its bytes. */
export async function getR2ObjectMetadata(
  key: string
): Promise<{ byteSize: number; contentType: string | null }> {
  if (!bucketName) throw new Error("R2_BUCKET_NAME not set");
  const client = getR2Client();
  try {
    const response = await client.send(
      new HeadObjectCommand({ Bucket: bucketName, Key: normalizeR2ObjectKey(key) })
    );
    return {
      byteSize: Number(response.ContentLength ?? 0),
      contentType: response.ContentType ?? null
    };
  } catch (error: any) {
    const status = Number(error?.$metadata?.httpStatusCode ?? 0);
    if (status === 404 || error?.name === "NotFound" || error?.Code === "NoSuchKey") {
      throw Object.assign(new Error("Uploaded media object not found"), { status: 400 });
    }
    throw error;
  }
}

/** Upload buffer to R2 with Content-Type + long Cache-Control (immutable optimized assets). */
export async function putR2ObjectBuffer(
  key: string,
  body: Buffer,
  contentType: string,
  options?: { cacheControl?: string }
): Promise<void> {
  if (!bucketName) throw new Error("R2_BUCKET_NAME not set");
  const client = getR2Client();
  await client.send(
    new PutObjectCommand({
      Bucket: bucketName,
      Key: key,
      Body: body,
      ContentType: contentType,
      CacheControl: options?.cacheControl ?? R2_CACHE_CONTROL_IMMUTABLE
    })
  );
}

export async function deleteR2ObjectByKey(key: string): Promise<void> {
  if (!bucketName) return;
  try {
    const client = getR2Client();
    await client.send(new DeleteObjectCommand({ Bucket: bucketName, Key: key }));
  } catch (err) {
    console.warn("[R2] Delete key failed:", key, err instanceof Error ? err.message : err);
  }
}

/** Delete full + medium + thumb variants when URL/key uses _full.webp convention. */
export async function deleteR2ImageVariants(urlOrKey: string | null | undefined): Promise<void> {
  if (!urlOrKey?.trim()) return;
  const key = urlOrKey.startsWith("digital-house/")
    ? urlOrKey
    : extractR2KeyFromUrl(urlOrKey);
  if (!key) return;
  if (key.endsWith("_full.webp")) {
    await deleteR2ObjectByKey(key);
    await deleteR2ObjectByKey(key.replace(/_full\.webp$/, "_md.webp"));
    await deleteR2ObjectByKey(key.replace(/_full\.webp$/, "_thumb.webp"));
    return;
  }
  await deleteR2ObjectByKey(key);
}

export async function deleteR2ObjectIfStored(url: string | null | undefined): Promise<void> {
  if (!url || typeof url !== "string" || !url.trim()) return;
  const u = url.trim();
  const cdnBase = process.env.R2_CDN_PUBLIC_URL?.replace(/\/$/, "");
  let key: string | null = null;
  if (cdnBase && u.startsWith(cdnBase)) {
    const pathPart = u.slice(cdnBase.length).split("?")[0].replace(/^\//, "") || null;
    key = pathPart ? decodeIfEncoded(pathPart) : null;
  }
  if (!key) key = extractR2KeyFromUrl(u);
  if (!key || !bucketName) return;
  try {
    const client = getR2Client();
    await client.send(new DeleteObjectCommand({ Bucket: bucketName, Key: key }));
  } catch (err) {
    console.warn("[R2] Delete object failed:", err instanceof Error ? err.message : err);
  }
}

/**
 * @internal Low-level signer used by toPrivateSignedUrlIfR2.
 * Services must choose toPublicUrlIfR2 or toPrivateSignedUrlIfR2 explicitly.
 */
export async function toSignedUrlIfR2(url: string | null | undefined): Promise<string | null> {
  if (!url || typeof url !== "string" || !url.trim()) return null;
  const u = url.trim();
  const cdnBase = process.env.R2_CDN_PUBLIC_URL?.replace(/\/$/, "");
  let key: string | null = null;
  if (cdnBase && u.startsWith(cdnBase)) {
    const pathPart = u.slice(cdnBase.length).split("?")[0].replace(/^\//, "") || null;
    key = pathPart ? decodeIfEncoded(pathPart) : null;
  }
  if (!key) key = extractR2KeyFromUrl(u);
  if (!key) return u;
  key = normalizeR2ObjectKey(key);

  const { getCachedSignedUrl, setCachedSignedUrl } = await import("./signedUrlCache");
  if (SIGNED_URL_CACHE_TTL_MS > 0) {
    const cached = getCachedSignedUrl(key);
    if (cached) return cached;
  }

  try {
    const signed = await getPresignedGetUrl(key, SIGNED_GET_EXPIRY_SEC);
    if (SIGNED_URL_CACHE_TTL_MS > 0) {
      setCachedSignedUrl(key, signed, SIGNED_URL_CACHE_TTL_MS);
    }
    return signed;
  } catch (err) {
    // Retrieve fails if R2_* env vars are missing on server (upload can still work from another env).
    console.warn(
      "[R2] Retrieve/signed GET failed — images will not display. Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME on this server.",
      err instanceof Error ? err.message : ""
    );
    return u;
  }
}

/**
 * Sensitive-media delivery: return only a verifiably presigned R2 GET URL.
 * Invalid/external values and signing failures become null rather than leaking a
 * stored key or public-CDN URL through a private response field.
 */
export async function toPrivateSignedUrlIfR2(
  url: string | null | undefined
): Promise<string | null> {
  const key = toStorageKeyIfR2(url);
  // Legacy private records can live under an older public prefix, so private
  // response fields may sign any Digital House key. New writes are separately
  // constrained to digital-house/private/*.
  if (!key?.startsWith("digital-house/")) return null;
  const signed = await toSignedUrlIfR2(url);
  if (!signed || !/[?&]X-Amz-Signature=/i.test(signed)) return null;
  return signed;
}
