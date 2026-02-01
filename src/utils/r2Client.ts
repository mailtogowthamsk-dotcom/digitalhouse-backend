/**
 * Cloudflare R2 client (S3-compatible API).
 * Bucket remains PRIVATE; uploads only via pre-signed PUT URLs.
 * Do NOT expose R2 credentials to client.
 */

import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
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
 * If url is our R2 CDN URL (private bucket), return a signed GET URL so the image loads.
 * Otherwise return url unchanged (e.g. YouTube, external links).
 */
export async function toSignedUrlIfR2(url: string | null | undefined): Promise<string | null> {
  if (!url || typeof url !== "string" || !url.trim()) return null;
  const u = url.trim();
  const cdnBase = process.env.R2_CDN_PUBLIC_URL?.replace(/\/$/, "");
  if (!cdnBase || !u.startsWith(cdnBase)) return u;
  const key = u.slice(cdnBase.length).replace(/^\//, "");
  if (!key) return u;
  try {
    return await getPresignedGetUrl(key);
  } catch {
    return u;
  }
}
