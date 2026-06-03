# WenFlow 部署指南

## 环境要求

| 软件 | 版本 | 说明 |
|------|------|------|
| Node.js | 18+ | 运行环境 |
| npm | 9+ | 包管理器 |
| Git | 2.x | 版本控制 |
| Nginx | 最新稳定版 | 可选，仅 `-UseNginx` 模式需要 |

---

## 快速开始

### 方式一：一键启动（Windows，开发模式）

```powershell
# 在项目根目录执行
.\start-dev.ps1
```

脚本会自动：
- 检查并补齐 `backend/.env`（必要时触发配置向导）
- 自动安装依赖（缺少 `node_modules` 时）
- 自动执行 Prisma 初始化（`prisma generate` + `prisma db push`）
- 自动将核心 agent / skill prompts 从当前代码同步到数据库 ACTIVE 版本
- 清理开发端口占用（3001、5173）
- 启动后端与前端开发服务
- 自动打开浏览器

如需跳过 Prisma 初始化：

```powershell
.\start-dev.ps1 -SkipPrisma
```

说明：`-SkipPrisma` 也会跳过启动前的 core prompt sync，仅适用于数据库 schema 和 prompts 都已准备好的环境。

### 方式二：一键测试部署（本机 Nginx，HTTP）

```powershell
# Nginx 在 PATH 中
.\start-dev.ps1 -UseNginx

# 指定域名
.\start-dev.ps1 -UseNginx -Domain demo.example.com

# Nginx 不在 PATH 中
.\start-dev.ps1 -UseNginx -NginxExePath "C:\nginx\nginx.exe"
```

`-UseNginx` 模式会自动：
- 构建前端（`npm run build`）
- 生成运行时配置 `runtime/nginx/wenflow.nginx.conf`
- 停止系统 nginx 进程并启动/重载脚本管理的 Nginx
- 写入反向代理相关环境变量（`FRONTEND_URL`、`CORS_ORIGIN`、`TRUST_PROXY=1`）

### 方式三：手动启动

```powershell
# 后端
cd backend
npm install
Copy-Item .env.example .env
npx prisma generate
npx prisma db push
npm run prompts:sync-core
npm run dev

# 前端
cd ..\frontend
npm install
Copy-Item .env.example .env
npm run dev
```

补充说明：
- `npm run prompts:sync-core` 会把当前仓库代码中的核心 prompts 同步到数据库 ACTIVE 版本。
- 如果代码与数据库 ACTIVE 不一致，系统会自动创建新版本并切到 ACTIVE，以保证新拉取项目的默认运行版本和代码一致。
- 如果你直接在 `backend/` 目录执行 `npm run dev`，后端启动时也会做一次相同的 core prompt sync。
- 如果项目升级后新增了 prompt 节点，可手动执行 `npm run prompts:backfill-core` 补齐缺项，不覆盖已有 ACTIVE 配置。

### 方式四：仅启动后端（便捷脚本）

```powershell
cd backend
.\start-backend.ps1
```

说明：该脚本适合 backend-only 本地调试，会先执行一次 core prompt sync 再启动后端；如无特殊需要，日常开发仍推荐优先使用项目根目录的 `start-dev.ps1`。

---

## 配置说明

### 后端配置（`backend/.env`）

推荐方式：

```powershell
# 项目根目录执行
npm run env:setup
```

常用关键项：

| 配置项 | 说明 | 示例 |
|--------|------|------|
| `JWT_SECRET` | 必填，至少 32 位随机串 | `base64-random-string` |
| `AI_API_URL` | AI 服务地址 | `https://api.deepseek.com` |
| `AI_API_KEY` | AI API 密钥 | `sk-xxx` |
| `DATABASE_URL` | 本地 SQLite 数据库路径 | `file:./dev.db` |
| `CORS_ORIGIN` | 允许来源（逗号分隔） | `https://demo.example.com` |
| `FRONTEND_URL` | 前端主地址 | `https://demo.example.com` |
| `TRUST_PROXY` | 反向代理信任 | `1` |
| `INIT_ADMIN_NAME` | 初始管理员用户名 | `admin` |
| `INIT_ADMIN_PASSWORD` | 初始管理员密码 | `YourStrongPassword123` |

部署示例：

```env
NODE_ENV=production
PORT=3001
DATABASE_URL=file:./dev.db

JWT_SECRET=replace-with-strong-secret
JWT_EXPIRES_IN=7d

CORS_ORIGIN=https://demo.example.com
FRONTEND_URL=https://demo.example.com
TRUST_PROXY=1

AI_API_URL=https://api.deepseek.com
AI_API_KEY=sk-your-api-key
AI_MODEL=deepseek-v4-flash
AI_MODEL_REASONING=deepseek-v4-pro

INIT_ADMIN_NAME=admin
INIT_ADMIN_PASSWORD=YourStrongPassword123
```

本地 SQLite 开发环境请保持：`DATABASE_URL=file:./dev.db`。不要改成 `file:./prisma/dev.db`，错误写法可能让 Prisma 创建 `backend/prisma/prisma/dev.db` 这样的误库，导致现有数据与 prompt 配置看起来“丢失”。

### 前端配置（`frontend/.env`）

```powershell
Copy-Item frontend/.env.example frontend/.env
```

| 配置项 | 说明 | 默认值 |
|--------|------|--------|
| `VITE_API_BASE_URL` | API 地址 | `/api` |
| `VITE_APP_TITLE` | 应用标题 | `问流 WenFlow` |

---

## 管理员账户

系统会在后端启动时尝试自动创建初始管理员：

```env
INIT_ADMIN_NAME=admin
INIT_ADMIN_PASSWORD=YourStrongPassword123
```

说明：
- 如果数据库里已存在管理员，会自动跳过
- 建议首次登录后立即修改密码

详见 `ADMIN_SETUP.md`。

---

## 常见问题

### 1) 后端启动失败（Prisma 表不存在）

```powershell
cd backend
npx prisma generate
npx prisma db push
```

### 1.1) 启动时报 `No active prompt found` / `Missing active prompt`

先检查：
- 当前连接的数据库是否正确
- `DATABASE_URL` 是否保持为 `file:./dev.db`

如需让数据库中的核心 prompts 与当前代码重新对齐，可执行：

```powershell
cd backend
npm run prompts:sync-core
```

说明：该命令会把核心 prompts 同步成当前代码版本；若只想补新增节点而不覆盖已有 ACTIVE prompt，继续使用 `npm run prompts:backfill-core`。

### 2) 反向代理后出现 403「请求来源不被允许」

检查：
- `CORS_ORIGIN` 是否包含真实访问域名
- 域名建议不要带结尾 `/`
- `TRUST_PROXY=1` 是否已设置

### 3) 出现 `ERR_ERL_UNEXPECTED_X_FORWARDED_FOR`

这是反向代理环境未正确信任代理导致，设置：

```env
TRUST_PROXY=1
```

### 4) 访问到 Welcome to nginx 默认页

说明系统 Nginx 默认站点在响应。使用 `-UseNginx` 时脚本会先停止系统 nginx 并启动 runtime 配置。

---

## 健康检查

```bash
# 后端直连
curl http://localhost:3001/health

# Nginx 网关（UseNginx 模式）
curl http://127.0.0.1/health
```

---

## 目录结构

```text
wenflow/
├── backend/
├── frontend/
├── runtime/
│   └── nginx/                 # 脚本生成的 Nginx 运行时目录
├── start-dev.ps1
├── setup-env.ps1
├── README.md
└── DEPLOYMENT.md
```

---

## 相关文档

- `README.md`
- `ADMIN_SETUP.md`

---

*文档版本：v3.1*
*最后更新：2026-04-26*
