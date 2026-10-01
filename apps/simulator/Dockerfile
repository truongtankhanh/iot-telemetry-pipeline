# Build context: repository root. The simulator runs TypeScript directly (Node 24 type stripping).
FROM node:24-alpine AS build
RUN corepack enable
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY packages ./packages
COPY apps ./apps
RUN pnpm install --frozen-lockfile
RUN pnpm turbo run build --filter "@itp/simulator..."
RUN pnpm --filter @itp/simulator deploy --prod --legacy /out \
 && mkdir -p /out/registry && cp apps/ingest/config/devices.json /out/registry/

FROM node:24-alpine
WORKDIR /app
COPY --from=build --chown=node:node /out ./
USER node
ENTRYPOINT ["node", "src/main.ts", "--registry", "/app/registry/devices.json"]
