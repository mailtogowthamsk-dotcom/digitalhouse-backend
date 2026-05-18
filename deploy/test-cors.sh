#!/usr/bin/env bash
# Run on server or locally against production URL
BASE="${1:-https://www.infosensetechnologies.com/digitalhouse/backend}"
ORIGIN="${2:-https://www.infosensetechnologies.com}"

echo "OPTIONS preflight..."
curl -sSI -X OPTIONS "${BASE}/api/admin/login" \
  -H "Origin: ${ORIGIN}" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: content-type" | grep -i access-control

echo ""
echo "Expect exactly ONE Access-Control-Allow-Origin: ${ORIGIN}"
