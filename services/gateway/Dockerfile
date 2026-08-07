# syntax=docker/dockerfile:1
FROM node:20-alpine AS deps

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# ---

FROM node:20-alpine AS runtime

ENV NODE_ENV=production
WORKDIR /app

RUN addgroup -S nodejs && adduser -S gateway -G nodejs

COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src

RUN mkdir -p logs && chown -R gateway:nodejs /app
USER gateway

# Render (and most PaaS targets) inject their own $PORT — src/config/env.js
# already defaults to 4000 when it's unset, so this only matters for `docker run` standalone.
ENV PORT=4000
EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget -qO- "http://127.0.0.1:${PORT:-4000}/api/v1/health" > /dev/null || exit 1

CMD ["node", "src/server.js"]
