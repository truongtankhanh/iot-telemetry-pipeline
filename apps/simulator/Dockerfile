# Build context: repository root. The simulator runs TypeScript directly (Node 24 type stripping).
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
RUN pnpm turbo run build --filter "@itp/simulator..."
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm --filter @itp/simulator deploy --prod --legacy --store-dir /pnpm/store /out \
 && mkdir -p /out/registry && cp apps/ingest/config/devices.json /out/registry/

FROM node:24-alpine
WORKDIR /app
COPY --from=build --chown=node:node /out ./
USER node
ENTRYPOINT ["node", "src/main.ts", "--registry", "/app/registry/devices.json"]
