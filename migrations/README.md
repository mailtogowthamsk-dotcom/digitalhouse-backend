# Database migrations (Matrimony)

Run these **in order** on production MySQL (phpMyAdmin, cPanel SQL, or CLI).  
Each file is idempotent where possible (`IF NOT EXISTS` / safe re-run).

| # | File | Required | Purpose |
|---|------|----------|---------|
| 1 | `matrimony-admin-module.sql` | **Yes** | Admin review tables, `matrimony_request_meta`, audit |
| 2 | `matrimony-changes-requested.sql` | Recommended | `CHANGES_REQUESTED` / `RESUBMITTED` workflow columns |
| 3 | `matrimony-candidate-photos.sql` | **Yes** (if using candidate photos) | `matrimony_candidate_photos` |
| 4 | `matrimony-phase2.sql` | **Yes** (Phase 2 live) | `matrimony_interests`, `matrimony_matches` |
| 5 | `matrimony-phase2-safety.sql` | **Yes** (Step 4.2) | `matrimony_saved_profiles`, `matrimony_blocks`, `matrimony_reports` |
| 6 | `matrimony-phase5-monetization.sql` | **Yes** (Phase 5) | Subscriptions, profile opens, contact payments, profile views |

## CLI example (production)

```bash
cd backend
mysql -h YOUR_HOST -u YOUR_USER -p YOUR_DATABASE < migrations/matrimony-admin-module.sql
mysql -h YOUR_HOST -u YOUR_USER -p YOUR_DATABASE < migrations/matrimony-changes-requested.sql
mysql -h YOUR_HOST -u YOUR_USER -p YOUR_DATABASE < migrations/matrimony-candidate-photos.sql
mysql -h YOUR_HOST -u YOUR_USER -p YOUR_DATABASE < migrations/matrimony-phase2.sql
mysql -h YOUR_HOST -u YOUR_USER -p YOUR_DATABASE < migrations/matrimony-phase2-safety.sql
mysql -h YOUR_HOST -u YOUR_USER -p YOUR_DATABASE < migrations/matrimony-phase5-monetization.sql
```

## Verify after migrate

```bash
cd backend
npm run db:verify-matrimony
```

## After migrations

1. Restart Node backend (cPanel / PM2 / Railway).
2. `npm run verify:health` (or curl health URL).
3. Follow smoke tests in `/PRODUCTION_READINESS.md` → Step 1.
