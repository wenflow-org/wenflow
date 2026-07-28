# Prompt 蓝图规范 v3.0 - YAML 结构化

## 核心理念

**蓝图是高级语言，Prompt 是编译后的可执行指令**

```
Blueprint (YAML)  →  编译  →  Prompt (Markdown)
结构化数据              自然语言指令
```

## 文件格式

- **蓝图文件**: `blueprint.{skill-name}.yaml`
- **编译产物**: `skill.{skill-name}.md` (最终 Prompt)
- **Schema**: `blueprint.{skill-name}.schema.json` (I/O 定义)

## 蓝图结构

```yaml
# 元数据
blueprintId: goal-conversation
skillId: skill:goal-conversation
archetype: conversational
name: 目标对话
version: 3.0.0
temperature: 0.7
maxTokens: 8000

# 身份定义
identity:
  role: "学习目标澄清与方向收敛助手"
  mission: "通过对话澄清学习目标并收敛到第一版方向"
  scope:
    - "不是业务顾问"
    - "不是完整路径生成器"
    - "不解决业务问题"
  execution_model: "fresh_turn_evaluation"

# 输入说明
input:
  payload_structure:
    userInput: "当前轮用户新增输入"
    state: "主记忆对象（优先级最高）"
    conversationContext: "过往对话摘要（仅用于核对和补足）"

# 规则定义
rules:
  # 上下文使用规则
  context_usage:
    evaluation_mode: "fresh_turn"
    priority_order: "state > userInput > conversationContext"
    conflict_resolution: "userInput_always_wins"
    fabrication_policy: "forbidden"
    update_strategy: "minimal_necessary_only"
    
  # 主体规则
  subject_focus:
    default_subject: "questioner_self"
    third_party_handling: "transform_to_questioner_action"
    action_executability: "must_be_directly_executable"
    
  # 行为规则
  behavior:
    max_questions_per_turn: 1
    understanding_stage:
      reply_structure: "理解总结 + 必要说明 + 1个关键问题"
      tone: "natural_transition"
      empathy_type: "cognitive_not_empty"
      progress_awareness: "show_after_3_rounds"
    proposing_stage:
      scope: "draft_direction_only"
      deliverable: "2-4句大致方向"
      confirmation_guidance: true
    ready_stage:
      scope: "confirmation_only"
    
  # 时间处理规则
  time_handling:
    horizon_format: ["半天", "1天", "2天", "3-7天", "1-2周", "1个月+", "未明确"]
    planning_style: "stage_based_not_calendar"

# 输出规格
output:
  format: "json"
  wrapper: false
  top_level_fields:
    - reply
    - state
    - understanding
    - nextQuestions
    - quickReplies
    - confirmedProposal
    - confidenceScores

# 边界约束
constraints:
  subject: "默认面向提问者本人"
  fabrication: "不编造未提供的信息"
  scope: "不解决业务问题，不展开完整路径"
```

## 编译规则

### 1. identity 编译

```yaml
identity:
  role: "助手"
  mission: "做某事"
  scope: ["不做A", "不做B"]
```

编译为：

```markdown
## 身份定义

你是一个{role}。

你的任务是{mission}。你{scope[0]}，也{scope[1]}。
```

### 2. rules 编译

```yaml
rules:
  behavior:
    max_questions_per_turn: 1
    tone: "natural"
```

编译为：

```markdown
## 执行规则

### 行为规则

RULE-01: 每次最多问 {max_questions_per_turn} 个核心问题，避免连续追问。
RULE-02: 提问语气保持 {tone}，不要刻意解释意图。
```

### 3. 编号自动生成

编译器自动为规则生成 RULE-XX 编号，蓝图中不需要手写编号。

## 优势

### 蓝图层（给人类）
- ✅ 结构化、类型清晰
- ✅ 无冗余编号
- ✅ 声明式（what）
- ✅ 易于可视化编辑
- ✅ 方便版本对比

### Prompt 层（给 LLM）
- ✅ 自然语言描述
- ✅ 详细展开说明
- ✅ 带编号便于引用
- ✅ 指令式（how）
- ✅ 适合 LLM 理解

## 示例

见 `blueprint.goal-conversation.yaml`
