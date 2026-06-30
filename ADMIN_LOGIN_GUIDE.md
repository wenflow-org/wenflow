# 管理员登录安全配置说明

## 📋 功能概述

WenFlow 已配置管理员本地登录限制，确保管理后台的安全性。

### ✅ 已实现的功能

1. **默认本地登录限制**
   - 管理员登录 `/api/admin-auth/login` 默认只允许从本机访问
   - 允许的地址：`localhost`、`127.0.0.1`、`::1`、`::ffff:127.0.0.1`

2. **可配置的访问控制**
   - 通过环境变量 `ADMIN_LOCALHOST_ONLY` 控制是否启用限制
   - 默认值：`true`（启用本地限制）

3. **开箱即用的管理员账户**
   - 首次启动自动创建管理员账户
   - 默认用户名：`admin`
   - 默认密码：`admin123`

---

## 🚀 快速开始

### 1. 首次使用（默认配置）

```bash
# 在 wenflow 目录下运行
npm run dev
```

服务启动后，会自动创建管理员账户：
- **用户名**: `admin`
- **密码**: `admin123`
- **邮箱**: `admin@wenflow.local`

访问管理后台：
```
http://localhost:5173/admin/login
```

⚠️ **只能从本机访问**，远程 IP 会被拒绝。

---

## ⚙️ 配置说明

### 方式 1：使用 .env 文件（推荐）

编辑 `wenflow/backend/.env` 文件：

```bash
# ===========================================
# Admin 访问限制
# ===========================================
# 设为 true: 只允许本地访问（默认，推荐）
# 设为 false: 允许远程访问（不推荐）
ADMIN_LOCALHOST_ONLY=true

# ===========================================
# 初始管理员配置
# ===========================================
# 自定义管理员账户信息
INIT_ADMIN_NAME=admin
INIT_ADMIN_EMAIL=admin@wenflow.local
INIT_ADMIN_PASSWORD=admin123
```

### 方式 2：手动创建管理员

如果需要手动创建或重置管理员：

```bash
cd wenflow/backend
node create-admin.js
```

此脚本会从 `.env` 读取配置创建管理员账户。

---

## 🔓 允许远程访问（不推荐）

如果确实需要远程访问管理后台：

1. 编辑 `wenflow/backend/.env`
2. 修改配置：
   ```bash
   ADMIN_LOCALHOST_ONLY=false
   ```
3. 重启后端服务

⚠️ **安全警告**：
- 允许远程访问会增加安全风险
- 建议使用强密码
- 考虑使用 VPN 或 SSH 隧道代替远程访问

---

## 🛡️ 安全最佳实践

### 生产环境部署

1. **修改默认密码**
   ```bash
   # 在 .env 中设置强密码
   INIT_ADMIN_PASSWORD=YourStrongPassword2024!@#
   ```

2. **保持本地登录限制**
   ```bash
   ADMIN_LOCALHOST_ONLY=true
   ```

3. **使用 SSH 隧道远程管理**
   ```bash
   # 在本地电脑执行
   ssh -L 3001:localhost:3001 user@your-server.com
   
   # 然后通过 localhost:3001 访问远程服务器的管理后台
   ```

### 修改管理员密码

1. 方式 1：修改 `.env` 后删除数据库重新初始化
   ```bash
   cd wenflow/backend
   rm dev.db
   npm run dev  # 会重新创建数据库和管理员
   ```

2. 方式 2：使用密码重置功能（如果已实现）

---

## 🔍 故障排查

### 问题 1：无法登录管理后台

**症状**：访问 `/api/admin-auth/login` 返回 403 错误

**原因**：
- 从远程 IP 访问，但 `ADMIN_LOCALHOST_ONLY=true`

**解决**：
1. 确认是从 `localhost` 或 `127.0.0.1` 访问
2. 或者设置 `ADMIN_LOCALHOST_ONLY=false`（不推荐）

### 问题 2：忘记管理员密码

**解决**：
```bash
# 方法 1：查看 .env 中配置的密码
cat wenflow/backend/.env | grep INIT_ADMIN_PASSWORD

# 方法 2：重置数据库（会丢失所有数据）
cd wenflow/backend
rm dev.db
npm run dev
```

### 问题 3：服务启动时未创建管理员

**原因**：
- `.env` 中未配置 `INIT_ADMIN_PASSWORD`

**解决**：
```bash
# 编辑 .env 文件，添加：
INIT_ADMIN_NAME=admin
INIT_ADMIN_PASSWORD=admin123

# 或手动创建
cd wenflow/backend
node create-admin.js
```

---

## 📝 配置文件位置

- 后端环境配置：`wenflow/backend/.env`
- 配置模板：`wenflow/backend/.env.example`
- 管理员初始化服务：`wenflow/backend/src/services/auth/init-admin.service.ts`
- 访问控制中间件：`wenflow/backend/src/middleware/admin-access-restrict.middleware.ts`
- 手动创建脚本：`wenflow/backend/create-admin.js`

---

## 🔗 相关链接

- 前端管理页面：`http://localhost:5173/admin/login`
- 后端 API 文档：`http://localhost:3001/api`
- 管理员登录端点：`POST /api/admin-auth/login`

---

## ⚠️ 重要提示

1. **默认密码**：首次部署后请立即修改默认密码
2. **本地限制**：生产环境务必保持 `ADMIN_LOCALHOST_ONLY=true`
3. **环境变量**：确保 `.env` 文件不提交到 Git 仓库
4. **数据库备份**：删除 `dev.db` 前请备份重要数据

---

最后更新：2026-06-16
