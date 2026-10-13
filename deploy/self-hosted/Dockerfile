# The digest matches the server's existing Node 22.23.3 Alpine image.
FROM node:22-alpine@sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402 AS build

WORKDIR /app
ENV npm_config_update_notifier=false

COPY package.json package-lock.json ./
COPY scripts ./scripts
RUN npm run install:ci

COPY . .
RUN npm run build:selfhost

FROM node:22-alpine@sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402 AS runtime

WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    MUSE_DB_PATH=/data/muse.sqlite \
    npm_config_update_notifier=false

# Vinext is declared in devDependencies and is needed by the production server.
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/public ./public
COPY --from=build --chown=node:node /app/drizzle ./drizzle
COPY --from=build --chown=node:node /app/package.json /app/package-lock.json ./
COPY --from=build --chown=node:node /app/scripts ./scripts

RUN mkdir /data && chown node:node /data
USER node
EXPOSE 3000

CMD ["npm", "run", "start:selfhost"]
