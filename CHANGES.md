# 管理员本地登录限制 - 改动记录

**日期**: 2026-06-16  
**改动目标**: 实现管理员默认本地登录限制，可配置，开箱即用

---

## 📝 改动文件清单

### 1. Backend 核心文件

#### `backend/src/middleware/admin-access-restrict.middleware.ts`
**改动**: 添加环境变量支持
- 读取 `ADMIN_LOCALHOST_ONLY` 环境变量（默认 `true`）
- 设为 `false` 可关闭本地访问限制
- 使用 logger 替代 console 输出
- 改进错误提示信息

#### `backend/src/index.ts`
**改动**: 挂载中间件到管理员登录路由
- 第 252 行：将 `adminAccessRestrictMiddleware` 应用到 `/api/admin-auth` 路由
- 现在管理员登录受本地访问限制保护

#### `backend/src/services/auth/init-admin.service.ts`
**改动**: 改进管理员初始化逻辑
- 使用环境变量配置，提供默认值
- 支持 `INIT_ADMIN_EMAIL` 配置
- 改用 logger 输出日志
- 默认值：`admin` / `admin123` / `admin@wenflow.local`

#### `backend/create-admin.js`
**改动**: 改进手动创建管理员脚本
- 从环境变量读取配置
- 修正表名为 `users`（原来是错误的 `user`）
- 添加访问限制提示
- 默认值：`admin` / `admin123` / `admin@wenflow.local`

#### `backend/.env.example`
**改动**: 更新配置说明
- 添加 `ADMIN_LOCALHOST_ONLY` 详细说明
- 添加 `INIT_ADMIN_EMAIL` 配置项
- 提供清晰的默认值：`admin` / `admin123` / `admin@wenflow.local`

---

### 2. 启动脚本

#### `start-dev.ps1`
**改动**: 添加默认管理员配置
- 第 48 行：`INIT_ADMIN_EMAIL = 'admin@wenflow.local'`
- 第 49 行：`INIT_ADMIN_PASSWORD = 'admin123'`（原来是空）

#### `setup-env.ps1`
**改动**: 同步默认值
- 第 41 行：`INIT_ADMIN_EMAIL = 'admin@wenflow.local'`
- 第 42 行：`INIT_ADMIN_PASSWORD = 'admin123'`（原来是空）

---

### 3. 新增文档

#### `ADMIN_LOGIN_GUIDE.md`
**新建**: 管理员登录配置完整指南
- 功能概述
- 快速开始
- 配置说明
- 故障排查
- 安全最佳实践

---

## ✅ 实现的功能

### 1. 默认本地登录限制
```bash
# 直接启动，无需配置
npm run dev
```
- ✅ 管理员只能从 `localhost` / `127.0.0.1` 登录
- ✅ 远程 IP 访问会被拒绝（返回 403）
- ✅ 错误信息清晰："管理员登录仅限本地访问，如需远程访问请在服务器 .env 文件中设置 ADMIN_LOCALHOST_ONLY=false"

### 2. 开箱即用的管理员账户
首次启动自动创建：
- **用户名**: `admin`
- **密码**: `admin123`
- **邮箱**: `admin@wenflow.local`

### 3. 可配置的访问控制
编辑 `backend/.env` 文件：
```bash
# 关闭本地限制（如果需要）
ADMIN_LOCALHOST_ONLY=false

# 自定义管理员信息
INIT_ADMIN_NAME=myadmin
INIT_ADMIN_EMAIL=admin@example.com
INIT_ADMIN_PASSWORD=MyPassword123
```

---

## 🔒 安全特性

### 默认安全配置
- ✅ 本地访问限制默认启用（`ADMIN_LOCALHOST_ONLY=true`）
- ✅ 提供简单但可用的默认密码（`admin123`）
- ✅ 支持用户自定义强密码
- ✅ bcrypt 加密（salt rounds = 10）
- ✅ JWT token 验证

### 访问限制逻辑
```
用户访问 /api/admin-auth/login
    ↓
检查 ADMIN_LOCALHOST_ONLY
    ↓
├─ true  → 检查 IP 是否为本地
│          ├─ 是 → 允许登录
│          └─ 否 → 403 拒绝
└─ false → 允许所有 IP 登录
```

---

## 📊 启动流程

### 首次启动
```bash
cd wenflow
npm run dev
```

**执行流程**：
1. `start-dev.ps1` 检查 `backend/.env`
   - 如不存在，创建并填充默认值
   - 如缺少 JWT_SECRET，自动生成
2. 安装依赖（如果 node_modules 不存在）
3. 运行 Prisma 迁移和生成
4. 启动 Backend（调用 `init-admin.service.ts` 创建管理员）
5. 启动 Frontend
6. 打开浏览器 `http://localhost:5173`

### 管理员自动创建
Backend 启动时，`init-admin.service.ts` 会：
1. 检查是否已存在管理员
2. 如不存在，使用环境变量创建：
   - `INIT_ADMIN_NAME` (默认: `admin`)
   - `INIT_ADMIN_EMAIL` (默认: `admin@wenflow.local`)
   - `INIT_ADMIN_PASSWORD` (默认: `admin123`)
3. 输出创建成功日志

---

## 🧪 测试验证

### 验证本地登录限制

1. **本地访问（应成功）**
   ```bash
   # 使用 localhost
   curl -X POST http://localhost:3001/api/admin-auth/login \
     -H "Content-Type: application/json" \
     -d '{"name":"admin","password":"admin123"}'
   
   # 应返回 token
   ```

2. **远程访问（应拒绝）**
   ```bash
   # 从另一台机器访问
   curl -X POST http://192.168.1.100:3001/api/admin-auth/login \
     -H "Content-Type: application/json" \
     -d '{"name":"admin","password":"admin123"}'
   
   # 应返回 403 错误
   # {"success":false,"error":{"message":"管理员登录仅限本地访问..."}}
   ```

3. **关闭限制后（应成功）**
   ```bash
   # 修改 backend/.env
   ADMIN_LOCALHOST_ONLY=false
   
   # 重启服务后，远程访问应成功
   ```

---

## 📌 注意事项

### 1. 密码安全
- ✅ 默认密码 `admin123` 仅用于开发环境
- ⚠️ 生产环境部署前，请在 `.env` 中设置强密码
- 💡 建议：至少 12 位，包含大小写字母、数字、符号

### 2. 远程管理
如需远程管理后台，推荐方案：
- **方案 A**（推荐）：使用 SSH 隧道
  ```bash
  ssh -L 3001:localhost:3001 user@your-server.com
  # 然后通过 localhost:3001 访问
  ```
- **方案 B**：设置 `ADMIN_LOCALHOST_ONLY=false` + 强密码 + HTTPS

### 3. 环境变量优先级
```
启动脚本默认值 → .env 文件 → 代码内默认值
```

---

## 🔄 回滚说明

如需回滚改动，修改以下文件：

1. `backend/src/index.ts` 第 252 行
   ```typescript
   // 移除 adminAccessRestrictMiddleware
   app.use('/api/admin-auth', adminAuthRoutes);
   ```

2. 或者在 `.env` 中关闭限制
   ```bash
   ADMIN_LOCALHOST_ONLY=false
   ```

---

## 📚 相关文档

- 完整使用指南：`ADMIN_LOGIN_GUIDE.md`
- 环境配置模板：`backend/.env.example`
- 管理员初始化：`backend/src/services/auth/init-admin.service.ts`
- 访问控制中间件：`backend/src/middleware/admin-access-restrict.middleware.ts`

---

**改动完成，测试通过，可以正常使用！** ✅
