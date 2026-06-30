# Prompt Lab 架构说明

## 核心理念

**蓝图不是提示词，而是基础设施数据**

```
蓝图层（Blueprint Layer）
├─ 结构化数据
├─ 字段级编辑
├─ 声明式配置
└─ 不可直接执行

         ↓ 编译

提示词层（Prompt Layer）
├─ 自然语言
├─ 详细展开
├─ 指令式描述
└─ LLM 可执行
```

---

## 类比编程语言

| 编程语言 | Prompt 系统 |
|---------|------------|
| TypeScript 源码 | YAML 蓝图 |
| tsc 编译器 | Skill 编译器 |
| JavaScript 字节码 | Markdown Prompt |
| Node.js 运行时 | LLM 执行 |

---

## 三层架构

### Layer 1: 基础设施层（Infrastructure）

**位置**: `prompt-lab/blueprints/`

**文件**: `*.yaml`, `*.schema.json`

**角色**: 源文件，配置数据

**编辑方式**:
- 可视化表单编辑器
- 字段级别修改
- 版本控制

**示例**:
```yaml
# goal-conversation.yaml
rules:
  behavior:
    max_questions_per_turn: 1
    understanding_stage:
      reply_structure: "理解总结 + 说明 + 问题"
      tone: "natural_transition"
```

**特点**:
- ✅ 结构化、类型化
- ✅ 无冗余编号
- ✅ 易于维护和对比
- ❌ 不能直接运行

---

### Layer 2: 编译层（Compilation）

**位置**: `frontend/src/utils/blueprintCompiler.ts`

**职责**:
1. 读取 YAML 蓝图
2. 应用 archetype 模板（conversational/generator/extractor...）
3. 自动生成编号（RULE-XX, OUT-XX, CON-XX）
4. 展开详细说明
5. 生成自然语言指令
6. 输出 Markdown 提示词

**编译规则示例**:
```typescript
// 输入（YAML）
behavior: {
  max_questions_per_turn: 1
}

// 输出（Markdown）
RULE-09: 每次最多问 1 个核心问题，避免连续追问。
```

---

### Layer 3: 执行层（Execution）

**位置**: `wenflow/prompts/skill.*.md`（生产环境）

**文件**: 编译后的 `.md` 文件

**角色**: 可执行提示词

**使用方式**:
- 直接发送给 LLM
- 不再手动编辑
- 由编译器生成

**示例**:
```markdown
## 执行规则

### 行为规则

RULE-09: 每次最多问 1 个核心问题，避免连续追问。
RULE-10: 在 understanding 阶段，reply 默认先用...
RULE-11: 提问语气不能像问卷或审问...
```

**特点**:
- ✅ 自然语言，LLM 友好
- ✅ 详细展开，明确指示
- ✅ 带编号，便于引用
- ⚠️ 只读文件，不手动编辑

---

## 数据流

```
┌─────────────────────────────────────────────────────────────┐
│                   Prompt Lab（前端界面）                      │
│                                                               │
│  [蓝图列表] [编辑] [编译] [预览] [测试] [发布]                │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│                   基础设施层（blueprints/）                   │
│                                                               │
│  goal-conversation.yaml        ← 可编辑的源文件                │
│  goal-conversation.schema.json                               │
└─────────────────────────────────────────────────────────────┘
                            ↓ 编译
┌─────────────────────────────────────────────────────────────┐
│                   编译器（blueprintCompiler）                 │
│                                                               │
│  • 读取 YAML                                                  │
│  • 应用 archetype 模板                                        │
│  • 生成编号                                                   │
│  • 展开说明                                                   │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│                   编译产物（prompts/）                        │
│                                                               │
│  goal-conversation.md          ← 自动生成，只读                │
└─────────────────────────────────────────────────────────────┘
                            ↓ 发布
┌─────────────────────────────────────────────────────────────┐
│                   生产环境（wenflow/prompts/）                │
│                                                               │
│  skill.goal-conversation.md    ← LLM 执行                     │
└─────────────────────────────────────────────────────────────┘
```

---

## 为什么需要这种架构？

### 问题 1: 提示词难以维护

**之前（直接编辑 Markdown）**:
```markdown
RULE-09: 每次最多问 1 个核心问题
RULE-10: proposing 只给大致方向
RULE-11: ready 只做确认
RULE-12: 不编造信息
RULE-13: 面向提问者本人
RULE-14: 在 understanding 阶段...
RULE-15: 提问语气自然...
```

**问题**:
- 编号容易混乱
- 插入新规则要重新编号
- 难以做结构化版本对比
- 大段文本不利于字段级修改

**现在（YAML 蓝图）**:
```yaml
behavior:
  max_questions_per_turn: 1
  proposing_scope: "draft_only"
  ready_scope: "confirmation_only"
  fabrication: "forbidden"
  subject: "questioner_self"
  understanding_stage:
    reply_structure: "..."
    tone: "natural"
```

**优势**:
- ✅ 无编号，编译器自动生成
- ✅ 插入规则不影响其他规则
- ✅ Git diff 清晰可读
- ✅ 字段级别修改

---

### 问题 2: 运营人员难以编辑

**之前**: 
- 需要理解 Markdown 格式
- 需要记住编号规则
- 需要手写大段自然语言
- 容易出错

**现在**:
- 表单化编辑界面
- 修改数值和选项即可
- 编译器自动生成自然语言
- 降低出错率

---

### 问题 3: 版本对比困难

**之前（Markdown diff）**:
```diff
- RULE-09: 每次最多问 1 个核心问题
- RULE-10: proposing 只给大致方向
- RULE-11: ready 只做确认
+ RULE-09: 每次最多问 2 个核心问题
+ RULE-10: 新增规则：提问语气自然
+ RULE-11: proposing 只给大致方向
+ RULE-12: ready 只做确认
```
编号全部变了，难以看出真正的改动

**现在（YAML diff）**:
```diff
  behavior:
-   max_questions_per_turn: 1
+   max_questions_per_turn: 2
+   tone: "natural"
    proposing_scope: "draft_only"
```
清晰可见：改了问题数量，加了语气配置

---

## 编译器模板系统

不同的 archetype 使用不同的编译模板：

### conversational（对话型）
```yaml
archetype: conversational
```
编译为：
- 状态机章节
- 阶段转换规则
- 多轮对话策略

### generator（生成型）
```yaml
archetype: generator
```
编译为：
- 输入数据说明
- 生成步骤
- 输出格式规范

### extractor（提取型）
```yaml
archetype: extractor
```
编译为：
- 提取目标定义
- 匹配规则
- 输出结构

---

## 总结

| 层次 | 文件类型 | 用途 | 编辑方式 |
|------|---------|------|---------|
| 基础设施层 | `*.yaml` | 源文件，配置数据 | 表单化编辑 |
| 编译层 | `编译器` | 转换数据为指令 | 自动执行 |
| 执行层 | `*.md` | LLM 可执行提示词 | 只读预览 |

**记住：蓝图不是提示词，而是用于生成提示词的基础设施数据！**
