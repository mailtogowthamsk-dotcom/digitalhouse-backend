# PM2 deploy — Digital House API

Run these on the **server** (SSH), in the backend folder (e.g. `/home/USER/digitalhouse-backend`).

## 1. One-time setup

```bash
# Node 18+ and PM2
node -v    # v18 or v20
npm install -g pm2

cd /path/to/digitalhouse-backend
cp .env.example .env   # then edit .env with real DB, JWT, SMTP, R2, ADMIN_* values

# Upload package.json AND package-lock.json (or run npm install if lock is missing)
bash deploy/npm-install-deps.sh
npm run build
```

## 2. Start with PM2

```bash
cd /path/to/digitalhouse-backend
npm run pm2:start
pm2 save
```

Or use the helper script:

```bash
chmod +x deploy/pm2-deploy.sh
./deploy/pm2-deploy.sh
```

Check locally on the server:

```bash
curl -sS http://127.0.0.1:4000/api/health
# {"ok":true,"ready":true,"dbFailed":false}
```

Useful commands:

```bash
npm run pm2:logs      # tail logs
npm run pm2:reload    # after code/env changes
pm2 status
pm2 monit
```

## 3. Start PM2 on server reboot

```bash
pm2 startup
# Run the command PM2 prints (often sudo env PATH=... pm2 startup systemd -u USER --hp /home/USER)
pm2 save
```

## 4. Apache reverse proxy (required for HTTPS)

Without this, `https://www.infosensetechnologies.com/digitalhouse/backend/api/health` stays **404**.

### Standard VPS (root / sudo)

```bash
sudo a2enmod proxy proxy_http headers
```

Add `deploy/apache-digitalhouse-api.conf` inside the **VirtualHost** for `www.infosensetechnologies.com`, then:

```bash
sudo apachectl configtest
sudo systemctl reload apache2
```

### cPanel (no root)

1. **WHM → Apache Configuration → Include Editor** (or cPanel → **Apache Handlers** / **Include** for your domain).
2. Paste the `<Location /digitalhouse/backend/>` block from `deploy/apache-digitalhouse-api.conf`.
3. Rebuild Apache config in WHM if offered.
4. If proxy is not allowed, use `deploy/htaccess-api-proxy.conf` in `public_html/digitalhouse/backend/.htaccess` (host must allow `[P]`).

## 5. Public health check

```bash
curl -sS "https://www.infosensetechnologies.com/digitalhouse/backend/api/health"
```

Must return JSON, not HTML 404.

## 6. Deploy updates

```bash
cd /path/to/digitalhouse-backend
git pull   # or upload new files
npm ci
npm run build
npm run pm2:reload
```

## Troubleshooting

### `npm ci` — no package-lock.json

Upload **`package-lock.json`** next to `package.json`, or on the server run:

```bash
npm install
npm run build
```

(`deploy/npm-install-deps.sh` uses `npm ci` when the lockfile exists, otherwise `npm install`.)

### Crash loop: `dist/app.js` + `MODULE_NOT_FOUND` (cors)

Wrong PM2 entry and/or missing `node_modules`:

```bash
cd ~/public_html/digitalhouse/backend
bash deploy/FIX_PM2_ON_SERVER.sh
```

| Wrong | Correct |
|-------|---------|
| `pm2 start dist/app.js` | `pm2 start ecosystem.config.cjs` → **`dist/server.js`** |
| App name `digitalhouse` | `digitalhouse-api` |
| Only `dist/` uploaded | Full backend + `npm ci` on server |

`app.js` only exports Express; **`server.js`** opens port 4000 and connects the DB.

### Other issues

| Issue | Action |
|-------|--------|
| `pm2: command not found` | `npm install -g pm2` or use `npx pm2` |
| `ready: false` / 503 | Fix `DB_*` in `.env`; check MySQL is running |
| Port 4000 in use | `pm2 delete digitalhouse-api` or change `PORT` in `.env` + ecosystem |
| Local health OK, public 404 | Apache proxy not configured (step 4) |
| EADDRINUSE | `lsof -i :4000` and stop duplicate process |
