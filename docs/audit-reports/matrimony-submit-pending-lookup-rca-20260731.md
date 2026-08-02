# Matrimony submit — pending_profile_updates lookup RCA

**Date:** 2026-07-31  
**Symptom:** `POST /api/matrimony/submit` logged `[slow-query] 14508ms` on  
`PendingProfileUpdate.findOne({ userId, section: 'MATRIMONY', status: 'PENDING' ORDER BY submittedAt DESC LIMIT 1 })`  
Total API: ~16004ms.

## Execution flow

1. `POST /api/matrimony/submit` → `matrimony.routes.ts` → `Matrimony.controller.submit`
2. `submitMatrimonyProfile` (`matrimony.application.service.ts`)
3. `getMatrimonyHub` → `findActiveMatrimonyApplication` (`matrimony.persistence.service.ts` ~L164)
4. `upsertMatrimonyPending` → **same** `findActiveMatrimonyApplication` again
5. Final `getMatrimonyHub` → **same** query a third time

Canonical query site: `backend/src/services/matrimony/matrimony.persistence.service.ts` — `findActiveMatrimonyApplication`.

## Why ~14s (not “JSON is huge”)

| Check | Result |
|--------|--------|
| Table size | ~13 rows, ~2.5KB JSON max |
| EXPLAIN (before fix) | `idx_pending_status_section` (status, section); filter `userId`; **Using filesort** |
| EXPLAIN ANALYZE (idle) | **~0.03–0.8ms** server time |
| Client RTT (idle) | ~20–50ms |
| Locking SELECT vs FOR UPDATE | Non-locking SELECT did **not** block |
| Pool saturation | Wall-clock waits for free connection; Sequelize benchmark starts **after** acquire |
| Concurrent load (same window) | Feed `COUNT` also took ~9.7s — shared MySQL overload |

**Root cause (combined):**

1. **Wrong index for the access pattern** — planner preferred `(status, section)`, scanned all PENDING+MATRIMONY rows, filtered `userId`, filesorted by `submittedAt`. Fine at 13 rows; degrades as the queue grows; amplifies cost when the shared host is busy.
2. **Query repeated 3× per submit** — multiplies chance of hitting a saturated MySQL / network stall.
3. **Hub loaded redundant full `User` + duplicate `UserProfile`** in parallel — held extra pool connections (`DB_POOL_MAX` default 4) during submit, worsening acquire pressure under load.
4. The **14.5s Sequelize timing is wall time waiting on MySQL/network for that statement**, not 14s of CPU work on 13 rows. Idle EXPLAIN proves the statement is cheap when the server is responsive.

Not caused by: selecting JSON alone (~2.5KB), missing LIMIT, Sequelize hooks on the model, or an open app-level transaction around submit (none).

## Fix (behavior preserved)

1. **Composite index** `idx_pending_user_section_status_submitted (userId, section, status, submittedAt)`  
   - Migration: `db/migrations/20260731184500_pending_profile_user_lookup_index/`  
   - Model indexes + hardening script mirror  
2. **Reuse pending row** on submit (`preloadedActive` / `existingRow`) — one findActive for status+upsert  
3. **Leaner `getMatrimonyHub`** — single User + UserProfile load (no nested `getUserContext` duplicate)  
4. **Timing logs** — `MATRIMONY_SUBMIT_TIMING=true`, or auto-log when submit ≥ 3s  

## EXPLAIN after fix

- **key:** `idx_pending_user_section_status_submitted`  
- **rows:** 1  
- **Extra:** `Backward index scan` (no filesort)  
- **ANALYZE:** ~0.03ms server-side  

## Ops

```bash
cd backend && npm run db:migrate
# optional: MATRIMONY_SUBMIT_TIMING=true
```
