# 管理员账户与登录安全

> 本文合并原 `ADMIN_SETUP.md`（初始管理员账户配置）与 `ADMIN_LOGIN_GUIDE.md`（登录安全配置）。
> 凭据、数据库备份与泄露响应要求见 [`SECURITY.md`](./SECURITY.md)。

## 初始化管理员

系统在后端启动时会根据 `backend/.env` 自动创建初始管理员账户：

- 如果数据库中已存在管理员，系统会自动跳过创建。
- 未配置 `INIT_ADMIN_PASSWORD` 时，开发环境使用内置默认密码 `ChangeMe_2026_Admin`（仅首次启动创建时生效）；**生产环境（`NODE_ENV=production`）拒绝默认口令，必须显式配置**，否则跳过创建并告警。
- `INIT_ADMIN_NAME` 未配置时使用 `admin`。
- 显式配置弱密码、初始用户名或邮箱被普通用户占用、或数据库写入失败时，后端会拒绝启动，不会静默继续。
- 如果数据库中已经存在管理员，初始化会自动跳过（**修改 `INIT_ADMIN_PASSWORD` 后重启不会更新已有管理员密码**）。

在 `backend/.env` 中配置：

```env
# 初始管理员配置（仅首次启动时使用）
# 开发环境不配置则使用内置默认密码 ChangeMe_2026_Admin；生产环境必须显式设置
INIT_ADMIN_NAME=admin
INIT_ADMIN_EMAIL=admin@wenflow.local
INIT_ADMIN_PASSWORD=<set-a-unique-strong-password>
```

密码至少 12 位，并包含大写字母、小写字母和数字（生产环境必须显式设置，不允许使用默认口令）。不要把填写后的 `.env` 提交到 Git。

## 启动后端

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

也可以在 `backend/` 下运行 `node create-admin.js`，该脚本同样读取环境变量并执行强度校验，不会输出密码。

## 查看启动日志

创建成功时：

```text
✅ 初始管理员创建成功：<用户名>
```

已存在管理员时：

```text
✅ 管理员账户已存在，跳过创建
```

## 登录管理端

- 前端管理端：`http://localhost:5173/admin`（登录页 `http://localhost:5173/admin/login`）
- 登录 API：`POST /api/admin-auth/login`

Admin API 同时要求来源网络策略允许、JWT 身份有效、数据库用户仍有管理员权限，并拒绝 Projection 或 Synthetic 身份。

## Admin 来源策略

Admin 来源策略通过管理端「模型与接入」页面（连接与安全）持久化到 System DB，并支持热生效。环境变量只作为数据库未配置时的默认值：

```env
# loopback: 仅服务器本机（localhost / 127.0.0.1 / ::1）
# private: 本机和 RFC1918 局域网，默认推荐
# any: 不限制来源，不建议直接用于公网
ADMIN_ACCESS_MODE=private

# 额外精确允许的客户端 IP，逗号分隔
ADMIN_ALLOWED_IPS=
```

生产公网管理建议使用 VPN 或受控反向代理，并保持精确 IP Allowlist。不要通过关闭认证或使用共享弱密码解决远程访问问题。

## 忘记密码

不要删除数据库。当前安全恢复流程是：

1. 备份主库和数据库加密 Keyring。
2. 使用受控维护脚本或数据库管理流程为指定管理员写入新的 bcrypt 哈希。
3. 撤销现有会话或 Token。
4. 审计恢复操作和登录记录。

如果尚未创建任何管理员，可设置新的 `INIT_ADMIN_PASSWORD` 后重新启动或运行 `node create-admin.js`。

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
- 将 `TRUST_PROXY` 设置为直接连接后端的受信代理 IP/CIDR，例如本机 Nginx 使用 `127.0.0.1`；生产禁止 `TRUST_PROXY=true`。
- 后端端口不得绕过代理公开，否则客户端可伪造转发来源地址。

## 发布检查

```powershell
npm run security:scan
npm run check
```

更多凭据、数据库备份和泄露响应要求见 [`SECURITY.md`](./SECURITY.md)。
