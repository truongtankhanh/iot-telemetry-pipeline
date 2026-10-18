# Build context: repository root.
FROM node:24-alpine AS build
RUN corepack enable
WORKDIR /repo
# From here to the install, this file and the other app's Dockerfile are identical on purpose:
# `docker compose build` solves both images in one graph and runs the identical steps once, and
# a change to a source file leaves them cached. A new workspace project needs its manifest here.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/telemetry-contract/package.json ./packages/telemetry-contract/
COPY apps/ingest/package.json ./apps/ingest/
COPY apps/simulator/package.json ./apps/simulator/
# The pnpm store is a cache mount: it is kept between builds and is not part of any layer.
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm install --frozen-lockfile --store-dir /pnpm/store
COPY turbo.json tsconfig.base.json ./
COPY packages ./packages
COPY apps ./apps
RUN pnpm turbo run build --filter "@itp/ingest..."
# Self-contained production bundle: built app + config + production dependencies only.
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm --filter @itp/ingest deploy --prod --legacy --store-dir /pnpm/store /out

FROM node:24-alpine
ENV NODE_ENV=production CONFIG_DIR=/app/config
WORKDIR /app
COPY --from=build --chown=node:node /out ./
USER node
EXPOSE 3100
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s \
  CMD wget -qO- http://127.0.0.1:3100/api/health > /dev/null || exit 1
CMD ["node", "dist/main.js"]
