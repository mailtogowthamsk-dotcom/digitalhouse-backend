# Database Audit Report — Digital House

| Field | Value |
|-------|--------|
| **Project** | Digital House |
| **Database** | MySQL 8.0.43 · InnoDB · `infosense_digital_house` |
| **ORM** | Sequelize (Node.js / Express) |
| **Scope** | Schema, indexes, FKs, query patterns, pooling, transactions, locking, EXPLAIN samples |
| **Method** | Live `information_schema` + `EXPLAIN` on production DB + static code review of `backend/src` |
| **Date** | 2026-07-27 |
| **Schema changes** | **None** (audit only) |

---

## Executive summary

The database is still small (~11 users, ~18 posts, ~89 messages), so many inefficiencies are **latent**. Live inspection shows a **critical gap**: every core **matrimony** table exists with **PRIMARY KEY only** — migration SQL that defines indexes and foreign keys was **not applied**. Hot-path queries already show `type=ALL` table scans on those tables.

| Priority | Count |
|----------|------:|
| Critical | 5 |
| High | 12 |
| Medium | 11 |
| Low | 6 |
| **Total** | **34** |

### Fix first (do not apply yet — planning only)

1. **Apply matrimony phase SQL indexes + FKs** (tables currently PK-only; EXPLAIN = `ALL`)
2. **Rewrite matrimony discover** — stop loading ≤500 JSON profiles into memory
3. **Fix mobile uniqueness** — stop full `users` scan / JS digit normalize
4. **Replace remaining community `IN (...)` lists** (HelpingHands, Home highlights)
5. **Enable slow query log** (`long_query_time` ≤ 1s) before schema churn

---

## 1. Environment & server configuration

| Setting | Live value | Assessment |
|---------|------------|------------|
| MySQL version | 8.0.43 | Current LTS line — good |
| Engine | InnoDB | Expected |
| `innodb_buffer_pool_size` | 2 GB | Healthy for current data size |
| `max_connections` | 151 | Fine; app pool is much smaller |
| `transaction_isolation` | REPEATABLE-READ | MySQL default; OK |
| `innodb_lock_wait_timeout` | 50s | Default; OK |
| `slow_query_log` | **OFF** | **Gap** — no production visibility |
| `long_query_time` | 10s | Too high once logging is on; prefer 0.5–1s |
| Tables | **69** | Mixed camelCase / snake_case columns |
| Foreign keys (live) | **47** | Matrimony suite largely **missing** FKs |
| Tables with **only PRIMARY** | **27** | Includes all core matrimony tables |

### Sequelize connection pool (`src/config/db.ts`)

| Setting | Value |
|---------|--------|
| `pool.max` | `min(10, max(2, DB_POOL_MAX \|\| 5))` → typically **5** |
| `pool.min` | 0 |
| `acquire` | ≥ 30s (connectTimeout + 15s) |
| `idle` / `evict` | 10s / 10s |
| `connectTimeout` | ≥ 5s (default 20s) |
| Keep-alive | enabled |
| Retry | 2× on timeout / deadlock / lock wait |
| Query logging | **off** |

**Assessment:** Pool size is appropriate for a small Node process on shared hosting. Risk under concurrent load: wait queue at `acquire` while matrimony discover / feed work holds connections. Prefer raising to 8–10 only with measured connection wait metrics — not blindly.

---

## 2. Data volume (exact counts)

| Table | Rows | Notes |
|-------|-----:|--------|
| `feed_engagement_events` | 988 | Largest by row count; sparse indexes |
| `otps` | 243 | Needs TTL purge job |
| `notifications` | 214 | Well indexed |
| `messages` | 89 | Pair + recipient/read indexes present |
| `post_likes` | 45 | Unique `(postId,userId)` present |
| `comments` | 23 | `idx_comments_post` present |
| `posts` | 18 | Many feature indexes present |
| `users` | 11 | Duplicate email index |
| `user_profiles` | 11 | JSON-heavy matrimony prefs |
| `matrimony_profile_views` | 26 | **PK only** |
| `matrimony_subscriptions` | 7 | **PK only** |
| `matrimony_interests` | 2 | **PK only** — scan today, cliff later |
| `matrimony_matches` | 1 | **PK only** |
| `matrimony_contact_reveals` | 2 | **PK only** |

Approximate storage is still &lt; 1 MB for hot tables; **index and query shape matter more than size today**.

---

## 3. Query execution plans (live EXPLAIN)

| Query | type | key used | Extra | Verdict |
|-------|------|----------|-------|---------|
| Thread list `GROUP BY` other user | `index` | `idx_messages_pair_created` | Using temporary; Using filesort | Works now; **scales poorly** (full user history aggregated before LIMIT) |
| Notifications for user | `ref` | `idx_notifications_user_created` | Using index | Good |
| Recent posts | `index` | `idx_posts_type_created` | Using filesort | Acceptable |
| Matrimony interests by `to_user_id` + status | **`ALL`** | *none* | Using where | **Critical** — no secondary indexes |
| Matrimony matches by pair/status | **`ALL`** | *none* | Using where | **Critical** |
| Users mobile IS NOT NULL (OR pending) | **`ALL`** | possible `users_mobile` unused | Using where | **Critical** pattern for registration |

---

## 4. Indexes

### 4.1 What looks healthy (live)

- **`posts`:** rich covering set (`userId,createdAt`, `postType,createdAt`, visibility, marketplace/help expiry composites, title/description prefixes). Hardening SQL appears applied.
- **`messages`:** `idx_messages_pair_created`, `idx_messages_recipient_read`
- **`notifications`:** user/created, unread, group_key, deleted composites
- **`member_connections`:** unique pair + requester/recipient+status
- **`post_likes` / `saved_posts`:** unique pair constraints

### 4.2 Critical: matrimony tables are PK-only

Live `SHOW INDEX` for these tables returns **only `PRIMARY`**, and `SHOW CREATE TABLE` shows **no FOREIGN KEY**:

- `matrimony_interests`
- `matrimony_matches`
- `matrimony_blocks`
- `matrimony_saved_profiles`
- `matrimony_reports`
- `matrimony_subscriptions`
- `matrimony_profile_opens`
- `matrimony_contact_reveals`
- `matrimony_profile_views`
- `matrimony_payment_orders`

**Expected from migration SQL** (not live):

| Table | Expected indexes / constraints |
|-------|--------------------------------|
| `matrimony_interests` | unique `(from_user_id,to_user_id)`; `(to_user_id,status)`; `(from_user_id,status)`; FKs → `users` |
| `matrimony_matches` | unique `(user_low_id,user_high_id)`; `(user_low_id,status)`; `(user_high_id,status)`; FKs → `users` |
| `matrimony_*` monetization | period/user/status composites + FKs (see `migrations/matrimony-phase*.sql`) |

**Root cause (likely):** tables created via `sequelize.sync` from models that declare **no `indexes` array**, while index/FK DDL lives only in optional `npm run db:run-matrimony-*` scripts that were never run (or only partially).

### 4.3 Other tables with no secondary indexes (live)

Also PK-only: `auth_analytics_events`, `kulams`, `locations`, `member_professional_identities`, `moderation_actions`, `notification_preferences` (PK is `user_id` — OK), most `platform_*` content tables, `support_faqs` / `support_guides` / `support_contact_config`.

Low urgency while row counts are tiny; **matrimony + profile_views + subscriptions** are highest priority.

### 4.4 Duplicate / redundant indexes (live)

| Table | Issue |
|-------|--------|
| `users` | Unique `email` **and** non-unique `users_email` on same column |
| `users` | `users_status` + `users_community` largely covered by `idx_users_status_community` |
| `posts` | `idx_posts_visibility` redundant with `idx_posts_visibility_userId`; `idx_posts_mp_expires` vs `idx_posts_mp_expiry` |
| `post_likes` | `idx_post_likes_post` redundant with unique `(postId,userId)` leftmost prefix |
| `notifications` | Overlap among `idx_notifications_user_created`, `idx_notif_user_deleted_created`, unread/group composites — review before dropping |

Repo already has `npm run db:fix-indexes` for sync residue; use after verifying with `SHOW INDEX`.

---

## 5. Foreign keys

| Area | Live state |
|------|------------|
| Core feed (`posts`, `comments`, `post_likes`, `saved_posts`, `messages`, `notifications`, `otps`) | FKs present (often Sequelize sync names `*_ibfk_*`) |
| Connections / jobs / hashtags / many platform tables | FKs present via migrations |
| **Matrimony suite** | **No FKs** despite SQL migrations defining them |
| Integrity risk | Orphan interests/matches/reveals possible if users deleted without app cascade |

**Recommendation (planning):** apply matrimony FK DDL in a maintenance window after backfill/orphan cleanup — do not enable CASCADE blindly without checking delete paths.

---

## 6. Slow queries & inefficient patterns (code)

### Critical

| ID | Finding | Evidence | Impact |
|----|---------|----------|--------|
| D1 | Matrimony discover loads ≤500 profiles + JSON filter in JS | `MatrimonyDiscover.service.ts` `discoverProfiles` | CPU/RAM and latency grow with every approved profile; pagination is fake |
| D2 | Matrimony interest/match queries have no usable indexes | Live EXPLAIN `type=ALL` | Will cliff as matrimony grows |
| D3 | Mobile conflict loads all users with phones, normalizes in JS | `RegistrationStatus.service.ts` | Auth/registration path; full table as users grow |
| D4 | Matrimony migrations (indexes/FKs) not applied to live DB | `SHOW INDEX` / `SHOW CREATE TABLE` | Schema drift vs repo SQL |
| D5 | Discover loads unbounded viewer interests/matches | same service ~interest findAll | Extra scans on PK-only tables |

### High

| ID | Finding | Evidence |
|----|---------|----------|
| D6 | HelpingHands stats: all approved user IDs → `IN (...)` | `HelpingHands.service.ts` |
| D7 | Home highlights: same community ID fan-out | `Home.service.ts` |
| D8 | Member search: many `%LIKE%` queries per keystroke | `UsersDirectory.service.ts` |
| D9 | `listThreads` aggregates all messages for user before LIMIT | raw SQL in `Messages.service.ts`; EXPLAIN temporary+filesort |
| D10 | Admin paid orders loaded unbounded then summed in JS | `MatrimonySubscriptionAdmin.service.ts` |
| D11 | Admin report search unbounded LIKE prefetches | `AdminReports.service.ts` |
| D12 | `sendInterest` / `removeMatch` not fully transactional | `MatrimonyDiscover.service.ts` |
| D13 | Connection accept/send without transaction/locks | `Connection.service.ts` |
| D14 | Payment fulfill holds `LOCK.UPDATE` while validating Razorpay (network) | `MatrimonyPayment.service.ts` |
| D15 | Feed DTO still reloads all likes/comments despite denormalized counts | `Feed.service.ts` |
| D16 | Explore / feed still select heavy gallery JSON | Feed/Explore services |
| D17 | Hashtag explore unbounded `post_hashtags` → large `IN` | `Hashtag.service.ts` |

### Medium

| ID | Finding |
|----|---------|
| D18 | `listMatches` / interest lists unbounded or select * profiles |
| D19 | Post create + hashtags + media not in one transaction |
| D20 | Post share sequential per-recipient DB work |
| D21 | Push broadcast N+1 prefs/tokens |
| D22 | Auth middleware still wide User attribute set |
| D23 | `getAcceptedConnectionUserIds` unbounded → feed `IN` |
| D24 | Message permission OR-clause explosion for large thread sets |
| D25 | Expiry workers update row-by-row in JS loops |
| D26 | `otps` / engagement events grow without retention policy |
| D27 | No Sequelize `paranoid`; notification soft-delete is manual |
| D28 | Split source of truth: model indexes vs SQL runners |

### Low

| ID | Finding |
|----|---------|
| D29 | Platform/MDM seed loops at startup |
| D30 | Media approve N+1 ownership checks |
| D31 | Small admin catalogs unbounded `findAll` (ads, flags) |
| D32 | Prefix indexes on TEXT help LIKE `term%` only, not `%term%` |
| D33 | Duplicate email index on `users` |
| D34 | Slow query log disabled |

---

## 7. Pagination & large result sets

| Path | Pagination | Risk |
|------|------------|------|
| Feed / Explore | Yes (page/limit) | Gallery JSON still heavy |
| Notifications | Yes | Good |
| Message threads | LIMIT 20–200 | Aggregate-before-limit remains |
| Admin pending users | Paginated (recent fix) | Good |
| Matrimony discover | Fake (pool 500 → slice) | Critical |
| Saved posts | `limit: 500` | Soft cap only |
| HelpingHands / Home highlights | Unbounded ID lists | High |
| Admin revenue / report ID prefetch | Unbounded | High |
| Profile views | Cap ~200 | OK |

---

## 8. Joins & N+1

| Pattern | Status |
|---------|--------|
| Feed community via User JOIN | Improved (prior optimization) |
| Message access map batching | Fixed |
| Discover duplicate match query | Fixed |
| HelpingHands / Home `IN` lists | Still open |
| Push / share / media loops | Still N+1 |
| Discover scoring in app memory | Architectural N× work |

JSON matrimony preferences in `user_profiles` **cannot** be efficiently joined/filtered in SQL until denormalized columns exist.

---

## 9. Transactions & locking

| Location | Pattern | Notes |
|----------|---------|--------|
| Matrimony payment fulfill | `transaction` + `LOCK.UPDATE` | Correct idempotency; keep HTTP out of lock if possible |
| Matrimony block/unblock | Short transaction | Good |
| Accept interest → match | Partial transaction | Interest update outside txn in places |
| `sendInterest`, post create, connections | Often **no** transaction | Race / orphan risk |
| Isolation | REPEATABLE-READ | Default; deadlocks retried (2×) at pool level |
| App-level lock contention | Low today | Will rise with concurrent match/payment |

No widespread `FOR UPDATE` abuse found. Primary locking concern is **long lock duration around external Razorpay validation**.

---

## 10. Connection pooling & concurrency

```
App pool max ≈ 5  ×  PM2 instances (typically 1)
MySQL max_connections = 151
```

**Risks when traffic grows:**

1. Discover / HelpingHands hold connections while scanning large sets  
2. Socket + HTTP share the same Sequelize pool  
3. `acquire` timeout under burst → 503-style failures  

**Ops recommendations (no schema change):**

- Export pool wait / active connection metrics  
- Keep PM2 instances × `DB_POOL_MAX` ≪ `max_connections` (leave headroom for admin/migrations)  
- Turn on slow query log before optimizing

---

## 11. Cross-check vs prior backend performance audit

| Prior item | DB status now |
|------------|---------------|
| Feed correlated COUNT in ORDER BY | **Mitigated** (`likeCount`/`commentCount` present live) |
| Message access N+1 | **Fixed** in code |
| Thread list LIMIT | **Fixed**; aggregate cost remains |
| Hardening camelCase indexes | **Applied** for posts/messages/notifications |
| Message/Post model indexes | **Present** live |
| Matrimony discover in-memory | **Still open** |
| Matrimony interest/match indexes | **Worse than assumed** — SQL never applied live |
| Community IN lists | Feed improved; HelpingHands/Home open |
| Member search LIKE | **Still open** |
| Transactions on interest/match | **Partial** |

---

## 12. Recommended remediation roadmap (schema unchanged until approved)

### Phase A — Observability (safe)

1. Enable `slow_query_log` with `long_query_time=1` (or Performance Schema)  
2. Log Sequelize slow queries in staging (`logging` with duration threshold)  
3. Snapshot `SHOW INDEX` / `SHOW CREATE TABLE` for matrimony into runbooks

### Phase B — Apply missing matrimony DDL (maintenance window)

1. Dry-run `migrations/matrimony-phase2.sql` (+ safety + monetization + razorpay) against a backup  
2. Add unique pair + status composites + FKs  
3. Re-run EXPLAIN on interest/match/contact paths — expect `ref`/`range`, not `ALL`

### Phase C — Query rewrites (app)

1. SQL-first matrimony discover (denormalize district/age/kulam/lookingFor)  
2. Normalized mobile column + unique index; rewrite conflict check  
3. JOIN-based HelpingHands / Home highlights  
4. Complete transactions on interest/match/connection/post-create  
5. Use denormalized like/comment counts in feed hydration; prune gallery attributes  
6. Cap admin analytics with SQL `SUM`/`GROUP BY`

### Phase D — Hygiene

1. Drop redundant indexes (`users_email`, leftover single-column prefixes) via `db:fix-indexes` after review  
2. OTP / engagement event retention jobs  
3. Align Sequelize model `indexes` with live DDL so `sync` cannot recreate drift

---

## 13. Appendix — Sequelize pool source

File: `backend/src/config/db.ts`

- Dialect: `mysql`
- Pool max capped at 10, default 5
- Keep-alive enabled for remote cPanel MySQL
- Retries on deadlock / lock wait timeout

---

## 14. Appendix — Tables with only PRIMARY KEY (live)

`auth_analytics_events`, `kulams`, `locations`, `matrimony_blocks`, `matrimony_contact_reveals`, `matrimony_interests`, `matrimony_matches`, `matrimony_payment_orders`, `matrimony_profile_opens`, `matrimony_profile_views`, `matrimony_reports`, `matrimony_saved_profiles`, `matrimony_subscriptions`, `member_professional_identities`, `moderation_actions`, `notification_preferences`, `platform_ads`, `platform_alert_popups`, `platform_announcements`, `platform_app_versions`, `platform_audit_logs`, `platform_banners`, `platform_maintenance`, `platform_notifications`, `support_contact_config`, `support_faqs`, `support_guides`

---

**End of report.** No database schema was modified during this audit.
