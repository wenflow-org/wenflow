# AI开源学习系统架构设计

**日期**: 2026-02-11
**设计理念**: 基于通用大模型的开源学习系统，可自部署、易扩展

---

## 核心定位

**产品**: OpenLearn - 开源AI学习系统

**核心价值**:
- 🎓 **AI教师即服务** - 通过配置System Prompt创建AI教师
- 📚 **互动课件系统** - 动态生成可交互的学习内容
- 🔓 **完全开源** - 可自部署，私有化运行
- 🚀 **易扩展** - 预留自定义模型API接口

---

## 系统架构图

```
┌─────────────────────────────────────────────────────────────┐
│                     学生用户界面                            │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐                  │
│  │ AI教师   │  │ 我的学习 │  │ 个人中心 │                  │
│  │ 商城     │  │ 进度     │  │          │                  │
│  └──────────┘  └──────────┘  └──────────┘                  │
└────────────────────────────┬────────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────────┐
│                     学生学习界面                            │
│  ┌──────────────────────────────────────────────────┐      │
│  │           互动课件播放器                        │      │
│  │  - 动态内容渲染                                │      │
│  │  - 实时对话（AI教师）                        │      │
│  │  - 互动问答                                    │      │
│  │  - 学习进度追踪                                │      │
│  └──────────────────────────────────────────────────┘      │
└────────────────────────────┬────────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────────┐
│                     教师/开发者后台                         │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐    │
│  │ 创建AI   │  │ 教师管理 │  │ 数据分析 │  │ 知识库   │    │
│  │ 教师     │  │          │  │          │  │ 管理     │    │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘    │
└────────────────────────────┬────────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────────┐
│                      核心平台服务                            │
│  ┌──────────────────────────────────────────────────┐      │
│  │           AI教师调度引擎                        │      │
│  │  - 教师选择和匹配                              │      │
│  │  - 对话上下文管理                              │      │
│  │  - 提示词工程                                  │      │
│  └──────────────────────────────────────────────────┘      │
│  ┌──────────────────────────────────────────────────┐      │
│  │           互动课件生成引擎                      │      │
│  │  - 课件模板引擎                                │      │
│  │  - 学生数据追踪                                │      │
│  │  - 个性化推荐                                  │      │
│  └──────────────────────────────────────────────────┘      │
│  ┌──────────────────────────────────────────────────┐      │
│  │           知识库检索引擎 (RAG)                  │      │
│  │  - 向量数据库 (Milvus/PG)                      │      │
│  │  - 语义检索                                    │      │
│  │  - 文档索引                                    │      │
│  └──────────────────────────────────────────────────┘      │
└────────────────────────────┬────────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────────┐
│                   大模型集成层                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │ OpenAI       │  │ 本地NewAPI   │  │ 预留自定义  │      │
│  │ (GPT-4/5)    │  │ (GLM/Qwen)   │  │ 模型接口    │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
└────────────────────────────┬────────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────────┐
│                   数据存储层                                │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐    │
│  │ 用户数据 │  │ AI教师   │  │ 课件数据 │  │ 向量DB   │    │
│  │          │  │ 配置     │  │          │  │          │    │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘    │
└─────────────────────────────────────────────────────────────┘
```

---

## 核心模块设计

### 模块1: AI教师系统

#### 1.1 AI教师配置（类似Custom GPTs）

**AI教师定义**:

```json
{
  "id": "math-tutor-v1",
  "name": "初中数学老师",
  "description": "擅长用生动例子讲解初中数学",
  "avatar": "🧮",
  "category": "数学",

  "system_prompt": "你是一个初中数学老师，擅长用生动的例子讲解复杂概念。遵循苏格拉底式教学法，不要直接给答案，而是引导学生自己思考。回答简洁明了，不超过200字。",

  "teaching_style": "苏格拉底式",

  "capabilities": {
    "tools": ["web_search", "file_upload", "code_interpreter"],
    "knowledge_bases": ["初中数学教材.pdf", "几何题库.pdf"],
    "max_tokens": 1000,
    "temperature": 0.7
  },

  "metadata": {
    "creator": "teacher_123",
    "created_at": "2026-02-11",
    "version": "1.0",
    "total_interactions": 5420,
    "rating": 4.8
  }
}
```

#### 1.2 AI教师创建界面

**UI设计**:

```
┌─────────────────────────────────────────┐
│ 创建新的AI教师                          │
│                                         │
│ 基本信息                                │
│ ├─ 名称: [初中数学老师]                 │
│ ├─ 描述: 擅长用生动例子讲解...          │
│ └─ 图标: [🧮 选择]                     │
│                                         │
│ 教学风格                                │
│ ├─ [☑] 苏格拉底式 (引导式)             │
│ ├─ [ ] 直接教学 (讲授式)               │
│ ├─ [ ] 游戏化                          │
│ └─ [ ] 探究式                          │
│                                         │
│ 系统提示词                              │
│ ┌─────────────────────────────────────┐ │
│ │ 你是一个初中数学老师...              │ │
│ │ 遵循苏格拉底式教学法...              │ │
│ │                                     │ │
│ │                                     │ │
│ └─────────────────────────────────────┘ │
│                                         │
│ 开启工具                                │
│ ├─ [☑] 网络搜索                        │
│ ├─ [☑] 文件上传                        │
│ └─ [ ] 代码执行 (编程题专用)           │
│                                         │
│ 知识库                                  │
│ ├─ [📁 上传教材]初中数学教材.pdf       │
│ └─ [📁 上传题库]一千道习题.txt         │
│                                         │
│ [🎤 预览对话]  [💾 保存]  [🚀 发布]    │
└─────────────────────────────────────────┘
```

---

### 模块2: 互动课件系统

#### 2.1 课件组件库

**核心组件**:

```typescript
// 1. 文章展示组件
<ArticleText
  text={{
    content: "一元一次方程是指含有一个未知数，且未知数的最高次数为1的方程。",
    revealMode: "click", // click/scroll/typing
    highlights: ["一元一次方程", "未知数", "最高次数"]
  }}
/>

// 2. 对话问答组件
<AIChat
  teacher={"math-tutor-v1"}
  initialMessage="欢迎学习一元一次方程！"
  maxHints={3} // 最多提示3次
/>

// 3. 互动选择题
<MultipleChoice
  question="下列哪个是一元一次方程？"
  options={[
    { text: "x² + 2x = 5", correct: false, explanation: "未知数x的次数是2" },
    { text: "2x + 3 = 7", correct: true, explanation: "正确！" },
    { text: "xy = 10", correct: false, explanation: "有2个未知数" }
  ]}
  onAnswer={(result) => showExplanation(result.explanation)}
/>

// 4. 代码练习（编程课）
<CodeEditor
  language="python"
  template="def solve_equation(a, b):"
  tests={[
    { input: {a: 2, b: 5}, expected: 7 },
    { input: {a: 3, b: -2}, expected: 1 }
  ]}
  onRun={(output) => checkOutput(output, tests)}
/>

// 5. 可视化演示
<Visualization
  type="equation"
  equation="2x + 5 = 13"
  interactive={true}
  steps={[
    "首先将-5移到右边",
    "2x = 8",
    "两边除以2",
    "x = 4"
  ]}
/>

// 6. 拖拽组件（幼儿园互动）
<DragDrop
  items={["苹果", "香蕉", "橙子"]}
  target="水果篮子"
  onDrop={(item, target) => checkFruit(item)}
/>
```

#### 2.2 AI生成课件

**系统自动生成的课件结构**:

```json
{
  "lesson_id": "lesson_123",
  "topic": "一元一次方程",
  "grade": "初一",
  "estimated_time": "15分钟",

  "sections": [
    {
      "type": "introduction",
      "ai_message": "今天我们要学习一元一次方程，它是最简单的方程类型，让我们一起探索！",
      "component": "ArticleText",
      "props": {
        "content": "一元一次方程是指...",
        "revealMode": "click"
      }
    },
    {
      "type": "concept_explain",
      "ai_message": "让我用一个例子来解释：2x + 5 = 13",
      "component": "Visualization",
      "props": {
        "type": "equation",
        "equation": "2x + 5 = 13",
        "interactive": true
      }
    },
    {
      "type": "practice",
      "ai_message": "现在试试看：解这个方程 3x - 4 = 11",
      "component": "MultipleChoice",
      "props": {
        "question": "方程 3x - 4 = 11 的解是？",
        "options": [...]
      }
    },
    {
      "type": "ai_chat",
      "component": "AIChat",
      "props": {
        "initialMessage": "有什么问题吗？我来帮你解答"
      }
    }
  ],

  "adaptive_rules": {
    "on_correct_next": "下一节",
    "on_wrong_hint": "提示",
    "on_stuck": "切换教学模式"
  }
}
```

#### 2.3 课件播放器

**学习流程**:

```
学生开始学习
  ↓
[加载课件] → 根据学生水平加载合适版本
  ↓
[播放组件] → 按顺序展示互动组件
  ↓
[AI辅助] → AI教师实时答疑
  ↓
[评估学习] → 根据答对/答错调整后续内容
  ↓
[保存进度] → 记录学习数据
```

---

### 模块3: 知识库系统（RAG）

#### 3.1 知识库管理

**上传教材/资料**:

```bash
# 支持格式
pdf, docx, txt, md, json

# 上传API
POST /api/knowledge-base/upload
{
  "files": [
    {"name": "初中数学教材.pdf"},
    {"name": "几何定理手册.docx"}
  ],
  "teacher_id": "math-tutor-v1"
}

# 自动索引
- 文档切分
- 向量化
- 存储到向量数据库
```

#### 3.2 检索流程

```
学生提问: "什么是勾股定理？"
  ↓
[向量查询] → 在知识库检索相关段落
  ↓
[构建Context] → Top 3片段 + System Prompt
  ↓
[调用大模型] → 生成回答
  ↓
{返回: 回答 + 引用来源}
```

---

### 模块4: 学生学习系统

#### 4.1 学习进度追踪

```json
{
  "student_id": "student_123",
  "learning_progress": {
    "math": {
      "equations": {
        "completed_lessons": ["lesson_linear_equation", "lesson_quadratic"],
        "current_lesson": "lesson_system_of_equations",
        "accuracy": 0.85,
        "time_spent": "2h 30m",
        "weak_points": ["system_of_equations", "word_problems"]
      }
    }
  },

  "preferences": {
    "preferred_teaching_style": "苏格拉底式",
    "difficulty_level": "中等",
    "learning_speed": "渐进式"
  }
}
```

#### 4.2 个性化推荐

```python
def recommend_next_lesson(student_id):
    # 获取学生学习数据
    progress = get_progress(student_id)
    weak_points = progress["weak_points"]

    # 知识图谱查询：查找薄弱点的前置知识点
    prerequisites = find_prerequisites(weak_points)

    # 推荐复习薄弱点的前置知识
    if prerequisites:
        return find_lesson_for_topic(prerequisites[0])

    # 否则推荐下一个难度
    return find_next_level_lesson(progress["current_lesson"])
```

---

## 大模型集成层

### 多模型支持

```typescript
interface ModelProvider {
  name: string;
  models: string[];
  apiEndpoint: string;
  apiKey: string;
}

// 默认配置
const modelProviders: ModelProvider[] = [
  {
    name: "OpenAI",
    models: ["gpt-4", "gpt-4-turbo", "gpt-3.5-turbo"],
    apiEndpoint: "https://api.openai.com/v1",
    apiKey: process.env.OPENAI_API_KEY
  },
  {
    name: "LocalNewAPI",
    models: ["deepseek-chat", "deepseek-think", "Qwen2.5-7B"],
    apiEndpoint: "http://localhost:3000/v1",
    apiKey: "sk-xxx"
  },
  {
    name: "CustomModel", // 预留接口
    models: [],
    apiEndpoint: "",
    apiKey: ""
  }
];
```

### 统一调用接口

```typescript
async function chatCompletion(config: {
  teacherId: string;
  messages: ChatMessage[];
  model?: string;
  temperature?: number;
  stream?: boolean;
}): Promise<{content: string}> {
  // 1. 获取AI教师配置
  const teacher = await getTeacher(teacherId);

  // 2. 选择模型（如果没有指定，使用教师默认）
  const provider = modelProviders.find(
    p => p.name === teacher.preferred_provider
  );

  // 3. 构建完整Prompt
  const fullMessages = [
    {role: "system", content: teacher.system_prompt},
    ...messages
  ];

  // 4. 调用大模型
  const response = await fetch(`${provider.apiEndpoint}/chat/completions`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${provider.apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: config.model || teacher.default_model,
      messages: fullMessages,
      temperature: config.temperature ?? teacher.capabilities.temperature,
      stream: config.stream
    })
  });

  return response.json();
}
```

---

## 技术栈

### 后端

| 组件 | 技术选择 | 说明 |
|------|---------|------|
| **API框架** | FastAPI (Python) | 高性能异步 |
| **数据库** | PostgreSQL | 主数据库 |
| **向量库** | Milvus / PG-Vector | RAG检索 |
| **文件存储** | MinIO / 本地 | 知识库文件 |
| **缓存** | Redis | 会话和缓存 |
| **任务队列** | Celery | 异步任务 |

### 前端

| 组件 | 技术选择 |
|------|---------|
| **框架** | React + TypeScript |
| **组件库** | Ant Design / Material-UI |
| **富文本** | TipTap / Draft.js |
| **图表** | Recharts / ECharts |
| **状态管理** | Zustand |

### AI集成

| 组件 | 技术选择 |
|------|---------|
| **OpenAI SDK** | openai (Python) |
| **LangChain** | 可选，用于Prompt工程 |
| **Embedding** | text-embedding-ada-002 / 本地模型 |
| **向量数据库** | Milvus / PG-Vector |

---

## 开发者工作流

### 创建AI教师

```python
from openlearn import AITeacher

# 创建教师
teacher = AITeacher(
    name="初中数学老师",
    description="擅长用生动例子讲解初中数学",
    system_prompt="你是一个初中数学老师...",
    teaching_style="socratic",
    tools=["web_search", "file_upload"]
)

# 上传知识库
teacher.upload_knowledge_base([
    "初中数学教材.pdf",
    "几何题库.pdf"
])

# 保存并发布
teacher.save()
teacher.publish()

# 测试
response = teacher.chat("怎么解方程 2x + 5 = 13？")
print(response.message)
```

### 创建课件

```python
from openlearn import Lesson, Component

# 创建课件
lesson = Lesson(
    topic="一元一次方程",
    grade="初一",
    teacher_id="math-tutor-v1"
)

# 添加组件
lesson.add_component(
    Component(
        type="ArticleText",
        props={"content": "一元一次方程是指..."}
    )
)

lesson.add_component(
    Component(
        type="Visualization",
        props={"type": "equation", "equation": "2x + 5 = 13"}
    )
)

# 保存
lesson.save()
```

---

## 开源许可

**MIT License** - 完全开源

**包含内容**:
- ✅ 完整源代码
- ✅ 部署文档
- ✅ 开发者文档
- ✅ 示例项目
- ⚠️ 不包含大模型调用（需用户提供API Key）

---

## MVP功能列表

### Phase 1: 核心功能（2周）

- [x] AI教师创建和管理
- [x] System Prompt配置
- [x] 基础对话功能
- [x] 知识库上传（PDF/Docx）
- [x] 简单RAG检索
- [x] 基础UI（后台 + 学习界面）

### Phase 2: 互动课件（2周）

- [x] 课件组件库（文本、选择、对话）
- [x] AI自动生成课件
- [x] 课件播放器
- [x] 学习进度追踪
- [x] 个性化推荐

### Phase 3: 高级功能（2周）

- [x] 多模型支持（OpenAI + 本地）
- [x] 自定义模型API接口（预留）
- [x] 高级RAG（混合检索）
- [x] 数据分析和可视化
- [x] 移动端响应式

### Phase 4: 完善生态（2周）

- [x] AI教师市场
- [x ] 评价和评论系统
- [x] 社区功能
- [x] 部署工具（Docker）

---

## 参考项目

**设计灵感**:
- ChatGPT Edu - Custom GPTs配置
- Khan Academy - 互动课件
- Duolingo - 游戏化学习
- Anki - 间隔重复

**技术组件**:
- LangChain - LLM框架
- Milvus - 向量数据库
- vLLM - 推理（自定义模型预留）

---

**文档版本**: v3.0
**更新日期**: 2026-02-11
**核心理念**: 开源学习系统，基于通用大模型，可自部署
