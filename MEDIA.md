# Media Storage & Delivery (Cloudflare R2 + CDN)

## Overview

- **Upload**: Client gets a pre-signed PUT URL from the backend, then uploads **directly to R2**. The backend never receives file bytes.
- **Storage**: Cloudflare R2 (S3-compatible), private bucket.
- **Delivery**: Public read via Cloudflare CDN (custom domain or R2 public URL).
- **Moderation**: New uploads are `PENDING`; admin approves/rejects. Only `APPROVED` media should be considered visible (enforce in feed/post APIs if needed).

## Backend env (`.env`)

```env
# Cloudflare R2 (private bucket)
R2_ACCOUNT_ID=your_account_id
R2_ACCESS_KEY_ID=your_r2_access_key
R2_SECRET_ACCESS_KEY=your_r2_secret_key
R2_BUCKET_NAME=digital-house
# Public CDN URL (custom domain or R2 dev subdomain)
R2_CDN_PUBLIC_URL=https://your-cdn-domain.com
```

- Create an R2 bucket (e.g. `digital-house`), keep it **private**.
- Create API tokens with Object Read & Write (backend only; never expose to client).
- For CDN: either attach a custom domain to the bucket, or use R2’s public bucket URL.

## API

### POST `/api/media/upload-url`

**Auth:** JWT (user must be APPROVED).

**Body:**

- `fileName` (string)
- `fileType` (MIME: `image/jpeg`, `image/png`, `video/mp4`)
- `fileSize` (number, bytes)
- `module` (`profile` | `posts` | `jobs` | `marketplace` | `matrimony` | `help`)

**Limits:**

- Images: ≤ 5 MB (jpg, jpeg, png)
- Videos: ≤ 15 MB (mp4)

**Response:** `uploadUrl` (pre-signed PUT), `publicUrl` (CDN URL to store in DB), `key`, `mediaFileId`.

Client then `PUT` file to `uploadUrl` with `Content-Type: <fileType>` (no auth). Store `publicUrl` in post/profile.

### Admin (X-Admin-Key)

- `GET /api/admin/media/pending` – list PENDING media
- `POST /api/admin/media/:id/approve` – set status APPROVED
- `POST /api/admin/media/:id/reject` – set status REJECTED

## R2 folder structure

```
digital-house/
  profile/{userId}/
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

`media_files`: `id`, `user_id`, `module`, `file_url`, `file_type` (image | video), `status` (PENDING | APPROVED | REJECTED), `created_at`, `updated_at`.

Tables are created via Sequelize `sync()` (no `alter: true` to avoid “too many keys” on existing tables).

## Security

- No public write to R2; upload only via pre-signed URLs.
- Strict validation (type, size, path traversal–safe `fileName`).
- Rate limit on upload-url (e.g. 30/min).
- R2 credentials only in backend env.
