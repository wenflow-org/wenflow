# 多阶段构建：前端
FROM node:20-alpine AS frontend-builder

WORKDIR /app

# 复制 package 文件
COPY frontend/package*.json ./

# 安装依赖
RUN npm ci

# 复制源代码
COPY frontend/ ./

# 构建生产版本
RUN npm run build

# Nginx 生产镜像
FROM nginx:alpine AS frontend-production

# 复制自定义 Nginx 配置
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf

# 复制构建产物
COPY --from=frontend-builder /app/dist /usr/share/nginx/html

# 暴露端口
EXPOSE 80

# 健康检查
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://localhost/ || exit 1

# 启动 Nginx
CMD ["nginx", "-g", "daemon off;"]
