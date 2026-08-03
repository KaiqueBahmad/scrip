# syntax=docker/dockerfile:1
#
# Single Dockerfile for both independent apps in this repo (backend/, frontend/).
# Build a specific image with --target:
#   docker build --target backend  -t scrip-backend .
#   docker build --target frontend -t scrip-frontend .
# (docker-compose.yml already does this for you.)

# ----------------------------------------------------------------------------
# backend — Node/Fastify (NestJS) API
# ----------------------------------------------------------------------------

FROM node:20-bookworm-slim AS backend-base
WORKDIR /app

# better-sqlite3 needs to compile a native addon when no prebuilt binary matches the
# image's platform/libc, so build tools are present in every stage that runs `npm ci`.
FROM backend-base AS backend-deps
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

FROM backend-base AS backend-prod-deps
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && test -d node_modules/better-sqlite3

FROM backend-base AS backend
ENV NODE_ENV=production \
    SCRIP_HOST=0.0.0.0 \
    SCRIP_PORT=4242 \
    SCRIP_DATABASE_PATH=data/scrip.sqlite

RUN groupadd --system --gid 1001 scrip \
  && useradd --system --uid 1001 --gid scrip --home /app scrip

COPY --from=backend-prod-deps /app/node_modules ./node_modules
COPY --from=backend-build /app/dist ./dist
COPY backend/package.json ./

RUN mkdir -p data && chown -R scrip:scrip /app

USER scrip

EXPOSE 4242
VOLUME ["/app/data"]

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.SCRIP_PORT||4242)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/main.js"]

# ----------------------------------------------------------------------------
# frontend — Vite/React panel, served by nginx
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
ARG VITE_API_BASE_URL=http://localhost:4242
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL

RUN npm run build

FROM nginx:1.27-alpine AS frontend
COPY --from=frontend-build /app/dist /usr/share/nginx/html
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -qO- http://127.0.0.1:80/ >/dev/null || exit 1
