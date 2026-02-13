FROM node:22-alpine AS build
WORKDIR /app

COPY package*.json ./
COPY packages/shared/package*.json packages/shared/
COPY apps/mcp-server/package*.json apps/mcp-server/
RUN npm ci

COPY packages/shared packages/shared
COPY apps/mcp-server apps/mcp-server
# Build only the server workspaces needed for this image (skip apps/imsg-bridge).
RUN npm --workspace packages/shared run build && npm --workspace apps/mcp-server run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
COPY packages/shared/package*.json packages/shared/
COPY apps/mcp-server/package*.json apps/mcp-server/
RUN npm ci --omit=dev

COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY --from=build /app/apps/mcp-server/dist apps/mcp-server/dist
COPY --from=build /app/apps/mcp-server/public apps/mcp-server/public
# Runtime migrations are plain SQL files read by dist/db/migrate.js at /app/apps/mcp-server/src/db/migrations.
COPY --from=build /app/apps/mcp-server/src/db/migrations apps/mcp-server/src/db/migrations

WORKDIR /app/apps/mcp-server
EXPOSE 8787
CMD ["node", "dist/index.js"]
