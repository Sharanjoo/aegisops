FROM node:22.23.2-alpine3.23 AS dependencies

WORKDIR /app

COPY package.json package-lock.json ./

RUN npm ci


FROM dependencies AS build

COPY tsconfig.json ./
COPY src ./src

RUN npm run build \
    && npm prune --omit=dev


FROM node:22.23.2-alpine3.23 AS runtime

ENV NODE_ENV=production

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