# ContentAgent v3.0 生产环境配置清单

## ✅ 部署前检查清单

### 1. 环境准备
- [ ] Docker 20.10+ 已安装
- [ ] Docker Compose 2.0+ 已安装
- [ ] Git 已安装
- [ ] 系统资源充足（4GB+ 内存，20GB+ 存储）

### 2. 配置文件
- [ ] 复制 `backend/.env.production.example` 为 `backend/.env.production`
- [ ] 复制 `frontend/.env.production.example` 为 `frontend/.env.production`
- [ ] 修改 `backend/.env.production` 中的配置：
  - [ ] `DATABASE_URL` - PostgreSQL 连接字符串
  - [ ] `JWT_SECRET` - 强随机密钥（至少 32 字符）
  - [ ] `AI_API_URL` - AI 服务地址
  - [ ] `AI_API_KEY` - API 密钥
  - [ ] `CORS_ORIGIN` - 前端域名
  - [ ] `LOG_LEVEL` - 生产环境建议 `info` 或 `warn`

### 3. 安全配置
- [ ] 修改所有默认密码
- [ ] 生成强 JWT_SECRET（使用 `openssl rand -base64 32`）
- [ ] 配置 HTTPS/SSL 证书
- [ ] 配置防火墙规则
- [ ] 启用限流保护

### 4. 数据库准备
- [ ] PostgreSQL 15+ 已安装（或使用 Docker Compose 自动部署）
- [ ] 数据库用户和权限已配置
- [ ] 数据库连接测试通过

### 5. SSL 证书（生产环境必需）
- [ ] 获取 SSL 证书（Let's Encrypt 或购买）
- [ ] 证书放入 `nginx/ssl/` 目录
- [ ] 证书文件名：`fullchain.pem` 和 `privkey.pem`
- [ ] 修改 `nginx/nginx.conf` 中的域名

---

## 🚀 快速部署命令

### Windows (PowerShell)
```powershell
# 1. 克隆项目
git clone https://github.com/your-org/ai-learning-platform.git
cd ai-learning-platform

# 2. 配置环境变量
Copy-Item backend\.env.production.example backend\.env.production
notepad backend\.env.production

# 3. 一键部署
.\deploy.ps1
```

### Linux/macOS (Bash)
```bash
# 1. 克隆项目
git clone https://github.com/your-org/ai-learning-platform.git
cd ai-learning-platform

# 2. 配置环境变量
cp backend/.env.production.example backend/.env.production
nano backend/.env.production

# 3. 一键部署
chmod +x deploy.sh
./deploy.sh
```

---

## 📦 Docker Compose 服务

| 服务 | 容器名 | 端口 | 说明 |
|------|--------|------|------|
| PostgreSQL | ai-learning-db | 5432 | 数据库 |
| Backend | ai-learning-backend | 3001 | Node.js API |
| Frontend | ai-learning-frontend | 5173 | Vue3 前端 |
| Nginx | ai-learning-nginx | 80/443 | 反向代理 |

---

## 🔧 常用运维命令

### 查看日志
```bash
# 所有服务日志
docker compose logs -f

# 后端日志
docker compose logs -f backend

# 前端日志
docker compose logs -f frontend

# 最近 100 行
docker compose logs --tail=100 backend
```

### 服务管理
```bash
# 重启所有服务
docker compose restart

# 重启单个服务
docker compose restart backend

# 停止所有服务
docker compose down

# 停止并删除数据（危险！）
docker compose down -v
```

### 数据库操作
```bash
# 备份数据库
docker compose exec postgres pg_dump -U ai_learning ai_learning_platform > backup.sql

# 恢复数据库
docker compose exec -T postgres psql -U ai_learning ai_learning_platform < backup.sql

# 查看数据库状态
docker compose exec postgres pg_isready -U ai_learning

# Prisma Studio（数据库管理）
docker compose exec backend npx prisma studio
```

### 性能监控
```bash
# 查看容器资源使用
docker stats

# API 健康检查
curl http://localhost:3001/api/health

# 查看性能指标
curl http://localhost:3001/api/admin/metrics
```

---

## 🔐 安全配置

### JWT_SECRET 生成
```bash
# Linux/macOS
openssl rand -base64 32

# Windows PowerShell
[Convert]::ToBase64String((1..32 | ForEach-Object { Get-Random -Minimum 0 -Maximum 256 }))
```

### SSL 证书（Let's Encrypt）
```bash
# 使用 Certbot 获取证书
docker run --rm --name certbot \
  -v ./nginx/ssl:/etc/letsencrypt \
  certbot/certbot certonly --standalone \
  -d your-domain.com -d www.your-domain.com \
  --email your-email@example.com
```

### 防火墙配置
```bash
# 只开放必要端口
# 80 (HTTP) - 重定向到 443
# 443 (HTTPS) - 主服务端口
# 5432 (PostgreSQL) - 仅本地访问

# UFW (Ubuntu)
ufw allow 80/tcp
ufw allow 443/tcp
ufw deny 5432/tcp
ufw enable
```

---

## 📊 ContentAgent 特定配置

### 缓存配置
```bash
# backend/.env.production
CONTENT_AGENT_CACHE_ENABLED=true
CONTENT_AGENT_CACHE_TTL=3600000  # 1 小时
CONTENT_AGENT_MAX_ROUNDS=8
```

### 性能优化
```bash
# 启用缓存
CACHE_ENABLED=true
CACHE_TTL=3600000
CACHE_MAX_SIZE=1000

# 调整限流
RATE_LIMIT_ENABLED=true
RATE_LIMIT_MAX=100
RATE_LIMIT_WINDOW=60000
```

### 监控配置
```bash
# 启用监控
MONITORING_ENABLED=true
METRICS_ENDPOINT=/api/admin/metrics

# 日志配置
LOG_LEVEL=info
LOG_FILE_PATH=/var/log/ai-learning-platform/
```

---

## 🐛 故障排查

### 后端无法启动
```bash
# 查看日志
docker compose logs backend

# 检查数据库连接
docker compose exec backend ping postgres

# 检查环境变量
docker compose exec backend env | grep DATABASE
```

### 前端空白页
```bash
# 检查前端容器
docker compose ps frontend

# 查看日志
docker compose logs frontend

# 检查 API 连接
curl http://localhost:3001/api/health
```

### 数据库连接失败
```bash
# 检查数据库状态
docker compose ps postgres

# 测试连接
docker compose exec postgres pg_isready -U ai_learning

# 重启数据库
docker compose restart postgres
```

---

## 📈 性能优化建议

1. **启用缓存**: ContentAgent 结果缓存、API 响应缓存
2. **数据库索引**: 确保常用查询字段有索引
3. **静态资源 CDN**: 使用 CDN 加速前端静态资源
4. **Gzip 压缩**: Nginx 已默认启用
5. **限流保护**: 防止恶意请求
6. **连接池**: Prisma 默认使用连接池

---

## 📝 部署后验证

- [ ] 访问前端：https://your-domain.com
- [ ] 测试登录/注册
- [ ] 创建学习目标
- [ ] 测试 ContentAgent 功能
- [ ] 检查日志无错误
- [ ] 性能指标正常
- [ ] 数据库备份正常
- [ ] SSL 证书有效

---

## 📚 相关文档

- [完整部署指南](./DEPLOYMENT.md)
- [开发指南](./DEVELOPMENT.md)
- [API 文档](./API.md)
- [用户指南](./USER_GUIDE.md)

---

*版本：v3.0*
*最后更新：2026-03-18*
