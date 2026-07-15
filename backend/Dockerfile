FROM node:18-slim AS builder

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY backend/package.json backend/package-lock.json ./
RUN npm ci

COPY backend/prisma/ ./prisma/
RUN npx prisma generate

COPY backend/src/ ./src/
RUN npx prisma generate --schema=prisma/system.prisma

COPY backend/tsconfig.json backend/tsconfig.build.json ./
RUN npx tsc -p tsconfig.build.json

COPY prompts/ ./prompts/


FROM node:18-slim AS runtime

WORKDIR /app

COPY --from=builder /app/package.json /app/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=builder /app/dist/ ./dist/
COPY --from=builder /app/prisma/ ./prisma/
COPY --from=builder /app/prompts/ ./prompts/

RUN mkdir -p /app/data

COPY backend/docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

EXPOSE 3001
ENV NODE_ENV=production
ENTRYPOINT ["./docker-entrypoint.sh"]
