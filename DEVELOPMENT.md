# AI 学习平台 - 开发环境

> 快速启动指南

## 项目结构

```
ai-learning-platform/
├── backend/          # Node.js + Express + TypeScript 后端
├── frontend/         # Vue3 + TypeScript 前端
├── docs/             # 项目文档
└── README.md         # 这个文件
```

## 快速开始

### 前置要求

- Node.js >= 18.x
- PostgreSQL 数据库

### 安装依赖

```bash
# 安装后端依赖
cd backend
npm install

# 安装前端依赖
cd ../frontend
npm install
```

### 配置环境变量

#### 后端配置

复制 `backend/.env.example` 为 `backend/.env` 并填写配置：

```bash
cp backend/.env.example backend/.env
```

关键配置项：
- `PORT`: 后端端口（默认 3001）
- `DATABASE_URL`: PostgreSQL 数据库连接字符串
- `AI_API_URL`: AI 服务地址（默认 http://localhost:3000）
- `AI_API_KEY`: AI 服务 API Key
- `AI_MODEL`: AI 模型名称（默认 deepseek-chat）

#### 前端配置

复制 `frontend/.env.example` 为 `frontend/.env`：

```bash
cp frontend/.env.example frontend/.env
```

### 运行开发服务器
