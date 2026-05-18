# CORS & Apache deployment (admin web)

## The error you saw

```
Redirect is not allowed for a preflight request
```

Usually caused by (1) admin on `www` calling API on non-`www`, or (2) Apache redirecting **OPTIONS** before Node responds.

## Fixes (deploy all three)

### 1. Admin frontend: same-origin API (best — no CORS)

The admin app now auto-uses **`window.location.origin + /digitalhouse/backend`** when hosted on `infosensetechnologies.com`. Rebuild and redeploy the frontend:

```bash
cd frontend && npm run build
```

Upload `dist/` to the server. Login calls `/digitalhouse/backend/api/admin/login` on the **same host** as the page — no cross-origin request.

### 2. Match API host if you disable auto-detect

In `frontend/.env` (fallback for non-browser / custom hosts):

```env
VITE_API_BASE=https://www.infosensetechnologies.com/digitalhouse/backend
```

Mobile:

```env
EXPO_PUBLIC_API_URL=https://www.infosensetechnologies.com/digitalhouse/backend/api
```

### 2. Apache: proxy API without redirecting OPTIONS

Proxy `/digitalhouse/backend/` to Node (example port 4000). **Do not** apply www/http redirects to this path.

```apache
# Example — adjust port and path to your setup
ProxyPreserveHost On
ProxyPass /digitalhouse/backend/ http://127.0.0.1:4000/
ProxyPassReverse /digitalhouse/backend/ http://127.0.0.1:4000/

# Optional: exclude API from global RewriteRule www redirects
RewriteCond %{REQUEST_URI} !^/digitalhouse/backend
```

Verify (must return JSON, not HTML 301/404):

```bash
curl -i -X OPTIONS "https://www.infosensetechnologies.com/digitalhouse/backend/api/health" \
  -H "Origin: https://www.infosensetechnologies.com" \
  -H "Access-Control-Request-Method: POST"
```

Expect `204` or `200` with `Access-Control-Allow-Origin` header, **not** `301 Moved Permanently`.

### 3. Backend CORS env (optional)

```env
CORS_ORIGINS=https://www.infosensetechnologies.com,https://infosensetechnologies.com
```

Restart Node after deploy.

## Quick test

```bash
curl -sS "https://www.infosensetechnologies.com/digitalhouse/backend/api/health"
# {"ok":true,"ready":true,...}
```
