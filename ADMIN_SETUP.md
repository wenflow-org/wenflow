# 初始管理员账户配置

## 功能说明

系统在后端启动时会尝试根据 `backend/.env` 自动创建初始管理员账户。

- 如果数据库中已存在管理员，系统会自动跳过创建。
- 如果未配置 `INIT_ADMIN_NAME` 或 `INIT_ADMIN_PASSWORD`，系统也会跳过创建。

## 配置方法

### 1) 编辑 `backend/.env`

```env
# 初始管理员配置（仅首次启动时使用）
INIT_ADMIN_NAME=admin
INIT_ADMIN_PASSWORD=YourStrongPassword123
```

### 2) 启动后端

```powershell
# 推荐：在项目根目录一键启动
./start-dev.ps1

# 或使用 backend-only 便捷脚本
cd backend
./start-backend.ps1

# 或仅启动后端
npm run dev
```

说明：
- 如果数据库是空的，后端首次启动时会自动 bootstrap 核心 agent / skill prompts。
- 如果数据库里已经存在 prompt 配置，则不会覆盖已有版本。
- 若项目升级后新增了 prompt 节点，可在 `backend/` 下手动执行 `npm run prompts:backfill-core` 补齐缺项。

### 3) 查看启动日志

创建成功时：

```text
✅ 初始管理员创建成功：<用户名>
```

已存在管理员时：

```text
✅ 已存在管理员账户，跳过创建
```

## 登录管理端

开发环境管理端地址：

- `http://localhost:5173/admin`

使用你在 `backend/.env` 中配置的管理员用户名和密码登录。

注意：当前管理员登录接口仅允许本机访问（`localhost` / `127.0.0.1` / `::1`）。如果通过局域网地址、普通反向代理域名或其他远程来源访问，后端会拒绝登录请求。

## 安全建议

1. 首次登录后立即修改管理员密码。
2. 对外部署时请使用强密码（建议 12 位以上，包含大小写字母、数字、特殊字符）。
3. 不要把 `backend/.env` 提交到仓库。

## 常见问题

### 启动后没有创建管理员

- 检查 `INIT_ADMIN_NAME` 和 `INIT_ADMIN_PASSWORD` 是否都已配置。
- 检查数据库中是否已经存在管理员。
- 检查后端日志是否有数据库连接或 Prisma 报错。

### 使用反向代理后登录异常

- 确认 `CORS_ORIGIN` 与实际域名一致（不要带尾部 `/`）。
- 反向代理场景建议设置 `TRUST_PROXY=1`。
