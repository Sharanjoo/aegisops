FROM node:22.23.5-alpine3.23 AS dependencies

WORKDIR /app

COPY package.json package-lock.json ./

RUN npm ci


FROM dependencies AS build

COPY tsconfig.json ./
COPY src ./src

RUN npm run build \
    && npm prune --omit=dev


FROM node:22.23.5-alpine3.23 AS runtime

ENV NODE_ENV=production

# Runtime only needs `node`: apply pending Alpine patches and remove the
# bundled npm/corepack, which are never used here and carry their own CVEs.
RUN apk upgrade --no-cache && \
    rm -rf /usr/local/lib/node_modules/npm \
           /usr/local/lib/node_modules/corepack \
           /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack

WORKDIR /app

COPY --from=build --chown=node:node \
    /app/package.json \
    /app/package-lock.json \
    ./

COPY --from=build --chown=node:node \
    /app/node_modules \
    ./node_modules

COPY --from=build --chown=node:node \
    /app/dist \
    ./dist

USER node

EXPOSE 8081

HEALTHCHECK \
    --interval=30s \
    --timeout=3s \
    --start-period=5s \
    --retries=3 \
    CMD wget -qO- http://127.0.0.1:8081/health > /dev/null || exit 1

CMD ["node", "dist/index.js"]