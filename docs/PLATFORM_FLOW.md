# AI 学习平台 - 完整流程与概念梳理

**文档目的**: 为 OpenCode 对齐代码提供完整参考
**最后更新**: 2026-03-23 21:56
**版本**: v1.2（首页审计 + 成就系统优化）

**重大变更**:

### v1.2 - 2026-03-23 21:56（首页审计决策）
- ✅ 确认平台符合 ZPD 支架式教学理论
- ✅ 确认 GoalConversation、学习路径、AI 辅导无需修改
- ⚠️ XP/成就系统从"奖励完成"改为"记录成长"
- 📚 理论依据：Vygotsky ZPD、Scaffolding、建构主义

### v1.1 - 2026-03-23 21:27（LSB 异步计算方案）
- LSB 计算从"实时公式"改为"Agent 异步计算"
- 学习过程中不显示 LSB，避免增加焦虑
- 课后展示：成就感 + 指导下次学习

---

## 📌 一、平台愿景与核心理念

### 1.1 核心定义

> **我们不教工具，我们教思维。有了思维，你自然会用好任何工具。**

### 1.2 爱因斯坦警告（1946）

**原文**：
> "原子释放出的力量改变了一切，除了我们的思维方式，因此我们正走向前所未有的灾难。"

**对 AI 时代教育的启示**：
- AI 释放的力量 ≈ 原子能（改变一切）
- 教育思维方式 ≈ 尚未改变
- 错位风险：用工业时代教育培养 AI 时代人才

### 1.3 平台使命

**不是**：
- ❌ 用 AI 工具提高传统学习效率
- ❌ 让学生更快记住更多知识
- ❌ AI 辅助应试

**而是**：
- ✅ 培养"新的思维方式"
- ✅ 用 AI 培养 AI 时代需要的能力
- ✅ 让教育跟上技术变革

### 1.4 核心能力培养

1. **问题定义能力**（而非知识记忆）
2. **系统思维能力**（而非单点解题）
3. **判断力**（而非标准答案）
4. **AI 协作力**（而非独立实现）
5. **创造力**（而非重复练习）

---

## 🗺️ 二、完整用户旅程

### 2.1 用户类型

| 类型 | 说明 | 入口 |
|-----|------|------|
| **游客** | 未登录用户，可体验核心功能 | Home.vue |
| **注册用户** | 完整功能，有学习记录 | Dashboard.vue |
| **管理员** | 后台管理，Agent 配置 | /admin/* |

### 2.2 核心流程（注册用户）

```
┌─────────────────────────────────────────────────────────────────┐
│                        用户学习主流程                            │
└─────────────────────────────────────────────────────────────────┘

[1] 登录/注册
    │
    ▼
[2] Dashboard（欢迎页 + 学习概览）
    │
    ├──→ 新手任务引导（仅新用户）
    │    1. 告诉 AI 你想探索什么
    │    2. 生成第一张学习地图
    │    3. 完成第一个小任务
    │
    ▼
[3] AI 规划（GoalConversation.vue）
    │   用户输入："我想学点什么"
    │   AI 苏格拉底式反问 → 澄清真实需求
    │   产出：学习目标 + 初步路径
    │
    ▼
[4] 学习路径生成（LearningPaths.vue）
    │   后端 Agent 生成阶段化路径
    │   结构：Stage → Task（不再按周切分）
    │
    ▼
[5] 学习执行（LearningPage.vue / TaskDetail.vue）
    │   ├── 阅读学习材料
    │   ├── 完成任务
    │   ├── AI 辅导（ZPD 分层提示）
    │   └── 状态追踪（LSB/LSS/KTL/LF）
    │
    ▼
[6] 状态反馈（CognitiveStatePanel.vue）
    │   实时计算认知状态
    │   触发干预建议（提示/解释/简化/休息）
    │
    ▼
[7] 成就系统（Achievements.vue）
    │   XP 经验值 + 等级提升
    │   学习时长统计
    │   完成率追踪
    │
    └──→ 返回 [3] 继续下一个任务/路径
```

### 2.3 游客流程

```
[访问首页] → [点击"开始提问"] → [游客模式 GoalConversation]
                                      │
                                      ▼
                              [生成预览路径]
                                      │
                                      ▼
                              [提示注册继续学习]
```

---

## 📊 三、核心概念与量化模型

### 3.1 三层认知参与度模型

```
┌─────────────────────────────────────────────────────────┐
│                  认知参与度（Cognitive Engagement）       │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  DKI (Deep)     深层认知参与                             │
│  ├─ 批判性思考                                          │
│  ├─ 知识迁移                                            │
│  └─ 原创问题创建                                        │
│                                                         │
│  MKI (Medium)   中层认知参与                             │
│  ├─ 概念理解                                            │
│  ├─ 模式识别                                            │
│  └─ 系统思考                                            │
│                                                         │
│  SKI (Surface)  表层认知参与                             │
│  ├─ 知识记忆                                            │
│  ├─ 简单应用                                            │
│  └─ 跟随指导                                            │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

**量化公式**：
```typescript
interface CognitiveEngagement {
  SKI: number; // 0-1，基于答题正确率/完成速度
  MKI: number; // 0-1，基于理解度自述/提问质量
  DKI: number; // 0-1，基于原创问题/知识迁移
}
```

### 3.2 学习状态量化（异步 Agent 计算）

**核心原则**:
- ❌ **不实时计算** - 学习过程中不显示 LSB，避免增加焦虑
- ✅ **课后计算** - 任务完成/课程结束时由 Agent 计算
- ✅ **成就感导向** - 学完后看到"哇我 LSB+5"
- ✅ **指导下次** - "上次 LSS 太高，下次降低难度"

**计算时机**:
| 触发事件 | 说明 |
|---------|------|
| `task:completed` | 任务完成时自动触发 |
| `session:end` | 课程结束时自动触发 |
| `user:request:review` | 用户主动请求评估 |

**Agent 输入上下文**:
```typescript
interface LSBCalculationContext {
  // 学习过程数据
  taskCompletion: number;    // 完成率 0-1
  accuracy: number;          // 正确率 0-1
  timeSpent: number;         // 实际用时（分钟）
  pauseCount: number;        // 暂停次数
  helpRequests: number;      // 求助次数
  
  // 交互质量
  chatMessages: number;      // 提问次数
  questionQuality?: number;  // 提问质量（AI 评估）
  
  // 历史对比
  previousLSB?: number[];    // 最近 3 次 LSB
  averageAccuracy?: number;  // 平均正确率
}
```

**Agent 输出**:
```typescript
interface LSBResult {
  lsb: number;               // -10~10，最终状态平衡值
  lss: number;               // 0-10，学习压力
  ktl: number;               // 0-10，知识负荷
  lf: number;                // 0-10，疲劳度
  confidence: number;        // 0-1，置信度
  reasoning: string;         // 人类可读的解释
  suggestion: string;        // 下次学习建议
}
```

**LSB 含义**:
| 范围 | 状态 | 说明 |
|-----|------|------|
| < 0 | 状态不佳 | 疲劳超过知识积累 |
| 0-2 | 状态一般 | 可以继续努力 |
| 2-5 | 状态良好 | 学习效果不错 |
| > 5 | 状态优秀 | 继续保持！ |

**展示场景**:
- ✅ 学习报告页（任务完成后）
- ✅ 成就页（历史趋势图）
- ✅ Dashboard（近 7 次平均 LSB）
- ❌ 学习过程中（不显示，避免焦虑）

**类比**:
- ❌ 健身时每分钟看"消耗多少卡路里"（焦虑）
- ✅ 健完身看"本次消耗 300 卡，很棒"（成就感）
- ✅ 看"下周建议增加重量"（指导）

### 3.3 干预决策逻辑（基于 Agent 计算结果）

**干预触发时机**: 任务完成后，Agent 产出 LSB 时同步给出

```typescript
interface InterventionStrategy {
  type: 'hint' | 'explanation' | 'example' | 'simplification' | 
        'challenge' | 'break' | 'encouragement' | 'redirection';
  priority: number;    // 1-5，1 最高
  content: string;     // 干预内容
  reasoning: string;   // 为什么给出这个干预
}

// Agent 决策示例（伪代码）
function decideIntervention(context: LSBCalculationContext): InterventionStrategy {
  if (context.accuracy < 0.5 && context.helpRequests > 5) {
    return {
      type: 'encouragement',
      priority: 2,
      content: '正确率不错，但求助有点频繁，下次先独立思考',
      reasoning: '求助次数过多可能影响深度思考'
    };
  }
  if (context.timeSpent > 60 && context.pauseCount > 5) {
    return {
      type: 'break',
      priority: 1,
      content: '学习时长较长，建议休息一下再继续',
      reasoning: '长时间学习可能降低效率'
    };
  }
  if (context.accuracy > 0.9 && context.questionQuality > 0.8) {
    return {
      type: 'challenge',
      priority: 3,
      content: '掌握得很好，下次可以尝试更高难度',
      reasoning: '高正确率 + 高质量提问表明可以进阶'
    };
  }
  return null;
}
```

### 3.4 Bloom 认知层级

```
层级 6: 创造 (Create)    - 设计新项目/提出原创问题
层级 5: 评估 (Evaluate)  - 批判性分析/价值判断
层级 4: 分析 (Analyze)   - 拆解结构/识别模式
层级 3: 应用 (Apply)     - 在新情境中使用知识
层级 2: 理解 (Understand)- 解释概念/举例说明
层级 1: 记忆 (Remember)  - 回忆事实/定义
```

---

## 🏗️ 四、系统架构

### 4.1 前端架构

```
frontend/
├── src/
│   ├── views/
│   │   ├── Home.vue                    # 首页（理念传达）
│   │   ├── Dashboard.vue               # 用户仪表盘
│   │   ├── GoalConversation.vue        # AI 目标对话
│   │   ├── LearningPaths.vue           # 学习路径列表
│   │   ├── LearningPathDetail.vue      # 路径详情
│   │   ├── LearningPage.vue            # 学习执行页
│   │   ├── TaskDetail.vue              # 任务详情（含 AI 辅导）
│   │   ├── LearningState.vue           # 学习状态页
│   │   ├── Achievements.vue            # 成就页
│   │   └── admin/                      # 后台管理
│   │
│   ├── components/
│   │   ├── CognitiveStatePanel.vue     # 认知状态面板
│   │   ├── LearningMetrics.vue         # 学习指标
│   │   ├── LoadCalendar.vue            # 学习日历
│   │   ├── QuestionCard.vue            # 问题卡片
│   │   └── home/                       # 首页组件
│   │       ├── EinsteinQuote.vue       # 爱因斯坦警告
│   │       ├── MindVsTool.vue          # 思维 vs 工具
│   │       ├── ProblemCreator.vue      # 问题创建器
│   │       └── CapabilityList.vue      # 核心能力列表
│   │
│   ├── api/
│   │   ├── learning.ts                 # 学习相关 API
│   │   ├── goal.ts                     # 目标对话 API
│   │   └── admin.ts                    # 后台 API
│   │
│   └── stores/
│       ├── user.ts                     # 用户状态
│       └── learning.ts                 # 学习状态
```

### 4.2 后端架构（待完善）

```
backend/
├── controllers/
│   ├── goal.controller.ts              # 目标对话
│   ├── path.controller.ts              # 学习路径
│   ├── task.controller.ts              # 任务管理
│   └── state.controller.ts             # 学习状态
│
├── services/
│   ├── agent/
│   │   ├── path.agent.ts               # 路径生成 Agent
│   │   ├── content.agent.ts            # 内容推荐 Agent
│   │   ├── tutor.agent.ts              # 辅导 Agent
│   │   └── progress.agent.ts           # 进度追踪 Agent
│   │
│   └── state/
│       ├── lsb.service.ts              # LSB 计算
│       └── intervention.service.ts     # 干预决策
│
└── models/
    ├── LearningPath.ts
    ├── Task.ts
    ├── LearningState.ts
    └── CognitiveEngagement.ts
```

### 4.3 事件总线（EduClaw 架构）

```
┌─────────────────────────────────────────────────────────┐
│                      事件总线架构                        │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  [Path Agent] ──→ path:generated ──→ [Progress Agent]  │
│       │                              │                  │
│       │                              ▼                  │
│       │                      更新学习进度                │
│       │                                                 │
│       ▼                                                 │
│  [Content Agent] ←─ task:started ←─ [User]             │
│       │                                                 │
│       │                              ▲                  │
│       │                              │                  │
│       └─→ content:recommended ──→ [Tutor Agent]        │
│                                                         │
│  [State Monitor] ──→ state:changed ──→ [所有 Agent]     │
│       │                                                 │
│       └─→ intervention:triggered ──→ [Tutor Agent]     │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

---

## 📄 五、关键页面功能清单

### 5.1 Home.vue（首页）

**目的**: 传达平台理念，引导用户注册

**核心模块**:
1. Hero 区域："世上最难的问题，是自己给自己出的题"
2. EinsteinQuote: 1946 年爱因斯坦警告
3. MindVsTool: 思维 (道) vs 工具 (技) 对比
4. ProblemCreator: 问题创建器入口
5. CapabilityList: 核心能力列表
6. Footer: 邀请注册

**CTA 按钮**:
- "开始提问" → /goal-conversation
- "这是什么？" → 滚动到理念区

---

### 5.2 Dashboard.vue（用户仪表盘）

**目的**: 学习概览 + 快速入口

**核心模块**:
1. 欢迎区域（新用户/老用户不同文案）
2. 新手任务条（仅新用户）
3. 统计卡片：
   - 等级 + XP 进度
   - 完成任务数
   - 学习时长
   - XP 经验值
4. 学习日历（LoadCalendar）
5. 学习指标（LearningMetrics）

**新用户判断逻辑**:
```typescript
const isNewUser = computed(() => {
  return (stats.value.tasks.completed === 0 && 
          stats.value.user.xp === 0);
});
```

---

### 5.3 GoalConversation.vue（AI 目标对话）

**目的**: 通过对话澄清用户真实学习目标

**核心流程**:
```
用户输入 → AI 苏格拉底式反问 → 用户澄清 → AI 总结 → 生成路径
```

**AI 策略**:
1. 不直接给答案，用反问引导
2. 追问"为什么想学这个"
3. 帮助区分"工具"和"思维"
4. 最终产出可执行的学习目标

**输出**:
```typescript
interface GoalOutput {
  originalRequest: string;    // 用户原始请求
  clarifiedGoal: string;      // 澄清后的目标
  why: string;                // 学习动机
  expectedOutcome: string;    // 期望结果
  timeCommitment: string;     // 时间投入
}
```

---

### 5.4 LearningPaths.vue（学习路径列表）

**目的**: 展示用户的学习路径

**数据结构**:
```typescript
interface LearningPath {
  id: string;
  name: string;
  description: string;
  stages: Stage[];  // 阶段（不再按周切分）
  status: 'active' | 'completed' | 'paused';
  progress: number; // 完成百分比
  createdAt: string;
}

interface Stage {
  id: string;
  title: string;
  tasks: Task[];
}
```

---

### 5.5 TaskDetail.vue（任务详情）

**目的**: 任务执行 + AI 辅导

**核心模块**:
1. 任务基本信息（标题/描述/预计时间）
2. AI 提示（aiHints）
3. 学习资源（resources）
4. 学习目标（week.learningObjectives）
5. AI 辅导聊天（ZPD 分层策略）
6. 学习计时器
7. 完成操作

**AI 辅导 ZPD 策略**:
```typescript
interface AITutorMessage {
  role: 'user' | 'assistant';
  content: string;
  hintLevel?: 1 | 2 | 3;  // 提示等级
}

// 提示等级说明
// 1: 轻微提示（方向性引导）
// 2: 中等提示（部分答案）
// 3: 完整解释（直接给答案）
```

---

### 5.6 CognitiveStatePanel.vue（认知状态面板）

**目的**: 展示课后学习状态报告（非实时）

**展示时机**: 任务完成后，在学习报告页显示

**输入指标**（由 Agent 计算后传入）:
```typescript
interface LearningStateMetrics {
  lss: number;         // 学习压力 0-10
  ktl: number;         // 知识负荷 0-10
  lf: number;          // 疲劳度 0-10
  lsb: number;         // 状态平衡值 -10~+10
  reasoning: string;   // AI 解释（为什么是这个 LSB）
  suggestion: string;  // 下次建议
}
```

**认知分析**:
```typescript
interface CognitiveAnalysisResult {
  cognitiveLevel: string;      // Bloom 层级
  levelScore: number;          // 1-6
  understanding: number;       // 理解度 0-1
  engagement: number;          // 参与度 0-1
  confusionPoints: string[];   // 困惑点
  emotionalState: string;      // 情绪状态
}
```

**干预建议**:
```typescript
interface InterventionStrategy {
  type: string;        // hint/explanation/example/simplification/challenge/break
  priority: number;
  content: string;
  reasoning: string;
}
```

**UI 结构**:
```vue
<template>
  <div class="learning-report">
    <!-- 本次状态 -->
    <div class="metrics-summary">
      <div class="metric lsb">
        <span class="label">LSB 状态平衡</span>
        <span class="value" :class="lsbClass">{{ state.lsb }}</span>
        <span class="reasoning">{{ state.reasoning }}</span>
      </div>
    </div>
    
    <!-- 下次建议 -->
    <div class="suggestion">
      <h3>下次学习建议</h3>
      <p>{{ state.suggestion }}</p>
    </div>
    
    <!-- 历史趋势 -->
    <div class="trend-chart">
      <h3>近 7 次学习趋势</h3>
      <!-- 折线图 -->
    </div>
  </div>
</template>
```

---

## 🔧 六、待完善功能清单

### 6.1 P0 - 核心功能深化

| 功能 | 现状 | 需要实现 |
|-----|------|---------|
| **认知参与度三层模型** | ❌ 未实现 | SKI/MKI/DKI 计算 + 存储 |
| **LSB Agent 异步计算** | ❌ 未实现 | Agent Prompt + 触发逻辑 + 持久化 |
| **学习报告页** | ❌ 未实现 | LearningReport.vue（课后展示 LSB） |
| **导航仪表盘** | ❌ 未实现 | 速度/变道/疲劳预警 |
| **苏格拉底反问** | ⚠️ 部分实现 | GoalConversation 完整策略 |

### 6.2 P1 - AI 辅导增强

| 功能 | 现状 | 需要实现 |
|-----|------|---------|
| **ZPD 分层提示** | ⚠️ 有框架 | 完整 3 层提示逻辑 |
| **问题质量评估** | ❌ 未实现 | 原创性/可行性/价值评分 |
| **状态同步** | ❌ 未实现 | 前端状态 → 后端存储 |

### 6.3 P2 - 体验优化

| 功能 | 现状 | 需要实现 |
|-----|------|---------|
| **Dashboard 横向滚动** | ⚠️ 待审计 | 布局修复 |
| **空状态引导** | ❌ 缺失 | 各页面空状态按钮 |
| **全局错误边界** | ❌ 缺失 | ErrorBoundary 组件 |

---

## 📋 七、API 接口清单

### 7.1 学习相关

```
GET  /api/learning/stats          # 获取学习统计
GET  /api/learning/paths          # 获取学习路径列表
GET  /api/learning/paths/:id      # 获取路径详情
POST /api/learning/paths/generate # 生成新路径
GET  /api/learning/tasks/:id      # 获取任务详情
POST /api/learning/tasks/:id/complete  # 完成任务
PUT  /api/learning/state          # 更新学习状态
```

### 7.2 目标对话

```
POST /api/goal/conversation       # 开始对话
POST /api/goal/conversation/:id/message  # 发送消息
GET  /api/goal/conversations      # 获取对话历史（⚠️ API 500 待修复）
```

### 7.3 状态追踪

```
GET  /api/state/report/:taskId    # 获取任务学习报告（LSB + 解释 + 建议）
POST /api/state/calculate         # 触发 Agent 计算状态（任务完成后调用）
GET  /api/state/trend             # 获取历史趋势（近 7 次/30 次）
POST /api/state/intervention      # 获取干预建议（基于 Agent 计算结果）
```

---

## 🎯 八、OpenCode 对齐任务

### 任务 1: 认知参与度三层模型

**文件**: `frontend/src/stores/learning.ts`

**需要添加**:
```typescript
interface CognitiveEngagement {
  SKI: number; // 0-1
  MKI: number; // 0-1
  DKI: number; // 0-1
}

interface LearningState {
  // 现有字段...
  cognitiveEngagement: CognitiveEngagement;
}
```

---

### 任务 2: LSB Agent 异步计算

**核心原则**:
- 不实时计算，学习过程中不显示 LSB
- 任务完成后由 Agent 计算 + 产出解释
- 结果用于：学习报告 + 成就感 + 指导下次

**文件 1**: `backend/src/services/state/lsb.agent.ts`（新文件）
**实现**: Agent Prompt + 计算逻辑

```typescript
// Agent Prompt 核心
const LSB_AGENT_PROMPT = `
你是一个学习状态评估专家。根据以下上下文计算学生的学习状态平衡值 (LSB)。

## 输入数据
- 基础指标：LSS={{lss}}, KTL={{ktl}}, LF={{lf}}
- 任务难度：{{taskDifficulty}}
- 完成率：{{completionRate}}
- 实际用时：{{timeSpent}}分钟
- 错误率：{{errorRate}}
- 历史 LSB：{{previousLSB}}
- 交互数据：提问{{chatMessages}}次，求助{{helpRequests}}次，暂停{{pauseCount}}次

## 计算原则
1. 基础公式：LSB = LSS - KTL - LF
2. 根据上下文调整（±2 分以内）
3. 考虑历史趋势（连续下降需预警）
4. 考虑用户等级（新手更宽容）

## 输出格式
{
  "lsb": 3.5,
  "lss": 6,
  "ktl": 4,
  "lf": 2,
  "confidence": 0.85,
  "reasoning": "基础 LSB=4，但因错误率较高 (0.25) 和频繁求助 (5 次)，下调 0.5 分",
  "suggestion": "下次学习前建议先复习相关概念，减少求助次数"
}
`;
```

**文件 2**: `backend/src/controllers/state.controller.ts`
**添加**: `POST /api/state/calculate` 接口

```typescript
async function calculateState(taskId: string) {
  // 1. 收集上下文数据
  const context = await buildLSBContext(taskId);
  
  // 2. 调用 Agent 计算
  const result = await lsbAgent.calculate(context);
  
  // 3. 持久化
  await db.learningState.create({
    taskId,
    ...result,
    calculatedAt: new Date(),
  });
  
  // 4. 返回结果（用于学习报告页）
  return result;
}
```

**文件 3**: `frontend/src/views/LearningReport.vue`（新文件）
**实现**: 学习报告页（展示 LSB + 解释 + 建议 + 历史趋势）

**文件 4**: `backend/src/services/state/intervention.service.ts`
**实现**: 基于 Agent 结果给出干预建议

---

### 任务 3: 导航仪表盘

**新文件**: `frontend/src/components/LearningNavigator.vue`

**需要实现**:
```vue
<template>
  <div class="learning-navigator">
    <!-- 速度检测 -->
    <div class="speed-indicator">
      <span>学习速度</span>
      <el-progress :value="speedPercent" />
    </div>
    
    <!-- 变道检测 -->
    <div class="direction-indicator">
      <span>方向稳定性</span>
      <el-tag :type="directionStabilityType">
        {{ directionStabilityText }}
      </el-tag>
    </div>
    
    <!-- 疲劳预警 -->
    <div class="fatigue-warning" :class="{ active: isFatigued }">
      <el-icon><Warning /></el-icon>
      <span>疲劳驾驶预警</span>
    </div>
  </div>
</template>
```

---

### 任务 4: 苏格拉底反问策略

**文件**: `frontend/src/views/GoalConversation.vue`

**需要添加**:
```typescript
const socraticQuestions = [
  "为什么想学这个？",
  "学完后你想用它做什么？",
  "这和你已有的知识有什么联系？",
  "如果只能用一句话描述目标，会是什么？",
  "你希望达到什么水平？（了解/应用/精通）"
];

function generateSocraticResponse(userInput: string): string {
  // 根据用户输入选择反问策略
  // 目标：帮助用户澄清真实需求
}
```

---

## 📝 九、命名规范

### 9.1 组件命名

```
✅ 正确：CognitiveStatePanel.vue, LearningNavigator.vue
❌ 错误：cognitiveStatePanel.vue, state-panel.vue
```

### 9.2 变量命名

```typescript
// 状态指标
const lsb = ref(0);      // Learning State Balance
const lss = ref(0);      // Learning State Stress
const ktl = ref(0);      // Knowledge To Learn
const lf = ref(0);       // Learning Fatigue

// 认知参与度
const ski = ref(0);      // Surface Cognitive Engagement
const mki = ref(0);      // Medium Cognitive Engagement
const dki = ref(0);      // Deep Cognitive Engagement
```

### 9.3 API 命名

```typescript
// 统一使用 learning 前缀
learningAPI.getStats()
learningAPI.getPaths()
learningAPI.generatePath()
```

---

## 🔗 十、关键文件索引

| 文件 | 路径 | 用途 |
|-----|------|------|
| Home.vue | `frontend/src/views/Home.vue` | 首页理念 |
| Dashboard.vue | `frontend/src/views/Dashboard.vue` | 用户仪表盘 |
| GoalConversation.vue | `frontend/src/views/GoalConversation.vue` | AI 目标对话 |
| TaskDetail.vue | `frontend/src/views/TaskDetail.vue` | 任务详情 |
| CognitiveStatePanel.vue | `frontend/src/components/CognitiveStatePanel.vue` | 状态面板 |
| EinsteinQuote.vue | `frontend/src/components/home/EinsteinQuote.vue` | 爱因斯坦警告 |
| MindVsTool.vue | `frontend/src/components/home/MindVsTool.vue` | 思维 vs 工具 |

---

## 📌 十一、核心原则

1. **先跑起来再优化** - 避免过度设计拖慢进度
2. **文本 > 大脑** - 所有状态写文件，不依赖记忆
3. **用户创建问题** - 苏格拉底式引导，不直接给答案
4. **思维 > 工具** - 培养底层能力，不教具体语法
5. **异步状态计算** - LSB 由 Agent 课后计算，避免焦虑

---

## 📚 十二、教育理论基础

**审计时间**: 2026-03-23
**审计结论**: 平台与首页理念一致性 **78/100** ✅

### 12.1 ZPD（最近发展区）- Vygotsky

**理论核心**:
```
"儿童无法独自完成的任务，但在成人或有能力的同伴帮助下可以完成"

ZPD = 实际发展水平 与 潜在发展水平 之间的区域
```

**平台对应**:
| 理论概念 | 平台实现 | 一致性 |
|---------|---------|--------|
| 实际发展水平 | 用户独立探索能力 | ✅ |
| 潜在发展水平 | AI 辅助下的能力 | ✅ |
| ZPD 区域 | 学习路径难度设计 | ✅ |
| More Knowledgeable Other | AI 伙伴角色 | ✅ |

---

### 12.2 Scaffolding（支架式教学）

**理论核心**:
```
1. 提供帮助，然后逐渐撤去
2. 从学生当前水平开始构建
3. 最终目标是独立完成任务
```

**平台对应**:
| 理论原则 | 平台实现 | 一致性 |
|---------|---------|--------|
| 提供帮助 | 新手任务引导 | ✅ |
| 逐渐撤去 | ZPD 分层提示（1→2→3 级） | ✅ |
| 独立完成任务 | 开放性任务设计 | ✅ |

---

### 12.3 建构主义学习理论

**理论核心**:
```
学习是学习者主动构建知识的过程，不是被动接受
```

**平台对应**:
| 理论原则 | 平台实现 | 一致性 |
|---------|---------|--------|
| 主动构建 | GoalConversation 用户发起 | ✅ |
| 社会互动 | 用户-AI 对话 | ✅ |
| 意义建构 | 苏格拉底反问引导 | ✅ |

---

### 12.4 首页审计决策（2026-03-23）

**审计范围**: 首页基调 vs 平台开发一致性

**无需修改的部分**（✅ 完全符合）:
1. **GoalConversation** - 苏格拉底反问，符合建构主义
2. **学习路径引导** - ZPD 支架式教学，无需修改
3. **AI 辅导（ZPD 分层提示）** - MKO 角色正确
4. **5 种能力培养** - 隐性课程，在实践中培养

**需要优化的部分**（⚠️ 待实施）:
- **XP/成就系统** - 从"奖励完成"改为"记录成长"

**优化方案**:
```typescript
// 修改前（外在动机）
{
  id: 'first_task',
  name: '初学者',
  description: '完成第一个任务',
  xpReward: 10
}

// 修改后（内在动机）
{
  id: 'first_exploration',
  name: '第一次探索',
  description: '开始你的第一次学习探索',
  xpReward: 10
}

// XP 规则修改
const XPRules = {
  // ❌ 不再奖励
  task_completion: 0,
  correct_answer: 0,
  
  // ✅ 改为奖励
  deep_question: 10,       // 提出深度问题
  insight_shared: 15,      // 分享洞察
  help_peer: 20,           // 帮助同伴
  reflection_written: 10,  // 写学习反思
  iteration_improved: 15,  // 迭代改进
  cross_domain_link: 20,   // 跨领域联系
};
```

**实施计划**:
- **P0**: 修改成就文案（1 天）
- **P1**: 修改 XP 规则（2 天）
- **P2**: 重构成就系统为成长记录（3-5 天）

---

## 🔗 十三、关键文件索引

| 文件 | 路径 | 用途 |
|-----|------|------|
| Home.vue | `frontend/src/views/Home.vue` | 首页理念 |
| Dashboard.vue | `frontend/src/views/Dashboard.vue` | 用户仪表盘 |
| GoalConversation.vue | `frontend/src/views/GoalConversation.vue` | AI 目标对话 |
| TaskDetail.vue | `frontend/src/views/TaskDetail.vue` | 任务详情 |
| CognitiveStatePanel.vue | `frontend/src/components/CognitiveStatePanel.vue` | 状态面板 |
| EinsteinQuote.vue | `frontend/src/components/home/EinsteinQuote.vue` | 爱因斯坦警告 |
| MindVsTool.vue | `frontend/src/components/home/MindVsTool.vue` | 思维 vs 工具 |
| CapabilityList.vue | `frontend/src/components/home/CapabilityList.vue` | 5 种能力 |
| ProblemCreator.vue | `frontend/src/components/home/ProblemCreator.vue` | 问题创建 |

---

## 📄 十四、相关文档

| 文档 | 路径 | 用途 |
|-----|------|------|
| [首页审计报告](./HOMEPAGE_VS_PLATFORM_AUDIT.md) | `docs/HOMEPAGE_VS_PLATFORM_AUDIT.md` | 详细审计过程 |
| [审计决策记录](./AUDIT_DECISIONS_2026-03-23.md) | `docs/AUDIT_DECISIONS_2026-03-23.md` | 决策详情 |
| [LSB 异步计算方案](#) | 本文档第 3.2 节 | LSB 计算逻辑 |

---

**文档结束**

这份文档是平台流程和概念的完整梳理。OpenCode 可以根据此文档对齐代码实现。

**最后更新**: 2026-03-23 21:56
**版本**: v1.2
**审计状态**: 78/100 ✅（仅 XP/成就系统待优化）
