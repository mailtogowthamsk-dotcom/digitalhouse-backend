# PM2 log rotation

Operational hardening for Digital House PM2 processes. **Does not change** the Media Worker, queue logic, APIs, or schema.

PM2 writes dedicated log files (see `ecosystem.config.cjs`):

| Process | Out log | Error log |
|---------|---------|-----------|
| `digitalhouse-api` | `logs/pm2-out.log` | `logs/pm2-error.log` |
| `digitalhouse-media-worker` | `logs/pm2-media-worker-out.log` | `logs/pm2-media-worker-error.log` |
| `digitalhouse-scheduler` | `logs/pm2-scheduler-out.log` | `logs/pm2-scheduler-error.log` |

Without rotation, these files grow unbounded and can fill the disk.

## One-time setup (on the server)

Run as the same OS user that owns the PM2 daemon:

```bash
pm2 install pm2-logrotate
```

Recommended settings (tune later if needed):

```bash
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:retain 30
pm2 set pm2-logrotate:compress true
pm2 set pm2-logrotate:dateFormat YYYY-MM-DD_HH-mm-ss
pm2 set pm2-logrotate:workerInterval 30
pm2 set pm2-logrotate:rotateInterval 0 0 * * *
pm2 set pm2-logrotate:rotateModule true
```

Verify:

```bash
pm2 conf pm2-logrotate
pm2 describe digitalhouse-media-worker
ls -lah logs/
```

## What this does / does not do

| Does | Does not |
|------|----------|
| Rotate and compress PM2 log files | Change worker concurrency or claim logic |
| Limit retained rotated files | Modify `ecosystem.config.cjs` log paths (optional) |
| Apply to all PM2 apps for that user | Replace application-level logging |

## After deploy / reboot

`pm2-logrotate` is a PM2 module. After `pm2 startup` / reboot, confirm it is still listed:

```bash
pm2 ls
pm2 conf pm2-logrotate
```

If missing, re-run `pm2 install pm2-logrotate` and re-apply `pm2 set` values.

## Rollback

```bash
# Optional: remove the module (logs stop rotating; existing files remain)
pm2 uninstall pm2-logrotate
```

Application processes are unaffected.

## Related docs

- Deploy overview: [PM2_DEPLOY.md](./PM2_DEPLOY.md)
- Media pipeline: [../MEDIA.md](../MEDIA.md)
- Media worker ops (queue / alerts / retention design): `docs/MEDIA_WORKER_OPS.md` (planned follow-up doc)
