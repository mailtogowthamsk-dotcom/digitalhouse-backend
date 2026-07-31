# Database & Migration Policy

Authoritative policy for Digital House MySQL schema changes and bootstrap.

**Related:** [MIGRATIONS.md](./MIGRATIONS.md) (CLI / framework), [DATABASE_LIVE_AUDIT.md](./DATABASE_LIVE_AUDIT.md) (read-only audit checklist).

---

## 1. Schema freeze (production)

The **current physical schema is frozen** for redesign work.

| Forbidden | Allowed (later, separately approved) |
|-----------|--------------------------------------|
| Table redesign / rewrite | Additive `CREATE TABLE IF NOT EXISTS` for net-new features |
| Replacing ENUMs with STRING or other types | Expanding ENUM **only** with a reviewed versioned migration (append values; never narrow) |
| CHECK constraints | Additive indexes / unique keys / FKs after live audit + dedupe |
| Column renames | Forward-compatible nullable columns |
| Splitting polymorphic `posts` | Application-level discipline only for now |

Do **not** generate schema change tickets that violate the left column without an explicit architecture decision that lifts this freeze.

---

## 2. Sole migration mechanism going forward

**Only** versioned migrations under `db/migrations/` applied via:

```bash
npm run db:migrate
npm run db:migrate:new -- <snake_case_name>
```

Deploy (`deploy/pm2-deploy.sh`) runs `npm run db:migrate`. That is the supported production schema path.

Do **not** add new `scripts/run-*-sql.js` / `scripts/run-*-migration.js` files for schema changes.

---

## 3. Legacy migration scripts (deprecated, not removed)

Scripts such as `npm run db:run-*`, `db:migrate-media`, `db:fix-indexes`, and `db:apply-changes-requested` are **deprecated**.

- Files remain in the repo for history and emergency reference.
- They must **not** be used for routine deploys or new work.
- They may be executed **only** when **all** of the following are true:

  1. `ALLOW_LEGACY_DB_SCRIPTS=1` is set in the shell environment for that invocation.
  2. An incident or maintenance ticket documents **why** the legacy script is required.
  3. A reviewer has confirmed the script will not narrow ENUMs or drop needed indexes/constraints.
  4. A verified backup exists (see §7).

```bash
# Emergency only — document reason in the ticket first
ALLOW_LEGACY_DB_SCRIPTS=1 npm run db:run-<name>
```

**Especially dangerous (never re-run casually):** scripts that `MODIFY COLUMN` `users.status` ENUM with incomplete value lists (`db:run-reports-phase1-sql`, `db:run-registration-status-sql`, `db:run-user-soft-delete-sql`). Prefer a single future versioned migration if ENUM expansion is ever required — never re-apply an older narrowing script.

> **Enforcement:** npm scripts for legacy runners go through `scripts/legacy-db-guard.js` and exit unless `ALLOW_LEGACY_DB_SCRIPTS=1`. Invoking `node scripts/run-*.js` directly still bypasses the guard — do not do that in shared environments.

---

## 4. sequelize.sync() — local development only

| Environment | `sequelize.sync()` | `sync({ alter: true })` |
|-------------|--------------------|-------------------------|
| Local developer machine (`NODE_ENV=development`) | Permitted to bootstrap an **empty** local DB | Avoid; prefer migrations. If used, only on disposable local DBs |
| Staging | **Forbidden** | **Forbidden** |
| Production | **Forbidden** (already skipped when `NODE_ENV=production`) | **Forbidden** |
| Any shared / persistent DB | **Forbidden** | **Forbidden** |

Rationale: `alter: true` has caused duplicate indexes and approached MySQL’s per-table index limit. Shared environments must use `db:migrate` only.

Do **not** set `DB_SYNC=true` or `DB_SYNC_ALTER=true` on staging or production hosts.

---

## 5. Bootstrap procedures

### 5.1 Greenfield (new empty MySQL)

1. Prefer restore from a known-good anonymized staging/prod dump, **or**
2. Local only: `NODE_ENV=development` with `DB_SYNC=true` once (no alter) to create base tables from models, then:
3. `npm run db:migrate`
4. `npm run db:migrate:validate`
5. Run seeds as documented for local/dev

### 5.2 Existing production / staging

1. Ensure `NODE_ENV=production` (or staging equivalent) so sync is skipped.
2. Deploy: `npm run build` → `npm run db:migrate` → process reload.
3. Never run legacy `db:run-*` as part of normal deploy.
4. Use `db:migrate:baseline` **only** when intentionally recording already-applied versioned migrations on an env that already has that DDL — never on an empty DB to “skip” real ups.

---

## 6. Migration Review Checklist

Every PR that adds or changes a folder under `db/migrations/` must answer:

| # | Check | Required answer |
|---|--------|-----------------|
| 1 | **Additive?** | Prefer ADD COLUMN / INDEX / TABLE. If destructive, justify + maintenance window. |
| 2 | **Idempotent?** | Guards / `IF NOT EXISTS` / information_schema checks so re-run is safe if history row missing after partial failure. |
| 3 | **Rollback strategy** | `down.sql`/`down.js` + `meta.rollback: true`, **or** explicit `rollback: false` with backup/restore / forward-fix plan. |
| 4 | **Online migration assessment** | Will this take metadata-only lock, brief lock, or table copy? Estimated duration on prod-sized data? |
| 5 | **Downtime required?** | Yes / No. If yes: window, owner, communication plan. |
| 6 | **Compatible with previous app version?** | Can old app binaries run against the new schema during rolling deploy? (Expand-contract: add nullable columns first; don’t drop/rename until old app is gone.) |
| 7 | **Expectations updated?** | Update `db/expectations/*.json` when adding required tables/columns/indexes. |
| 8 | **Backup verified?** | §7 completed before apply on staging/prod. |
| 9 | **ENUM change?** | Append-only if unavoidable; never remove values; call out lock risk. Prefer avoiding ENUM changes under freeze. |
| 10 | **No legacy script?** | Change ships as `db/migrations/…`, not a new `db:run-*`. |

PRs that fail this checklist should not merge.

---

## 7. Backup verification (before migrations)

Before applying migrations to **staging or production**:

1. **Confirm a recent backup exists** (hosting panel dump, `mysqldump`, or managed snapshot) with timestamp and retention known.
2. **Verify restore integrity** on a non-prod target at least on a defined cadence (e.g. monthly) and before high-risk migrations:
   - Restore dump to a scratch database.
   - `SELECT COUNT(*)` on critical tables (`users`, `posts`, `messages`, `media_jobs`) matches expectations within tolerance.
   - Spot-check: login/API smoke against restored copy if feasible.
3. **Record in the change ticket:** backup id/path, taken-at time, who verified, scratch restore result (pass/fail).
4. **Do not proceed** if backup is missing, older than the agreed RPO, or restore verification failed.

App binary rollback does **not** restore the database. Backups are the primary undo for irreversible DDL.

---

## 8. Live database audit (read-only)

Use [DATABASE_LIVE_AUDIT.md](./DATABASE_LIVE_AUDIT.md). Run on staging first, then production (read-only credentials preferred).

Optional automated helper (same checks, markdown report):

```bash
npm run db:audit:live
npm run db:audit:live -- --out=docs/audit-reports/staging-YYYYMMDD.md
```

The runner is **not** legacy-gated, executes **no DDL**, and must **not** be wired as a production CI job. Ops filing of findings: [audit-reports/FINDINGS-20260731.md](./audit-reports/FINDINGS-20260731.md) (PR-D).

Audit must cover:

### 8.1 Structure & integrity

- ENUM definitions (especially `users.status`, `posts.postType`, media/moderation status columns) vs application constants
- Indexes on hot tables (`posts`, `media_jobs`, `messages`, notifications, matrimony, junctions)
- Foreign keys (core social graph + matrimony suite)
- Duplicate junction rows (`post_likes`, `saved_posts`, `post_hashtags`, matrimony pair tables)
- `schema_migrations` contents and checksum drift

### 8.2 Query performance (EXPLAIN)

Capture `EXPLAIN` (and `EXPLAIN ANALYZE` where MySQL version supports it safely on staging) for:

| Area | Representative queries |
|------|-------------------------|
| Feed | Home/feed list filters by `postType`, visibility/moderation, cursor pagination |
| Messages | Thread list / pair history (`senderId`/`recipientId` + `createdAt`) |
| Notifications | Inbox by `userId` + unread / `createdAt` |

For each plan record:

- `type` / `key` / `rows` (rows examined estimate)
- `Extra`: **Using filesort**, **Using temporary**, **Using where**, etc.
- Whether the chosen index matches expectations

Do **not** run DDL as part of the audit. Findings feed the post-launch roadmap (additive indexes/uniques/FKs only after separate approval).

---

## 9. Post-launch improvement roadmap (policy)

Ordered intent — **no automatic implementation**:

| Order | Theme | Constraint |
|-------|--------|------------|
| 1 | Complete live audit + document findings | Read-only — **done 2026-07-31** ([FINDINGS](./audit-reports/FINDINGS-20260731.md)) |
| 2 | Additive UNIQUE on junctions **only after** duplicate cleanup plan | Versioned migration; separate ticket — **not needed on audited host** (UNIQUEs present, 0 dups) |
| 3 | Additive FKs where orphan count is zero | Versioned migration; separate ticket — pair FKs already present; orphan scan optional |
| 4 | Port critical legacy history into versioned stubs + baseline for new envs | No ENUM narrowing — **blocked on** bootstrapping `schema_migrations` via `db:migrate` (see findings F1/F2) |
| 5 | Tighten sync env allowlist in code (dev-only) | Separate PR; no schema |

Deferred indefinitely under freeze: ENUM→STRING, CHECK, renames, polymorphic posts split.

---

## 10. Owners & review

- Schema / migration PRs: require checklist (§6) in the PR description.
- Legacy script use: require ticket + `ALLOW_LEGACY_DB_SCRIPTS=1` + backup verification (§7).
- Questions: align with Database Policy / Production Stabilization owners before inventing parallel processes.
