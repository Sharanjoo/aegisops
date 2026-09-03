# syntax=docker/dockerfile:1.7

# ---- Build stage: compiles the production bundle ----
FROM node:22.23.2-alpine3.23 AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
# import.meta.env.PROD is true for a Vite production build, which is what
# selects the same-origin default routes in src/config/env.ts - no
# VITE_* build args are needed to make the image environment-portable.
RUN npm run build


# ---- Runtime stage: static assets behind a non-root nginx, nothing else ----
FROM nginxinc/nginx-unprivileged:1.29-alpine AS runtime

# Only these AEGISOPS_* variables are substituted into nginx.conf.template
# at container start; nginx's own $host/$remote_addr/... variables must
# reach nginx untouched, so the filter is deliberately narrow.
ENV NGINX_ENVSUBST_FILTER=^AEGISOPS_ \
    AEGISOPS_INCIDENT_SERVICE_URL=http://incident-service:8080 \
    AEGISOPS_REALTIME_GATEWAY_URL=http://realtime-gateway:8081

COPY nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build --chown=nginx:nginx /app/dist /usr/share/nginx/html

EXPOSE 8080

HEALTHCHECK \
    --interval=30s \
    --timeout=3s \
    --start-period=5s \
    --retries=3 \
    CMD wget -qO- http://127.0.0.1:8080/health > /dev/null || exit 1

# nginxinc/nginx-unprivileged already runs as its non-root `nginx` user and
# uses this exec-form entrypoint/CMD, which forwards SIGTERM to the nginx
# master process for a clean shutdown.
ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["nginx", "-g", "daemon off;"]
