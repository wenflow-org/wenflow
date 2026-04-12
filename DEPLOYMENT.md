# WenFlow 部署指南

## 环境要求

| 软件 | 版本 | 说明 |
|------|------|------|
| Node.js | 18+ | 运行环境 |
| npm | 9+ | 包管理器 |
| Git | 2.x | 版本控制 |

---

## 快速开始

### 方式一：一键启动（Windows）

```powershell
# 在项目根目录执行
.\start-dev.ps1
```

脚本会自动：
- 检查并清理端口占用
- 启动后端服务（端口 3001）
- 启动前端服务（端口 5173）
- 自动打开浏览器

### 方式二：手动启动

#### 1. 克隆项目

```bash
git clone https://github.com/your-repo/wenflow.git
cd wenflow
```

#### 2. 启动后端

```bash
cd backend

# 安装依赖
npm install

# 生成 Prisma 客户端
npx prisma generate

# 初始化数据库
npx prisma db push

# 启动开发服务
npm run dev
```

后端启动后访问：http://localhost:3001

#### 3. 启动前端

```bash
cd frontend

# 安装依赖
npm install

# 启动开发服务
npm run dev
```

前端启动后访问：http://localhost:5173

---

## 配置说明

### 后端配置（backend/.env）

创建 `backend/.env` 文件：

```bash
# 复制示例配置
cp backend/.env.example backend/.env
```

**必需配置项**：

| 配置项 | 说明 | 示例 |
|--------|------|------|
| `AI_API_URL` | AI 服务地址 | `https://api.deepseek.com` |
| `AI_API_KEY` | API 密钥 | `sk-xxx` |
| `JWT_SECRET` | JWT 密钥 | 随机字符串 |

**完整配置示例**：

```env
DATABASE_URL=file:./dev.db
JWT_SECRET=your-secret-key-change-in-production
PORT=3001
CORS_ORIGIN=http://localhost:5173

AI_API_URL=https://api.deepseek.com
AI_API_KEY=sk-your-api-key
AI_MODEL=deepseek-chat
AI_MODEL_REASONING=deepseek-reasoner

INIT_ADMIN_NAME=admin
INIT_ADMIN_PASSWORD=admin123
```

### 前端配置（frontend/.env）

创建 `frontend/.env` 文件：

```bash
# 复制示例配置
cp frontend/.env.example frontend/.env
```

**配置项**：

| 配置项 | 说明 | 默认值 |
|--------|------|--------|
| `VITE_API_BASE_URL` | API 地址 | `/api` |
| `VITE_APP_TITLE` | 应用标题 | `问流 WenFlow` |

---

## 数据库

### 数据库类型

开发环境使用 **SQLite**，无需额外安装数据库服务。

### 数据库文件位置

```
backend/prisma/dev.db
```

### 常用命令

```bash
# 查看数据库结构
npx prisma studio

# 重置数据库（清空所有数据）
npx prisma db push --force-reset

# 查看数据库内容
npx prisma studio
# 打开 http://localhost:5555
```

---

## 常见问题

### 端口占用

**Windows 检查端口**：

```powershell
# 检查 3001 端口
Get-NetTCPConnection -LocalPort 3001

# 终止占用进程
Stop-Process -Id <进程ID> -Force
```

**或使用 start-dev.ps1 脚本**，会自动清理端口占用。

### 后端启动失败

**检查项**：

1. 数据库文件是否存在
   ```bash
   ls backend/prisma/dev.db
   ```

2. Prisma 客户端是否生成
   ```bash
   npx prisma generate
   ```

3. 依赖是否安装
   ```bash
   npm install
   ```

### 前端无法连接后端

**检查项**：

1. 后端是否启动（访问 http://localhost:3001/api/health）
2. CORS 配置是否正确
3. 前端 .env 中的 `VITE_API_BASE_URL` 是否正确

### AI 功能不工作

**检查项**：

1. `AI_API_KEY` 是否配置
2. API 余额是否充足
3. API 地址是否正确

---

## 开发工具

### Prisma Studio

可视化数据库管理工具：

```bash
cd backend
npx prisma studio
```

访问 http://localhost:5555

### API 健康检查

```bash
curl http://localhost:3001/api/health
# 预期返回：{"status":"healthy"}
```

### 查看后端 API 端点

访问 http://localhost:3001/api 可查看所有 API 端点列表。

---

## 目录结构

```
wenflow/
├── backend/           # 后端服务
│   ├── src/           # 源代码
│   ├── prisma/        # 数据库
│   │   ├── schema.prisma
│   │   └── dev.db     # SQLite 数据库文件
│   └── .env           # 环境配置
├── frontend/          # 前端服务
│   ├── src/           # 源代码
│   └── .env           # 环境配置
├── docs/              # 文档
├── start-dev.ps1      # 一键启动脚本
└── DEPLOYMENT.md      # 本文档
```

---

## 相关文档

- [开发指南](./DEVELOPMENT.md)
- [API 文档](./API.md)
- [用户指南](./USER_GUIDE.md)

---

*文档版本：v3.0*
*最后更新：2026-04-12*