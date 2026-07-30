# Media Storage & Delivery (Cloudflare R2 + CDN)

## Overview

- **Upload**: Client gets a pre-signed PUT URL from the backend, then uploads **directly to R2**. The backend never receives file bytes.
- **Storage**: Cloudflare R2 (S3-compatible).
- **Delivery**: Public social media uses stable URLs through the Cloudflare custom domain.
- **Private delivery**: Horoscope, private documents, admin-only media, and future
  private chat attachments use time-limited pre-signed GET URLs.
- **Moderation**: New uploads are `PENDING`; admin approves/rejects. Only `APPROVED` media should be considered visible (enforce in feed/post APIs if needed).

## Backend env (`.env`)

```env
# Public social media delivery through Cloudflare Edge
MEDIA_DELIVERY_MODE=public
R2_ACCOUNT_ID=your_account_id
R2_ACCESS_KEY_ID=your_r2_access_key
R2_SECRET_ACCESS_KEY=your_r2_secret_key
R2_BUCKET_NAME=digital-house
R2_CDN_PUBLIC_URL=https://media.konguvettuvagounder.com
MEDIA_MAX_CONCURRENT=2
```

**Server deployment:** For profile/post images to **display** in the app, the server must have the same R2 env vars set. Otherwise signed URLs cannot be generated and images will not load. Copy `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`, `R2_CDN_PUBLIC_URL` to the server environment and restart the backend. Check server logs for `[R2] Signed URL failed` if images still do not load.

- Create an R2 bucket (e.g. `digital-house`) and attach the media custom domain.
- Create API tokens with Object Read & Write (backend only; never expose to client).
- Public API responses must use stable custom-domain URLs. Do not sign public posts,
  profile photos, marketplace/help galleries, or prominent-people media.
- Private object prefixes (`digital-house/private/*`, legacy
  `digital-house/profile/*/horoscope/*`) must be blocked on the public custom domain,
  because signing a GET does not make an otherwise public object private. Worker source,
  `wrangler.toml`, dashboard steps and the equivalent WAF expression live in
  [`infra/cloudflare/media-guard`](../infra/cloudflare/media-guard/README.md). Authorized
  API responses then use the R2 S3 pre-signed GET URL.

## API

### POST `/api/media/upload-url`

**Auth:** JWT (user must be APPROVED).

**Body:**

- `fileName` (string)
- `fileType` (MIME: `image/jpeg`, `image/png`, `video/mp4`)
- `fileSize` (number, bytes)
- `module` (`profile` | `posts` | `jobs` | `marketplace` | `matrimony` | `help`)

**Limits:**

- Images: ≤ 2 MB declared size after client compression (jpeg, png, webp) — see [IMAGE_OPTIMIZATION.md](./IMAGE_OPTIMIZATION.md)
- Videos: ≤ 15 MB (mp4)

**Response:** `uploadUrl` (pre-signed PUT), `publicUrl` (staging CDN URL), `key`, `mediaFileId`.

Client then:

1. `PUT` optimized WebP to `uploadUrl` with `Content-Type: image/webp`
2. `POST /api/media/finalize` with `{ mediaFileId }` — API validates the R2
   object, enqueues a durable MySQL `media_jobs` row, and returns immediately.
3. Poll `GET /api/media/{mediaFileId}/status` until `processingStatus` is
   `completed` (the current mobile helper does this transparently).
4. Store returned `publicUrl` (full variant) in post/profile.

Finalize keeps the legacy response fields populated with the uploaded source URL
while processing is pending. The worker therefore preserves that source object,
so already-deployed mobile clients remain functional; updated clients wait for
the completed variant URLs.

Sharp and FFmpeg run only in the standalone media worker:

```bash
npm run db:run-media-jobs-sql
npm run build
npm run worker:media
```

PM2 starts both `digitalhouse-api` and `digitalhouse-media-worker`. The worker
polls MySQL every two seconds, atomically claims jobs, retries failures three
times, and uses `MEDIA_MAX_CONCURRENT` (default `2`).

Private image purposes preserve the same request/response shape:

- `{ module: "matrimony", purpose: "horoscope" }` stores under
  `digital-house/private/horoscopes/{userId}/...`.
- `{ module: "profile", purpose: "identity" }` stores under
  `digital-house/private/ids/{userId}/...`.

For these purposes, the legacy `publicUrl` response field contains the object key rather
than a CDN URL. Finalize also returns keys for private variants. Authorized retrieval
endpoints convert those keys to signed GET URLs. The server rejects a new
`horoscopeDocumentUrl` or `govtIdFile` that does not use protected private storage;
unchanged legacy records remain valid and are signed at read time.

Registration identity workflow: create the account, use the returned JWT with
`POST /api/media/upload-url` (`module: "profile"`, `purpose: "identity"`), upload and
finalize, then attach the returned key with `POST /api/auth/registration-identity`
(`govtIdType`, `govtIdFile`). The attach endpoint verifies that the key belongs to the
authenticated user's `digital-house/private/ids/{userId}/` prefix. Supplying an identity
file directly to initial registration is rejected so one account cannot reference another
account's private object.

### Admin (X-Admin-Key)

- `GET /api/admin/media/pending` – list PENDING media
- `POST /api/admin/media/:id/approve` – set status APPROVED
- `POST /api/admin/media/:id/reject` – set status REJECTED

## R2 folder structure

```
digital-house/
  private/
    horoscopes/{userId}/   (new horoscope PDF/image uploads; edge blocked)
    ids/{userId}/          (new registration identity images; edge blocked)
    support/{userId}/      (new support evidence uploads; edge blocked)
    chat/{userId}/         (new chat attachment uploads; edge blocked)
  profile-photos/{userId}/   (profile pictures; also used by media/upload-url when module=profile)
  profile/{userId}/horoscope/ (legacy horoscope layout; edge blocked)
  posts/
    announcements/ (via module "posts")
    jobs/
    marketplace/
    matrimony/
    help/
  thumbnails/
  documents/
```

## Database

`media_files.processingStatus`: `pending` | `processing` | `completed` | `failed`.

`media_jobs`: durable processing queue with media/object identifiers, job type,
status, retry/error state, worker claim metadata, and timestamps.

New rows store the **R2 object key** (`digital-house/...`) in media columns — `media_files.file_url`,
`media_files.variants_json`, `posts.media_url`, `posts.thumbnail_url`, the marketplace/help
galleries, and `users.profile_photo` / `pending_profile_photo` / `govt_id_file`. API responses
still return absolute URLs: public media is resolved with `toPublicUrlIfR2()` and private media
with `toPrivateSignedUrlIfR2()`. Both helpers accept a key, a current CDN URL, or a legacy
`*.r2.cloudflarestorage.com` URL, so existing rows keep working with no migration.

Tables are created via Sequelize `sync()` (no `alter: true` to avoid “too many keys” on existing tables).

## Security

- No public write to R2; upload only via pre-signed URLs.
- Strict validation (type, size, path traversal–safe `fileName`).
- Rate limit on upload-url (e.g. 30/min).
- R2 credentials only in backend env.
