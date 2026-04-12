# AI Learning Platform 部署指南

## 📋 目录

- [前置要求](#前置要求)
- [快速部署](#快速部署)
- [手动部署](#手动部署)
- [配置说明](#配置说明)
- [监控和维护](#监控和维护)
- [故障排查](#故障排查)
- [常见问题](#常见问题)

---

## 前置要求

### 最低配置
- **CPU**: 2 核心
- **内存**: 4GB RAM
- **存储**: 20GB 可用空间
- **操作系统**: Windows 10/11, Linux, macOS

### 软件要求
- **Docker**: 20.10+
- **Docker Compose**: 2.0+
- **Node.js**: 18+ (本地开发)
- **Git**: 2.x+

### 生产环境推荐
- **CPU**: 4 核心+
- **内存**: 8GB+ RAM
- **存储**: 50GB+ SSD
- **数据库**: PostgreSQL 15+
- **反向代理**: Nginx

---

## 快速部署

### Windows 环境

#### 1. 克隆项目
```powershell
git clone https://github.com/your-org/ai-learning-platform.git
cd ai-learning-platform
```

#### 2. 配置环境变量
```powershell
# 复制环境变量文件
Copy-Item backend\.env.production.example backend\.env.production

# 编辑 .env.production，修改配置
notepad backend\.env.production
```

#### 3. 一键部署
```powershell
# 执行部署脚本
.\deploy.ps1
```

### Linux/macOS 环境

#### 1. 克隆项目
```bash
git clone https://github.com/your-org/ai-learning-platform.git
cd ai-learning-platform
```

#### 2. 配置环境变量
```bash
# 复制环境变量文件
cp backend/.env.production.example backend/.env.production

# 编辑 .env.production，修改配置
nano backend/.env.production
```

#### 3. 一键部署
```bash
# 添加执行权限
chmod +x deploy.sh

# 执行部署脚本
./deploy.sh
```

---

## 手动部署

### 使用 Docker Compose

#### 1. 配置环境变量
```bash
# 复制并编辑环境变量文件
cp backend/.env.production.example backend/.env.production
cp frontend/.env.production.example frontend/.env.production
```

#### 2. 构建并启动
```bash
# 构建镜像
docker compose build

# 启动所有服务
docker compose up -d

# 查看日志
docker compose logs -f
```

#### 3. 数据库迁移
```bash
# 执行数据库迁移
docker compose exec backend npx prisma migrate deploy
```

### 本地部署（开发环境）

#### 后端部署

```bash
cd backend

# 安装依赖
npm install

# 生成 Prisma 客户端
npx prisma generate

# 数据库迁移
npx prisma migrate deploy

# 构建生产版本
npm run build

# 启动服务
npm start
```

#### 前端部署

```bash
cd frontend

# 安装依赖
npm install

# 构建生产版本
npm run build

# 预览构建结果
npm run preview
```

将 `frontend/dist` 目录部署到 Web 服务器（Nginx/Apache）。

---

## 配置说明

### 环境变量配置

#### 后端配置 (`backend/.env.production`)

```bash
# 服务器配置
NODE_ENV=production
PORT=3001

# 数据库配置
DATABASE_URL="postgresql://ai_learning:password@localhost:5432/ai_learning_platform"

# JWT 配置（重要！）
JWT_SECRET=your-super-secret-jwt-key-change-this-in-production
JWT_EXPIRES_IN=7d

# AI 服务配置
AI_API_URL=https://your-ai-service.com
AI_API_KEY=sk-your-production-api-key
AI_MODEL=gem-4-flash

# 缓存配置
CACHE_ENABLED=true
CACHE_TTL=3600000
CACHE_MAX_SIZE=1000

# 日志配置
LOG_LEVEL=info
LOG_FILE_PATH=/var/log/ai-learning-platform/

# 安全配置
CORS_ORIGIN=https://your-domain.com
RATE_LIMIT_ENABLED=true
RATE_LIMIT_MAX=100
RATE_LIMIT_WINDOW=60000

# ContentAgent 配置
CONTENT_AGENT_CACHE_ENABLED=true
CONTENT_AGENT_CACHE_TTL=3600000
CONTENT_AGENT_MAX_ROUNDS=8
```

#### 前端配置 (`frontend/.env.production`)

```bash
# API 配置
VITE_API_BASE_URL=/api

# 应用配置
VITE_APP_TITLE=AI 学习平台
VITE_APP_VERSION=3.0.0
```

### Docker Compose 配置

`docker-compose.yml` 定义了以下服务：

| 服务 | 容器名 | 端口 | 说明 |
|------|--------|------|------|
| postgres | ai-learning-db | 5432 | PostgreSQL 数据库 |
| backend | ai-learning-backend | 3001 | Node.js 后端 API |
| frontend | ai-learning-frontend | 5173 | Vue3 前端 |
| nginx | ai-learning-nginx | 80/443 | Nginx 反向代理 |

### Nginx 配置

`nginx/nginx.conf` 包含：

- HTTP 到 HTTPS 重定向
- SSL/TLS 配置
- Gzip 压缩
- 限流保护
- WebSocket 支持
- 静态资源缓存

---

## 监控和维护

### 查看日志

```bash
# 查看所有服务日志
docker compose logs -f

# 查看后端日志
docker compose logs -f backend

# 查看前端日志
docker compose logs -f frontend

# 查看数据库日志
docker compose logs -f postgres

# 查看最近 100 行
docker compose logs --tail=100 backend
```

### 性能监控

```bash
# 访问 API 指标端点
curl http://localhost:3001/api/admin/metrics

# 查看容器资源使用
docker stats
```

### 数据库备份

```bash
# 备份数据库
docker compose exec postgres pg_dump -U ai_learning ai_learning_platform > backup_$(date +%Y%m%d).sql

# 恢复数据库
docker compose exec -T postgres psql -U ai_learning ai_learning_platform < backup_20260318.sql
```

### 服务管理

```bash
# 重启所有服务
docker compose restart

# 重启单个服务
docker compose restart backend

# 停止所有服务
docker compose down

# 停止并删除数据卷（危险！）
docker compose down -v
```

### 更新部署

```bash
# 拉取最新代码
git pull origin main

# 重新构建并部署
docker compose down
docker compose build
docker compose up -d

# 执行数据库迁移
docker compose exec backend npx prisma migrate deploy
```

---

## 故障排查

### 后端启动失败

**症状**: 容器启动后立即退出

**排查步骤**:
```bash
# 1. 查看日志
docker compose logs backend

# 2. 检查数据库连接
docker compose exec backend ping postgres

# 3. 检查环境变量
docker compose exec backend env | grep DATABASE

# 4. 测试数据库连接
docker compose exec backend node -e "console.log(require('@prisma/client'))"
```

**常见问题**:
- 数据库连接字符串错误
- JWT_SECRET 未配置
- 端口被占用
- Prisma 客户端未生成

### 前端无法访问

**症状**: 浏览器显示无法连接或空白页

**排查步骤**:
```bash
# 1. 检查前端容器状态
docker compose ps frontend

# 2. 查看前端日志
docker compose logs frontend

# 3. 检查 Nginx 配置
docker compose exec nginx nginx -t

# 4. 测试 API 连接
curl http://localhost:3001/api/health
```

### 数据库连接问题

**症状**: 后端报错无法连接数据库

**解决方案**:
```bash
# 1. 检查数据库容器状态
docker compose ps postgres

# 2. 查看数据库日志
docker compose logs postgres

# 3. 测试数据库连接
docker compose exec postgres pg_isready -U ai_learning

# 4. 重启数据库
docker compose restart postgres
```

### SSL 证书配置

**使用 Let's Encrypt**:
```bash
# 安装 Certbot
docker run --rm --name certbot \
  -v ./nginx/ssl:/etc/letsencrypt \
  certbot/certbot certonly --standalone \
  -d your-domain.com -d www.your-domain.com \
  --email your-email@example.com
```

---

## 常见问题

### Q: 如何重置数据库？
```bash
# 删除数据卷（警告：所有数据将丢失）
docker compose down -v

# 重新启动
docker compose up -d

# 执行迁移
docker compose exec backend npx prisma migrate deploy
```

### Q: 如何修改端口？
编辑 `docker-compose.yml`:
```yaml
ports:
  - "8080:80"  # 将 80 改为 8080
  - "8443:443" # 将 443 改为 8443
```

### Q: 如何查看数据库内容？
```bash
# 使用 Prisma Studio
docker compose exec backend npx prisma studio

# 或直接连接 PostgreSQL
docker compose exec postgres psql -U ai_learning ai_learning_platform
```

### Q: 如何启用 HTTPS？
1. 获取 SSL 证书（Let's Encrypt 或购买）
2. 将证书放入 `nginx/ssl/` 目录
3. 修改 `nginx/nginx.conf` 中的域名
4. 重启 Nginx: `docker compose restart nginx`

### Q: ContentAgent 缓存如何配置？
在 `backend/.env.production` 中配置:
```bash
CONTENT_AGENT_CACHE_ENABLED=true
CONTENT_AGENT_CACHE_TTL=3600000  # 1 小时
CONTENT_AGENT_MAX_ROUNDS=8
```

### Q: 如何优化性能？
1. **启用缓存**: 配置 `CACHE_ENABLED=true`
2. **调整限流**: 修改 `RATE_LIMIT_MAX`
3. **数据库索引**: 检查 Prisma schema 索引
4. **静态资源 CDN**: 配置 CDN 加速

### Q: 如何监控 ContentAgent 状态？
```bash
# 访问管理端点
curl http://localhost:3001/api/admin/metrics

# 查看 ContentAgent 日志
docker compose logs backend | grep ContentAgent
```

---

## 安全建议

1. **修改默认密码**: 数据库密码、JWT_SECRET
2. **启用 HTTPS**: 生产环境必须使用 HTTPS
3. **配置防火墙**: 只开放必要端口
4. **定期更新**: 保持 Docker 镜像和依赖最新
5. **日志审计**: 定期检查访问日志
6. **备份策略**: 设置自动备份计划

---

## 相关文档

- [开发指南](./DEVELOPMENT.md)
- [API 文档](./API.md)
- [用户指南](./USER_GUIDE.md)
- [变更日志](./CHANGELOG.md)

---

*文档版本：v3.0*
*最后更新：2026-03-18*
