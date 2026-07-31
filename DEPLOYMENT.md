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
- 生成双 Prisma Client，并对主库和 System DB 分别执行 `prisma migrate deploy`
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
- 写入反向代理相关环境变量（`FRONTEND_URL`、`CORS_ORIGIN`、`TRUST_PROXY=127.0.0.1`）

### 方式三：手动启动

```powershell
# 后端
cd backend
npm install
Copy-Item .env.example .env
npx prisma generate
npx prisma generate --schema=prisma/system/schema.prisma
npm run prisma:migrate:deploy:all
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

### 方式五：Docker 部署（Linux/macOS）

PowerShell 启动脚本当前仅适配 Windows；Linux/macOS 使用 Docker 一键脚本：

```bash
./docker-start.sh
```

说明：该脚本会检查 Docker/Compose v2，交互式引导补齐 `backend/.env`（JWT_SECRET、Keyring、AI 密钥、管理员账号），适配 nginx 端口与 `FRONTEND_URL`/`CORS_ORIGIN` 后执行 `docker compose up -d --build`。支持环境变量非交互传入（`JWT_SECRET`、`AI_API_KEY`、`SECRET_ENCRYPTION_KEYS` 等），也支持 `NGINX_PORT` 覆盖默认 80 端口。

自定义域名部署：`nginx.docker.conf` 的 `server_name` 需按域名修改后重新构建；反向代理与健康检查细节见下文「常见问题」。

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
| `SECRET_ENCRYPTION_CURRENT_KEY_ID` | 当前数据库 Secret 加密 Key ID | `v1` |
| `SECRET_ENCRYPTION_KEYS` | `keyId:32字节Base64` Keyring，生产必填 | `v1:base64-key` |
| `AI_API_URL` | AI 服务地址 | `https://api.deepseek.com` |
| `AI_API_KEY` | AI API 密钥 | `sk-xxx` |
| `DATABASE_URL` | 本地 SQLite 数据库路径 | `file:./dev.db` |
| `CORS_ORIGIN` | 允许来源（逗号分隔） | `https://demo.example.com` |
| `FRONTEND_URL` | 前端主地址 | `https://demo.example.com` |
| `TRUST_PROXY` | 直接连接后端的受信代理 IP/CIDR；生产禁止 `true` | `127.0.0.1` |
| `SHUTDOWN_DEADLINE_MS` | SIGTERM 后 HTTP drain 和后台组件停止的总时限 | `25000` |
| `INIT_ADMIN_NAME` | 初始管理员用户名 | `admin` |
| `INIT_ADMIN_PASSWORD` | 初始管理员密码，至少 12 位且包含大小写字母和数字 | 无默认值 |

部署示例：

```env
NODE_ENV=production
PORT=3001
DATABASE_URL=file:./dev.db

JWT_SECRET=replace-with-strong-secret
JWT_EXPIRES_IN=7d
SECRET_ENCRYPTION_CURRENT_KEY_ID=v1
SECRET_ENCRYPTION_KEYS=v1:replace-with-32-byte-base64-key

CORS_ORIGIN=https://demo.example.com
FRONTEND_URL=https://demo.example.com
TRUST_PROXY=127.0.0.1
SHUTDOWN_DEADLINE_MS=25000

AI_API_URL=https://api.deepseek.com
AI_API_KEY=sk-your-api-key
AI_MODEL=deepseek-v4-flash
AI_MODEL_REASONING=deepseek-v4-pro

INIT_ADMIN_NAME=admin
INIT_ADMIN_PASSWORD=YourStrongPassword123
```

数据库 Secret 升级或轮换顺序：

1. 备份主库、System DB 和当前 Keyring。
2. 将旧 Key 和新 Key 都加入 `SECRET_ENCRYPTION_KEYS`，将 `SECRET_ENCRYPTION_CURRENT_KEY_ID` 指向新 Key。
3. 运行 `npm run secrets:audit` 查看待迁移数量。
4. 运行 `npm run secrets:migrate` 执行幂等迁移。
5. 再次运行 `npm run secrets:audit`，确认 `pending=0` 且 `failed=0`。
6. 完成备份恢复验证后再部署或重启服务；旧 Key 只能在确认所有历史密文和备份都不再需要后删除。

数据库和 Keyring 备份必须位于 Git 工作区之外。Windows 可使用专用目录并限制 ACL：

```powershell
New-Item -ItemType Directory -Path 'D:\WenFlowBackups' -Force
icacls 'D:\WenFlowBackups' /inheritance:r
icacls 'D:\WenFlowBackups' /grant:r "$env:USERNAME:(OI)(CI)F"
```

Linux 目录和文件权限不得宽于：

```bash
chmod 700 /var/backups/wenflow
chmod 600 /var/backups/wenflow/*
```

备份至少包含主库、System DB、当前及仍需解密历史数据的旧 Keyring。恢复演练必须在隔离副本上进行，不能直接覆盖运行中的数据库。

不要复制运行中的 `.db` 文件；已提交数据可能仍在 WAL 中。正式备份流程：

```powershell
# 1. 停止写流量或停止后端，确保双库处于维护窗口。
$env:WENFLOW_BACKUP_DIR = 'D:\WenFlowBackups'
npm run database:backup:create -- --confirm-quiesced

# 2. 在不连接运行库的隔离临时目录中验证 SHA-256、完整性、外键、表归属、migration 和 Keyring 指纹。
npm run database:backup:verify -- 'D:\WenFlowBackups\<backup-id>'
```

也可通过 `--output <绝对目录>` 覆盖 `WENFLOW_BACKUP_DIR`。命令拒绝仓库内目录、源数据库目录、符号链接/Junction、不安全权限和旧式 SQLite URL。备份先写入 `.partial-*` staging，双库验证通过后才原子发布正式目录。

`manifest.json` 不保存源路径、数据库 URL 或 Keyring 原文，只保存数据库 SHA-256、migration 信息和 Keyring 指纹。Keyring 必须单独保存在加密的 Secret Manager 或运维备份中。

SQLite Online Backup 保证每个数据库各自一致，但两个独立数据库不构成跨库原子快照，因此 manifest 固定记录 `pairAtomic: false`。只有在写流量停止后才能确认 `--confirm-quiesced`。

Docker 部署先停止后端写流量，再运行一次性 operations profile。宿主目录必须预先创建并限制权限：

```bash
export COMPOSE_PROJECT_NAME=wenflow
export WENFLOW_BACKUP_HOST_DIR=/var/backups/wenflow
docker compose stop backend
docker compose -f docker-compose.operations.yml run --rm backup
docker compose start backend
```

独立的 `docker-compose.operations.yml` 不影响常规 `docker compose up`。`backup` service 只读挂载现有主数据卷，并将备份写入独立宿主目录；`COMPOSE_PROJECT_NAME` 必须与常规部署一致。不要把 `/app/backups` 映射回 `wenflow_data`。

应用提供只读权限审计和显式修复命令：

```powershell
npm run permissions:audit

# 修复会递归收紧数据库、日志和备份目录权限，必须先确认运行账户并保存原 ACL。
icacls 'backend\prisma' /save prisma-acl-backup.txt /T
$env:WENFLOW_SERVICE_ACCOUNT = "$env:USERNAME"
npm run permissions:repair
```

Windows 修复仅保留指定服务账户、SYSTEM 和 Administrators；Linux 修复将目录设为 `0700`、文件设为 `0600`。应用启动只记录权限风险，不会自动改 ACL。

### Secret 扫描和凭据轮换

提交或部署前运行：

```powershell
npm run security:scan:current
npm run security:scan:history
```

仓库历史中已确认存在两枚疑似真实的旧 API Key，指纹记录在 `SECURITY.md`。扫描基线只避免重复报告，不代表凭据仍可安全使用；必须在 Provider 后台撤销或轮换，并检查调用日志、来源 IP 和账单。不要通过发送测试请求验证泄露 Key 是否仍有效。

本地 SQLite 开发环境请保持：

```env
DATABASE_URL=file:./dev.db
SYSTEM_DATABASE_URL=file:../system.db
```

相对路径按各自 Schema 文件位置解析：主 Schema 位于 `backend/prisma/`，System Schema 位于 `backend/prisma/system/`。旧的 `file:./prisma/*.db` 会产生嵌套误库；旧的 `SYSTEM_DATABASE_URL=file:./system.db` 在新目录布局下也会指向错误位置。

### Prisma Migration 基线

- 主库历史：`backend/prisma/migrations/`
- System DB 历史：`backend/prisma/system/migrations/`
- 旧混合 SQL 仅归档于 `backend/prisma/legacy-migrations/`，不能用于 deploy。
- `npm run prisma:migrate:verify-clean` 会在两个临时空库上验证 deploy、幂等、无 drift、表归属和 SQLite 完整性。

已有数据库不能直接运行 baseline migration。先备份并执行只读审计：

```powershell
npm run prisma:baseline:audit
```

审计会按仓库 migration 顺序和 checksum 校验已有历史。只有结构与当前 Schema 完全一致，且 migration 历史为空或为仓库当前历史的合法前缀时，才允许补登记：

```powershell
npm run prisma:baseline:adopt
```

`prisma:baseline:adopt` 会按顺序登记所有缺失的仓库 migration，不只登记第一条 baseline。发现未知、乱序、失败、回滚、checksum 不一致的 migration 历史或 schema drift 时，工具会拒绝操作。此类数据库必须旁路建立新库、执行 migration、迁移数据并校验后切换 URL，不能手工使用 `migrate resolve` 掩盖历史。

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
npm run prisma:generate:all
npm run prisma:migrate:deploy:all
```

### 1.1) 启动时报 `No active prompt found` / `Missing active prompt`

先检查：
- 当前连接的数据库是否正确
- `DATABASE_URL` 是否为 `file:./dev.db`
- `SYSTEM_DATABASE_URL` 是否为 `file:../system.db`

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
- `TRUST_PROXY` 是否为直接连接后端的代理 IP/CIDR
- 后端端口是否只允许受信代理连接；Docker Compose 默认不发布 `3001`

### 3) 出现 `ERR_ERL_UNEXPECTED_X_FORWARDED_FOR`

这是反向代理环境未正确信任代理导致。填写直接连接后端的代理地址，例如本机 Nginx：

```env
TRUST_PROXY=127.0.0.1
```

### 4) 访问到 Welcome to nginx 默认页

说明系统 Nginx 默认站点在响应。使用 `-UseNginx` 时脚本会先停止系统 nginx 并启动 runtime 配置。

---

## 健康检查

```bash
# 本地开发直连后端：进程存活，不检查数据库
curl http://localhost:3001/health
curl http://localhost:3001/livez

# 双库、ACTIVE Prompt、字段路由和 Gateway 注册就绪
curl http://localhost:3001/readyz

# 生产 Docker 只经 Nginx 访问，宿主机不会发布后端 3001
curl http://127.0.0.1/readyz
```

`/readyz` 失败返回 HTTP 503，并且不会返回数据库路径、SQL 或异常堆栈。外部 AI/MCP Provider 健康度不作为实例 readiness 的硬条件。

收到 `SIGTERM` 或 `SIGINT` 后，后端会立即进入 drain，`/readyz` 返回 503，并停止接受新连接。Background Task Tracker 会先拒绝新后台生成或刷新任务，并等待已经启动的路径生成、阶段补全、Dashboard/学习者快照和启动回填完成。随后依次停止 HTTP 活跃请求、Teaching/协作、Outbox、Gateway/EventBus 和双 Prisma 连接。默认总时限为 25 秒；超时会强制关闭 HTTP 连接并以非零状态退出。Docker `stop_grace_period` 为 35 秒，应始终大于 `SHUTDOWN_DEADLINE_MS`。

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
