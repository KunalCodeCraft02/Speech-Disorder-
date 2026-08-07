# syntax=docker/dockerfile:1
#
# This image exists for local/full-stack Docker Compose use (see the root
# docker-compose.yml) and as a portable alternative to Vercel — the
# production deploy target for this app is Vercel (see
# docs/DEPLOYMENT.md), which builds directly from the repo and doesn't use
# this Dockerfile at all.
FROM node:20-alpine AS build

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .

# Vite bakes VITE_* variables into the bundle at *build* time, not runtime —
# pass them as --build-arg (docker build) or `args:` (compose) if you need
# anything other than .env.example's defaults.
ARG VITE_API_URL=http://localhost:4000/api/v1
ARG VITE_SOCKET_URL=http://localhost:4000
ARG VITE_DEMO_MODE=false
ENV VITE_API_URL=${VITE_API_URL} \
    VITE_SOCKET_URL=${VITE_SOCKET_URL} \
    VITE_DEMO_MODE=${VITE_DEMO_MODE}

RUN npm run build

# ---

FROM nginx:1.27-alpine AS runtime

COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD wget -qO- http://127.0.0.1/healthz > /dev/null || exit 1
