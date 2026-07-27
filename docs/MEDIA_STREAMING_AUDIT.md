# Media Streaming Audit Report — Digital House

> **Update (2026-07-27):** Optimization sprint implemented — see [`MEDIA_OPTIMIZATION_CHANGELOG.md`](./MEDIA_OPTIMIZATION_CHANGELOG.md).
> Cache-Control on server PutObject, signed URL cache, FFmpeg video finalize, feed medium variants, and Expo client buffering/cache are in code. This audit remains the pre-change baseline.

| Field | Value |
|-------|--------|
| **Project** | Digital House |
| **Scope** | Upload → compress → store (R2) → sign/CDN → mobile Expo Video / admin display |
| **Stacks** | Backend (Express + Sharp + R2), Mobile (Expo + `expo-video` + compressor), Admin (images only) |
| **Method** | Static code inspection (no live R2 HEAD / Cloudflare dashboard probe) |
| **Date** | 2026-07-27 |
| **Code modified** | **None** (audit-only; see changelog for later implementation) |

---

## Executive summary

The pipeline is a **short-form progressive media** design (Instagram-style feed), not a Netflix-style adaptive streaming stack.

| Area | Status |
|------|--------|
| Image upload + server WebP variants | Strong |
| Client video compress (720p / ~2 Mbps) | Strong in EAS builds; weak in Expo Go |
| Server video transcode / FFmpeg | **Absent** |
| HLS / ABR | **Absent** |
| Thumbnails | Client video poster + server image `_thumb/_md/_full` |
| Expo Video feed UX | Solid (poster, preload, mute-by-default) |
| R2 object `Cache-Control` | **Not set by app** |
| App-level `Accept-Ranges` | **Not set** (relies on R2/S3 native range GET) |
| Cloudflare CDN caching | Documented via `R2_CDN_PUBLIC_URL`; runtime prefers **signed GET** for private bucket |

| Priority | Count |
|----------|------:|
| Critical | 3 |
| High | 8 |
| Medium | 9 |
| Low | 5 |
| **Total** | **25** |

### Fix first (recommendations only — not implemented)

1. Set **`Cache-Control`** (and consider `Content-Disposition`) on R2 `PutObject` for images/videos  
2. Server **video probe + optional remux** (`faststart` / H.264 baseline) — today codec is trust-the-client  
3. Use **image variants** (`_thumb` / `_md`) in feed DTOs instead of always signing full WebP  
4. Add Expo Video **`bufferOptions`** / prefer `replaceAsync`; drop deprecated `allowsFullscreen` usage patterns  

---

## 1. Architecture overview

```
┌─────────────┐   POST /media/upload-url    ┌──────────────┐
│ Mobile app  │ ──────────────────────────► │ API (auth)   │
│ compress    │ ◄── presigned PUT + publicUrl│ media_files  │
└──────┬──────┘                             └──────┬───────┘
       │ PUT bytes (Content-Type only)             │
       ▼                                           │
┌─────────────┐   [image] POST /finalize    ┌──────▼───────┐
│ Cloudflare  │ ◄── Sharp → _thumb/_md/_full│ API process  │
│ R2 (private)│                             └──────────────┘
└──────┬──────┘
       │ signed GET (1h) ± CDN public URL
       ▼
┌─────────────┐
│ Feed / Expo │  progressive MP4 + poster
│ VideoView   │  RN Image for photos
└─────────────┘
```

**Admin web:** no `<video>` player; Prominent People images upload via **backend base64 proxy** (avoids browser→R2 CORS).

---

## 2. Upload flow

### Primary path (posts / most modules)

| Step | Detail | Evidence |
|------|--------|----------|
| 1. Presign | `POST /api/media/upload-url` | `media.routes.ts`, `Media.service.ts` |
| 2. Auth / rate | Registration-media JWT; **30 req/min** | `media.routes.ts` |
| 3. Client PUT | Direct to R2 via `@aws-sdk` presigned URL (**15 min**) | `r2Client.getPresignedPutUrl` |
| 4. Image finalize | `POST /api/media/finalize` → Sharp variants | `MediaProcessing.service.ts` |
| 5. Video | No finalize of video bytes; optional separate `video_thumbnail` upload | `Media.service.ts` |
| 6. Post create | Declares `media_url`, `thumbnail_url`, `video_duration`, `file_size` | `post.validation.ts` / `Post.service.ts` |

**Backend does not receive post media bytes** on the happy path (no multer).

### MIME & size gates

| Kind | MIME allowlist | Max size (declared) | Duration |
|------|----------------|---------------------|----------|
| Image | jpeg/png/webp | **2 MB** after client compress | — |
| Video | mp4 / quicktime / m4v | **50 MB** after compress | **3–60 s** |

Constants: `backend/src/constants/postMedia.constants.ts`, mirrored in `mobile/src/config/media.config.ts`.

### Alternate upload paths (weaker pipeline)

| Path | Limit | Sharp finalize? |
|------|-------|-----------------|
| Profile photo presign | ≤ **5 MB** jpeg/png | No |
| Horoscope | ≤ **10 MB** pdf/jpeg/png | No |
| Admin prominent proxy | ≤ **2.5 MB** | No `media_files` user pipeline |

### Gaps in upload integrity

- Presign trusts **client-declared** `fileSize` / duration — no post-PUT size probe for videos  
- Duration is **client-declared**, not ffprobe’d  
- Docs (`MEDIA.md`) still mention older limits in places (e.g. historical 15 MB) vs code **50 MB**

---

## 3. Compression

### Images

| Stage | Tool | Behavior |
|-------|------|----------|
| Mobile | `expo-image-manipulator` | WebP, quality loop ~0.82→0.45, max edge 1920, target ~450 KB |
| Server finalize | **Sharp** | EXIF-orient, resize, WebP encode; quality 82→55 step −8; target `IMAGE_TARGET_BYTES` (450 KB) for full |

Variants written:

| Variant | Max edge | Suffix |
|---------|----------|--------|
| thumb | 320 | `_thumb.webp` |
| medium | 1080 | `_md.webp` |
| full | 1920 | `_full.webp` (becomes canonical `fileUrl`) |

Bomb guard: max **40M pixels**; download for process capped at **12 MB**.

**Worker queue:** none — finalize runs in-process (API can block under load).

### Videos

| Stage | Tool | Behavior |
|-------|------|----------|
| Mobile (EAS / dev client) | `react-native-compressor` | `maxSize: 720`, `bitrate: 2_000_000` (~2 Mbps), manual method |
| Mobile (Expo Go) | **Skipped** | Original file allowed only if ≤ 50 MB |
| Server | **None** | No FFmpeg, no re-encode |

**Implication:** Expo Go users can upload “camera dump” MP4s that are heavy/variable codec; EAS builds are far more consistent.

---

## 4. Video codec, bitrate, resolution, file size

| Property | Enforced where? | Value |
|----------|-----------------|-------|
| Container / MIME | Client + API allowlist | mp4 / mov / m4v |
| Max resolution | Client compressor only | **720p** longest edge |
| Target bitrate | Client compressor only | **2 Mbps** |
| Codec | **Not enforced server-side** | Comment assumes H.264; device may emit HEVC/other depending on OS |
| Max file size | Client + API | **50 MB** |
| Duration | Client + API metadata | **3–60 s** |
| Audio track | Not normalized | Passthrough |
| `moov` atom / faststart | **Not remuxed** | Seek-before-download may suffer on some files |

**No ABR ladder** (360p/720p/1080p). Single progressive file only.

---

## 5. Thumbnail generation

| Media | How | Where stored |
|-------|-----|--------------|
| Image | Server Sharp `_thumb` / `_md` / `_full` | R2 keys + `media_files.variantsJson` |
| Video | Client `expo-video-thumbnails` (~quality 0.7) → WebP upload as purpose `video_thumbnail` | `…/videos/thumbnails/…` + post `thumbnailUrl` |
| Server frame grab from video | **Not implemented** | — |

**Feed behavior:** shows `thumbnailUrl` as poster until playback; image feed typically signs **full** WebP — thumb/md variants exist but are **underused** in list DTOs.

---

## 6. Expo Video configuration (mobile)

Package: `expo-video` ~3.0.16 (not `expo-av`).

### Feed player (`FeedVideoPlayer.tsx`)

| Setting | Value |
|---------|--------|
| `loop` | `true` |
| Default mute | **Muted** (global feed audio preference) |
| `audioMixingMode` | `auto` when muted / `doNotMix` when unmuted |
| Inline `contentFit` | `cover` |
| Fullscreen `contentFit` | `contain` |
| Inline `nativeControls` | `false` (custom chrome) |
| Fullscreen `nativeControls` | `true` |
| `allowsFullscreen` | Still set (`false` inline / `true` modal) — Expo deprecates in favor of `fullscreenOptions` |
| `bufferOptions` | **Not configured** |

### Lifecycle / preloading / buffering

| Mode | Behavior |
|------|----------|
| Inactive | Poster only — **no** native player mount |
| Preload | Mounts `useVideoPlayer(uri)` to warm decoder/network; UI stays on poster (**no VideoView**) |
| Active | `VideoView` + autoplay if screen focused and app foreground |
| Selection | One active + next preload; viewability ~65% / 120 ms |

Cleanup prefers `replaceAsync(null)` with sync `replace` fallback (Expo warns sync `replace` can hitch UI).

**No explicit buffer window** (`preferredForwardBufferDuration` / `bufferOptions`) — OS/expo-video defaults only.

---

## 7. R2 delivery

| Item | Implementation |
|------|----------------|
| Bucket | Private (credentials server-only) |
| Upload | Presigned **PUT**, expiry **900 s** |
| Download | Presigned **GET**, default expiry **3600 s** |
| In-process URL cache | **4 min** TTL, max **2000** keys (`signedUrlCache.ts`) |
| Public CDN helper | `getCdnPublicUrl` + `R2_CDN_PUBLIC_URL` |
| Runtime display | `toSignedUrlIfR2` rewrites stored URLs to **fresh signed GET** when R2 creds work |

PutObject metadata today:

| Header | On upload / server put? |
|--------|-------------------------|
| `Content-Type` | **Yes** |
| `Cache-Control` | **No** |
| `Content-Disposition` | **No** |
| Multipart upload | **No** (single PUT; 50 MB cap) |

---

## 8. Cloudflare cache

| Topic | Finding |
|-------|---------|
| Intended CDN | Custom domain / R2 public URL via `R2_CDN_PUBLIC_URL` (`MEDIA.md`) |
| Cache rules in repo | **None** (no Cloudflare Terraform / `_headers` for R2) |
| Effect of signed URLs | Query-string signed GETs are often **poorly cached** or treated as unique — CDN hit ratio depends on whether clients hit bare CDN URLs vs signed URLs |
| Object-level cache hints | Missing `Cache-Control: public, max-age=…, immutable` on stable keys |

**Risk:** Even with Cloudflare in front, lack of object `Cache-Control` + heavy use of short-lived signed URLs limits edge caching for feed scrolls.

---

## 9. Accept-Ranges

| Layer | Behavior |
|-------|----------|
| Express API | Does **not** proxy media bytes for posts; no `Accept-Ranges` header from app |
| R2 / S3 GET | Typically supports **HTTP Range** on `GetObject` when client sends `Range` |
| Mobile player | Relies on platform networking + progressive download of MP4 |

**Gap:** Without `faststart` remux, some MP4s need large initial download before first frame. App does not verify `moov` placement.

---

## 10. Cache-Control (summary)

| Surface | Cache-Control |
|---------|---------------|
| R2 objects (app-written) | **Not set** |
| Profile API responses | Some `no-store` (unrelated to media objects) |
| Signed GET responses | Controlled by R2/Cloudflare defaults + signature lifetime |

---

## 11. Preloading & buffering (end-to-end)

| Mechanism | Present? | Notes |
|-----------|----------|-------|
| Feed video preload (next item) | Yes | Player warm without VideoView |
| Image aspect / URL prefetch | Partial | Home prefetch helpers; not `expo-image` disk cache |
| ABR / multi-bitrate preload | No | Single file |
| Explicit buffer seconds | No | expo-video defaults |
| Thumbnail-first paint | Yes | Poster until play / load |

---

## 12. Admin frontend

- **No video streaming UI**  
- Images via `<img src={apiUrl}>`  
- Only upload UI: Prominent People (backend proxy)  
- Backend admin media moderation APIs exist; admin UI does not appear to consume pending-media screens

---

## 13. Findings catalog

### Critical

| ID | Finding | Impact |
|----|---------|--------|
| M1 | No server video transcode / codec enforcement | Bad devices upload HEVC/high-bitrate files; playback fails or buffers heavily on others |
| M2 | No `Cache-Control` on R2 objects | Weak Cloudflare/browser caching; repeated full fetches |
| M3 | Signed URL delivery vs CDN caching tension | Feed re-signs URLs; edge cache effectiveness unclear |

### High

| ID | Finding | Impact |
|----|---------|--------|
| M4 | No HLS / ABR | Single 720p/2Mbps (or worse) for all networks |
| M5 | Expo Go skips video compress | Inconsistent quality/size in local testing vs production EAS |
| M6 | Image `_thumb`/`_md` unused in feed DTOs | Extra bytes on cellular for list scroll |
| M7 | No `bufferOptions` on expo-video | Less control of stall vs data use |
| M8 | Client-declared duration/size for video | Bypass risk / incorrect metadata |
| M9 | No `faststart` remux | Delayed first frame on some MP4s |
| M10 | Sharp finalize in-process | API latency spikes under concurrent image uploads |
| M11 | `allowsFullscreen` still used | Future Expo breakage / warnings |

### Medium

| ID | Finding |
|----|---------|
| M12 | Profile/horoscope/prominent skip Sharp finalize |
| M13 | No multipart upload (mitigated by 50 MB cap) |
| M14 | Sync `replace` fallback on player cleanup |
| M15 | Preload warms player but shows poster only (good UX; limited true buffer fill visibility) |
| M16 | Docs drift (15 MB vs 50 MB; CDN vs signed) |
| M17 | Admin has no media pending UI despite API |
| M18 | RN `Image` instead of `expo-image` caching |
| M19 | No server video thumbnail fallback if client omits poster |
| M20 | `IMAGE_UPLOAD_MAX_BYTES` env unused by Zod (hard 2 MB) |

### Low

| ID | Finding |
|----|---------|
| M21 | YouTube embeds via WebView (separate path) |
| M22 | Video trim UI present (good) but adds complexity |
| M23 | Orphan media cleanup job exists (positive) |
| M24 | Rate limit 30/min on media routes (positive) |
| M25 | Decompression bomb guard on Sharp (positive) |

---

## 14. What already works well

1. Direct-to-R2 uploads keep API memory low  
2. Image pipeline (client + Sharp WebP variants) is production-grade for photos  
3. Clear mobile targets: **720p / 2 Mbps / ≤60 s / ≤50 MB**  
4. Feed player lifecycle: mute-by-default, single active, next preload, poster frames  
5. Signed URL process cache reduces crypto churn  
6. MIME allowlists and Zod validation on presign  

---

## 15. Recommended roadmap (not implemented)

### Phase A — Delivery headers & caching

1. On `PutObject` / finalize puts: `Cache-Control: public, max-age=31536000, immutable` for content-addressed keys (or long max-age)  
2. Clarify product: **CDN public URLs for approved media** vs always-signed private GETs  
3. Document Cloudflare Cache Rules for `/digital-house/*`

### Phase B — Video integrity

1. Optional FFmpeg worker: probe → enforce H.264 + AAC → `-movflags +faststart`  
2. Reject non-compliant uploads after PUT  
3. Generate server-side poster if client thumbnail missing  

### Phase C — Feed efficiency

1. Return `mediaUrl` + `mediaUrlMedium` / `thumb` in feed DTOs; mobile picks by screen width  
2. Configure expo-video `bufferOptions`  
3. Prefer `replaceAsync` only; migrate off `allowsFullscreen`

### Phase D — Scale streaming (product decision)

1. HLS ladder (e.g. 360 / 720) via Cloudflare Stream or custom encoder  
2. Background Sharp queue  

---

## 16. Key file index

| Area | Path |
|------|------|
| Upload service | `backend/src/services/Media.service.ts` |
| Image finalize | `backend/src/services/MediaProcessing.service.ts` |
| Sharp encode | `backend/src/utils/imageProcessor.ts` |
| Image constants | `backend/src/config/image.config.ts` |
| Media limits | `backend/src/constants/postMedia.constants.ts` |
| R2 client | `backend/src/utils/r2Client.ts` |
| Signed URL cache | `backend/src/utils/signedUrlCache.ts` |
| Mobile limits | `mobile/src/config/media.config.ts` |
| Video compress | `mobile/src/utils/videoOptimizer.ts` |
| Feed player | `mobile/src/components/media/FeedVideoPlayer.tsx` |
| Docs | `backend/MEDIA.md`, `backend/IMAGE_OPTIMIZATION.md` |

---

**End of report.** No application code or infrastructure was modified during this audit.
