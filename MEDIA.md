# Media Storage & Delivery (Cloudflare R2 + CDN)

## Overview

- **Upload**: Client gets a pre-signed PUT URL from the backend, then uploads **directly to R2**. The backend never receives file bytes.
- **Storage**: Cloudflare R2 (S3-compatible).
- **Delivery**: Public social media uses stable URLs through the Cloudflare custom domain (`media-guard` Worker).
- **Private delivery**: Horoscope, IDs, support/chat attachments use time-limited pre-signed GET URLs (CDN host denies private prefixes).
- **Processing**: Standalone media worker claims `media_jobs`, runs Sharp/FFmpeg, then commits DB state.
- **Moderation**: New uploads are `PENDING`; admin approves/rejects.

Architecture (upload URL → R2 PUT → finalize → queue → worker → CDN/signed GET) is **production-approved**. Do not redesign it for routine hardening.

## Backend env (`.env`)

```env
R2_ACCOUNT_ID=your_account_id
R2_ACCESS_KEY_ID=your_r2_access_key
R2_SECRET_ACCESS_KEY=your_r2_secret_key
R2_BUCKET_NAME=digital-house
R2_CDN_PUBLIC_URL=https://media.konguvettuvagounder.com
MEDIA_MAX_CONCURRENT=2
# Optional: R2_SIGNED_GET_EXPIRY_SEC (default 21600), R2_DOWNLOAD_TIMEOUT_MS,
# MEDIA_ORPHAN_CLEANUP_*, MEDIA_JOB_STALE_MS, VIDEO_OPTIMIZE_ENABLED
```

**Removed / unused:** `MEDIA_DELIVERY_MODE` — delivery is chosen by object-key prefix (`isPrivateR2Object`) and API helpers (`toPublicUrlIfR2` / `toPrivateSignedUrlIfR2`), not by this env var.

**Server deployment:** Set the same `R2_*` vars on API and media worker. Check logs for `[R2] Signed URL failed` if private images do not load.

- Create an R2 bucket and attach the media custom domain via **media-guard** (not a bypassable R2 public domain binding). See [`infra/cloudflare/media-guard`](../infra/cloudflare/media-guard/README.md).
- R2 API tokens: Object Read & Write (backend only).

## Local development (critical)

`npm run dev` starts **only the API**. Finalize enqueues `media_jobs` and returns immediately; **Sharp/FFmpeg never runs in the API process**.

You must also run:

```bash
npm run dev:media-worker
```

Without the worker, `GET /api/media/:id/status` stays `processingStatus: pending` forever (job `workerId` remains null).

Production/PM2: `digitalhouse-api` **and** `digitalhouse-media-worker` (see `ecosystem.config.cjs`).

Optional timing logs: `MEDIA_PIPELINE_TIMING=true`.

## API

### POST `/api/media/upload-url`

**Auth:** JWT (`registrationMediaAuthMiddleware` — APPROVED or registration statuses).

**Body:** `fileName`, `fileType`, `fileSize`, `module`, optional `purpose`.

**Limits (declared size):**

- Images: ≤ 2 MB (jpeg, png, webp) — see [IMAGE_OPTIMIZATION.md](./IMAGE_OPTIMIZATION.md)
- Videos: ≤ 50 MB (mp4)

**Size enforcement:** Declared `fileSize` is validated when minting the PUT URL. The presigned PUT signs **Content-Type only** (not `ContentLength`) so clients are not broken by encoding differences. Actual object size/type are verified with **HeadObject on finalize**. Signing `ContentLength` on PutObject is intentionally not used — it is not equivalent to S3 POST `content-length-range` and would require an exact matching header on every client.

**Response:** `uploadUrl`, `publicUrl` (or key for private), `key`, `mediaFileId`.

Client flow:

1. `PUT` to `uploadUrl` with matching `Content-Type`
2. `POST /api/media/finalize` `{ mediaFileId }` — HEAD validate + enqueue `media_jobs`
3. Poll `GET /api/media/{mediaFileId}/status` until `processingStatus` is `completed` or `failed`
4. Persist returned variant URLs/keys

While processing, finalize returns provisional URLs (staging object) for older clients. After completion, responses point at `_full.webp` / `_opt.mp4` (and posters).

```bash
npm run build
npm run worker:media
```

PM2: `digitalhouse-api` + `digitalhouse-media-worker`. See [deploy/PM2_LOG_ROTATION.md](./deploy/PM2_LOG_ROTATION.md).

---

## Storage lifecycle

### Image lifecycle

1. Client PUTs staging key (e.g. `…/name.webp`)
2. Finalize enqueues job; DB still references staging while `pending`/`processing`
3. Worker downloads staging → writes `name_thumb.webp`, `name_md.webp`, `name_full.webp`
4. **DB transaction** sets `objectKey` / variants to `_full` and job `completed`
5. **Only then**, if this worker still owns the completed job, staging key is deleted
6. On processing failure: staging is **kept** for retry

**Retry safety:** If staging is already gone but `_full.webp` exists (prior attempt committed cleanup), the worker rehydrates from the existing full variant and completes without re-download.

### Video lifecycle

1. Client PUTs staging `…/clip.mp4`
2. Worker may write `clip_opt.mp4` (+ poster webps under `videos/thumbnails/…`)
3. DB commit points at `_opt.mp4` (or staging if optimize skipped/failed but codecs allowed)
4. Staging is deleted **only if** optimize produced a distinct `_opt.mp4` **and** posters exist (or ffmpeg is unavailable so posters were never expected)
5. Optimize failure → staging retained; never delete before success

### Cleanup lifecycle (orphan job)

Scheduler job `media_orphan_cleanup` (default hourly, `MEDIA_ORPHAN_CLEANUP_*`):

| Target | Action |
|--------|--------|
| `PENDING` rows older than threshold, no active job, unreferenced | Delete all artifacts + DB row |
| `failed` processing + `PENDING`/`REJECTED`, same gates | Delete all artifacts + DB row |
| `completed` rows | Best-effort delete **derived staging leftovers** (`_full.webp` → `.webp/.jpg…`, `_opt.mp4` → `.mp4`) not listed in live `objectKey`/variants |

**Never deletes:** active `pending`/`processing` jobs’ media, referenced/attached media, completed live variants.

**Conservative:** prefers leaving an object over deleting valid data. Does **not** list the entire R2 bucket — only DB-derived candidate keys (safe).

### User / admin delete

`deleteMediaArtifacts` / `deleteR2ImageVariants` remove the full sibling set when possible: image thumb/md/full + staging candidates; video original + `_opt` + posters. Missing keys are ignored (idempotent).

### Retry / stale recovery / failed jobs

- Process fail → job `pending` with `retryCount++` (max 3) → staging retained
- Stale `processing` reclaim unchanged (heartbeat / `MEDIA_JOB_STALE_MS`)
- Permanent `failed` → eventually eligible for orphan cleanup if unreferenced

### Deletion safety guarantees

- Staging delete runs **after** successful DB commit, never inside Sharp/FFmpeg work
- Re-checks job `status=completed` and `workerId` before staging delete
- Lost claim before commit → **no** staging delete (variants may remain as orphans until cleanup)
- Delete helpers never throw fatally on missing R2 objects

---

## R2 folder structure

```
digital-house/
  private/{horoscopes,ids,support,chat}/{userId}/yyyy/mm/…
  profile-photos/{userId}/…
  profile/{userId}/horoscope/          (legacy private; edge blocked)
  images/posts/{module}/yyyy/mm/…     (+ _thumb/_md/_full.webp)
  videos/posts/yyyy/mm/…              (+ optional _opt.mp4)
  videos/thumbnails/yyyy/mm/…         (poster webps)
  images/prominent/…
```

## Database

`media_files.processingStatus`: `pending` | `processing` | `completed` | `failed`.

`media_jobs`: durable queue (claim, retry, stale recovery). Prefer `npm run db:migrate` for schema.

Keys stored in DB; APIs hydrate CDN or signed URLs at read time.

## Security

- No public write; short-lived presigned PUT only
- Validation: type, declared size, path-safe `fileName`
- Rate limit on upload-url / status
- Private prefixes blocked on CDN host (media-guard)
- R2 credentials server-only
