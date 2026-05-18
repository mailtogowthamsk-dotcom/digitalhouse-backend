/**
 * Cloudflare R2 client (S3-compatible API).
 * Bucket remains PRIVATE; uploads only via pre-signed PUT URLs.
 * Do NOT expose R2 credentials to client.
 */

import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const accountId = process.env.R2_ACCOUNT_ID;
const accessKeyId = process.env.R2_ACCESS_KEY_ID;
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
const bucketName = process.env.R2_BUCKET_NAME;
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
const SIGNED_GET_EXPIRY_SEC = 3600;

/**
 * Retrieve: turn stored R2 URL (or key) into a signed GET URL so the app can load the image.
 * Upload is separate (presigned PUT); this is only for display. Same bucket/key as upload
 * (e.g. digital-house/profile-photos/…). Requires R2_* env vars on the server.
 */
/** Best-effort delete of an R2 object referenced by CDN URL or key. */
/** Download object bytes from R2 (server-side only). */
export async function getR2ObjectBuffer(
  key: string,
  maxBytes: number
): Promise<Buffer> {
  if (!bucketName) throw new Error("R2_BUCKET_NAME not set");
  const client = getR2Client();
  const response = await client.send(
    new GetObjectCommand({ Bucket: bucketName, Key: key })
  );
  const contentLength = response.ContentLength ?? 0;
  if (contentLength > maxBytes) {
    throw new Error(`Object exceeds max download size (${maxBytes} bytes)`);
  }
  const body = response.Body;
  if (!body || typeof (body as any).transformToByteArray !== "function") {
    throw new Error("Empty R2 response body");
  }
  const bytes = await (body as any).transformToByteArray();
  const buf = Buffer.from(bytes);
  if (buf.length > maxBytes) {
    throw new Error(`Object exceeds max download size (${maxBytes} bytes)`);
  }
  return buf;
}

/** Upload buffer to R2 with Content-Type. */
export async function putR2ObjectBuffer(
  key: string,
  body: Buffer,
  contentType: string
): Promise<void> {
  if (!bucketName) throw new Error("R2_BUCKET_NAME not set");
  const client = getR2Client();
  await client.send(
    new PutObjectCommand({
      Bucket: bucketName,
      Key: key,
      Body: body,
      ContentType: contentType
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
  try {
    return await getPresignedGetUrl(key, SIGNED_GET_EXPIRY_SEC);
  } catch (err) {
    // Retrieve fails if R2_* env vars are missing on server (upload can still work from another env).
    console.warn(
      "[R2] Retrieve/signed GET failed — images will not display. Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME on this server.",
      err instanceof Error ? err.message : ""
    );
    return u;
  }
}
