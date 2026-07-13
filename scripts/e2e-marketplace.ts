/**
 * Marketplace E2E smoke test against local API (uses .env DB + R2).
 * Prefer: node scripts/run-e2e-marketplace.cjs
 */
import mysql from "mysql2/promise";
import sharp from "sharp";
import { S3Client, HeadObjectCommand } from "@aws-sdk/client-s3";
import { signAccessToken } from "../src/utils/jwt.util";

const BASE = process.env.E2E_API_BASE || "http://127.0.0.1:4000/api";
const ADMIN_KEY = process.env.ADMIN_API_KEY || "";

const results: { name: string; pass: boolean; detail?: string }[] = [];
function ok(name: string, detail?: string) {
  results.push({ name, pass: true, detail });
  console.log(`✅ ${name}${detail ? ` — ${detail}` : ""}`);
}
function fail(name: string, detail?: string) {
  results.push({ name, pass: false, detail });
  console.error(`❌ ${name} — ${detail}`);
}
function assert(name: string, cond: unknown, detail?: string) {
  if (cond) ok(name, detail);
  else fail(name, detail || "assertion failed");
}

async function api(
  method: string,
  urlPath: string,
  opts: { token?: string; adminKey?: string; body?: unknown } = {}
) {
  const h: Record<string, string> = {};
  if (opts.body !== undefined) h["Content-Type"] = "application/json";
  if (opts.token) h.Authorization = `Bearer ${opts.token}`;
  if (opts.adminKey) h["X-Admin-Key"] = opts.adminKey;
  const res = await fetch(`${BASE}${urlPath}`, {
    method,
    headers: h,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body)
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  return { status: res.status, json, text };
}

async function sampleImage(): Promise<Buffer> {
  return sharp({
    create: {
      width: 64,
      height: 64,
      channels: 3,
      background: { r: 40, g: 120, b: 200 }
    }
  })
    .webp({ quality: 80 })
    .toBuffer();
}

function extractKey(url: string | null | undefined): string | null {
  if (!url) return null;
  const u = String(url).split("?")[0];
  const idx = u.indexOf("digital-house/");
  if (idx >= 0) return decodeURIComponent(u.slice(idx));
  return null;
}

async function r2Exists(urlOrKey: string): Promise<boolean> {
  const key = urlOrKey.startsWith("digital-house/") ? urlOrKey : extractKey(urlOrKey);
  if (!key) return false;
  const client = new S3Client({
    region: "auto",
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!
    },
    forcePathStyle: true
  });
  try {
    await client.send(
      new HeadObjectCommand({ Bucket: process.env.R2_BUCKET_NAME!, Key: key })
    );
    return true;
  } catch {
    return false;
  }
}

async function uploadMarketplaceImage(token: string, label: string): Promise<string> {
  const buf = await sampleImage();
  const up = await api("POST", "/media/upload-url", {
    token,
    body: {
      fileName: `e2e-${label}-${Date.now()}.jpg`,
      fileType: "image/jpeg",
      fileSize: Math.max(buf.length, 1024),
      module: "marketplace"
    }
  });
  if (up.status >= 400 || !up.json?.ok) {
    throw new Error(`upload-url failed: ${up.status} ${up.text}`);
  }
  const { uploadUrl, mediaFileId } = up.json;
  const put = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": "image/webp" },
    body: buf
  });
  if (!put.ok) throw new Error(`R2 PUT failed: ${put.status}`);
  const fin = await api("POST", "/media/finalize", {
    token,
    body: { mediaFileId }
  });
  if (fin.status >= 400 || !fin.json?.ok) {
    throw new Error(`finalize failed: ${fin.status} ${fin.text}`);
  }
  return fin.json.publicUrl as string;
}

function printSummary() {
  const passed = results.filter((r) => r.pass).length;
  const failed = results.filter((r) => !r.pass).length;
  console.log(`\n——— Summary: ${passed} passed, ${failed} failed ———\n`);
  if (failed) process.exitCode = 1;
}

async function main() {
  console.log(`\nMarketplace E2E → ${BASE}\n`);

  const health = await api("GET", "/health");
  assert("API health", health.status === 200, `status=${health.status}`);

  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME
  });

  const [users] = (await conn.query(
    `SELECT id, fullName, community, status FROM users
     WHERE status = 'APPROVED' AND community IS NOT NULL AND community <> ''
     ORDER BY id ASC LIMIT 20`
  )) as any[];

  if (!users.length) {
    fail("Find approved users", "none found");
    await conn.end();
    printSummary();
    return;
  }

  let seller = users[0];
  for (const u of users) {
    const [rows] = (await conn.query(
      `SELECT COUNT(*) AS c FROM posts
       WHERE userId = ? AND postType = 'MARKETPLACE' AND marketplaceStatus = 'LIVE'`,
      [u.id]
    )) as any[];
    if (Number(rows[0].c) < 5) {
      seller = u;
      break;
    }
  }
  const buyer =
    users.find((u: any) => u.id !== seller.id && u.community === seller.community) || seller;

  ok("Seller selected", `id=${seller.id} community=${seller.community}`);
  ok("Buyer selected", `id=${buyer.id}`);

  const sellerToken = signAccessToken({ userId: Number(seller.id) });
  const buyerToken = signAccessToken({ userId: Number(buyer.id) });

  const me = await api("GET", "/home/summary", { token: sellerToken });
  assert("Seller JWT accepted", me.status === 200, `status=${me.status} ${me.json?.message || ""}`);

  let url1 = "";
  let url2 = "";
  try {
    url1 = await uploadMarketplaceImage(sellerToken, "a");
    url2 = await uploadMarketplaceImage(sellerToken, "b");
    ok("Upload gallery photos", "2 images");
  } catch (e: any) {
    fail("Upload gallery photos", e.message);
    await conn.end();
    printSummary();
    return;
  }

  assert("R2 object exists after upload", await r2Exists(url1), extractKey(url1) || undefined);

  const title = `E2E Polish ${Date.now()}`;
  const create = await api("POST", "/posts", {
    token: sellerToken,
    body: {
      post_type: "MARKETPLACE",
      title,
      description: "E2E marketplace polish listing with enough description text.",
      media_url: url1,
      marketplace_gallery: [url1, url2],
      marketplace_intent: "SALE",
      marketplace_category: "ELECTRONICS",
      marketplace_condition: "GOOD",
      marketplace_price: 1500,
      marketplace_negotiable: true,
      marketplace_district: "Erode"
    }
  });
  assert(
    "Create listing → PENDING_REVIEW",
    create.status === 200 || create.status === 201,
    `status=${create.status} ${create.json?.message || ""}`
  );
  const postId = create.json?.id as number | undefined;
  assert("Create returns id", Boolean(postId), String(postId));
  assert(
    "Create status PENDING_REVIEW",
    create.json?.marketplace_status === "PENDING_REVIEW",
    create.json?.marketplace_status
  );
  assert(
    "Create gallery length 2",
    Array.isArray(create.json?.marketplace_gallery) && create.json.marketplace_gallery.length === 2,
    String(create.json?.marketplace_gallery?.length)
  );

  const browseBefore = await api(
    "GET",
    `/home/feed?limit=50&sort=recent&postType=MARKETPLACE&page=1`,
    { token: buyerToken }
  );
  const foundPending = (browseBefore.json?.items || []).some((i: any) => i.postId === postId);
  assert("Pending hidden from browse", !foundPending, `found=${foundPending}`);

  const adminList = await api("GET", "/admin/marketplace?status=pending&limit=50", {
    adminKey: ADMIN_KEY
  });
  assert("Admin list pending", adminList.status === 200, `status=${adminList.status}`);
  const inPending = (adminList.json?.listings || []).some((l: any) => l.id === postId);
  assert("Listing in admin pending queue", inPending);

  const approve = await api("POST", `/admin/marketplace/${postId}/approve`, {
    adminKey: ADMIN_KEY,
    body: {}
  });
  assert("Admin approve", approve.status === 200, `status=${approve.status} ${approve.text}`);
  assert(
    "Approved is LIVE",
    approve.json?.listing?.marketplaceStatus === "LIVE",
    approve.json?.listing?.marketplaceStatus
  );
  assert(
    "Expiry set on approve",
    Boolean(approve.json?.listing?.marketplaceExpiresAt),
    approve.json?.listing?.marketplaceExpiresAt
  );

  const browse = await api(
    "GET",
    `/home/feed?limit=50&sort=recent&postType=MARKETPLACE&page=1`,
    { token: buyerToken }
  );
  const liveItem = (browse.json?.items || []).find((i: any) => i.postId === postId);
  assert(
    "Live listing visible in browse",
    Boolean(liveItem),
    `items=${(browse.json?.items || []).length}`
  );
  if (liveItem) {
    assert(
      "Browse has gallery/photoCount",
      (liveItem.marketplacePhotoCount || liveItem.marketplaceGallery?.length || 0) >= 2
    );
  }

  const detail = await api("GET", `/posts/${postId}`, { token: buyerToken });
  assert("Buyer can open LIVE detail", detail.status === 200, `status=${detail.status}`);
  assert(
    "Detail gallery length",
    (detail.json?.marketplace_gallery || []).length >= 2,
    String(detail.json?.marketplace_gallery?.length)
  );

  const feature = await api("POST", `/admin/marketplace/${postId}/feature`, {
    adminKey: ADMIN_KEY,
    body: { featured: true }
  });
  assert(
    "Admin feature",
    feature.status === 200 && feature.json?.listing?.marketplaceFeatured === true,
    feature.text
  );

  const browseFeat = await api(
    "GET",
    `/home/feed?limit=20&sort=recent&postType=MARKETPLACE&page=1`,
    { token: buyerToken }
  );
  assert(
    "Featured listing in browse",
    (browseFeat.json?.items || []).some((i: any) => i.postId === postId && i.marketplaceFeatured),
    "missing featured flag"
  );

  const save = await api("POST", `/posts/${postId}/save`, { token: buyerToken, body: {} });
  assert("Buyer save listing", save.status === 200 || save.status === 201, `status=${save.status}`);

  const saved = await api(
    "GET",
    `/home/feed?limit=20&postType=MARKETPLACE&saved=true&page=1`,
    { token: buyerToken }
  );
  assert(
    "Saved tab includes listing",
    (saved.json?.items || []).some((i: any) => i.postId === postId)
  );

  const update = await api("PUT", `/posts/${postId}`, {
    token: sellerToken,
    body: {
      media_url: url1,
      marketplace_gallery: [url1],
      marketplace_intent: "SALE",
      marketplace_category: "ELECTRONICS",
      marketplace_condition: "GOOD",
      marketplace_price: 1400,
      marketplace_negotiable: true,
      marketplace_district: "Erode",
      description: "E2E marketplace polish listing updated description text here.",
      title
    }
  });
  assert(
    "Seller update gallery (remove photo)",
    update.status === 200,
    `status=${update.status} ${update.json?.message || ""}`
  );
  assert(
    "Update requeues to PENDING_REVIEW (live edit)",
    update.json?.marketplace_status === "PENDING_REVIEW",
    update.json?.marketplace_status
  );

  await new Promise((r) => setTimeout(r, 1000));
  assert("Removed gallery image deleted from R2", !(await r2Exists(url2)), extractKey(url2) || undefined);
  assert("Kept gallery image still on R2", await r2Exists(url1), extractKey(url1) || undefined);

  try {
    const url3 = await uploadMarketplaceImage(sellerToken, "c");
    const del = await api("POST", "/media/delete", { token: sellerToken, body: { urls: [url3] } });
    assert("POST /media/delete", del.status === 200 && (del.json?.deleted ?? 0) >= 1, del.text);
    await new Promise((r) => setTimeout(r, 600));
    assert("Deleted session upload gone from R2", !(await r2Exists(url3)), extractKey(url3) || undefined);
  } catch (e: any) {
    fail("Media delete API", e.message);
  }

  const approve2 = await api("POST", `/admin/marketplace/${postId}/approve`, {
    adminKey: ADMIN_KEY,
    body: {}
  });
  assert("Re-approve after edit", approve2.status === 200, approve2.text);

  // Soft duplicate while still LIVE
  const dup = await api("POST", "/posts", {
    token: sellerToken,
    body: {
      post_type: "MARKETPLACE",
      title,
      description: "E2E marketplace polish listing with enough description text.",
      media_url: url1,
      marketplace_gallery: [url1],
      marketplace_intent: "SALE",
      marketplace_category: "ELECTRONICS",
      marketplace_condition: "GOOD",
      marketplace_price: 1500,
      marketplace_negotiable: false,
      marketplace_district: "Erode"
    }
  });
  assert("Soft duplicate blocked (409)", dup.status === 409, `status=${dup.status}`);
  if (dup.status === 201 && dup.json?.id) {
    await api("DELETE", `/admin/marketplace/${dup.json.id}`, { adminKey: ADMIN_KEY });
  }

  const sold = await api("PUT", `/posts/${postId}`, {
    token: sellerToken,
    body: { marketplace_status: "SOLD" }
  });
  assert(
    "Mark sold",
    sold.status === 200 && sold.json?.marketplace_status === "SOLD",
    sold.text
  );

  const browseSold = await api(
    "GET",
    `/home/feed?limit=50&postType=MARKETPLACE&page=1`,
    { token: buyerToken }
  );
  assert(
    "Sold hidden from public browse",
    !(browseSold.json?.items || []).some((i: any) => i.postId === postId)
  );

  const delListing = await api("DELETE", `/admin/marketplace/${postId}`, { adminKey: ADMIN_KEY });
  assert("Admin delete listing", delListing.status === 200, delListing.text);
  await new Promise((r) => setTimeout(r, 1000));
  assert(
    "Cover image deleted from R2 after listing delete",
    !(await r2Exists(url1)),
    extractKey(url1) || undefined
  );

  const [cols] = (await conn.query(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'posts'
       AND COLUMN_NAME IN ('marketplaceGallery','marketplaceFeatured','marketplaceFeaturedAt')`
  )) as any[];
  assert("Polish columns exist", cols.length === 3, cols.map((c: any) => c.COLUMN_NAME).join(","));

  await conn.end();
  printSummary();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
