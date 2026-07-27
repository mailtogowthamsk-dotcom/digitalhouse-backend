# Database Optimization Changelog

**Date:** 2026-07-27  
**Source:** `docs/DATABASE_AUDIT.md`  
**Constraint:** No business-logic changes — query shape, indexes, pooling, and logging only.

---

## How to apply schema changes

```bash
cd backend
npm run db:run-optimization-indexes
```

Idempotent. Adds matrimony indexes/FKs, supporting indexes, drops redundant indexes. Skips FKs when orphans exist.

Reference DDL: `migrations/db-optimization-indexes-2026-07.sql`  
Runner: `scripts/run-db-optimization-indexes.js`

---

## Optimizations explained

### 1. Proper indexes (Critical audit fix)

**Problem:** Live `matrimony_*` tables had only `PRIMARY KEY`. Interest/match `EXPLAIN` was `type=ALL`.

**Change:** Idempotent migration adds unique pair keys, status composites, and FKs to `users` / `matrimony_matches` for:

- interests, matches, blocks, saved, reports  
- subscriptions, profile opens, contact reveals, profile views  
- payment orders  

Also adds indexes on `feed_engagement_events`, `auth_analytics_events`, `platform_audit_logs`, `users.pending_mobile`.

**Drops (redundant):**

- `users.users_email` when unique `email` already exists  
- `posts.idx_posts_visibility` when `idx_posts_visibility_userId` exists  

**Models:** `MatrimonyInterest` / `MatrimonyMatch` now declare matching `indexes` so future `sync` does not recreate PK-only tables.

---

### 2. Connection pool

**File:** `src/config/db.ts`

| Before | After |
|--------|--------|
| Default `DB_POOL_MAX` 5, cap 10 | Default **8**, cap **12** |

Still well under MySQL `max_connections` (151). Override with `DB_POOL_MAX`.

---

### 3. Slow query logging

**File:** `src/config/db.ts`

- Sequelize `benchmark: true` + logging when duration ≥ `DB_SLOW_QUERY_MS` (default **500**)  
- Logs: `[slow-query] 842ms SELECT …`  
- Disable: `DB_SLOW_QUERY_MS=0`  
- Complements existing HTTP `[slow-api]` middleware (request-level)

---

### 4. Remove unnecessary queries / use denormalized counts

**File:** `Feed.service.ts` → `buildFeedItemsFromPosts`

**Before:** Loaded all `post_likes` and `comments` rows for the page just to recount.  
**After:** Uses `posts.likeCount` / `commentCount` already selected on feed rows. Still loads only “liked by me” / “saved by me” / help offers.

Same DTO counts when counters are kept in sync (hardening backfill + like/comment writers).

---

### 5. Replace community `IN (...)` lists with JOINs

**Files:** `Home.service.ts` (`getHighlights`), `HelpingHands.service.ts` (`getHelpingHandsStats`)

**Before:** `User.findAll` → giant `userId IN (...)`.  
**After:** `include: User` with `status=APPROVED` (+ community for help). Same filters, better plan as membership grows.

---

### 6. Mobile conflict without full table load

**File:** `RegistrationStatus.service.ts` → `findMobileConflict`

**Before:** Load every user with a phone; normalize digits in JS.  
**After:** One SQL `LIMIT 1` using the same `RIGHT(REGEXP_REPLACE(..., '[^0-9]', ''), 10)` rule as `mobileDigits()`.

Business rule unchanged; avoids O(n) memory.

---

### 7. Sequelize includes / attribute pruning

| Location | Change |
|----------|--------|
| Discover interests | Select only `fromUserId/toUserId/status` |
| `listMatches` / `listInterests` | Slim User + `matrimony` profile attributes; matches `limit: 200` |
| Explore list | Explicit post attributes (incl. counters); no admin-note columns |
| Auth middleware | Drop unused Google/link/remarks fields from every request |
| Home highlights | Attribute list for highlight DTO only |

---

### 8. Pagination / result caps

| Location | Cap |
|----------|-----|
| `listMatches` | 200 (newest first) |
| Admin report user/post search prefetch | 200 / 500 |
| Hashtag → post links | 5000 newest `postId` |

Soft safety nets; does not change API contracts.

---

### 9. Admin revenue aggregation in SQL

**File:** `MatrimonySubscriptionAdmin.service.ts`

**Before:** `findAll` all `PAID` orders; sum in JS.  
**After:** Single `SUM` / conditional `SUM` query for total/today/month revenue.

---

## Intentionally deferred (would risk logic change)

- Full SQL rewrite of matrimony discover filters (JSON prefs → denormalized columns)  
- Thread-list summary table (replacing `GROUP BY` messages)  
- FULLTEXT member search  
- Moving Razorpay HTTP outside `LOCK.UPDATE` (payment flow redesign)

---

### 10. Index-friendly match lookups (no OR scan)

**File:** `MatrimonyDiscover.service.ts`

`OR (user_low_id = ? OR user_high_id = ?)` prevented MySQL from using `idx_match_user_*` (EXPLAIN stayed `ALL`).

**After:** two parallel queries (low / high) merged in memory — same ACTIVE matches, uses indexes.

---

## Verify

```bash
npm run db:run-optimization-indexes
# Then EXPLAIN interest/match queries — expect type=ref/range, not ALL
```

Restart API after `db.ts` pool/logging changes.
