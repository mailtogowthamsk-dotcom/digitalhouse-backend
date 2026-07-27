# Digital House — MySQL Connection Saturation: Complete Audit Report

**Date:** 2026-07-28  
**Role:** Principal Node.js / Sequelize / MySQL Performance Engineer  
**Scope:** Backend database connection layer only (no business-logic changes)  
**Constraint:** Full backward compatibility  

---

## 1. Files audited

### Runtime (app)

| Area | Paths |
|------|--------|
| Sequelize singleton | `src/config/db.ts`, `src/config/dbPoolMonitor.ts`, `src/config/env.ts` |
| Boot / shutdown | `src/server.ts`, `src/app.ts`, `src/state.ts` |
| Models | All `src/models/*.ts` (import shared `sequelize`) |
| Transactions | `MatrimonyDiscover.service.ts`, `MatrimonySafety.service.ts`, `MatrimonyPayment.service.ts` |
| Raw queries | `MessagePermission.service.ts`, `Messages.service.ts`, `MatrimonySubscriptionAdmin.service.ts`, `RegistrationStatus.service.ts`, monetization/payment schema probes |
| Background jobs | Matrimony subscription, Marketplace expiry, Helping Hands expiry, Platform notifications, Orphan media |
| Realtime | `src/realtime/socket.ts` (uses `User.findByPk` via shared pool) |
| PM2 | `ecosystem.config.cjs` |

### CLI / scripts (one-off `mysql2`, not app pool)

All `scripts/*.js|ts|cjs` using `mysql.createConnection` — each audited for `.end()` / `sequelize.close()`.

---

## 2. Files modified (this engagement)

| File | Change |
|------|--------|
| `src/config/db.ts` | Profile-based pool, session wait_timeout, maxUses; **removed** retry on “Too many connections” (storm amplifier) |
| `src/config/dbPoolMonitor.ts` | Full `[MYSQL_POOL]` debug (acquire/release/create/reuse/destroy/waiting/timeout/tx/query) |
| `src/server.ts` | Graceful shutdown, stop all jobs, close pool, uncaughtException handling |
| `src/app.ts` | Health exposes pool stats when `DB_POOL_DEBUG=true` |
| `src/services/MatrimonyDiscover.service.ts` | Pass `transaction` into `tryCreateMutualMatch` (was holding an unused tx connection) |
| `src/services/MarketplaceExpiry.service.ts` | Added `stopMarketplaceExpiryJobs` |
| `src/services/HelpingHandsExpiry.service.ts` | Added `stopHelpingHandsExpiryJobs` |
| `src/services/OrphanMediaCleanup.service.ts` | Added `stopOrphanMediaCleanupJobs` |
| `ecosystem.config.cjs` | Document connection budget; `kill_timeout`; pool env defaults |
| `package.json` | `dev` uses `--exit-child`; `db:kill-idle-connections` script |
| `scripts/kill-idle-db-connections.js` | Ops tool to clear long Sleep sessions |
| `docs/MYSQL_CONNECTION_SATURATION_AUDIT.md` | This report |

---

## 3. Root causes found

| # | Root cause | Evidence |
|---|------------|----------|
| R1 | **MySQL connection saturation** | `Max_used_connections` 152 ≥ `max_connections` 151 |
| R2 | **Idle Sleep accumulation** | 111 Sleep ≥300s killed; up to ~7796s idle; **not** long queries |
| R3 | **Leaked pools after process death/restart** | Two client IPs (`192.140.152.233`, `202.83.16.253`); local laptop + remote VPS both hit same DB user |
| R4 | **Server `wait_timeout` = 28800s (8h)** | Orphan Sleeps survive for hours |
| R5 | **Aborted_connects ~50k** | Failed connects while at max_connections |
| R6 | **API “10–20s latency”** | Pool/server wait for a free slot; SQL itself ~20ms when healthy |
| R7 | **Interest-accept transaction bug** | Managed transaction opened a connection that inner queries did not use → +1 held connection per accept (**fixed**) |
| R8 | **Retry on Too many connections** | Could worsen storms (**removed from retry match**) |

**Not a root cause:** Missing unique index on `user_profiles.userId` (index exists; tiny table uses `ALL` in EXPLAIN by design).

---

## 4. Connection leaks found

| Leak / risk | Severity | Status |
|-------------|----------|--------|
| Abandoned Node processes leaving MySQL Sleep | **Critical** | Mitigated: session `wait_timeout=120`, graceful `sequelize.close()`, `--exit-child`, kill script |
| Local + production sharing one DB user | **Critical** | Ops: run one API against this DB, or budget `instances × pool.max` |
| `respondToInterest` unused transaction connection | **Medium** | **Fixed** |
| Background jobs without stop on shutdown | **Low–Medium** | **Fixed** (all 5 stop) |
| Manual `commit`/`rollback` missing | None found | All use managed `sequelize.transaction(async …)` |
| Raw `mysql2` in scripts without `.end()` | None found | All audited scripts call `.end()` or `sequelize.close()` |
| Sequelize per request | None found | Singleton only |

---

## 5. STEP 1 — Sequelize initialization

| Location | Type |
|----------|------|
| `src/config/db.ts` | **ONLY** runtime `new Sequelize()` |
| Models / services | Import shared `sequelize` |
| `scripts/seed-master-data.cjs`, `backfill-master-data-users.cjs`, `optimize-existing-media.ts`, `diagnose-matrimony-discover.js` | Import singleton + **close** at end |
| Migration/e2e scripts | `mysql.createConnection` (CLI only) |

**Verdict:** One Sequelize instance. No API path creates `new Sequelize()`. No reconnect loop in app code. Hidden connections = CLI scripts only (closed after use).

---

## 6. STEP 2 — Pool configuration

### Current defaults (`src/config/db.ts`)

| Setting | Default | Notes |
|---------|---------|--------|
| `max` | 4 (or profile) | Cap 64 if overridden |
| `min` | 0 | No warm idle sockets |
| `acquire` | 20–45s | Bounded |
| `idle` | 8000ms | Destroy idle quickly |
| `evict` | 5000ms | Reaper |
| `maxUses` | 750 | Recycle sockets |
| Session wait | 120s | Caps orphan Sleep |

### Recommended profiles

| Environment | Env | `pool.max` | Notes |
|-------------|-----|------------|--------|
| Laptop testing vs remote MySQL | `DB_POOL_PROFILE=test` | **3** | Current shared-host safe |
| 1GB VPS (API + light MySQL) | `test` / `1gb` | **3** | Keep PM2 `instances=1` |
| 16GB dedicated | `prod16` | **12** | 1–2 API processes max |
| 64GB dedicated | `prod64` | **24** | Budget `instances × 24` ≪ `max_connections` |

**Formula:**  
`pool.max ≤ floor((max_connections − reserved) / num_api_processes)`  
`reserved` ≈ 20–40 for admin / other apps.

---

## 7. STEP 3–5 — Leaks, transactions, raw queries

### Transactions (all managed — auto commit/rollback)

| Call site | Uses `{ transaction }` correctly? |
|-----------|-----------------------------------|
| `MatrimonyPayment.fulfillOrderLocked` | Yes |
| `MatrimonySafety.blockUser` / `unblockUser` | Yes |
| `MatrimonyDiscover.removeMatch` | Yes |
| `MatrimonyDiscover.respondToInterest` → `tryCreateMutualMatch` | **Yes after fix** |

No bare `.commit()` / `.rollback()` in app code (correct for managed API).

### Raw `sequelize.query` / `Model.sequelize!.query`

All use the **shared pool**. No extra Sequelize. Schema probes (`SELECT 1 FROM …`) are cheap and pooled.

### Socket / jobs

- Socket auth: one `User.findByPk` per connect — pooled.
- Jobs: `jobRunning` guards; stopped on shutdown.

---

## 8. STEP 6–11 — Monitoring & debug

```bash
DB_POOL_DEBUG=true
# optional:
DB_POOL_DEBUG_INTERVAL_MS=15000
```

Example logs:

```
[MYSQL_POOL] Connection acquired
[MYSQL_POOL] Connection released
[MYSQL_POOL] Pool Active: X | Pool Waiting: X | Pool Available: X | Pool Size: Y/Z
[MYSQL_POOL] Acquire Time: XXms
[MYSQL_POOL] Query Time: XXms | …
[MYSQL_POOL] Transaction Started
[MYSQL_POOL] Transaction Committed | Duration: XXms
[MYSQL_POOL] Transaction Rolled Back | Duration: XXms
```

Disable: unset `DB_POOL_DEBUG` or set ≠ `true`.  
Health: `GET /api/health` includes `pool` / counters when debug is on.

---

## 9. STEP 7 — MySQL health SQL (run on VPS)

```sql
SHOW FULL PROCESSLIST;
SHOW STATUS LIKE 'Threads_connected';
SHOW STATUS LIKE 'Threads_running';
SHOW STATUS LIKE 'Max_used_connections';
SHOW STATUS LIKE 'Aborted_connects';
SHOW STATUS LIKE 'Connections';
SHOW STATUS LIKE 'Connection_errors_max_connections';
SHOW VARIABLES LIKE 'wait_timeout';
SHOW VARIABLES LIKE 'interactive_timeout';
SHOW VARIABLES LIKE 'max_connections';
```

### How to interpret

| Metric | Healthy | Unhealthy |
|--------|---------|-----------|
| `Threads_connected` | Near app pool budget | Near `max_connections` |
| `Threads_running` | Usually 1–few | High = real query load |
| `Max_used_connections` | ≪ `max_connections` | ≥ max = saturation history |
| `Aborted_connects` | Flat / slow growth | Rapid growth = refused connects |
| `Connection_errors_max_connections` | 0 | >0 = hit ceiling |
| PROCESSLIST `Sleep` + high `Time` | Few, &lt; session wait | Dozens for hours = leaks |
| PROCESSLIST `Query` + high `Time` | Rare | Real slow SQL (not your case) |
| `wait_timeout` | 60–300 for app DB | 28800 keeps orphans forever |

---

## 10. STEP 8 — PM2 impact

**Current config:** `instances: 1`, `exec_mode: "fork"`.

| Mode | Total MySQL sockets (approx) |
|------|------------------------------|
| fork, instances=1 | ≤ `DB_POOL_MAX` (e.g. 3–4) |
| cluster, instances=4, pool.max=4 | ≤ **16** |
| cluster, instances=4, pool.max=12 | ≤ **48** |

Plus leftover Sleep from crashed/old processes.

**Do not** enable cluster on this remote MySQL until `max_connections` and process inventory are known.

---

## 11. STEP 9 — Remote DB (laptop → internet → VPS)

| Risk | Mitigation in place |
|------|---------------------|
| High RTT → cost of new TCP/TLS | Pool reuse (`min=0` but reuse while warm); keepAlive |
| Stale sockets after network blips | `maxUses`, idle destroy, session wait_timeout, retry on reset/timeout (**not** on max connections) |
| Local + VPS API both open pools | Ops discipline / separate users or budgets |

Pooling **does** minimize handshakes; saturation was from too many **idle** sockets, not from query RTT alone.

---

## 12. STEP 10 — Optimizations implemented

- ✔ Reuse pooled connections  
- ✔ Never create Sequelize per request  
- ✔ Recover from temporary disconnects (limited retry)  
- ✔ Prevent leaks (shutdown, session wait, stop jobs)  
- ✔ Prevent pool exhaustion (small max + acquire timeout)  
- ✔ Prevent connection storms (no retry on max_connections)  
- ✔ Reduce idle Sleep (idle/evict + session wait 120s)  
- ✔ Reduce aborted connects (stop hitting ceiling)  
- ✔ Backward compatible (env flags only)

---

## 13. Estimated impact

| Metric | Before | After (expected) |
|--------|--------|------------------|
| App sockets (1 process) | 8–12+ plus leaks | **3–4** |
| Orphan Sleep lifetime | up to 8h | **~2 min** session kill |
| Threads after kill script | −111 Sleep | Immediate relief |
| API latency spikes 10–20s | Common under saturation | **Rare** if one process + new pool |
| Aborted_connects growth | Steep | Flatten |

**Rough latency:** remove multi-second **queue wait** → p95 API DB time back to network RTT + query (often &lt;100–300ms remote).

---

## 14. Rollback plan

1. Unset `DB_POOL_DEBUG`.  
2. Restore previous pool via env:  
   `DB_POOL_MAX=8` (or prior value), unset `DB_POOL_PROFILE`, unset `DB_SESSION_WAIT_TIMEOUT`.  
3. Revert git commits touching `db.ts`, `dbPoolMonitor.ts`, `server.ts`, `ecosystem.config.cjs`, Discover transaction fix if needed.  
4. PM2: `pm2 reload ecosystem.config.cjs --update-env`.  
5. Kill script is ops-only; no code rollback required.

---

## 15. Ops checklist (now)

1. Restart local API (`npm run dev`) so new pool + shutdown code load.  
2. Ensure production PM2 also redeployed with same `db.ts` (otherwise Sleeps return from VPS IP).  
3. Keep `instances: 1` on shared MySQL.  
4. Optional debug: `DB_POOL_DEBUG=true`.  
5. If Sleeps return: `npm run db:kill-idle-connections` and identify which IP is leaking.

---

## 16. Verdict

| Check | Result |
|-------|--------|
| One Sequelize instance | **PASS** |
| Connections returned to pool | **PASS** |
| Transactions complete | **PASS** (bug fixed) |
| No per-request Sequelize | **PASS** |
| Jobs don’t leak instances | **PASS** |
| PM2 not multiplying unexpectedly | **PASS** (`instances=1`) |
| Root cause | **Saturation from idle/leaked connections + shared max_connections**, not slow SQL |

Database connection layer audited and optimized for the stated mission.
