# Backend Optimization Changelog (Critical + High)

**Date:** 2026-07-27  
**Scope:** Critical + High items from `BACKEND_PERFORMANCE_AUDIT.md`  
**API contract:** Response shapes preserved (additive fields only where noted)

---

## How to apply

```bash
cd backend
npm install
npm run db:run-production-hardening-sql   # indexes + likeCount/commentCount backfill
npm run build
# restart: npm run dev  OR  npm run pm2:reload
```

Set optional env:
- `SLOW_API_MS=800` — log APIs slower than this (default 800)
- `THREAD_LIST_LIMIT=100` — max threads returned by inbox list (20–200)

---

## Changes by priority

### Critical

| Change | Why | Gain | Files | How to test |
|--------|-----|------|-------|-------------|
| Fix hardening SQL column names + add engagement counters | Indexes never applied (snake vs camel); popular feed used correlated COUNTs | Indexes used; popular ORDER BY uses `likeCount`/`commentCount` | `scripts/run-production-hardening-sql.js`, `models/Post.model.ts`, `models/Message.model.ts`, `Post.service.ts`, `Feed.service.ts` | Run hardening script; open Home → Popular; like/unlike a post and confirm counts |
| Batch `getMessageAccessMap` | N× permission queries per thread list | Threads inbox ~constant DB round-trips | `MessagePermission.service.ts`, `Messages.service.ts` | Open Messages; inbox with many chats should load faster |
| Cap thread list SQL (`LIMIT`) | Unbounded GROUP BY over all messages | Bounded inbox query | `Messages.service.ts` | Confirm recent chats still appear |
| Discover: remove duplicate match query + dynamic limit | Double `MatrimonyMatch.findAll`; fixed 500 always | Fewer queries; smaller candidate pool on early pages | `MatrimonyDiscover.service.ts` | Open Matrimony Discover; scroll pages |

### High

| Change | Why | Gain | Files | How to test |
|--------|-----|------|-------|-------------|
| Feed/Explore community via User JOIN | Avoid loading all community user IDs into `IN (...)` | Less memory + faster feed/explore | `Feed.service.ts`, `Explore.service.ts` | Home feed + Explore search |
| Slim feed post attributes | Dropped admin notes / help phone from SELECT | Smaller payloads | `Feed.service.ts` | Feed JSON should omit `helpContactPhone` / marketplace admin note |
| Home quick-action counts via JOIN | Avoid global approved-ID dump + 6× IN counts | Faster home summary | `Home.service.ts` | Open Home; counters still correct |
| R2 signed URL TTL cache | Repeated signing on feed/threads | Less CPU on hot paths | `utils/signedUrlCache.ts`, `r2Client.ts` | Reload feed twice; images still load |
| Admin pending users pagination | Unbounded list | Default 50/page; response adds `page`,`limit`,`total` (additive) | `admin.service.ts`, `Admin.controller.ts` | Admin pending list; `?page=1&limit=50` |
| Block/unblock + removeMatch transactions | Partial writes on failure | Atomic safety | `MatrimonySafety.service.ts`, `MatrimonyDiscover.service.ts` | Block/unblock; remove match |
| Helmet + compression + global `apiLimiter` | Missing headers/gzip/global rate limit | Safer + smaller responses + abuse protection | `app.ts`, `package.json` | Check `Content-Encoding: gzip` on large JSON; headers present |
| Slow API logger | No visibility into slow routes | `[slow-api]` logs | `middlewares/slowApi.middleware.ts`, `app.ts` | Slow endpoint logs when > `SLOW_API_MS` |
| Socket CORS allowlist + community presence | `origin: true` + broadcast-all | Safer WS; less fan-out | `realtime/socket.ts` | Chat presence still updates in same community |
| Auth middleware attribute select | Full User row every request | Less auth IO | `auth.middleware.ts` | Login /me / JWT routes still work |

### Deferred (still High in audit, not fully done here)

- **Sharp worker queue** — keep in-process processing; needs separate worker process (follow-up)
- **Full SQL-side matrimony discover filters** — needs denormalized matrimony columns (follow-up)
- **Member search FULLTEXT / engine** — partial; search still multi-query (follow-up)

---

## Backward compatibility notes

- Admin pending: still returns `{ users: [...] }`; now also `page`, `limit`, `total` (safe additive).
- Thread list: still an array; may omit very old threads beyond `THREAD_LIST_LIMIT` (default 100).
- Feed/message/matrimony DTO field names unchanged.
