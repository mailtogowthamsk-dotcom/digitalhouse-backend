# DigitalHouse content safety

Invariant: **UNVERIFIED = NOT PUBLIC**.

Pipeline:

UPLOAD → private R2 quarantine → Media Worker processing → local moderation → DigitalHouse policy → SAFE → publication gate → public / Feed.

Never: upload → publish → moderate.

This architecture does **not** claim 100% detection accuracy. It guarantees that unverified, uncertain, failed, timed-out, corrupt, and unsupported content cannot become public.

## Architecture (reused)

- Existing Media Worker + `media_jobs` + FFmpeg + Sharp
- Existing Cloudflare R2 bucket (logical prefix `digital-house/private/quarantine/` until SAFE)
- Existing Feed Fetch Engine (SQL filter `safety_decision = SAFE` only — no inference, no FFmpeg, no media download, no N+1 moderation queries)
- PM2 `digitalhouse-api` + `digitalhouse-media-worker` + `digitalhouse-scheduler`
- Redis is used for auth/OTP/Socket.IO, not as a public post cache

## Model

| Field | Value |
| --- | --- |
| Name | nsfwjs 4.x + MobileNet V2 weights |
| Source | https://github.com/infinitered/nsfwjs |
| License | MIT (commercial use allowed; verified from the nsfwjs LICENSE) |
| Cost | ₹0 (local; no Rekognition/Azure/Google) |
| Size | MobileNet V2 (~ few tens of MB weights, not in git) |
| Runtime | `@tensorflow/tfjs` (pure JS, optionalDependency) inside the existing Media Worker |
| Weights | **not in git** — `bash scripts/install-moderation-model.sh` |
| Env | `MODERATION_MODEL_DIR` |

nsfwjs classes: Neutral, Drawing, Sexy, Porn, Hentai. The local provider normalizes these to DigitalHouse categories (`SEXUAL_EXPLICIT`, `SEXUALIZED_CONTENT`, `SAFE`, `UNCERTAIN`). Policy never branches on raw provider labels.

**Not selected:** AWS Rekognition / Azure / Google (paid, forbidden for v1). NudeNet (AGPL). Custom CSAM classifiers (unvalidated; not built).

**Gore/violence images:** nsfwjs does **not** classify gore. Caption keyword rules cover explicit violent language. Image/video gore is a remaining risk until a licensed local gore model is added. Uncertain / failed still stays non-public.

**Sexual activity / nudity labels:** nsfwjs does not emit separate `SEXUAL_ACTIVITY` / `SEXUAL_NUDITY` classes. Explicit sexual imagery is mapped through porn/hentai → `SEXUAL_EXPLICIT`. Policy still accepts those DigitalHouse categories if a future provider supplies them.

This is **not** 100% accurate. False positives (beach, sports, traditional clothing, sleeveless clothing, family photos) should go to REVIEW, not automatic SAFE. Child-related sexual/suspicious content is fail-closed (REVIEW/BLOCK) — there is no custom CSAM classifier. Do not retain prohibited media in public prefixes.

## Hardware / concurrency

Media worker PM2 `max_memory_restart` is **1024M**. Start with `MODERATION_MAX_CONCURRENCY=1` (also the ecosystem default). `MEDIA_MAX_CONCURRENT` remains 2 for processing; inference is separately capped so the API and Feed stay responsive.

Video moderation streams R2 to a temp file (`dh-mod-`) and extracts multiple bounded JPEG frames with the existing FFmpeg helper. It does not load the whole video into a second Node Buffer for inference.

## Thresholds (starting, conservative)

Configured via `MODERATION_BLOCK_THRESHOLD` (default 0.5 porn+hentai → BLOCK), `MODERATION_REVIEW_THRESHOLD` (0.2 → REVIEW), sexy 0.75 / 0.5.

These were chosen to fail closed on sexual content for a family/community product, **not** from a production labeled set. Re-tune only after `scripts/benchmark-moderation.ts` on a controlled local set. Do not commit prohibited media. Do not claim production precision/recall until that benchmark is run on the target host.

## States (`posts.safety_decision`)

`PENDING` | `PROCESSING` | `SAFE` | `REVIEW_REQUIRED` | `BLOCKED` | `FAILED`

Only `SAFE` **and** `moderation_status = ACTIVE` is public. Independent of the older hide/restore `moderation_status`.

Valid transitions (conceptual): PENDING → PROCESSING → SAFE | REVIEW_REQUIRED | BLOCKED | FAILED. FAILED never becomes SAFE automatically.

Historical rows are backfilled `SAFE` at migrate time (no blocking full rescan). New uploads default `PENDING`.

## Publication gate

Conditional update: `id` + `media_version` must match; `deletedAt` / `SOFT_DELETED` cannot publish; caption must still pass; `FAILED` / timeout / missing never write `SAFE`.

Edits that change media bump `media_version`. Version N results never authorize N+1.

Marketplace `LIVE` additionally requires `assertCanGoLive` → `safetyDecision === SAFE`.

## Public surfaces

Feed, Explore/search, Home highlights, member profile posts (non-self), saved/liked, helping-hands public counts, post detail (non-owner), engagement, reposts, and notifications (post id only; `getPost` 404s if not SAFE) all require precomputed SAFE.

`toPublicUrlIfR2` returns **null** for `digital-house/private/` keys. Public APIs must not fall back to the raw object key.

Socket.IO `feed:new_post` emits only after SAFE (and not for marketplace until LIVE).

## Admin

`POST /api/admin/posts/:id/safety-allow` and `safety-reject` require `posts.manage`, current `mediaVersion`, transaction-safe update, and `moderation_actions` (`SAFETY_ALLOW` / `SAFETY_REJECT`). Admin video preview uses `controls` + `preload="none"` (no autoplay). Quarantine media is served with signed URLs.

## Account enforcement

Blocked content is audited in `content_safety_scans` + structured logs. Repeated/severe abuse uses the **existing** admin warn / suspend flows (`reports.warn`, `users.suspend`). No automatic account deletion.

Severe user reports (`nudity`, `porn`, `sexual`, `child`, `gore`, `violence`, …) pull a SAFE post back to `REVIEW_REQUIRED`.

## Fingerprints

Images: dHash-16, Hamming ≤ 5, stored on BLOCK/REVIEW. Detects resize/recompress/metadata/filename changes; not perfect.

Video perceptual hashing is **not** implemented (Media Worker stability). Extension point: after frame extraction, hash key frames and compare — do not add this until benchmarked.

## Retention

Promoted quarantine objects are deleted after CopyObject to the public prefix. Orphan PENDING uploads still use the existing 24h cleanup job. Rejected/blocked quarantine objects should not be kept indefinitely; purge R2 objects after operational review while keeping scan/fingerprint rows.

## Deploy

1. `npm run db:migrate`
2. `npm install` (optional nsfwjs / @tensorflow/tfjs)
3. `bash scripts/install-moderation-model.sh`
4. Set `MODERATION_MODEL_DIR` and concurrency `1` on 1GB media workers
5. Load-test `scripts/benchmark-moderation.ts` on a local safe set
6. Reload PM2 (`digitalhouse-media-worker` then API)
7. If the model is missing: new media stays private (fail closed)

Startup order: migrate → install weights → media worker (loads model lazily on first job) → API.

## Rollback

1. Reload previous API + worker builds
2. `npm run db:migrate:down` only after the previous app is live (drops safety columns/tables)
3. Emergency: leave columns in place; missing model already fail-closes new content. Historical `SAFE` backfill is unchanged.

## Historical content

Not rescanned on deploy. New content is gated. Optional later: bounded async jobs on the existing Media Worker (`MEDIA_MAX_CONCURRENT` + `MODERATION_MAX_CONCURRENCY`).

## Future providers

`localProvider.ts` is the only production provider. Add `FutureAwsModerationProvider` / Azure only if product later accepts paid cost. Keep `evaluateModeration()` as the single policy engine.
