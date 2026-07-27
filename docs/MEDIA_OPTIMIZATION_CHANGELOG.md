# Media Optimization Changelog — Digital House

| Field | Value |
|-------|--------|
| **Date** | 2026-07-27 |
| **Scope** | Upload validation → server optimize → R2 cache → feed variants → Expo client |
| **Backward compatible** | Yes — existing MOV / unoptimized assets still play; additive DTO fields only |
| **Schema changes** | None |

---

## 1. Files modified

### Backend

| File | Why |
|------|-----|
| `src/config/r2Cache.config.ts` | Long-lived `Cache-Control` for immutable media |
| `src/utils/r2Client.ts` | Apply Cache-Control on server puts; reuse signed GET via cache |
| `src/utils/signedUrlCache.ts` | In-memory signed URL cache (TTL ≈ expiry − 5m, capped) |
| `src/utils/videoProcessor.ts` | ffprobe validate + ffmpeg ≤720p H.264/AAC/faststart + frame extract |
| `src/utils/mediaVariants.ts` | Derive `_thumb` / `_md` / `_full` WebP paths |
| `src/services/MediaProcessing.service.ts` | Finalize **video** path (optimize + posters); images unchanged contract |
| `src/services/Media.service.ts` | New uploads: MP4-only MIME; pending_upload until finalize |
| `src/services/Feed.service.ts` | Additive `mediaUrlThumb/Medium/Full`; prefer medium as `mediaUrl` for images |
| `src/services/Home.service.ts` | DTO types for variant fields |
| `src/constants/postMedia.constants.ts` | `ALLOWED_POST_VIDEO_MIMES` vs `LEGACY_POST_VIDEO_MIMES` |
| `src/validations/media.validation.ts` / `post.validation.ts` | Reject non-MP4 new uploads; clearer errors |
| `.env.example` | Document `VIDEO_OPTIMIZE_ENABLED`, signed URL cache envs |

### Mobile

| File | Why |
|------|-----|
| `src/components/home/PostMedia.tsx` | `expo-image` + `cachePolicy="memory-disk"` |
| `src/components/media/FeedVideoPlayer.tsx` | `bufferOptions` (~8s forward); poster via expo-image; warm-URI skip spinner |
| `src/utils/videoUriWarmCache.ts` | Session memory of already-buffered video URIs |
| `src/utils/mediaVariantUrls.ts` | Prefer medium/thumb **without** rewriting signed URLs |
| `src/utils/postMappers.ts` / `hooks/useHome.ts` | Feed/explore/profile cards use medium where available |
| `src/config/media.config.ts` | New upload MIME = `video/mp4` |
| `src/utils/mediaUpload.ts` | Video PUT then `finalizeMedia` |
| `src/api/media.api.ts` / `home.api.ts` | Finalize + feed variant types |
| `src/media/pickerAsset.ts` | Validation copy aligned with MP4 policy |

---

## 2. Architecture (after)

```
Client compress (EAS) → PUT staging object → POST /media/finalize
                              ↓
              Image: Sharp → _thumb/_md/_full WebP (+ Cache-Control)
              Video: FFmpeg → *_opt.mp4 H.264/AAC faststart + poster WebPs
                              ↓
                     R2 (immutable Cache-Control)
                              ↓
              Feed signs variants once (signed URL cache)
                              ↓
         Mobile: expo-image disk cache | poster first | video current+next only
```

**Accept-Ranges / seek:** Served by R2/S3-compatible Range GET (not Express). Faststart (`moov` before `mdat`) enables immediate start. Verify with `curl -I` / Range `bytes=0-1` on a signed object URL.

**ETag / Last-Modified:** Provided by R2 object store on GET; app sets `Cache-Control` on PutObject so browsers/CDN honor long TTL.

---

## 3. Measurements (estimated before → after)

Baseline from product report: **~1.5 GB / 20 min** mobile data under heavy video scroll.

| Metric | Before (typical) | After (expected) | Notes |
|--------|------------------|------------------|-------|
| Average feed image | Full WebP / original (~200–800 KB) | Medium WebP (~40–120 KB) | Feed uses medium |
| Average video stored | Client 720p variable; often no faststart | ≤720p H.264/AAC + faststart | Server re-encode when enabled |
| Average feed payload (media URLs) | 1 signed URL / item | +2–3 additive fields (small JSON) | Negligible API bytes |
| Bandwidth / 20 min scroll | ~1.5 GB | **~0.4–0.7 GB** | Depends on video ratio & revisit rate |
| Repeated image downloads | High (RN Image) | Low (expo-image memory+disk) | Same URI → disk hit |
| Repeated video downloads | Full rebuffer on revisit | Reduced (warm cache + shorter buffer) | OS HTTP cache + player warm |
| Video startup / first frame | Wait full buffer often | Poster instant; media starts on Range | Faststart critical |
| Feed scroll spinner | Common on revisit | Rare when URI warmed | Poster always first |
| API CPU (signed URLs) | Sign every feed item every request | Cache hit until near expiry | Big win under 80 users |
| Server RAM (1 GB) | Feed + DB pool | + single FFmpeg job at finalize | Cap concurrency; `VIDEO_OPTIMIZE_ENABLED=0` if OOM |
| Concurrent users (1 GB test) | Degrades early on media+DB | **Target ~80** with pool=8, URL cache, no per-request FFmpeg | Finalize still serializes heavy jobs |

### Bandwidth reduction drivers

1. Medium images in feed (~50–80% smaller than full).
2. Server video bitrate cap + 720p ceiling.
3. ~8s forward buffer (not entire clip).
4. No preload of whole feed players.
5. Disk-cached images + warmed video URIs.
6. Long R2 Cache-Control when CDN/public URL path is used.

**Expected mobile data reduction:** **~45–70%** for mixed image/video feeds; **~30–50%** for video-heavy sessions once posters dominate scroll and revisits stop re-downloading.

**Expected concurrent-user improvement on 1 GB RAM:** **~2×** vs prior (less signing CPU, smaller egress pressure, no N parallel FFmpeg). Still limited by MySQL pool and finalize spikes — keep `DB_POOL_MAX≈8` and one FFmpeg lock.

---

## 4. Performance impact summary

| Area | Impact |
|------|--------|
| **Bandwidth** | Large ↓ (variants + buffer + cache) |
| **CPU (API)** | ↓ signed URL generation via cache |
| **CPU (upload)** | ↑ briefly on finalize (FFmpeg); soft-fallback if fail |
| **Memory (API)** | Stable; FFmpeg single-job + `-threads 1` |
| **Memory (mobile)** | Bounded warm set (40 URIs); fewer players |
| **Compatibility** | Legacy MOV / non-optimized keys still signed & played |

---

## 5. Ops knobs

```bash
VIDEO_OPTIMIZE_ENABLED=1          # 0 = skip ffmpeg (MIME/duration only)
R2_SIGNED_GET_EXPIRY_SEC=3600
R2_SIGNED_URL_CACHE_MS=3300000    # default ≈ expiry − 5m
```

Require `ffmpeg` + `ffprobe` on PATH for full video optimize + codec validation.

---

## 6. Risks

| Risk | Mitigation |
|------|------------|
| FFmpeg OOMs on 1 GB RAM | Single lock; `veryfast`; disable with env; soft-fallback keeps upload |
| Finalize timeout on large clips | Client already compresses; server caps edge/bitrate |
| Presigned URL path rewrite | Client **never** rewrites signed URLs |
| CDN vs private signed GET | Cache-Control helps when public CDN URL used; signed still TTL-bound |
| Old clients ignore variant fields | `mediaUrl` already set to medium for images |

---

## 7. Rollback strategy

1. Set `VIDEO_OPTIMIZE_ENABLED=0` — uploads skip server transcode; images unchanged.
2. Revert Feed DTO preference: clients can ignore `mediaUrlMedium` (fields additive).
3. Disable signed URL cache by setting `R2_SIGNED_URL_CACHE_MS=0` (if supported) or revert `signedUrlCache` usage in `r2Client`.
4. Mobile: swap `PostMedia` back to RN `Image` / remove `bufferOptions` if a device regresses (unlikely).
5. No DB migration to roll back.

---

## 8. Verification checklist

- [ ] Upload MP4 → finalize → R2 object has `Cache-Control: public, max-age=31536000, immutable`
- [ ] `curl -I` / Range request on video URL returns `Accept-Ranges: bytes`
- [ ] Reject AVI/MOV as **new** upload MIME; legacy posts still play
- [ ] Feed image network tab shows `*_md.webp` (or medium signed key)
- [ ] Scroll away and back: no spinner when URI warmed; poster always visible first
- [ ] 1 GB host: two concurrent video finalizes do not crash (second waits / soft-fails)

---

## 9. Prompt 6 gap fill (2026-07-27)

Closed remaining soft/incomplete validation paths while keeping **existing ready media** untouched (early return in finalize).

| Change | File | Why |
|--------|------|-----|
| Reject AVI/MOV/MKV/3GP by **extension** on presign | `postMedia.constants.ts`, `media.validation.ts` | MIME alone can be spoofed; containers must be MP4 |
| Always reject bitrate &gt; 12 Mbps and resolution &gt; 4K | `videoProcessor.ts` `assertVideoAllowed` | Bandwidth + encode safety on 1GB RAM |
| Optimize-fail fallback requires H.264+AAC | `MediaProcessing.service.ts` | Do not keep unsupported codecs when re-encode fails |
| No-transcode path requires H.264+AAC when ffprobe exists | same | `VIDEO_OPTIMIZE_ENABLED=0` still validates codecs |
| Require `mime_type: video/mp4` on video create | `post.validation.ts` | Close optional-MIME skip hole |
| Expo buffer ~5s forward | `FeedVideoPlayer.tsx` | Less speculative download per clip |
| Fix stale “no finalize” comment | `mediaUpload.ts` | Docs match `finalizeMedia` call |
| Startup warn if ffmpeg missing | `server.ts` | Make ops gap visible in logs |

**Ops (required for full 720p server path):** install `ffmpeg` + `ffprobe` on the API host. Without them, client compression + Cache-Control re-put still run; server 720p/poster generation does not.

**Already in place (unchanged this pass):** Cache-Control on PutObject, signed URL cache, feed medium variants, expo-image disk cache, active+next preload only, R2 Accept-Ranges, legacy MOV playback.
