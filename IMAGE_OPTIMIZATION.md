# Image Optimization Pipeline

## Overview

DigitalHouse compresses **all user-uploaded images** before they are stored in Cloudflare R2:

1. **Client (React Native)** – `expo-image-manipulator` resizes to max 1920px and compresses to WebP (~450 KB target).
2. **Upload** – Pre-signed PUT to R2 (staging key).
3. **Server (Node + sharp)** – `POST /api/media/finalize` re-validates, strips EXIF, generates **thumb / medium / full** WebP variants, deletes staging object.

Videos are unchanged (MP4, ≤ 15 MB).

## Configuration (backend `.env`)

```env
IMAGE_MAX_DIMENSION=1920
IMAGE_TARGET_BYTES=450000
IMAGE_MEDIUM_MAX=1080
IMAGE_THUMB_MAX=320
IMAGE_UPLOAD_MAX_BYTES=2097152
IMAGE_PROCESS_DOWNLOAD_MAX_BYTES=12582912
IMAGE_WEBP_QUALITY=82
```

## API

| Endpoint | Description |
|----------|-------------|
| `POST /api/media/upload-url` | Pre-signed PUT; images use `.webp` keys |
| `POST /api/media/finalize` | Body: `{ "mediaFileId": number }` → variants + `publicUrl` |

## Variants (R2 keys)

For upload key `digital-house/posts/posts/abc123.webp`:

- `abc123_thumb.webp` (320px)
- `abc123_md.webp` (1080px)
- `abc123_full.webp` (1920px, ~300–500 KB)

Posts/profiles store the **full** CDN URL in the database.

## Mobile usage

```ts
import { uploadOptimizedImage } from "../utils/mediaUpload";

const { publicUrl } = await uploadOptimizedImage(localUri, "posts", onProgress);
```

## Migration

Optimize legacy uploads:

```bash
cd backend
npx ts-node --transpile-only scripts/optimize-existing-media.ts --dry-run
npx ts-node --transpile-only scripts/optimize-existing-media.ts
```

## Libraries

| Layer | Library | Why |
|-------|---------|-----|
| Mobile | `expo-image-manipulator` | On-device resize/WebP before upload |
| Server | `sharp` (libvips) | Fast, production-grade resize/WebP/EXIF strip |

## Expected savings

| Scenario | Before | After (typical) |
|----------|--------|-----------------|
| 10 MP phone photo | 3–8 MB | ~350–500 KB (full) + small thumbs |
| Feed load | Full JPEG | WebP full or medium |
| Storage per image | 1 object | 3 variants (thumb+md+full), originals removed |

Rough **80–95% storage and bandwidth reduction** for photo-heavy feeds.
