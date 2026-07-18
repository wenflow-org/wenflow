# 管理员登录安全配置

WenFlow 不提供默认管理员密码。只有显式配置满足强度要求的 `INIT_ADMIN_PASSWORD` 时，首次启动才会创建管理员。

## 初始化管理员

在 `backend/.env` 中配置：

```env
INIT_ADMIN_NAME=admin
INIT_ADMIN_EMAIL=admin@wenflow.local
INIT_ADMIN_PASSWORD=<set-a-unique-strong-password>
```

密码至少 12 位，并包含大写字母、小写字母和数字。不要把填写后的 `.env` 提交到 Git。

启动后端：

```powershell
./start-dev.ps1
```

如果数据库中已经存在管理员，初始化会自动跳过。也可以在 `backend/` 下运行 `node create-admin.js`，该脚本同样读取环境变量并执行强度校验，不会输出密码。

## Admin 来源策略

Admin 来源策略通过“连接与安全”页面持久化到 System DB，并支持热生效。环境变量只作为数据库未配置时的默认值：

```env
# loopback: 仅服务器本机
# private: 本机和 RFC1918 局域网，默认推荐
# any: 不限制来源，不建议直接用于公网
ADMIN_ACCESS_MODE=private

# 额外精确允许的客户端 IP，逗号分隔
ADMIN_ALLOWED_IPS=
```

生产公网管理建议使用 VPN 或受控反向代理，并保持精确 IP Allowlist。不要通过关闭认证或使用共享弱密码解决远程访问问题。

## 登录地址

- 前端管理端：`http://localhost:5173/admin/login`
- 登录 API：`POST /api/admin-auth/login`

Admin API 同时要求来源网络策略允许、JWT 身份有效、数据库用户仍有管理员权限，并拒绝 Projection 或 Synthetic 身份。

## 忘记密码

不要删除数据库。当前安全恢复流程是：

1. 备份主库和数据库加密 Keyring。
2. 使用受控维护脚本或数据库管理流程为指定管理员写入新的 bcrypt 哈希。
3. 撤销现有会话或 Token。
4. 审计恢复操作和登录记录。

如果尚未创建任何管理员，可设置新的 `INIT_ADMIN_PASSWORD` 后重新启动或运行 `node create-admin.js`。

## 发布检查

```powershell
npm run security:scan
npm run check
```

更多凭据、数据库备份和泄露响应要求见 [`SECURITY.md`](./SECURITY.md)。
