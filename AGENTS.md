# AGENTS.md - AI 学习平台

## 项目概述

AI 学习平台是一个基于 AI 驱动的个性化学习平台，旨在让学习真正高效、有趣、可及。这不是学校，而是用户的学习伙伴。

**核心定位**：
- 用户自主：想学什么、学到什么程度，用户自己决定
- AI 赋能：AI 负责规划路径、组织资源、个性化辅导
- 问题导向：学习是为了解决实际问题
- 经济高效：AI 替代教师，边际成本接近零

**当前状态**: v3.0 - MCP Agent 系统 + Arena 竞技场 + AB 测试系统 🎉

---

## 技术架构

### 后端

**框架**: Node.js + Express + TypeScript

**核心依赖**:
- `express` v4.18.2 - Web 框架
- `typescript` v5.3.3 - 类型系统
- `prisma` v5.22.0 - ORM 工具（SQLite 开发，PostgreSQL 生产）
- `openai` v4.26.0 - AI API 客户端（兼容 GLM/Gemini）
- `jsonwebtoken` v9.0.2 - JWT 认证
- `bcrypt` v5.1.1 - 密码加密
- `winston` v3.11.0 - 日志系统
- `zod` v3.22.4 - 数据验证
- `helmet` v7.1.0 - 安全中间件
- `cors` v2.8.5 - 跨域支持
- `axios` v1.6.5 - HTTP 客户端
- `dotenv` v16.3.1 - 环境变量

**端口**: 3001

### 前端

**框架**: Vue3 + TypeScript + Vite 5

**核心依赖**:
- `vue` v3.4.15 - 核心框架
- `vue-router` v4.2.5 - 路由
- `pinia` v2.1.7 - 状态管理
- `element-plus` v2.5.4 - UI 组件库
- `@element-plus/icons-vue` v2.3.1 - 图标库
- `axios` v1.6.5 - HTTP 客户端
- `chart.js` v4.4.1 - 数据可视化
- `vue-chartjs` v5.3.0 - Vue 图表封装
- `dayjs` v1.11.10 - 日期处理
- `markdown-it` v14.1.1 - Markdown 渲染
- `sass-embedded` v1.97.3 - CSS 预处理器

**端口**: 5173

### 数据库

**开发环境**: SQLite
**生产环境**: PostgreSQL

使用 Prisma ORM 进行数据库操作。

**主要数据模型** (40 个):
- **核心学习系统** (8 个): `users`, `learning_paths`, `weeks`, `tasks`, `learning_goals`, `learning_sessions`, `learning_metrics`, `path_decompositions`
- **激励与评估** (3 个): `achievements`, `student_baselines`, `content_feedback`
- **Agent 系统** (8 个): `agent_instances`, `agent_registrations`, `agent_prompts`, `agent_lab_configs`, `agent_logs`, `agent_execution_logs`, `agent_call_logs`, `skill_registrations`
- **Arena 竞技场** (7 个): `arena_sessions`, `arena_personas`, `arena_dialogues`, `arena_evaluations`, `arena_extractions`, `arena_generations`, `arena_optimizations`, `arena_agent_logs`
- **实验与测试** (3 个): `ab_test`, `ab_test_result`, `dialogue_sessions`
- **访客系统** (3 个): `guest_conversations`, `guest_learning_paths`, `guest_email_bindings`
- **调试与系统** (5 个): `debug_learning_paths`, `debug_proposals`, `debug_requirements`, `debug_snapshots`, `system_announcements`, `platform_stats`
- **对话系统** (2 个): `goal_conversations`, `learning_sessions`

### AI 服务

**生产环境模型**: DeepSeek（通过 NewAPI 服务）

配置：
- 地址：`http://101.43.146.102:30001`
- 模型：`deepseek-chat` / `deepseek-think`
- 兼容 OpenAI API 格式
- API Key：保持不变（从环境变量读取）

---

## 项目结构

```
ai-learning-platform/
├── backend/                    # 后端代码
│   ├── src/
│   │   ├── agents/            # Agent 系统（新增）
│   │   │   ├── content-agent/         # ContentAgent v1
│   │   │   ├── content-agent-v3/      # ContentAgent v3
│   │   │   ├── content-agent-v5/      # ContentAgent v5
│   │   │   ├── content-generator/     # 内容生成 Agent
│   │   │   ├── coordinator/           # 协调 Agent
│   │   │   ├── data-mapping-agent/    # 数据映射 Agent
│   │   │   ├── path-agent/            # 路径生成 Agent
│   │   │   ├── path-planner/          # 路径规划 Agent
│   │   │   ├── plugins/               # Agent 插件系统
│   │   │   ├── progress-agent/        # 进度跟踪 Agent
│   │   │   ├── standard/              # 标准 Agent
│   │   │   ├── tutor-agent/           # 辅导 Agent
│   │   │   ├── tutor-core/            # 辅导核心逻辑
│   │   │   ├── index.ts               # Agent 入口
│   │   │   ├── plugin-registry.ts     # 插件注册表
│   │   │   └── protocol.ts            # Agent 协议
│   │   ├── core/              # 核心模块（新增）
│   │   │   ├── agent/                 # Agent 核心
│   │   │   ├── mcp/                   # MCP 核心
│   │   │   ├── skill/                 # Skill 核心
│   │   │   └── index.ts
│   │   ├── gateway/           # API 网关
│   │   ├── middleware/        # 中间件
│   │   │   ├── auth.middleware.ts     # JWT 认证中间件
│   │   │   └── guest-auth.middleware.ts  # 访客认证中间件
│   │   ├── models/            # 数据模型
│   │   ├── routes/            # API 路由（25 个路由文件）
│   │   │   ├── admin/                 # 管理端路由（新增）
│   │   │   │   ├── agent-lab.ts       # Agent 实验室
│   │   │   │   ├── agent-monitoring.ts # Agent 监控
│   │   │   │   ├── agent-prompts.ts   # Agent Prompt 管理
│   │   │   │   ├── arena.ts           # Arena 竞技场
│   │   │   │   ├── auth.ts            # 管理认证
│   │   │   │   ├── debug-sandbox.ts   # 调试沙盒
│   │   │   │   ├── goal-conversations.ts # 目标对话管理
│   │   │   │   ├── index.ts           # 管理路由索引
│   │   │   │   ├── platform.ts        # 平台数据
│   │   │   │   └── users.ts           # 用户管理
│   │   │   ├── ab-testing.ts          # AB 测试（新增）
│   │   │   ├── achievements.ts        # 成就系统
│   │   │   ├── admin-auth.ts          # 管理员认证
│   │   │   ├── admin-dashboard.ts     # 管理控制台
│   │   │   ├── agents.ts              # Agent 管理
│   │   │   ├── ai-teaching.routes.ts  # AI 教学路由
│   │   │   ├── ai.ts                  # AI 辅导
│   │   │   ├── auth.ts                # 认证相关
│   │   │   ├── feedback.ts            # 反馈系统（新增）
│   │   │   ├── goal-conversation.ts   # 目标对话
│   │   │   ├── guest-binding.ts       # 访客绑定（新增）
│   │   │   ├── learning.ts            # 学习路径/任务
│   │   │   ├── metrics.ts             # 指标统计
│   │   │   ├── plugins.ts             # 插件管理（新增）
│   │   │   ├── reports.ts             # 学习报告
│   │   │   ├── sessions.ts            # 学习会话
│   │   │   ├── skills.ts              # Skill 管理（新增）
│   │   │   ├── state-tracking.routes.ts # 学习状态追踪
│   │   │   └── users.ts               # 用户管理
│   │   ├── services/          # 业务逻辑
│   │   │   ├── ab-testing/            # AB 测试服务（新增）
│   │   │   ├── achievements/          # 成就系统
│   │   │   │   ├── achievement.service.ts
│   │   │   │   └── achievement-system.ts
│   │   │   ├── ai/                    # AI 服务
│   │   │   │   ├── ai.service.ts
│   │   │   │   └── zpd-strategy.ts    # ZPD 分层辅导策略
│   │   │   ├── ai-teaching/           # AI 教学服务（新增）
│   │   │   ├── arena/                 # Arena 竞技场服务（新增）
│   │   │   ├── auth/                  # 认证服务
│   │   │   ├── cache/                 # 缓存服务（新增）
│   │   │   ├── feedback/              # 反馈服务（新增）
│   │   │   ├── learning/              # 学习服务
│   │   │   │   ├── learning.service.ts
│   │   │   │   ├── goal-conversation.service.ts
│   │   │   │   ├── report.service.ts
│   │   │   │   └── state-tracking.service.ts
│   │   │   ├── metrics/               # 指标服务
│   │   │   ├── acp-permission.service.ts      # ACP 权限服务（新增）
│   │   │   ├── agentConfig.service.ts         # Agent 配置服务
│   │   │   ├── apiConfig.service.ts           # API 配置服务
│   │   │   ├── dynamic-adjustment.service.ts  # 动态调整服务（新增）
│   │   │   ├── ema.service.ts                 # EWMA 算法服务（新增）
│   │   │   ├── student-baseline.service.ts    # 学生基线服务（新增）
│   │   │   └── goal-conversation.service.ts   # 目标对话服务
│   │   ├── skills/              # Skill 系统（新增）
│   │   │   ├── answer-generation/     # 答案生成
│   │   │   ├── code-explainer/        # 代码解释
│   │   │   ├── content-generation/    # 内容生成
│   │   │   ├── error-pattern/         # 错误模式分析
│   │   │   ├── exercise-generator/    # 练习生成
│   │   │   ├── image-analyzer/        # 图像分析
│   │   │   ├── memory-search/         # 记忆搜索
│   │   │   ├── pdf-parser/            # PDF 解析
│   │   │   ├── quiz-generation/       # 测验生成
│   │   │   ├── retrieval/             # 检索
│   │   │   ├── smart-search/          # 智能搜索
│   │   │   ├── standard/              # 标准 Skill
│   │   │   ├── text-structure-analyzer/ # 文本结构分析
│   │   │   ├── time-estimator/        # 时间估算
│   │   │   ├── web-extractor/         # Web 提取
│   │   │   ├── index.ts
│   │   │   └── protocol.ts
│   │   ├── scripts/           # 工具脚本
│   │   ├── types/             # TypeScript 类型定义
│   │   ├── utils/             # 工具函数
│   │   │   └── logger.ts              # 日志工具
│   │   └── index.ts           # 入口文件
│   ├── prisma/                # 数据库 Schema
│   │   ├── schema.prisma          # 数据库模型定义 (28 个模型)
│   │   ├── migrations/            # 数据库迁移
│   │   └── seeds/                 # 数据种子
│   ├── logs/                    # 日志文件
│   ├── dist/                    # 编译输出
│   ├── package.json
│   ├── tsconfig.json
│   └── .env.example             # 环境变量示例
│
├── frontend/                    # 前端代码
│   ├── src/
│   │   ├── api/                 # API 封装（10 个 API 模块）
│   │   │   ├── adminApi.ts              # 管理端 API（新增）
│   │   │   ├── adminArenaApi.ts         # Arena API（新增）
│   │   │   ├── auth.ts
│   │   │   ├── ai.ts
│   │   │   ├── dialogue.ts              # 对话 API（新增）
│   │   │   ├── feedback.ts              # 反馈 API（新增）
│   │   │   ├── learning.ts
│   │   │   ├── metrics.ts
│   │   │   └── user.ts
│   │   ├── components/          # 组件（14 个）
│   │   │   ├── home/                  # 首页组件（新增）
│   │   │   ├── learning/              # 学习组件（新增）
│   │   │   ├── CognitiveStatePanel.vue    # 认知状态面板（新增）
│   │   │   ├── ContentAgentDialogCard.vue # ContentAgent 对话框（新增）
│   │   │   ├── ConversationPanel.vue      # 对话面板（新增）
│   │   │   ├── FeedbackDialog.vue         # 反馈对话框（新增）
│   │   │   ├── GuestEmailBinding.vue      # 访客邮箱绑定（新增）
│   │   │   ├── LearningMetrics.vue
│   │   │   ├── LearningRatingDialog.vue
│   │   │   ├── LoadCalendar.vue
│   │   │   ├── QuestionCard.vue           # 问题卡片（新增）
│   │   │   ├── ThemeSwitcher.vue          # 主题切换器（新增）
│   │   │   └── ...
│   │   ├── views/               # 页面视图（18 个页面）
│   │   │   ├── admin/                 # 管理端页面（新增）
│   │   │   │   ├── AdminArena.vue           # Arena 管理
│   │   │   │   ├── AgentLab.vue             # Agent 实验室
│   │   │   │   ├── AgentMonitoring.vue      # Agent 监控
│   │   │   │   ├── AgentPrompts.vue         # Prompt 管理
│   │   │   │   ├── Dashboard.vue            # 管理控制台
│   │   │   │   ├── GoalConversations.vue    # 目标对话管理
│   │   │   │   ├── PlatformStats.vue        # 平台统计
│   │   │   │   └── Users.vue                # 用户管理
│   │   │   ├── guest/                 # 访客页面（新增）
│   │   │   │   └── GuestLearning.vue        # 访客学习
│   │   │   ├── Achievements.vue           # 成就系统
│   │   │   ├── AITutor.vue                # AI 辅导
│   │   │   ├── Dashboard.vue              # 控制台
│   │   │   ├── DialogueLearningPage.vue   # 对话学习页（新增）
│   │   │   ├── GoalConversation.vue       # 目标对话
│   │   │   ├── Home.vue                   # 首页
│   │   │   ├── LearningPage.vue           # 学习页面
│   │   │   ├── LearningPathDetail.vue     # 路径详情
│   │   │   ├── LearningPaths.vue          # 路径列表
│   │   │   ├── LearningState.vue          # 学习状态追踪
│   │   │   ├── LearningStateDashboard.vue # 学习状态仪表板（新增）
│   │   │   ├── Login.vue                  # 登录
│   │   │   ├── Profile.vue                # 个人中心
│   │   │   ├── QuestionCardDemo.vue       # 问题卡片演示（新增）
│   │   │   ├── Register.vue               # 注册
│   │   │   └── TaskDetail.vue             # 任务详情
│   │   ├── stores/            # Pinia 状态管理
│   │   │   └── user.ts
│   │   ├── router/            # 路由配置
│   │   │   └── index.ts
│   │   ├── services/          # 服务层（新增）
│   │   ├── styles/            # 样式
│   │   │   ├── main.css
│   │   │   └── tremor-theme.css
│   │   ├── utils/             # 工具函数
│   │   │   ├── api.ts
│   │   │   └── request.ts
│   │   ├── types/             # TypeScript 类型
│   │   ├── assets/            # 静态资源
│   │   ├── App.vue            # 根组件
│   │   └── main.ts            # 入口文件
│   ├── public/                # 静态资源
│   ├── node_modules/
│   ├── package.json
│   ├── tsconfig.json
│   ├── vite.config.ts
│   └── .env.example           # 环境变量示例
│
├── docs/                      # 文档
│   ├── theory/                # 教育理论基础
│   │   ├── learning-platform-theory.md  # 完整教育理论框架（1.4 万字）
│   │   └── LEARNING_PHILOSOPHY_V2.md
│   ├── learning-paths/        # 学习路径示例
│   │   └── learning-path-python-chatgpt.md  # Python 学习路径（2.1 万字）
│   ├── architecture/          # 架构设计 (8 个文档)
│   │   ├── ARCHITECTURE_V2.md
│   │   ├── ARCHITECTURE_ROADMAP.md
│   │   ├── learning-goal-decomposition.md
│   │   ├── learning-assessment.md
│   │   ├── learning-path-marketplace.md
│   │   ├── ai-tutoring-system.md
│   │   ├── FOUR_SYSTEMS_DESIGN.md
│   │   └── OPEN_SOURCE_SYSTEM_DESIGN.md
│   ├── admin-lab/             # 管理实验室（新增）
│   │   └── ADMIN_LAB_SPEC.md
│   ├── progress/              # 进度文档
│   │   └── goal-conversation-implementation.md
│   ├── research/              # 研究资料 (6 个文档)
│   │   ├── learning-state-tracking-system.md  # LSS/KTL/LF/LSB 模型
│   │   ├── CHATGPT_EDU_RESEARCH.md
│   │   ├── RESEARCH_TEACHING_PHILOSOPHY.md
│   │   ├── RESEARCH_REPORT_2026.md
│   │   ├── VIDEO_UNDERSTANDING_RAG.md
│   │   └── FUTURE_MULTIMEDIA_FLOW.md
│   ├── design/                # 设计文档（新增）
│   ├── guides/                # 指南（新增）
│   ├── agent-plugin-architecture.md   # Agent 插件架构（新增）
│   ├── GUEST_MODE_SPEC_V2.md          # 访客模式规范 v2（新增）
│   └── test-user-simulation-plan.md   # 测试用户模拟计划（新增）
│
├── memory/                    # 记忆文件
│   ├── 2026-02-12.md
│   └── 2026-02-24.md
│
├── assets/                    # 资源文件
│
├── nginx/                     # Nginx 配置（新增）
│   ├── nginx.conf
│   └── ssl/
│
├── scripts/                   # 部署脚本（新增）
│   ├── generate-ssl-cert.sh
│   └── init-database.sh
│
├── .iflow/                    # iFlow 配置
│   └── agents/
│       └── ui-ux-designer.md
│
├── docker-compose.yml         # Docker Compose 配置（新增）
├── Dockerfile                 # Docker 镜像（新增）
├── deploy.ps1                 # Windows 部署脚本
├── deploy.sh                  # Linux/Mac 部署脚本
├── start-dev.ps1              # Windows 开发启动脚本
├── start-dev.bat              # Windows 开发启动批处理
└── health-check.ps1           # 健康检查脚本
```

---

## 快速开始

### 前置要求

- Node.js >= 18.x
- PostgreSQL 数据库（生产环境）
- AI 服务（NewAPI + deepseek-chat/Gemini）
- Docker 20.10+（生产部署）
- Docker Compose 2.0+（生产部署）

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
# 服务器配置
NODE_ENV=development
PORT=3001

# 数据库配置（开发用 SQLite）
DATABASE_URL="file:./dev.db"

# JWT 配置
JWT_SECRET=your-super-secret-jwt-key
JWT_EXPIRES_IN=7d

# AI 服务配置
AI_API_URL=http://101.43.146.102:30001
AI_API_KEY=sk-your-api-key
AI_MODEL=deepseek-chat

# 日志配置
LOG_LEVEL=debug

# ContentAgent 配置
CONTENT_AGENT_CACHE_ENABLED=true
CONTENT_AGENT_CACHE_TTL=3600000
CONTENT_AGENT_MAX_ROUNDS=8
```

#### 前端配置

复制 `frontend/.env.example` 为 `frontend/.env`：

```bash
VITE_API_BASE_URL=http://localhost:3001/api
VITE_APP_TITLE=AI 学习平台
VITE_APP_VERSION=3.0.0
```

### 初始化数据库

```bash
cd backend
npx prisma generate
npx prisma db push
```

### 启动开发服务器

#### 方式一：使用启动脚本（推荐）

```powershell
# Windows PowerShell
.\start-dev.ps1

# 或批处理
.\start-dev.bat
```

脚本会自动：
1. 检查并清理端口占用（3001, 5173）
2. 启动后端服务（等待就绪）
3. 启动前端服务
4. 打开浏览器

#### 方式二：手动启动

**后端**：
```bash
cd backend
npm run dev
```

后端运行在 http://localhost:3001

**前端**：
```bash
cd frontend
npm run dev
```

前端运行在 http://localhost:5173

---

## 开发命令

### 后端

```bash
cd backend

npm run dev          # 开发模式（热重载）
npm run build        # 构建生产版本
npm run start        # 运行生产版本
npm run test         # 运行测试（Jest）
npm run test:watch   # 测试监听模式
npm run lint         # 代码检查
npm run lint:fix     # 自动修复代码问题

# Prisma 相关
npx prisma generate  # 生成 Prisma 客户端
npx prisma db push   # 同步 Schema 到数据库
npx prisma migrate dev  # 创建并应用迁移
npx prisma studio    # 数据库管理界面
npm run prisma:generate  # 通过 npm 脚本生成
npm run prisma:migrate  # 通过 npm 脚本迁移
npm run prisma:studio    # 通过 npm 脚本打开管理界面
```

### 前端

```bash
cd frontend

npm run dev          # 开发模式（热重载）
npm run build        # 构建生产版本
npm run preview      # 预览生产版本
npm run lint         # 代码检查（自动修复）
npm run format       # 代码格式化
```

### 快速启动脚本

```powershell
# Windows PowerShell - 一键启动开发环境
.\start-dev.ps1

# Windows 批处理
.\start-dev.bat
```

脚本会自动：
1. 检查并清理端口占用（3001, 5173）
2. 启动后端服务（等待就绪）
3. 启动前端服务
4. 打开浏览器

### Docker 部署（生产环境）

```bash
# 构建并启动
docker compose build
docker compose up -d

# 查看日志
docker compose logs -f

# 数据库迁移
docker compose exec backend npx prisma migrate deploy

# 停止服务
docker compose down
```

---

## 核心功能模块

### 1. 用户认证系统

- 用户注册/登录
- JWT 令牌认证
- 访客模式（无需注册即可体验）
- 邮箱绑定（访客转正式用户）
- 用户 Profile 管理
- 权限控制

**API 端点**：
- `POST /api/auth/register` - 注册
- `POST /api/auth/login` - 登录
- `GET /api/users/me` - 获取当前用户信息
- `POST /api/guest-binding/bind` - 访客邮箱绑定

### 2. 学习目标分解系统

将用户的模糊学习目标分解为具体可执行的学习任务

**流程**：
1. AI 分析用户目标（学科、水平、时间约束）
2. 评估用户背景（当前水平、时间投入、学习风格）
3. 从知识图谱查询学习路径
4. 划分学习阶段和具体任务
5. 生成学习计划

**API 端点**：
- `POST /api/learning/goals` - 创建学习目标
- `POST /api/goal-conversation` - 对话式收集学习目标
- `GET /api/learning/paths` - 获取学习路径列表

### 3. 学习执行系统

- 学习路径管理
- 任务完成追踪
- 学习时间记录
- 学习笔记
- 对话式学习（Round-based）
- 实时反馈

**API 端点**：
- `GET /api/learning/paths/:id` - 获取学习路径详情
- `GET /api/learning/tasks/:id` - 获取任务详情
- `PATCH /api/learning/tasks/:id` - 更新任务状态
- `POST /api/sessions/start` - 开始学习会话
- `POST /api/sessions/:id/end` - 结束学习会话

### 4. 学习状态追踪系统（LSS/KTL/LF/LSB）

借鉴 Intervals.icu 的运动量化模型，科学追踪和管理学习状态

**核心指标**：
- **LSS (Learning Stress Score)** - 学习压力评分（基于任务难度、时长、认知负荷等）
- **KTL (Knowledge Training Load)** - 知识掌握度（长期积累，42 天衰减因子 0.95）
- **LF (Learning Fatigue)** - 学习疲劳度（短期累计，7 天衰减因子 0.70）
- **LSB (Learning State Balance)** - 学习状态值 = KTL - LF

**EWMA 算法**：
- 使用指数加权移动平均（Exponentially Weighted Moving Average）
- 动态调整学习状态评估
- 学生基线追踪（响应时间、消息长度、AI 评分等）

**API 端点**：
- `GET /api/state/current` - 获取当前学习状态
- `GET /api/state/trends` - 获取学习趋势
- `POST /api/state/calculate` - 计算学习指标
- `GET /api/metrics/student-baseline` - 获取学生基线

### 5. ZPD 分层 AI 辅导系统

基于最近发展区理论的分层 AI 辅导

**辅导策略**：
| 用户阶段 | AI 辅导方式 |
|---------|-----------|
| 新手（Novice, 0-99 XP） | 完整答案 + 详细解释 + 代码示例 |
| 高级初学者（Advanced Beginner, 100-299 XP） | 提示关键步骤 + 提供参考资料 |
| 胜任（Competent, 300-599 XP） | 引导思考 + 指出方向 + 不给答案 |
| 精通（Proficient, 600-999 XP） | 讨论方案 + 优化建议 + 共同探索 |
| 专家（Expert, 1000+ XP） | 深度交流 + 挑战性提问 |

**API 端点**：
- `POST /api/ai/zpd-tutor` - ZPD 分层辅导
- `POST /api/ai-teaching/dialogue` - 对话式教学

### 6. 成就系统

- 14 个预定义成就
- 自动检测和解锁
- XP 奖励系统
- 徽章展示

**API 端点**：
- `GET /api/achievements/my-achievements` - 获取我的成就
- `GET /api/achievements/all` - 获取所有成就及状态
- `POST /api/achievements/check` - 触发成就检测

### 7. 学习报告系统

- 周报生成
- 月报生成
- 学习数据统计
- 智能建议

**API 端点**：
- `GET /api/reports/generate` - 生成学习报告（weekly/monthly）
- `GET /api/reports/history` - 获取报告历史

### 8. ContentAgent 系统（新增）

智能内容生成 Agent，支持多轮对话式内容生成

**版本演进**：
- v1: 基础内容生成
- v3: 支持缓存、多轮对话
- v5: 最新优化版本

**核心功能**：
- 对话式内容生成
- 缓存优化
- 多轮对话管理
- 用户反馈收集

**API 端点**：
- `POST /api/agents/content-agent` - 调用 ContentAgent
- `POST /api/feedback/submit` - 提交内容反馈

### 9. Agent 系统（新增）

多 Agent 协作系统，支持插件化扩展

**Agent 类型**：
- `content-agent`: 内容生成
- `tutor-agent`: AI 辅导
- `path-agent`: 路径生成
- `progress-agent`: 进度跟踪
- `coordinator`: 协调 Agent

**核心组件**：
- Agent 注册表
- 插件系统
- Prompt 管理
- 执行日志
- 性能监控

**API 端点**：
- `GET /api/agents` - 获取 Agent 列表
- `POST /api/agents/register` - 注册 Agent
- `POST /api/agents/:id/call` - 调用 Agent
- `GET /api/agents/logs` - 获取 Agent 日志
- `GET /api/admin/agent-monitoring` - Agent 监控

### 10. Arena 竞技场系统（新增）

多 Agent 对比评估系统

**核心功能**：
- 创建 Arena 会话
- 多 Agent 并行执行
- 对比评估
- 反馈收集
- 优化建议生成

**数据模型**：
- `arena_sessions`: Arena 会话
- `arena_personas`: Agent 角色
- `arena_extractions`: 提取内容
- `arena_generations`: 生成内容
- `arena_dialogues`: 对话记录
- `arena_evaluations`: 评估结果
- `arena_optimizations`: 优化建议

**API 端点**：
- `POST /api/admin/arena/sessions` - 创建 Arena 会话
- `GET /api/admin/arena/sessions/:id` - 获取会话详情
- `POST /api/admin/arena/sessions/:id/evaluate` - 进行评估

### 11. AB 测试系统（新增）

科学的 AB 测试框架

**核心功能**：
- 创建 AB 测试
- 流量分配
- 结果追踪
- 数据分析

**数据模型**：
- `ab_test`: AB 测试定义
- `ab_test_result`: 测试结果

**API 端点**：
- `POST /api/ab-testing/tests` - 创建 AB 测试
- `GET /api/ab-testing/tests/:id` - 获取测试详情
- `POST /api/ab-testing/tests/:id/result` - 提交测试结果

### 12. 访客系统（新增）

无需注册即可体验核心功能

**核心功能**：
- 访客会话管理
- 邮箱绑定（转正式用户）
- 学习记录保存
- Magic Link 验证

**数据模型**：
- `guest_conversations`: 访客对话
- `guest_learning_paths`: 访客学习路径
- `guest_email_bindings`: 访客邮箱绑定

**API 端点**：
- `POST /api/guest-binding/init` - 初始化访客会话
- `POST /api/guest-binding/send-link` - 发送 Magic Link
- `POST /api/guest-binding/verify` - 验证 Magic Link

### 13. 反馈系统（新增）

多维度用户反馈收集

**反馈维度**：
- 总体评分（1-5 星）
- 帮助性评分
- 清晰度评分
- 难度评分
- 文字评论
- 建议
- 困惑点

**数据模型**：
- `content_feedback`: 内容反馈

**API 端点**：
- `POST /api/feedback/submit` - 提交反馈
- `GET /api/feedback/:sessionId` - 获取反馈历史

### 14. 管理端系统（新增）

完整的管理后台

**管理功能**：
- 用户管理
- 学习路径管理
- 目标对话管理
- Agent 监控
- Prompt 管理
- Arena 管理
- 平台数据统计

**管理端页面**：
- `/admin/dashboard` - 管理控制台
- `/admin/users` - 用户管理
- `/admin/goal-conversations` - 目标对话管理
- `/admin/agent-monitoring` - Agent 监控
- `/admin/agent-lab` - Agent 实验室
- `/admin/agent-prompts` - Prompt 管理
- `/admin/arena` - Arena 管理
- `/admin/platform` - 平台统计

---

## 教育理论基础

### 6 大基石理论

1. **认知负荷理论** - 工作记忆容量有限（7±2），避免信息过载
2. **自我导向学习** - 成年人自主选择学习目标和方法
3. **Dreyfus 五阶段模型** - 技能发展：新手→高级初学者→胜任→精通→专家
4. **最近发展区 + 支架** - 学习者"做不了"和"在帮助下能做到"之间的区域
5. **形成性评估** - 学习过程中持续评估，即时反馈
6. **刻意练习** - 针对弱点刻意突破，专注 + 反馈 + 走出舒适区

详见：`docs/theory/learning-platform-theory.md`

---

## 开发规范

### 代码风格

- **TypeScript**: 严格模式，使用类型定义
- **ESLint**: 遵循 Airbnb 风格指南
- **Prettier**: 统一代码格式

### API 设计规范

- RESTful 风格
- 统一响应格式：
  ```json
  {
    "success": true,
    "data": {...}
  }
  ```
- 错误响应：
  ```json
  {
    "error": {
      "message": "错误描述",
      "status": 400
    }
  }
  ```

### Git 提交规范

```
feat: 新功能
fix: 修复 bug
docs: 文档更新
style: 代码格式调整
refactor: 重构
test: 测试相关
chore: 构建/工具相关
```

### 命名约定

- **文件名**: kebab-case（如 `learning.service.ts`）
- **类名**: PascalCase（如 `LearningService`）
- **函数/变量**: camelCase（如 `calculateMetrics`）
- **常量**: UPPER_SNAKE_CASE（如 `JWT_SECRET`）

---

## Agent 编码指南

### 开发命令

**后端 (cd backend):**
```bash
npm run dev              # 开发模式（热重载）
npm run build            # 构建生产版本
npm run lint             # ESLint 检查
npm run lint:fix         # ESLint 自动修复
npm run test             # 运行所有测试
npm run test:watch       # 测试监听模式
npm test -- --testNamePattern="test name"  # 运行单个测试
npm test -- src/__tests__/auth.test.ts     # 运行指定文件
npx prisma generate      # 生成 Prisma 客户端
npx prisma db push       # 同步 Schema
```

**前端 (cd frontend):**
```bash
npm run dev              # 开发模式
npm run build            # 构建生产版本
npm run lint             # ESLint 检查 + 自动修复
npm run format           # Prettier 格式化
```

### 代码风格

**TypeScript 规范:**
- 严格模式：启用 `strict: true`
- 避免 `any`，使用 `unknown` 或具体类型
- 接口命名：PascalCase（如 `UserProfile`）
- 类型别名：PascalCase（如 `AuthResponse`）
- 优先使用 `interface` 定义对象结构

**命名规范:**
| 类型 | 规范 | 示例 |
|------|------|------|
| 文件名 | kebab-case | `auth.service.ts` |
| 类名 | PascalCase | `AuthService` |
| 函数/变量 | camelCase | `getUserById` |
| 常量 | UPPER_SNAKE_CASE | `MAX_RETRY_COUNT` |
| 接口/类型 | PascalCase | `interface UserData` |
| Vue 组件 | PascalCase | `UserProfile.vue` |

**导入顺序:**
1. Node.js 内置模块（`import express from 'express'`）
2. 第三方库（`import { z } from 'zod'`）
3. 项目模块（`import authService from '../services/auth/auth.service'`）
4. 类型导入（`import type { User } from '@/types'`）

**错误处理模式:**
```typescript
// 后端：使用 try-catch + next(error)
router.post('/endpoint', async (req, res, next) => {
  try {
    const result = await service.method();
    res.json({ success: true, data: result });
  } catch (error: any) {
    if (error.name === 'ZodError') {
      return res.status(400).json({ success: false, error: { message: '验证失败', details: error.errors } });
    }
    next(error);
  }
});

// 前端：使用 async/await + try-catch
try {
  const response = await api.post('/endpoint', data);
  return response.data;
} catch (error: any) {
  ElMessage.error(error.message);
  throw error;
}
```

**API 响应格式:**
```typescript
// 成功
res.json({ success: true, data: result });

// 错误
res.status(400).json({
  success: false,
  error: { message: '错误描述', details: {} }
});
```

**Vue 组件规范:**
- 使用 `<script setup lang="ts">` 组合式 API
- Props 使用 `defineProps<{ title: string }>()` 类型定义
- 组件名：PascalCase 文件名
- 事件命名：kebab-case（`@click-handler`）

**代码组织:**
- 后端路由：`src/routes/` - 处理 HTTP 请求
- 后端服务：`src/services/` - 业务逻辑
- 后端中间件：`src/middleware/` - 请求处理
- 前端 API：`src/api/` - HTTP 请求封装
- 前端组件：`src/components/` - 可复用组件
- 前端视图：`src/views/` - 页面级组件

---

## 重要文档

| 文档 | 路径 | 说明 |
|------|------|------|
| 教育理论框架 | `docs/theory/learning-platform-theory.md` | 1.4 万字完整理论体系 |
| 学习状态追踪 | `docs/research/learning-state-tracking-system.md` | LSS/KTL/LF/LSB 模型 |
| 学习目标分解 | `docs/architecture/learning-goal-decomposition.md` | 目标分解算法 |
| 四大系统设计 | `docs/architecture/FOUR_SYSTEMS_DESIGN.md` | 四大核心系统设计 |
| 系统架构 v2 | `docs/architecture/ARCHITECTURE_V2.md` | 架构设计文档 |
| AI 辅导系统 | `docs/architecture/ai-tutoring-system.md` | ZPD 分层辅导设计 |
| 开源系统设计 | `docs/architecture/OPEN_SOURCE_SYSTEM_DESIGN.md` | 开源社区设计 |
| Agent 插件架构 | `docs/agent-plugin-architecture.md` | Agent 插件系统设计 |
| 访客模式规范 | `docs/GUEST_MODE_SPEC_V2.md` | 访客模式完整规范 |
| 管理实验室 | `docs/admin-lab/ADMIN_LAB_SPEC.md` | 管理端设计规范 |
| API 文档 | `API.md` | 完整 API 参考 |
| 开发指南 | `DEVELOPMENT.md` | 开发环境配置 |
| 部署指南 | `DEPLOYMENT.md` | 生产环境部署 |
| 用户指南 | `USER_GUIDE.md` | 用户使用说明 |
| MVP 报告 | `MVP_REPORT.md` | MVP 开发报告 |
| 进度追踪 | `PROGRESS.md` | 开发进度记录 |
| 变更日志 | `CHANGELOG.md` | 版本变更记录 |

---

## 常见问题

### Q: 如何重置数据库？

```bash
cd backend
npx prisma migrate reset
```

### Q: 如何查看数据库内容？

```bash
cd backend
npx prisma studio
```

### Q: 后端启动失败，端口被占用？

```powershell
# Windows PowerShell
Get-NetTCPConnection -LocalPort 3001 | Select-Object OwningProcess
# 然后杀掉进程
Stop-Process -Id <进程 ID>

# 或使用启动脚本（自动处理端口占用）
.\start-dev.ps1
```

### Q: AI 服务连接失败？

1. 检查 NewAPI 服务是否运行：`http://101.43.146.102:30001`
2. 检查 `.env` 中的 `AI_API_URL` 和 `AI_API_KEY` 配置
3. 查看后端日志获取详细错误信息

### Q: 如何启用访客模式？

访客模式默认启用，用户无需注册即可访问：
- `/guest/learning` - 访客学习页面
- `/guest/goal-conversation` - 访客目标对话

### Q: 如何查看 Agent 监控数据？

访问管理端：
- `/admin/agent-monitoring` - Agent 监控仪表板
- API: `GET /api/admin/agent-monitoring/metrics`

### Q: 如何进行 AB 测试？

1. 创建 AB 测试：`POST /api/ab-testing/tests`
2. 配置变体和流量分配
3. 提交测试结果：`POST /api/ab-testing/tests/:id/result`
4. 分析结果：`GET /api/ab-testing/tests/:id/results`

---

## 项目状态

**整体完成度**: v3.0 发布 🎉

### 已完成 ✅

#### 理论基础
- ✅ 教育理论框架（1.4 万字）
- ✅ 学习目标分解算法设计
- ✅ 学习状态追踪系统理论（LSS/KTL/LF/LSB）
- ✅ Python 学习路径示例（2.1 万字）

#### 后端系统 (100%)
- ✅ Node.js + Express + TypeScript 框架
- ✅ Prisma ORM + SQLite/PostgreSQL 数据库（40 个模型）
- ✅ JWT 认证系统 + 访客认证
- ✅ 25 个 API 路由文件，200+ API 端点
- ✅ Agent 系统（多 Agent 协作 + 插件化）
- ✅ Arena 竞技场系统
- ✅ AB 测试系统
- ✅ 反馈系统
- ✅ 缓存服务
- ✅ EWMA 算法服务
- ✅ 学生基线服务
- ✅ 用户管理 API
- ✅ 学习路径生成 API
- ✅ 学习执行系统 API
- ✅ 学习会话记录 API
- ✅ 学习状态追踪 API
- ✅ ZPD 分层 AI 辅导 API
- ✅ 成就系统 API（14 个成就）
- ✅ 学习报告 API（周报/月报）

#### 前端系统 (100%)
- ✅ Vue3 + TypeScript + Vite 5 框架
- ✅ Element Plus UI 组件库
- ✅ Pinia 状态管理
- ✅ 18 个页面视图
- ✅ 管理端完整页面（8 个）
- ✅ 访客系统页面
- ✅ 用户认证（登录/注册）
- ✅ Dashboard 控制台
- ✅ 学习路径列表和详情
- ✅ 任务详情页（含计时器、笔记）
- ✅ AI 辅导聊天界面
- ✅ 目标对话式收集
- ✅ 学习状态追踪可视化
- ✅ 成就系统展示
- ✅ 对话学习页面
- ✅ 学习状态仪表板
- ✅ 问题卡片组件
- ✅ 反馈对话框
- ✅ 主题切换器

#### 数据库设计 (100%)
- ✅ 28 个 Prisma 模型
- ✅ 用户和认证模型
- ✅ 学习路径模型（LearningPath, Week, Task）
- ✅ 学习会话和追踪模型
- ✅ 成就和指标模型
- ✅ Agent 系统模型
- ✅ Arena 系统模型
- ✅ AB 测试模型
- ✅ 访客系统模型
- ✅ 反馈系统模型

#### DevOps (100%)
- ✅ Docker Compose 配置
- ✅ Dockerfile 构建
- ✅ Nginx 反向代理配置
- ✅ SSL 证书配置脚本
- ✅ 部署脚本（Windows/Linux）
- ✅ 健康检查脚本
- ✅ 环境变量配置

### 进行中 🚧

- 🚧 Demo 课程内容充实
  - 新媒体运营学习路径
  - AI 工具应用学习路径
  - 数据分析学习路径
- 🚧 UI/UX 优化
- 🚧 端到端测试覆盖

### 待开始 ⏳

- ⏳ 更多学习路径开发
  - 英语学习路径
  - 职场写作学习路径
  - 产品思维学习路径
- ⏳ 社区功能
- ⏳ 移动端适配
- ⏳ 生产环境部署

---

## 联系方式

- 项目负责人：老哥
- AI 助理：小白 🤖

---

## 相关文件

| 文件 | 说明 |
|------|------|
| `TODO.md` | 开发任务清单（待办事项） |
| `PROGRESS.md` | 详细开发进度追踪 |
| `TODAY_SUMMARY.md` | 今日工作总结 |
| `memory/` | AI 记忆文件目录 |

---

*文档版本：v3.0*
*最后更新：2026-03-22*
*更新内容：同步 v3.0 项目状态 - Agent 系统、Arena 竞技场、AB 测试、访客系统、管理端*

