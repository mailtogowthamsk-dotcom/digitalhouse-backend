# Database migrations

## Current system (required)

Versioned migrations live under `db/migrations/`.

**Policy:** [docs/DATABASE_POLICY.md](../docs/DATABASE_POLICY.md)  
**Framework how-to:** [docs/MIGRATIONS.md](../docs/MIGRATIONS.md)  
**Live audit:** [docs/DATABASE_LIVE_AUDIT.md](../docs/DATABASE_LIVE_AUDIT.md)

```bash
npm run db:migrate
npm run db:migrate:status
npm run db:migrate:new -- my_change
```

Deploy runs `npm run db:migrate` only.

### Schema freeze

Do not use this folder (or new ad-hoc SQL) to redesign tables, replace ENUMs, add CHECK constraints, rename columns, or split polymorphic posts.

### sequelize.sync()

Allowed only on **local** empty development databases. **Never** on staging, production, or shared environments.

---

## Legacy SQL in this directory (deprecated)

Files below are **historical reference**. They are **deprecated for apply**.

Do **not** run them as part of normal deploy. Emergency use only:

1. Ticket documenting the reason  
2. Verified backup  
3. `ALLOW_LEGACY_DB_SCRIPTS=1` when invoking related npm scripts  

| # | File | Purpose (historical) |
|---|------|----------------------|
| 1 | `matrimony-admin-module.sql` | Admin review tables, audit |
| 2 | `matrimony-changes-requested.sql` | CHANGES_REQUESTED workflow |
| 3 | `matrimony-candidate-photos.sql` | Candidate photos |
| 4 | `matrimony-phase2.sql` | Interests / matches |
| 5 | `matrimony-phase2-safety.sql` | Saved / blocks / reports |
| 6 | `matrimony-phase5-monetization.sql` | Subscriptions / payments |

Prefer porting any still-needed DDL into `db/migrations/` (additive, reviewed) rather than re-applying these files.
