# Daybird for a NAS (PRD §15): builds the web client, then runs the server on one calendar folder at /data.
FROM node:22-alpine AS build
WORKDIR /src
RUN corepack enable
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY packages/core/package.json packages/core/
COPY packages/ui/package.json packages/ui/
COPY packages/node-files/package.json packages/node-files/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --filter @daybird/web...
COPY tsconfig.base.json ./
COPY packages packages
COPY apps/web apps/web
RUN pnpm --filter @daybird/web build

FROM node:22-alpine
ENV NODE_ENV=production DAYBIRD_PORT=8796 DAYBIRD_HOST=0.0.0.0 DAYBIRD_STATIC=/app/web DAYBIRD_DIR=/data
WORKDIR /app
RUN corepack enable
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY packages/core/package.json packages/core/
COPY packages/node-files/package.json packages/node-files/
COPY apps/server/package.json apps/server/
RUN pnpm install --prod --frozen-lockfile --filter @daybird/server... && rm -rf /root/.cache /root/.local
COPY packages/core/src packages/core/src
COPY packages/node-files/src packages/node-files/src
COPY apps/server/src apps/server/src
COPY --from=build /src/apps/web/dist web
USER node
EXPOSE 8796
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8796/api/info >/dev/null || exit 1
CMD ["node", "apps/server/src/main.ts"]
