# Live Database Audit Checklist (read-only)

Execute against **staging first**, then production. Use a read-only DB user when possible.

**Do not** run `ALTER`, `DROP`, `CREATE`, or data `DELETE`/`UPDATE` as part of this audit.

Policy context: [DATABASE_POLICY.md](./DATABASE_POLICY.md).

---

## Automated runner (PR-C)

Optional helper that runs the same checks as sections A–F and prints a markdown report. It uses **SELECT / SHOW / EXPLAIN only** (refuses DDL, write DML, and `EXPLAIN ANALYZE`).

```bash
# From digitalhouse-backend (uses .env DB_* credentials)
npm run db:audit:live

# Skip EXPLAIN section
npm run db:audit:live -- --skip-explain

# Write report file (still prints to stdout)
npm run db:audit:live -- --out=docs/audit-reports/staging-YYYYMMDD.md
```

| Rule | Detail |
|------|--------|
| CI | **Do not** auto-run against production in CI |
| Credentials | Prefer a read-only MySQL user |
| Schema changes | Report does **not** authorize DDL — file findings under §G |
| Manual SQL | Sections below remain the source of truth if you prefer a SQL client |

After the runner finishes, copy results into the result tables in this doc (or attach the generated report to the change ticket).

**Latest filed findings (PR-D):** [audit-reports/FINDINGS-20260731.md](./audit-reports/FINDINGS-20260731.md) · raw: [audit-reports/live-20260731.md](./audit-reports/live-20260731.md)

---

## Meta

| Field | Value |
|-------|--------|
| Environment | staging / production |
| Date | |
| Operator | |
| MySQL version | |
| Runner used? | `npm run db:audit:live` / manual |
| Report path (if any) | |
| Backup verified before any later remediation? | (N/A for read-only audit) |

---

## A. schema_migrations

```sql
SHOW TABLES LIKE 'schema_migrations';
SELECT version, name, direction, applied_at, LEFT(checksum, 12) AS checksum_prefix
FROM schema_migrations
ORDER BY version;
```

| Check | Result | Notes |
|-------|--------|-------|
| Table exists | | |
| Applied versions list | | |
| Unexpected empty on long-lived env? | | |

Also run: `npm run db:migrate:status` from an app checkout pointed at this DB (read applies history; does not write if up to date).

---

## B. ENUM values

Capture live definitions and compare to app constants (e.g. `User` status, `POST_TYPES`).

```sql
SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, COLUMN_DEFAULT
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND DATA_TYPE = 'enum'
ORDER BY TABLE_NAME, COLUMN_NAME;
```

Focus review:

| Column | Expected values (from app) | Live COLUMN_TYPE | Match? |
|--------|----------------------------|------------------|--------|
| `users.status` | include soft-delete / changes-requested set | | |
| `posts.postType` | POST_TYPES | | |
| media / moderation ENUMs | | | |

**Policy:** do not “fix” mismatches by re-running legacy `MODIFY ENUM` scripts.

---

## C. Indexes

```sql
SELECT TABLE_NAME, INDEX_NAME, NON_UNIQUE,
       GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS cols
FROM information_schema.STATISTICS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME IN (
    'posts', 'media_jobs', 'messages', 'notifications',
    'post_likes', 'saved_posts', 'post_hashtags',
    'users', 'matrimony_interests', 'matrimony_matches'
  )
GROUP BY TABLE_NAME, INDEX_NAME, NON_UNIQUE
ORDER BY TABLE_NAME, INDEX_NAME;
```

| Table | Notable indexes present? | Gaps / duplicates noted |
|-------|--------------------------|-------------------------|
| posts | | |
| media_jobs | claim `(status,updatedAt,createdAt)`? | |
| messages | | |
| notifications | | |
| junctions | | |
| matrimony | | |

---

## D. Foreign keys

```sql
SELECT TABLE_NAME, COLUMN_NAME, CONSTRAINT_NAME,
       REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME
FROM information_schema.KEY_COLUMN_USAGE
WHERE TABLE_SCHEMA = DATABASE()
  AND REFERENCED_TABLE_NAME IS NOT NULL
ORDER BY TABLE_NAME, CONSTRAINT_NAME;
```

| Area | FKs present? | Orphan risk notes |
|------|--------------|-------------------|
| Core social (posts, comments, likes, …) | | |
| Matrimony suite | | |
| media_jobs → media_files | | |

---

## E. Duplicate junction rows

```sql
SELECT postId, userId, COUNT(*) AS c
FROM post_likes
GROUP BY postId, userId
HAVING c > 1
LIMIT 50;

SELECT userId, postId, COUNT(*) AS c
FROM saved_posts
GROUP BY userId, postId
HAVING c > 1
LIMIT 50;

SELECT postId, hashtagId, COUNT(*) AS c
FROM post_hashtags
GROUP BY postId, hashtagId
HAVING c > 1
LIMIT 50;
```

Adapt column names if the live DB uses snake_case for a given table. Add analogous checks for matrimony pair tables (`from_user_id`/`to_user_id`, `user_low_id`/`user_high_id`, etc.). The automated runner skips a check when columns are missing.

| Table | Duplicate groups found? | Sample count |
|-------|-------------------------|--------------|
| post_likes | | |
| saved_posts | | |
| post_hashtags | | |
| matrimony pairs | | |

If duplicates exist: **stop** — open a remediation ticket (dedupe plan). Do not add UNIQUE indexes until cleaned.

---

## F. EXPLAIN — feed / messages / notifications

Replace literals with realistic ids from the environment. Prefer `EXPLAIN` on production; use `EXPLAIN ANALYZE` on staging only if approved (it executes the query). The automated runner never runs `EXPLAIN ANALYZE`.

### F1. Feed (example shape)

```sql
EXPLAIN
SELECT id, userId, postType, createdAt
FROM posts
WHERE postType = 'ANNOUNCEMENT'
  AND moderation_status = 'ACTIVE'   -- or moderationStatus if camelCase
ORDER BY createdAt DESC
LIMIT 20;
```

| Metric | Value |
|--------|-------|
| type / key | |
| rows | |
| Extra (filesort / temporary?) | |
| Acceptable? | |

Add variants used in production (marketplace/help filters, cursor `id < ?`, etc.) as needed.

### F2. Messages (thread / pair)

```sql
EXPLAIN
SELECT id, senderId, recipientId, createdAt
FROM messages
WHERE (senderId = ? AND recipientId = ?)
   OR (senderId = ? AND recipientId = ?)
ORDER BY createdAt DESC
LIMIT 50;
```

| Metric | Value |
|--------|-------|
| type / key | |
| rows | |
| Extra (filesort / temporary?) | |
| Acceptable? | |

### F3. Notifications inbox

```sql
EXPLAIN
SELECT id, userId, createdAt, readAt
FROM notifications
WHERE userId = ?
  AND deleted_at IS NULL          -- or deletedAt
ORDER BY createdAt DESC
LIMIT 50;
```

| Metric | Value |
|--------|-------|
| type / key | |
| rows | |
| Extra (filesort / temporary?) | |
| Acceptable? | |

---

## G. Summary for roadmap

| Finding | Severity | Suggested follow-up (additive only) |
|---------|----------|-------------------------------------|
| See [audit-reports/FINDINGS-20260731.md](./audit-reports/FINDINGS-20260731.md) | High→Low | F1/F2: bootstrap `db:migrate` / `media_jobs` on separate ticket; F3–F7 clean; F8 messages filesort optional |

No schema change is authorized by completing this audit alone. Follow [DATABASE_POLICY.md](./DATABASE_POLICY.md) §9.
