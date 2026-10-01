# Build context: repository root.
FROM node:24-alpine AS build
RUN corepack enable
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY packages ./packages
COPY apps ./apps
RUN pnpm install --frozen-lockfile
RUN pnpm turbo run build --filter "@itp/ingest..."
# Self-contained production bundle: built app + config + production dependencies only.
RUN pnpm --filter @itp/ingest deploy --prod --legacy /out

FROM node:24-alpine
ENV NODE_ENV=production CONFIG_DIR=/app/config
WORKDIR /app
COPY --from=build --chown=node:node /out ./
USER node
EXPOSE 3100
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s \
  CMD wget -qO- http://127.0.0.1:3100/api/health > /dev/null || exit 1
CMD ["node", "dist/main.js"]
