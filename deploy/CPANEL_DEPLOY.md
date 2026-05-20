# Deploy Digital House API on infosensetechnologies.com

Your `curl` returns **Apache HTML 404** because requests to `/digitalhouse/backend/api/*` never reach Node.  
After a correct deploy, this must return JSON:

```bash
curl -sS "https://www.infosensetechnologies.com/digitalhouse/backend/api/health"
# {"ok":true,"ready":true,"dbFailed":false}
```

## Option A — cPanel “Setup Node.js App” (recommended)

1. Upload the **backend** folder outside `public_html` (e.g. `/home/USER/digitalhouse-backend`).
2. On the server: `cd digitalhouse-backend && npm ci && npm run build`
3. cPanel → **Setup Node.js App** → Create application:
   - **Node version**: 18 or 20
   - **Application mode**: Production
   - **Application root**: `/home/USER/digitalhouse-backend`
   - **Application URL**: `digitalhouse/backend`
   - **Application startup file**: `dist/server.js`
4. Environment variables (in cPanel UI): copy from `.env` (`DB_*`, `JWT_*`, `ADMIN_API_KEY`, R2 keys, etc.).
5. If health still 404 but Node logs show hits on `/digitalhouse/backend/api/health`, set:
   - `API_BASE_PATH=/digitalhouse/backend`
6. **Restart** the Node app in cPanel.
7. Run the `curl` command above.

## Option B — PM2 + Apache reverse proxy

See **`deploy/PM2_DEPLOY.md`** for full steps. Short version:

```bash
cd /path/to/digitalhouse-backend
npm run pm2:deploy    # build + start/reload PM2 + local health check
pm2 startup && pm2 save
```

Then add `deploy/apache-digitalhouse-api.conf` to Apache and reload.

## Option C — `.htaccess` proxy (only if host allows `[P]`)

1. Copy `deploy/htaccess-api-proxy.conf` to  
   `public_html/digitalhouse/backend/.htaccess`
2. Node must be listening on `127.0.0.1:4000`.
3. If you get 500 or “proxy not allowed”, use Option A or B instead.

## CORS (admin + mobile)

Copy `deploy/htaccess-cors.conf` into `public_html/digitalhouse/backend/.htaccess`  
(merge with proxy rules if both are used). Always use **www** in client URLs.

## Mobile / admin URLs

- API base: `https://www.infosensetechnologies.com/digitalhouse/backend/api`
- Local dev: `http://<your-LAN-IP>:4000/api` in `mobile/.env`

## Troubleshooting

| Symptom | Fix |
|--------|-----|
| HTML 404 from Apache | Node not running or proxy/Passenger not configured |
| JSON `ready:false` / 503 | Fix MySQL credentials in server `.env` |
| CORS / redirect on OPTIONS | Use **www** URL; upload `htaccess-cors.conf` |
| Works on `127.0.0.1:4000` but not HTTPS | Apache `ProxyPass` or cPanel app URL mismatch |
| work on  "127.0.0.1:4002' but not|

