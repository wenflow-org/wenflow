# 多阶段构建：后端
FROM node:20-alpine AS backend-builder

WORKDIR /app

# 安装系统依赖
RUN apk add --no-cache python3 make g++ openssl

# 复制 package 文件
COPY backend/package*.json ./

# 安装所有依赖（包括 devDependencies 用于构建）
RUN npm ci

# 复制源代码
COPY backend/ ./

# 生成 Prisma 客户端
RUN npx prisma generate

# 编译 TypeScript
RUN npm run build

# 生产镜像
FROM node:20-alpine AS backend-production

WORKDIR /app

# 安装运行时依赖
RUN apk add --no-cache openssl ca-certificates

# 复制编译后的文件
COPY --from=backend-builder /app/node_modules ./node_modules
COPY --from=backend-builder /app/dist ./dist
COPY --from=backend-builder /app/prisma ./prisma
COPY --from=backend-builder /app/package*.json ./

# 复制环境变量示例
COPY backend/.env.production.example ./.env.production.example

# 创建日志目录
RUN mkdir -p /app/logs && chown -R node:node /app/logs

# 切换到非 root 用户
USER node

# 环境变量
ENV NODE_ENV=production
ENV PORT=3001

# 暴露端口
EXPOSE 3001

# 健康检查
HEALTHCHECK --interval=30s --timeout=3s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3001/api/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# 启动命令
CMD ["node", "dist/index.js"]
