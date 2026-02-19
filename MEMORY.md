# Backend memory usage (cPanel / long-running process)

If you see memory increase over time (e.g. 20 MB → 50 MB → 98 MB), these are the usual causes and what we do about them.

## Why memory can grow

1. **Node / V8**  
   The heap grows with workload and does not always return memory to the OS. Some growth (e.g. up to ~100–150 MB under load) is normal. It often stabilizes after a while.

2. **In-memory rate limiting**  
   `express-rate-limit` keeps an in-memory store per IP (and per route). More unique IPs and more time mean more entries. This is bounded by the rate-limit window (e.g. 1 minute), but on a busy server it can add a few MB.

3. **Request logging**  
   Logging every request (`console.log` per hit) allocates many short-lived strings and can increase peak heap until GC runs. In production this is now **off** unless you enable it (see below).

4. **Database connections**  
   Sequelize uses a connection pool. Without limits, idle connections could sit in memory. We now set an explicit **pool** (max 5, idle timeout 10s) so connections are released when idle.

## What we changed to limit growth

- **Sequelize pool** (`src/config/db.ts`): `pool: { max: 5, min: 0, acquire: 30000, idle: 10000 }` so the app does not hold more than 5 DB connections and releases idle ones.
- **Request logging** (`src/app.ts`): API request logs run only when `NODE_ENV=development` or `LOG_REQUESTS=true`. In production (e.g. cPanel) we do not log every request by default, which reduces allocations and log volume.

## Optional: enable request logging on cPanel

If you need to see every API request in production, set in your environment (e.g. cPanel env or `.env`):

```bash
LOG_REQUESTS=true
```

## When to worry

- **Stable at ~80–120 MB** after some traffic: normal.
- **Steady, continuous growth** (e.g. 98 → 200 → 400 MB over hours/days): possible leak or very high traffic. Next steps:
  - Use a single global rate limiter or move rate limiting to Redis so the in-memory store does not grow with IPs.
  - Profile with `node --inspect` or tools like clinic.js to find what keeps references.

## No heavy background process

There is no heavy background process (no polling loop, no unbounded caches, no SSE connection list). The app is a standard Express API with DB, rate limiting, and optional request logging.
