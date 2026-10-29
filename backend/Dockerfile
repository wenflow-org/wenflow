FROM node:22.23.4-slim AS builder

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY backend/package.json backend/package-lock.json ./
RUN npm ci

COPY backend/prisma/ ./prisma/
RUN npx prisma generate

COPY backend/src/ ./src/
RUN npx prisma generate --schema=prisma/system/schema.prisma

COPY backend/tsconfig.json backend/tsconfig.build.json ./
COPY backend/scripts/clean-dist.js backend/scripts/copy-system-prisma-client.js ./scripts/
# #139：src/config/misconception-corpus.ts 编译期静态 import ../../config/misconception-corpus.json，
# 干净构建上下文缺该目录会在 tsc 报 TS2307（本机不暴露：工作区磁盘上已有 backend/config/）。
# 注意 dist 产物运行时同样 require 该 JSON（tsc 不内联 JSON），runtime 阶段的 config/ COPY 不可省。
COPY backend/config/ ./config/
RUN npm run build

COPY prompts/ ./prompts/
COPY virtual-learners/ ./virtual-learners/


FROM node:22.23.4-slim AS runtime

RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=builder /app/package.json /app/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=builder /app/dist/ ./dist/
COPY --from=builder /app/prisma/ ./prisma/
# #140：npm ci --omit=dev 时 /app 下还没有 prisma/，@prisma/client 的 postinstall 找不到 schema
# 会跳过生成 → 启动即崩 "@prisma/client did not initialize yet"。prisma CLI 在 dependencies 里，
# --omit=dev 仍可用；generate 不连库，占位 URL 仅为满足 schema 的 env 引用。
# System DB 的自定义 Client 已由 builder 生成并随 dist/ 带入，这里只需生成主库 Client。
RUN DATABASE_URL="file:./dev.db" SYSTEM_DATABASE_URL="file:../system.db" npx prisma generate
COPY --from=builder /app/prompts/ ./prompts/
COPY --from=builder /app/virtual-learners/ ./virtual-learners/
COPY backend/config/ ./config/
COPY backend/scripts/validate-runtime-environment.js ./scripts/validate-runtime-environment.js

RUN groupadd --system --gid 10001 wenflow \
  && useradd --system --uid 10001 --gid 10001 --home-dir /app --shell /usr/sbin/nologin wenflow \
  && mkdir -p /app/data/logs /app/data/.runtime \
  && chown -R wenflow:wenflow /app/data

# #141：单实例锁目录可被 WENFLOW_RUNTIME_DIR 覆盖（src/utils/instance-lock.ts）。
# 容器内包根 /app 归 root、以 uid 10001 运行，默认的 <包根>/.runtime 必然 EACCES；
# 指到非 root 可写的数据卷子目录（/app/data 已挂 wenflow_data 卷并 chown）。
# 本地开发不设该变量，行为完全不变（backend/.runtime）。
ENV WENFLOW_RUNTIME_DIR=/app/data/.runtime

COPY backend/docker-entrypoint.sh ./
RUN sed -i 's/\r$//' docker-entrypoint.sh && chmod +x docker-entrypoint.sh

USER wenflow

EXPOSE 3001
ENV NODE_ENV=production
ENTRYPOINT ["sh", "./docker-entrypoint.sh"]
