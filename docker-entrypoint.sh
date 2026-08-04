#!/bin/sh
set -e

# Regenerates the frontend's runtime config from an env var set at `docker run`/compose
# time, so a pulled image can point at a different API host/port with no rebuild — see
# frontend/src/lib/api.ts. Escape backslashes and quotes so the value can't break out of
# the string literal.
escaped=$(printf '%s' "${API_BASE_URL:-}" | sed 's/\\/\\\\/g; s/"/\\"/g')

cat > /usr/share/nginx/html/env-config.js <<EOF
window.__SCRIP_CONFIG__ = {
  apiBaseUrl: "${escaped}"
};
EOF

exec "$@"
