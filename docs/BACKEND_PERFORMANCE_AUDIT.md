# Backend Performance Audit Report

**Project:** Digital House  
**Stack:** Node.js · Express · MySQL · Sequelize · PM2 · (Apache reverse proxy / no nginx in repo) · Cloudflare R2 · React Native Expo client  
**Scope:** Backend only (`backend/`)  
**Method:** Static code inspection (no runtime APM samples)  
**Code modified:** None  

---

## Executive summary

| Priority | Count |
|----------|------:|
| Critical | 4 |
| High | 15 |
| Medium | 14 |
| Low | 2 |
| **Total** | **35** |

### Fix first (Critical)

1. Matrimony discover loads ≤500 profiles into memory, then filters in JS  
2. `listThreads` / `getMessageAccessMap` — N× permission DB round-trips  
3. Feed ranking — correlated `COUNT` subqueries per row in `ORDER BY`  
4. Hardening SQL indexes — snake_case DDL vs camelCase schema (indexes may never apply)

---

## Architecture overview

### Entry points
| File | Role |
|------|------|
| `src/server.ts` | HTTP server, Socket.IO init, listen first, `initDb()` in background |
| `src/app.ts` | Express app, middleware, API mounts, health, error handler |
| `src/routes/index.ts` | Mounts all routers under `/api` |
| `package.json` `main` | `dist/server.js` |

### Middleware stack (`app.ts`)
1. `trust proxy = 1`
2. CORS preflight → `cors` → `OPTIONS /*`
3. Razorpay webhook with `express.raw` (before JSON)
4. `express.json({ limit: JSON_BODY_LIMIT \|\| "4mb" })`
5. `GET /`, `GET /health`
6. Per-mount: health → DB-ready gate → optional request log → `apiRouter`
7. `errorHandler`

**Not present globally:** helmet, compression, structured logger, global `apiLimiter` (exported but unused).

### PM2 / proxy
| Item | Notes |
|------|--------|
| PM2 | `ecosystem.config.cjs` — 1 fork instance, `max_memory_restart: 512M`, `PORT: 4000` |
| Nginx | **None in repo** |
| Apache | `deploy/htaccess-combined.conf` — reverse proxy to `127.0.0.1:4000` |

---

## Findings

For every issue: **File · Function · Root Cause · Impact · Recommendation · Priority**

---

### 1. Matrimony discover loads up to 500 profiles then filters in memory
- **File:** `services/MatrimonyDiscover.service.ts`
- **Function:** `discoverProfiles`
- **Root Cause:** `UserProfile.findAll({ limit: 500 })` then JS filter/sort/slice (JSON prefs).
- **Performance Impact:** High CPU/RAM on every discover; latency grows with profile count.
- **Recommendation:** Persist filterable columns; SQL WHERE + true pagination; score only the page.
- **Priority:** Critical

### 2. `listThreads` permission fan-out (N× DB round-trips)
- **File:** `services/MessagePermission.service.ts` (+ `Messages.service.ts` → `listThreads`)
- **Function:** `getMessageAccessMap`
- **Root Cause:** `unique.map(async id => getMessageAccess(...))` — each call hits blocks, connection, match, history.
- **Performance Impact:** Threads latency scales ~linearly with conversation count.
- **Recommendation:** Batch-load blocks/connections/matches/legacy once; assemble DTOs in memory.
- **Priority:** Critical

### 3. Feed engagement score uses correlated subqueries per row
- **File:** `services/Feed.service.ts`
- **Function:** `engagementScoreSql` / `getFeed`
- **Root Cause:** `ORDER BY` uses correlated `COUNT(*)` on `post_likes` + `comments` per post.
- **Performance Impact:** Popular/recent feeds slow as engagement tables grow.
- **Recommendation:** Denormalize like/comment counts or join aggregates; cache scores.
- **Priority:** Critical

### 4. Production hardening SQL likely uses wrong column names
- **File:** `scripts/run-production-hardening-sql.js`
- **Function:** `addIndex` DDL
- **Root Cause:** DDL uses `user_id`, `created_at`, etc. while app schema uses camelCase (`userId`, `createdAt`).
- **Performance Impact:** Indexes may fail silently; prod can run without intended indexes.
- **Recommendation:** Verify `information_schema.COLUMNS`; fix DDL to real names; re-apply.
- **Priority:** Critical

### 5. Feed loads all approved community user IDs into `IN (...)`
- **File:** `services/Feed.service.ts` (+ Explore)
- **Function:** `approvedUserIdsInCommunity`
- **Root Cause:** `User.findAll` all approved IDs then `posts WHERE userId IN (...)`.
- **Performance Impact:** Large IN lists + full community scan on home/explore every request.
- **Recommendation:** JOIN posts ↔ users on community/status instead of materializing IDs.
- **Priority:** High

### 6. Home summary / quick actions: many `Post.count` + all approved IDs
- **File:** `services/Home.service.ts`
- **Function:** `getQuickActionCounts` / `getSummary`
- **Root Cause:** All approved IDs + ~6 parallel `Post.count` with `Op.in`; no cache.
- **Performance Impact:** Home open is count-heavy; `/quick-actions` can double work.
- **Recommendation:** Single conditional aggregate; short TTL cache per community.
- **Priority:** High

### 7. Per-item R2 signing on hot paths
- **File:** Feed / Messages / UsersDirectory + `r2Client`
- **Function:** `toSignedUrlIfR2`
- **Root Cause:** Presign per URL with no response-level cache.
- **Performance Impact:** Crypto/sign work × posts × gallery images on feed/threads.
- **Recommendation:** Dedupe keys; short TTL signed-URL cache; CDN for public assets.
- **Priority:** High

### 8. Large JSON — posts returned with all columns
- **File:** `services/Feed.service.ts`
- **Function:** `getFeed` `Post.findAll`
- **Root Cause:** Sequelize default selects full row (galleries, help contact, admin fields, etc.).
- **Performance Impact:** Oversized payloads/memory; leak risk if mapping slips.
- **Recommendation:** Explicit `attributes` per DTO; never select contact/admin for public feed.
- **Priority:** High

### 9. Member search fans out many LIKE queries
- **File:** `services/UsersDirectory.service.ts`
- **Function:** `searchMembers`
- **Root Cause:** 6–8+ separate `findAll` LIKE paths (username/name/occupation/skills…).
- **Performance Impact:** Heavy search per keystroke; leading `%like%` weak on indexes.
- **Recommendation:** FULLTEXT / search engine; merge queries; stricter pre-hydrate caps.
- **Priority:** High

### 10. Missing pagination — admin pending users
- **File:** `services/admin.service.ts`
- **Function:** `listPendingUsers`
- **Root Cause:** `User.findAll` with no limit.
- **Performance Impact:** Unbounded admin payload as pending queue grows.
- **Recommendation:** Paginate; default limit 50.
- **Priority:** High

### 11. Missing pagination — message threads SQL
- **File:** `services/Messages.service.ts`
- **Function:** `listThreads`
- **Root Cause:** `GROUP BY` over all user messages with no thread LIMIT.
- **Performance Impact:** Heavy aggregation on large `messages` tables.
- **Recommendation:** Cap threads (50–100) or cursor by `MAX(createdAt)`.
- **Priority:** High

### 12. Message model has no Sequelize indexes
- **File:** `models/Message.model.ts`
- **Function:** `Message.init`
- **Root Cause:** No indexes in model; relies on optional hardening script.
- **Performance Impact:** Slow threads/unread/history if indexes missing or misnamed.
- **Recommendation:** Declare covering indexes on model + verify live DB.
- **Priority:** High

### 13. Post model has no indexes in model definition
- **File:** `models/Post.model.ts`
- **Function:** `Post.init`
- **Root Cause:** No indexes in model; feed filters `userId` / `postType` / `createdAt` heavily.
- **Performance Impact:** Schema drift vs migrations; slow feeds/explore.
- **Recommendation:** Align model + migrations with composite indexes for hot WHERE/ORDER.
- **Priority:** High

### 14. Multi-write without transactions — block / unblock
- **File:** `services/MatrimonySafety.service.ts`
- **Function:** `blockUser` / `unblockUser` / `restoreMessagingAfterUnblock`
- **Root Cause:** Multi-row writes without `sequelize.transaction`.
- **Performance Impact:** Partial state on failure; race windows.
- **Recommendation:** Wrap in transaction; bulk-update connections.
- **Priority:** High

### 15. Multi-write without transactions — interest / match
- **File:** `services/MatrimonyDiscover.service.ts`
- **Function:** `sendInterest` / `respondToInterest` / `removeMatch`
- **Root Cause:** Interest + match writes are separate non-atomic steps.
- **Performance Impact:** Orphan interests/matches under concurrency.
- **Recommendation:** Single transaction + unique pair constraints.
- **Priority:** High

### 16. Sharp image processing on request path
- **File:** `utils/imageProcessor.ts` + `MediaProcessing.service.ts`
- **Function:** `processImageBuffer` / `finalizeMediaFile`
- **Root Cause:** Sharp variants encoded in-process on request path.
- **Performance Impact:** CPU saturation under concurrent uploads on single Node instance.
- **Recommendation:** Worker queue / separate process; tighter finalize rate limits.
- **Priority:** High

### 17. Socket.IO CORS open + presence broadcast to all
- **File:** `realtime/socket.ts`
- **Function:** `initSocket` / presence emit
- **Root Cause:** `cors: { origin: true }`; `io.emit("presence:update")` to all clients.
- **Performance Impact:** Weaker WS CORS than HTTP; O(clients) fan-out + online-ID broadcast.
- **Recommendation:** Reuse HTTP origin allowlist; emit to community/friends rooms only.
- **Priority:** High

### 18. Global rate limiter unused; coverage gaps
- **File:** `middlewares/rateLimit.middleware.ts` + `app.ts`
- **Function:** `apiLimiter` (exported unused)
- **Root Cause:** Global limiter never mounted; matrimony/notifications/support gaps.
- **Performance Impact:** Abuse surface on unprotected routers; many in-memory stores.
- **Recommendation:** Mount shared limiter on `apiRouter`; Redis store if multi-instance.
- **Priority:** High

### 19. Missing helmet + compression
- **File:** `app.ts` / `package.json`
- **Function:** middleware stack
- **Root Cause:** No helmet; no response compression middleware.
- **Performance Impact:** Missing security headers; large JSON uncompressed over the wire.
- **Recommendation:** Add helmet + compression early in stack.
- **Priority:** High

### 20. Expertise fallback loops MDM × users
- **File:** `services/UsersDirectory.service.ts`
- **Function:** `searchMembers` expertise fallback
- **Root Cause:** Nested loop over MDM expertise × users when expertise rows missing.
- **Performance Impact:** CPU spike on search for incomplete profiles.
- **Recommendation:** Drop fallback or precompute expertise summaries at write time.
- **Priority:** Medium

### 21. Saved posts path loads all saved IDs unbounded
- **File:** `services/Feed.service.ts`
- **Function:** saved feed path
- **Root Cause:** `SavedPost.findAll` for user with no limit before `IN (...)`.
- **Performance Impact:** Large ID lists for power savers.
- **Recommendation:** Paginate saves; prefer JOIN over dumping all IDs.
- **Priority:** Medium

### 22. Duplicate MatrimonyMatch queries in discover
- **File:** `services/MatrimonyDiscover.service.ts`
- **Function:** `discoverProfiles`
- **Root Cause:** `MatrimonyMatch.findAll` executed twice in same request.
- **Performance Impact:** Extra DB round-trip every discover.
- **Recommendation:** Reuse first result set.
- **Priority:** Medium

### 23. Auth middleware loads full User row every request
- **File:** `middlewares/auth.middleware.ts`
- **Function:** `loadUserFromBearer`
- **Root Cause:** `User.findByPk` with no attribute select.
- **Performance Impact:** Extra IO on high-QPS paths.
- **Recommendation:** Select only auth-needed attributes.
- **Priority:** Medium

### 24. Multi-write without transactions — post create
- **File:** `services/Post.service.ts`
- **Function:** `createPost`
- **Root Cause:** `Post.create` → hashtags → media attach without transaction.
- **Performance Impact:** Orphan posts/hashtags/media links on mid-flight failure.
- **Recommendation:** Transaction for create + hashtags; media after commit.
- **Priority:** Medium

### 25. Connection accept / request without transaction
- **File:** `services/Connection.service.ts`
- **Function:** `sendRequest` / `acceptRequest`
- **Root Cause:** Multi-update relationship flows without transaction.
- **Performance Impact:** Inconsistent graph under races.
- **Recommendation:** Transaction + row locks.
- **Priority:** Medium

### 26. Blocking sync FS on admin / settings / FCM
- **File:** AdminRoles / MatrimonyPlatformSettings / FcmPush
- **Function:** `readFileSync` paths
- **Root Cause:** Synchronous FS reads on hot/admin/push paths.
- **Performance Impact:** Event-loop stalls under concurrency.
- **Recommendation:** `fs.promises` + in-memory cache.
- **Priority:** Medium

### 27. Presence `lastSeenAt` Map grows without TTL
- **File:** `realtime/presence.ts`
- **Function:** `lastSeenAt` Map
- **Root Cause:** Offline lastSeen entries accumulate with no TTL/eviction.
- **Performance Impact:** Slow memory growth; larger presence snapshots.
- **Recommendation:** Cap/TTL prune; avoid broadcasting full lastSeen forever.
- **Priority:** Medium

### 28. Console-only logging
- **File:** `app.ts` + services
- **Function:** `console.log` / optional `LOG_REQUESTS`
- **Root Cause:** No structured logger; no correlation IDs.
- **Performance Impact:** Weak production debugging and log shipping.
- **Recommendation:** Structured logger (pino); redact PII/OTP.
- **Priority:** Medium

### 29. Missing monitoring / metrics
- **File:** `app.ts` health
- **Function:** `GET /health`
- **Root Cause:** Health returns ok/ready only — no metrics/APM.
- **Performance Impact:** No latency/error/queue visibility.
- **Recommendation:** Add `/metrics` or APM (Datadog / New Relic / OpenTelemetry).
- **Priority:** Medium

### 30. PM2 single fork — jobs co-located with API
- **File:** `ecosystem.config.cjs` + `server.ts`
- **Function:** PM2 app + interval jobs
- **Root Cause:** `instances: 1` fork; API + sockets + expiry/cleanup jobs co-located; 512M restart.
- **Performance Impact:** No horizontal scale; job spikes steal API CPU; in-memory state not shared.
- **Recommendation:** Separate worker process for jobs; sticky sessions if scaling sockets.
- **Priority:** Medium

### 31. Missing caching on hot reads
- **File:** Home / Feed / Discover (vs `utils/mdmCache.ts`)
- **Function:** hot reads
- **Root Cause:** Only MDM has TTL cache; summary/counts/community IDs/discover uncached.
- **Performance Impact:** Repeated heavy reads under mobile churn.
- **Recommendation:** Short TTL for summary/counts; Redis if multi-node.
- **Priority:** Medium

### 32. Post share sequential per-recipient work
- **File:** `services/PostShare.service.ts`
- **Function:** `sharePostToConnections`
- **Root Cause:** Sequential per-recipient permission + create + notify loop.
- **Performance Impact:** Slow share-to-many.
- **Recommendation:** Batch permission checks; bounded concurrency.
- **Priority:** Medium

### 33. Expiry jobs update rows in JS loops
- **File:** HelpingHandsExpiry / MarketplaceExpiry
- **Function:** expiry workers
- **Root Cause:** `for (const post of due) await post.update`.
- **Performance Impact:** Slow batches; many round-trips.
- **Recommendation:** Bulk `UPDATE ... WHERE id IN (...)`.
- **Priority:** Low

### 34. Sync crypto for OTP hashing
- **File:** `utils/hash.util.ts`
- **Function:** `sha256Hex` / `hashEmailOtp`
- **Root Cause:** Sync crypto for OTP hashing.
- **Performance Impact:** Low unless mass verify floods (rate limits mitigate).
- **Recommendation:** Keep; ensure OTP rate limits stay strict; set OTP pepper in prod.
- **Priority:** Low

### 35. Nginx / edge optimization opportunities
- **File:** `deploy/htaccess-combined.conf` (Apache)
- **Function:** reverse proxy to `:4000`
- **Root Cause:** No nginx config in repo; TLS/gzip/proxy buffering at edge unclear.
- **Performance Impact:** Missed edge gzip, buffering, upstream keepalive, HSTS.
- **Recommendation:** At edge (Nginx/Cloudflare/Apache): gzip JSON, keepalive, timeouts, HSTS.
- **Priority:** Medium

---

## Recommended roadmap

### P0 — Critical
- Fix hardening index column names and verify live indexes  
- Rewrite matrimony discover to DB-filter + true pagination  
- Batch message access map  
- Remove correlated feed engagement subqueries  

### P1 — High
- Helmet + compression + mount global rate limit  
- Tighten socket CORS / presence fan-out  
- Join instead of community `IN` lists  
- Attribute pruning + R2 sign cache  
- Transactions on match/block  

### P2 — Medium
- Summary/counts cache  
- Auth attribute select  
- Async FS  
- Prune presence map  
- Post-create transaction  
- Consolidate member search  
- Edge gzip/HSTS  

### P3 — Low / ops
- Bulk expiry updates  
- Structured metrics/APM  
- PM2 worker split for jobs  

---

## Already done well

- Listen-before-DB with API 503 until ready  
- Razorpay raw body + payment `sequelize.transaction`  
- Route-level rate limits on auth / home / posts / messages / media  
- HTTP CORS allowlist  
- Zod on many write routes  
- Feed hydration batches likes/comments/saves (avoids classic N+1 includes)  
- MDM in-memory TTL cache  
- Image bomb guards (`limitInputPixels`, max download bytes)  
- Cursor pagination on message history  
- Explicit SQL migrations preferred over prod `sync`  

---

## How to download this file

**Path on disk:**

`/Applications/XAMPP/xamppfiles/htdocs/Gowtham/DigitalHouse/backend/docs/BACKEND_PERFORMANCE_AUDIT.md`

In Finder: open that folder → right-click the file → Share / AirDrop / copy.  
Or in Cursor: open the file → right-click tab → **Reveal in Finder** / **Download** (depending on UI).

You can also export to PDF via any Markdown preview (VS Code / Cursor preview → Print → Save as PDF).
