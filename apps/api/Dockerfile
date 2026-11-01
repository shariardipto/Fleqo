# syntax=docker/dockerfile:1.7
# One image for both long-running services; they differ only in the start command:
#   API:    node dist/server.js        Worker: node dist/worker.js
# Release step (before switching traffic):  npm run db:deploy
#   (uses the image's Prisma CLI; `npx prisma` would download the latest release if run outside /app)
# Build from the repository root:  docker build -f apps/api/Dockerfile -t fleqo-api .

# ── 1. Compile TypeScript and generate the Prisma client (needs devDependencies) ─────────
FROM node:24-alpine AS build
WORKDIR /app
# Install devDependencies regardless of the build host's NODE_ENV.
ENV NODE_ENV=development
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci --workspace=apps/api --include=dev --no-audit --no-fund
COPY apps/api apps/api
RUN npm run build --workspace=apps/api

# ── 2. Production dependencies only (includes the Prisma CLI for `migrate deploy`) ──────
FROM node:24-alpine AS prod-deps
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
# `npm ci --workspace` still installs every workspace's runtime tree (e.g. Next.js), so install from
# the lockfile, then drop the web workspace and prune: kept packages retain their locked versions.
# --legacy-peer-deps also drops peer-only packages (Better Auth's React/Next/Vitest integrations)
# that the API never imports; everything the API needs is a direct dependency.
RUN npm ci --omit=dev --no-audit --no-fund \
 && node -e "const fs=require('fs');const p=JSON.parse(fs.readFileSync('package.json'));p.workspaces=['apps/api'];fs.writeFileSync('package.json',JSON.stringify(p,null,2))" \
 && rm -rf apps/web node_modules/web \
 && npm prune --omit=dev --legacy-peer-deps --no-audit --no-fund \
 && mkdir -p apps/api/node_modules \
 && npm cache clean --force

# ── 3. Runtime ─────────────────────────────────────────────────────────────────────────
FROM node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN addgroup -S fleqo && adduser -S fleqo -G fleqo
COPY --from=prod-deps /app/package.json ./package.json
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=prod-deps /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=build /app/apps/api/package.json /app/apps/api/prisma.config.ts ./apps/api/
COPY --from=build /app/apps/api/prisma ./apps/api/prisma
COPY --from=build /app/apps/api/dist ./apps/api/dist
WORKDIR /app/apps/api
USER fleqo
EXPOSE 4000
CMD ["node", "dist/server.js"]
