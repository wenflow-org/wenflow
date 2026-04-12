# AI学习平台 - 实施计划

> 从规划到落地的技术实施路线图

**开始日期**: 2026-02-11
**目标**: 3个月内完成MVP，6个月内上线内测版本

---

## 📋 技术选型

### 后端

**选择**: Node.js + Express + TypeScript

**理由**:
- ✅ 快速开发，适合MVP
- ✅ 统一的语言栈（前后端都是TS）
- ✅ NPM生态丰富
- ✅ 便于后续扩展

**核心依赖**:
```
- express: Web框架
- typescript: 类型系统
- prisma: ORM工具（PostgreSQL）
- openai: AI API客户端（兼容GLM）
- zod: 数据验证
- winston: 日志系统
- jsonwebtoken: 认证
- bcrypt: 密码加密
```

### 前端

**选择**: Vue3 + TypeScript + Vite

**理由**:
- ✅ 学习曲线平缓
- ✅ 性能优秀
- ✅ 中文社区活跃
- ✅ 适合渐进式开发

**核心依赖**:
```
- vue: 3.x
- vue-router: 路由
- pinia: 状态管理
- element-plus: UI组件库
- axios: HTTP客户端
- chart.js: 数据可视化
```

### 数据库

**选择**: PostgreSQL

**理由**:
- ✅ 开源免费
- ✅ 性能稳定
- ✅ 支持JSON字段（灵活数据）
- ✅ 适合SaaS场景

**扩展**:
- Neo4j: 知识图谱（可选，后期）
- Chroma: 向量数据库（AI检索）

### AI服务

**选择**: 本地deepseek-chat + OpenAI兼容接口

**理由**:
- ✅ 已有NewAPI服务
- ✅ 成本可控
- ✅ 数据隐私
- ✅ 响应速度快

**已有配置**:
```
地址: http://localhost:3000
API Key: ***REVOKED_KEY_REMOVED***
模型: deepseek-chat
```

---

## 🎯 MVP核心功能

### 第一阶段：基础框架（Week 1-2）

#### 1.1 项目初始化
- [ ] 初始化Git仓库
- [ ] 配置前后端项目结构
- [ ] 配置ESLint + Prettier
- [ ] 配置环境变量管理
- [ ] 配置Docker（可选）

#### 1.2 数据库设计
- [ ] 设计数据库Schema
- [ ] 使用Prisma初始化数据库
- [ ] 创建核心表结构
- [ ] 配置迁移脚本

#### 1.3 用户系统
- [ ] 用户注册/登录
- [ ] JWT认证
- [ ] 用户Profile管理
- [ ] 权限系统基础

### 第二阶段：学习目标分解（Week 3-4）

#### 2.1 AI对话接口
- [ ] AI对话API封装
- [ ] 流式响应支持
- [ ] 上下文管理
- [ ] 成本追踪

#### 2.2 目标分析
- [ ] 用户目标解析
- [ ] 背景评估（对话式）
- [ ] 能力级别判断
- [ ] 学习风格识别

#### 2.3 学习路径生成
- [ ] 知识图谱查询
- [ ] 学习阶段划分
- [ ] 任务生成
- [ ] 时间规划

#### 2.4 路径展示
- [ ] 学习路径UI
- [ ] 任务清单展示
- [ ] 进度追踪
- [ ] 任务详情

### 第三阶段：学习执行（Week 5-6）

#### 3.1 任务系统
- [ ] 任务状态管理
- [ ] 任务完成标记
- [ ] 学习时间记录
- [ ] 学习笔记

#### 3.2 AI辅导
- [ ] ZPD分层策略
- [ ] 代码/内容辅导
- [ ] 错误分析
- [ ] 提示系统

#### 3.3 学习状态追踪
- [ ] LSS计算
- [ ] KTL追踪
- [ ] LF监控
- [ ] LSB计算

#### 3.4 数据可视化
- [ ] 学习进度图表
- [ ] 能力雷达图
- [ ] 学习趋势图
- [ ] 建议面板

### 第四阶段：评估与优化（Week 7-8）

#### 4.1 能力评估
- [ ] 能力清单管理
- [ ] 成就系统
- [ ] 徽章系统
- [ ] XP系统

#### 4.2 反馈系统
- [ ] 学习报告生成
- [ ] 薄弱分析
- [ ] 改进建议
- [ ] 路径动态调整

#### 4.3 内容管理
- [ ] 学习路径模板
- [ ] 任务库
- [ ] 资源库
- [ ] 内容标签

---

## 🗄️ 数据库Schema设计

### 核心表

#### 1. users
```sql
CREATE TABLE users (
  id VARCHAR(36) PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  name VARCHAR(100),
  avatar_url VARCHAR(500),

  -- Profile
  skill_level VARCHAR(20), -- beginner/intermediate/advanced
  learning_style VARCHAR(20), -- project-based/theoretical/mixed
  time_per_day VARCHAR(20), -- 30min/1h/2h/4h
  learning_goal TEXT,

  -- 系统字段
  xp INTEGER DEFAULT 0,
  level INTEGER DEFAULT 1,

  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

#### 2. learning_goals
```sql
CREATE TABLE learning_goals (
  id VARCHAR(36) PRIMARY KEY,
  user_id VARCHAR(36) NOT NULL REFERENCES users(id),
  description TEXT NOT NULL,
  subject VARCHAR(100),

  -- 生成的路径
  learning_path_id VARCHAR(36) REFERENCES learning_paths(id),

  -- 元数据
  status VARCHAR(20), -- planned/in_progress/completed/paused
  progress FLOAT DEFAULT 0,

  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

#### 3. learning_paths
```sql
CREATE TABLE learning_paths (
  id VARCHAR(36) PRIMARY KEY,
  user_id VARCHAR(36) NOT NULL REFERENCES users(id),
  name VARCHAR(200) NOT NULL,
  description TEXT,
  subject VARCHAR(100),

  -- 时间规划
  total_weeks INTEGER,
  estimated_hours INTEGER,

  -- AI参数
  ai_generated BOOLEAN DEFAULT true,
  ai_prompt_template TEXT,

  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

#### 4. weeks
```sql
CREATE TABLE weeks (
  id VARCHAR(36) PRIMARY KEY,
  learning_path_id VARCHAR(36) NOT NULL REFERENCES learning_paths(id),
  week_number INTEGER NOT NULL,
  title VARCHAR(200),
  description TEXT,
  learning_objectives JSONB,

  created_at TIMESTAMP DEFAULT NOW()
);
```

#### 5. tasks
```sql
CREATE TABLE tasks (
  id VARCHAR(36) PRIMARY KEY,
  week_id VARCHAR(36) NOT NULL REFERENCES weeks(id),
  user_id VARCHAR(36) NOT NULL REFERENCES users(id),

  title VARCHAR(200) NOT NULL,
  description TEXT,
  task_type VARCHAR(20), -- reading/practice/project/quiz

  -- 内容
  content_json JSONB, -- 灵活存储不同类型任务内容
  resources JSONB, -- 相关资源链接、文档等

  -- AI辅导配置
  ai_hints JSONB,
  ai_solution TEXT,

  -- 状态
  status VARCHAR(20), -- todo/in_progress/completed/skipped
  completion_rate FLOAT DEFAULT 0,

  -- 时间追踪
  estimated_minutes INTEGER,
  actual_minutes INTEGER DEFAULT 0,

  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  completed_at TIMESTAMP
);
```

#### 6. learning_sessions
```sql
CREATE TABLE learning_sessions (
  id VARCHAR(36) PRIMARY KEY,
  user_id VARCHAR(36) NOT NULL REFERENCES users(id),
  task_id VARCHAR(36) REFERENCES tasks(id),

  start_time TIMESTAMP NOT NULL,
  end_time TIMESTAMP,
  duration_minutes INTEGER,

  -- 学习状态追踪
  lss_score FLOAT, -- 学习压力评分
  subjective_difficulty INTEGER, -- 1-10主观难度
  notes TEXT,

  created_at TIMESTAMP DEFAULT NOW()
);
```

#### 7. ai_conversations
```sql
CREATE TABLE ai_conversations (
  id VARCHAR(36) PRIMARY KEY,
  user_id VARCHAR(36) NOT NULL REFERENCES users(id),
  session_type VARCHAR(20), -- goal_analysis/ tutoring/feedback

  messages JSONB NOT NULL, -- 对话历史
  context_json JSONB, -- 对话上下文

  -- AI配置
  model VARCHAR(50), -- deepseek-chat/gpt-4等
  tokens_used INTEGER,
  cost_usd FLOAT,

  created_at TIMESTAMP DEFAULT NOW()
);
```

#### 8. achievements
```sql
CREATE TABLE achievements (
  id VARCHAR(36) PRIMARY KEY,
  user_id VARCHAR(36) NOT NULL REFERENCES users(id),

  type VARCHAR(20), -- badge/milestone/completion
  title VARCHAR(100),
  description TEXT,
  icon_url VARCHAR(500),

  xp_reward INTEGER,

  earned_at TIMESTAMP DEFAULT NOW()
);
```

#### 9. learning_metrics
```sql
CREATE TABLE learning_metrics (
  id VARCHAR(36) PRIMARY KEY,
  user_id VARCHAR(36) NOT NULL REFERENCES users(id),

  -- 学习状态追踪指标
  lss_current FLOAT, -- 当前学习压力
  ktl_current FLOAT, -- 知识掌握度
  lf_current FLOAT, -- 学习疲劳度
  lsb_current FLOAT, -- 学习状态值

  -- 历史数据（用于计算）
  lss_history JSONB, -- 最近30次LSS记录
  session_history JSONB, -- 学习会话历史

  calculated_at TIMESTAMP DEFAULT NOW()
);
```

---

## 📁 项目结构

```
ai-learning-platform/
├── backend/                    # 后端代码
│   ├── src/
│   │   ├── config/            # 配置文件
│   │   ├── models/            # 数据模型
│   │   ├── routes/            # API路由
│   │   ├── services/          # 业务逻辑
│   │   │   ├── ai/           # AI服务
│   │   │   ├── learning/     # 学习相关
│   │   │   └── auth/         # 认证相关
│   │   ├── middleware/       # 中间件
│   │   ├── utils/            # 工具函数
│   │   └── types/            # TypeScript类型
│   ├── prisma/               # 数据库Schema
│   ├── package.json
│   └── tsconfig.json
│
├── frontend/                  # 前端代码
│   ├── src/
│   │   ├── components/       # 组件
│   │   ├── views/            # 页面
│   │   ├── stores/           # Pinia状态管理
│   │   ├── router/           # 路由配置
│   │   ├── api/              # API封装
│   │   ├── utils/            # 工具函数
│   │   └── types/            # TypeScript类型
│   ├── package.json
│   └── vite.config.ts
│
├── docs/                      # 文档（已有）
├── .gitignore
├── docker-compose.yml
└── README.md
```

---

## 🚀 Week 1 具体任务

### Day 1（今天）
- [x] 完成实施计划文档
- [ ] 选择技术栈（已完成）
- [ ] 初始化后端项目
- [ ] 初始化前端项目
- [ ] 配置Git仓库

### Day 2
- [ ] 设计数据库Schema
- [ ] 初始化Prisma
- [ ] 创建核心表结构
- [ ] 配置环境变量

### Day 3
- [ ] 实现用户认证API
- [ ] 实现JWT中间件
- [ ] 创建用户CRUD接口
- [ ] 单元测试

### Day 4
- [ ] 搭建前端基础框架
- [ ] 配置Vue Router
- [ ] 配置Pinia
- [ ] 实现登录/注册页面

### Day 5
- [ ] 实现AI对话接口
- [ ] 对接NewAPI
- [ ] 实现流式响应
- [ ] 测试对话功能

### Day 6-7
- [ ] 学习目标分解原型
- [ ] AI提示词优化
- [ ] 路径生成测试
- [ ] 前端展示

---

## 🎯 成功指标

### MVP验收标准
- ✅ 用户可以注册登录
- ✅ 用户可以输入学习目标
- ✅ 系统生成初步学习路径
- ✅ 用户可以查看学习进度
- ✅ AI可以解答学习问题
- ✅ 基础的数据可视化

### 性能指标
- 页面加载 < 2秒
- AI响应 < 5秒
- 支持100并发用户

---

## 📝 下一步行动

**立即执行**：
1. 初始化后端项目
2. 初始化前端项目
3. 配置开发环境
4. 创建数据库Schema

---

*文档版本: v1.0*
*最后更新: 2026-02-11*

