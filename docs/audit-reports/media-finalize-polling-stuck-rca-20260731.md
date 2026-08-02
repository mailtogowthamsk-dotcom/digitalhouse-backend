# Media finalize polling never completes — RCA

**Date:** 2026-07-31  
**Example:** `POST /api/media/finalize` → 200 for media **87**, then endless `GET /api/media/87/status`.

## Verdict

Processing did **not** hang in Sharp/FFmpeg/R2. Finalize correctly enqueued a durable job; **no media worker process was running** to claim it, so `processingStatus` stayed `pending` and the client poll never stopped.

## Lifecycle verified

| Stage | Result |
|--------|--------|
| upload-url | OK (media row created) |
| R2 PUT | OK (`byteSize=85282`) |
| finalize | OK (~1.5s) — HEAD + enqueue |
| `media_files` | `processingStatus=pending`, `variantsJson=null` |
| `media_jobs` | id=1, `status=pending`, **`workerId=null`**, never `startedAt` |
| Worker claim | **Did not happen** (API-only `npm run dev`) |
| Optimize / COMPLETED | N/A until worker started |

## Evidence (media 87 / job 1)

Before worker:

- `media_files.processingStatus = pending`
- `media_jobs.status = pending`, `workerId = null`, `retryCount = 0`, `errorMessage = null`

After `npm run dev:media-worker`:

```
[media-worker] claimed job=1 media=87 type=image
[media-worker] completed job=1 media=87 durationMs=3082
```

- `processingStatus = completed`, variants written, job `status=completed`

## Root cause

| Item | Detail |
|------|--------|
| **File** | Architecture: `Media.controller.finalizeUpload` → `MediaJob.service.enqueueMediaFinalize`; work in `src/workers/mediaWorker.ts` |
| **Function** | Finalize only enqueues; `claimNextMediaJob` / `processClaimedMediaJob` run **only** in the standalone worker |
| **Why polling never ends** | Status reads live DB (`getMediaFinalizeStatus`) — correctly returns `pending` while job unclaimed |
| **Not** | FFmpeg hang, Sharp hang, R2 hang, DB update failure, claim crash, continuous retry |

`npm run dev` does **not** start the media worker. Production expects PM2 process `digitalhouse-media-worker`.

## Fix (architecture preserved)

1. **Ops:** Keep `digitalhouse-media-worker` running (local: `npm run dev:media-worker`).
2. **Observability:** API boot warns if pending jobs exist; status may include `queue.hint` when unclaimed >5s; optional `MEDIA_PIPELINE_TIMING=true`.
3. **No** force-COMPLETED, **no** disable polling, **no** in-API Sharp (keeps processor out of Express).

## Local checklist

```bash
# terminal 1
npm run dev
# terminal 2
npm run dev:media-worker
```
