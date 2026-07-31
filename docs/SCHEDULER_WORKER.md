# Scheduler architecture

Lifecycle jobs no longer run inside the API process. They run in a dedicated **scheduler worker** so the API can scale without duplicate executions.

## Processes

| Process | Entry | Responsibility |
|---------|-------|----------------|
| `digitalhouse-api` | `dist/server.js` | HTTP + Socket.io. No interval jobs (default). |
| `digitalhouse-media-worker` | `dist/workers/mediaWorker.js` | MediaJob poll/claim (unchanged). |
| `digitalhouse-scheduler` | `dist/workers/schedulerWorker.js` | Domain `setInterval` jobs. |

## Jobs moved to the scheduler worker

1. Matrimony subscription lifecycle  
2. Marketplace expiry  
3. Helping Hands expiry  
4. Platform scheduled notifications  
5. Orphan media cleanup  

## Duplicate prevention (horizontal scale)

Every tracked job execution acquires a **MySQL `GET_LOCK`** (`SchedulerLock.service`) before work. A second worker (or overlapping tick) skips immediately. In-process `jobRunning` flags remain as a fast path.

Admin **Run Now** also goes through `trackExecution` → same lock.

## Graceful shutdown

- Scheduler worker: `SIGINT` / `SIGTERM` → clear intervals → `sequelize.close()`  
- API: no job timers unless `SCHEDULER_IN_API=true`

## Local / PM2

```bash
# Dev (two terminals)
npm run dev
npm run dev:scheduler

# Production
npm run build
npm run pm2:start   # starts api + media + scheduler
```

Escape hatch (single-process debug only):

```bash
SCHEDULER_IN_API=true npm run dev
```

## Ops dashboard

Admin System Scheduler still enable/disable / Run Now. Health uses **heartbeats** written by the worker (not in-process timers on the API).
