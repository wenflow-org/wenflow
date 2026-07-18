FROM node:20-slim AS builder

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY backend/package.json backend/package-lock.json ./
RUN npm install

COPY backend/prisma/ ./prisma/
RUN npx prisma generate

COPY backend/src/ ./src/
RUN npx prisma generate --schema=prisma/system/schema.prisma

COPY backend/tsconfig.json backend/tsconfig.build.json ./
COPY backend/scripts/clean-dist.js backend/scripts/copy-system-prisma-client.js ./scripts/
RUN npm run build

COPY prompts/ ./prompts/


FROM node:20-slim AS runtime

RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=builder /app/package.json /app/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=builder /app/dist/ ./dist/
COPY --from=builder /app/prisma/ ./prisma/
COPY --from=builder /app/prompts/ ./prompts/
COPY backend/config/ ./config/
COPY backend/scripts/validate-runtime-environment.js ./scripts/validate-runtime-environment.js

RUN groupadd --system --gid 10001 wenflow \
  && useradd --system --uid 10001 --gid 10001 --home-dir /app --shell /usr/sbin/nologin wenflow \
  && mkdir -p /app/data/logs \
  && chown -R wenflow:wenflow /app/data

COPY backend/docker-entrypoint.sh ./
RUN sed -i 's/\r$//' docker-entrypoint.sh && chmod +x docker-entrypoint.sh

USER wenflow

EXPOSE 3001
ENV NODE_ENV=production
ENTRYPOINT ["sh", "./docker-entrypoint.sh"]
