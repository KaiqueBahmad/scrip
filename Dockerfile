# syntax=docker/dockerfile:1
#
# Single image bundling both independent apps in this repo (backend/, frontend/):
# nginx serves the built panel on :8080, the Fastify/NestJS API listens on :8081, and
# supervisord runs both processes side by side in the same container.
#   docker build -t scrip .
#   docker run -p 8080:8080 -p 8081:8081 -v scrip-data:/app/backend/data scrip

# ----------------------------------------------------------------------------
# backend — Node/Fastify (NestJS) API
# ----------------------------------------------------------------------------

# better-sqlite3 needs to compile a native addon when no prebuilt binary matches the
# image's platform/libc, so build tools are present in every stage that runs `npm ci`.
FROM node:20-bookworm-slim AS backend-deps
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY backend/package.json backend/package-lock.json ./
# The `test -x` guard catches npm silently returning 0 on an incomplete install (a known
# npm bug — "Exit handler never called!" — usually triggered by a flaky registry
# connection): without it, the broken node_modules gets cached as a successful layer and
# only fails confusingly later, at `npm run build`.
RUN npm ci --no-audit --no-fund && test -x node_modules/.bin/tsc

FROM backend-deps AS backend-build
COPY backend/tsconfig.json ./
COPY backend/scripts ./scripts
COPY backend/src ./src
RUN npm run build

FROM node:20-bookworm-slim AS backend-prod-deps
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && test -d node_modules/better-sqlite3

# ----------------------------------------------------------------------------
# frontend — Vite/React panel
# ----------------------------------------------------------------------------

FROM node:20-bookworm-slim AS frontend-build
WORKDIR /app
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund && test -x node_modules/.bin/vite

COPY frontend/tsconfig.json frontend/vite.config.ts frontend/index.html ./
COPY frontend/public ./public
COPY frontend/src ./src

# Vite only bakes VITE_* vars into the bundle at build time, so it must be a build arg,
# not a runtime env var — the browser fetches the API directly, there's no server-side proxy.
ARG VITE_API_BASE_URL=http://localhost:8081
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL

RUN npm run build

# ----------------------------------------------------------------------------
# final image — nginx + node, supervised in one container
# ----------------------------------------------------------------------------

FROM node:20-bookworm-slim AS app

RUN apt-get update && apt-get install -y --no-install-recommends nginx supervisor \
  && rm -rf /var/lib/apt/lists/* \
  && rm -f /etc/nginx/sites-enabled/default

RUN groupadd --system --gid 1001 scrip \
  && useradd --system --uid 1001 --gid scrip --home /app/backend scrip

WORKDIR /app/backend
ENV NODE_ENV=production \
    SCRIP_HOST=0.0.0.0 \
    SCRIP_PORT=8081 \
    SCRIP_DATABASE_PATH=data/scrip.sqlite

COPY --from=backend-prod-deps /app/node_modules ./node_modules
COPY --from=backend-build /app/dist ./dist
COPY backend/package.json ./
RUN mkdir -p data && chown -R scrip:scrip /app/backend

COPY --from=frontend-build /app/dist /usr/share/nginx/html
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY supervisord.conf /etc/supervisor/conf.d/scrip.conf

EXPOSE 8080 8081
VOLUME ["/app/backend/data"]

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD node -e "Promise.all([fetch('http://127.0.0.1:8080/'),fetch('http://127.0.0.1:'+(process.env.SCRIP_PORT||8081)+'/health')]).then(rs=>process.exit(rs.every(r=>r.ok)?0:1)).catch(()=>process.exit(1))"

CMD ["/usr/bin/supervisord", "-n", "-c", "/etc/supervisor/supervisord.conf"]
