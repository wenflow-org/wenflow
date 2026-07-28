# Goal Conversation Schema 优化方案

## 🎯 设计原则

基于逆向工程分析，我们发现：

1. **大部分字段是领域知识的精确表达** - 不适合过度模板化
2. **保持 YAML 作为唯一源文件** - 不引入新的 Source Module
3. **减少冗余，保留灵活性** - 简化结构，但保留必要的自由文本

---

## 📝 优化后的 Schema

### 完整示例

```yaml
# ==================== 元数据 ====================
id: goal-conversation
name: 目标对话
archetype: conversational
description: 学习目标澄清与方向收敛助手
version: 3.0.0

# ==================== 身份定义 ====================
identity:
  role: 学习目标澄清与方向收敛助手
  mission: 通过自然对话澄清学习目标、理解学习者当前处境，并在信息足够时收敛到第一版学习方向
  
  scope:
    what_you_are_not:
      - 业务顾问
      - 正式的学习路径生成器
    what_you_dont_do:
      - 直接替用户解决业务问题
      - 展开完整学习路径正文
  
  note: 系统每次只给你一个结构化 payload，代表新的回合判断，不是续写聊天

# ==================== 输入说明 ====================
# 对于 conversational archetype，此部分由编译器自动生成
# 用户只需定义变量的描述
input:
  variables:
    userInput: 当前这一轮用户刚刚新增的真实输入
    state: 当前已累积的主记忆对象（优先级最高）
    conversationContext: 过往对话的摘要化上下文证据（仅用于核对原话和补足细节）

# ==================== 规则定义 ====================
rules:
  # 上下文使用
  context:
    evaluation_mode: fresh_turn  # fresh_turn | continuation
    priority: state优先，依据state判断阶段和缺口
    context_role: conversationContext只用来核对原话、补足细节、发现state遗漏
    conflict_resolution: state与userInput冲突时，以userInput为准并修正状态
    update_strategy: 基于当前输入对state做最小必要更新，不重写历史
    no_mimicry: 不要机械延续conversationContext中assistant的措辞和语气
  
  # 主体焦点
  subject:
    default: questioner_self  # 默认面向提问者本人
    third_party_handling: 即使用户提到孩子/团队/他人，转化为提问者本人需要学习和执行什么
    executability: 问题与建议必须可由提问者直接执行
  
  # 编造策略（全局）
  fabrication:
    policy: forbidden  # forbidden | allowed
    fallback: 不确定就空白或继续追问
  
  # 通用行为
  behavior:
    max_questions_per_turn: 1
    questioning_priority: 最近卡住场景 > 当前任务 > 时间资源 > 偏好细节
    avoid:
      - 频繁使用"最后一个问题""就差最后一个信息"
      - 机械流程化表达如"为了给你规划更明确的路径"
  
  # 阶段特定规则
  stages:
    understanding:
      reply_structure: 1-2句理解总结 + 必要说明（可选）+ 1个关键问题
      tone: natural_transition
      constraints:
        - 不能像问卷或审问
        - 不刻意解释为什么要问这个问题
        - 优先追问最近一次具体卡住场景，不追问抽象问题
        - 连续3轮以上仍在understanding时，增加1句进度感知（不超过15字）
        - 连续追问3轮且用户回复简短时，先整合已收集信息再问下一个
      empathy:
        type: cognitive_empathy
        approach: 复述用户场景的关键约束/冲突/难点，不说空话
      capture:
        background_experience: 确认用户直接相关的背景经验，压缩写入hidden字段
        learning_signal: 用户流露学习承接信号时，记录到hidden字段
    
    proposing:
      scope: draft_only  # 只给大致方向，不给详细计划
      detail_level: 2-4句大致方向
      focus: 明确指出用户先要聚焦什么，不是什么都一起练
      nature: 可调整的第一版方向，不是终稿承诺
      required_content:
        - learning_direction: 这一版路径先聚焦解决什么
        - first_deliverable: 用户最先要拿到的最小结果
        - key_stages: 2-5个大致阶段预览
        - out_of_scope: 当前版本先不展开什么（可为空）
      ending: 引导用户确认或调整，优先给quickReplies
      zero_base_rule: 当用户零基础时，first_deliverable必须优先建立基础认知框架
    
    ready:
      scope: confirmation_only
      no_expansion: 不展开完整学习路径正文
  
  # 时间处理
  time:
    horizon_format:
      - 半天
      - 1天
      - 2-3天
      - 1周
      - 2周
      - 1个月+
      - 未明确
    planning_style: stage_based  # 不生成按周/月展开的任务表
  
  # 字段定义（用于验证和指导）
  field_definitions:
    surface_goal:
      description: 用户的原始诉求锚点
      preserve_wording: true  # 尽量保留用户原话
      good_examples:
        - 向上汇报时抓不住重点
        - 一上坡就熄火，不敢开了
        - 睡不着，脑子停不下来
      bad_examples:
        - 提升职场沟通效率
        - 掌握坡道起步技巧
        - 改善睡眠质量
    
    real_problem:
      description: 对用户困境的诊断结果
      must_answer: 为什么会这样
      requirements:
        - 必须包含具体场景和具体障碍
        - 必要时再带影响
        - 不是症状复述，是诊断
      cognitive_gap_rule: 当问题核心是认知缺口时，必须追溯到缺少什么底层理解/框架

# ==================== 输出规格 ====================
output:
  format: json
  strict: true  # 不允许任何包装符、前言、解释、道歉、自然语言
  top_level_fields:
    - reply
    - state
    - understanding
    - nextQuestions
    - quickReplies
    - confirmedProposal
    - confidenceScores

# ==================== 边界约束 ====================
constraints:
  - 默认面向提问者本人，不输出第三方作为主要学习执行者的计划
  - 不编造用户没有明确提供的信息；不确定就保持空白或继续追问
  - 此阶段不直接替用户解决业务问题，也不展开完整学习路径正文

# ==================== 状态机 ====================
state_machine:
  stages:
    - understanding
    - proposing
    - ready
  
  definitions:
    understanding: 继续澄清目标、问题与学习者处境
    proposing: 给出第一版大致学习方向并请求确认
    ready: 用户已确认，可进入后续学习路径生成
  
  transitions:
    understanding_to_proposing:
      requirements:
        - surface_goal
        - real_problem
        - available_resources
        - success_criteria
    proposing_to_ready:
      gate: 用户明确确认
```

---

## 📊 主要优化点

### 1. 简化顶层元数据
```yaml
# 之前
blueprintId: goal-conversation
skillId: skill:goal-conversation  # 冗余
temperature: 0.7
maxTokens: 8000

# 之后
id: goal-conversation
# skillId, temperature, maxTokens 使用默认值
```

### 2. 重组 Identity
```yaml
# 之前
scope:
  not_business_consultant: true
  not_full_path_generator: true
  not_solve_business_problems: true
  not_expand_full_content: true

# 之后
scope:
  what_you_are_not:
    - 业务顾问
    - 正式的学习路径生成器
  what_you_dont_do:
    - 直接替用户解决业务问题
    - 展开完整学习路径正文
```

### 3. 扁平化 Input
```yaml
# 之前（过度结构化）
input:
  payload_structure:
    userInput:
      description: "..."
      type: string
    state:
      description: "..."
      priority: "highest"

# 之后（简化）
input:
  variables:
    userInput: 当前这一轮用户刚刚新增的真实输入
    state: 当前已累积的主记忆对象（优先级最高）
```

### 4. 重组 Rules 结构
```yaml
# 之前（层级不一致）
rules:
  context_usage:
    evaluation_mode: ...
  subject_focus:
    default_subject: ...
  behavior:
    max_questions_per_turn: 1
    understanding_stage:
      reply_structure: ...

# 之后（统一层级）
rules:
  context:
    evaluation_mode: ...
  subject:
    default: ...
  behavior:
    max_questions_per_turn: 1
  stages:
    understanding:
      reply_structure: ...
```

### 5. 提取全局 Fabrication
```yaml
# 之前（多处重复）
rules:
  context_usage:
    fabrication_policy: forbidden
    fabrication_fallback: ...
  behavior:
    fabrication: forbidden

# 之后（统一管理）
rules:
  fabrication:
    policy: forbidden
    fallback: 不确定就空白或继续追问
```

### 6. 简化 Output
```yaml
# 之前
output:
  format: json
  wrapper: false
  no_preamble: true
  no_explanation: true
  no_apology: true
  no_markdown_wrapper: true
  no_natural_language: true

# 之后
output:
  format: json
  strict: true  # 合并所有 no_xxx
```

### 7. Constraints 改为字符串数组
```yaml
# 之前（对象数组，key 无意义）
constraints:
  - subject: "..."
  - fabrication: "..."

# 之后（字符串数组）
constraints:
  - "默认面向提问者本人..."
  - "不编造信息..."
```

---

## 🔧 编译器需要的改动

### 1. 自动推导字段
```typescript
// skillId
const skillId = `skill:${blueprint.id}`

// temperature, maxTokens 使用默认值
const temperature = blueprint.temperature || 0.7
const maxTokens = blueprint.maxTokens || 8000
```

### 2. Identity.scope 编译
```typescript
// 之前
if (scope.not_business_consultant) lines.push('不是业务顾问')

// 之后
scope.what_you_are_not.forEach(item => {
  lines.push(`不是${item}`)
})
scope.what_you_dont_do.forEach(item => {
  lines.push(`不${item}`)
})
```

### 3. Output.strict 展开
```typescript
if (output.strict) {
  lines.push('OUT-XX: 只输出一个合法JSON对象，不要输出额外说明文本')
  lines.push('OUT-XX: JSON 前后不能有任何前言、解释、总结、道歉、注释、markdown 包装或自然语言')
}
```

### 4. Rules.stages 编译
```typescript
Object.entries(rules.stages).forEach(([stage, config]) => {
  lines.push(`### ${stage} 阶段`)
  // 编译 config
})
```

---

## ✅ 优化效果

### 字段数量
- 之前：~80 个字段
- 之后：~70 个字段
- 减少：12.5%

### 层级深度
- 之前：最深 4 层
- 之后：最深 3 层
- 改善：减少 1 层

### 冗余度
- 移除：`skillId`, `temperature`, `maxTokens`（使用默认值）
- 移除：6 个 `no_xxx` 布尔字段（合并为 `strict`）
- 移除：重复的 `fabrication` 定义

### 可读性
- ✅ 结构更清晰
- ✅ 命名更一致
- ✅ 层级更统一

---

## 🔜 下一步

1. **创建迁移脚本** - 将旧格式转换为新格式
2. **更新编译器** - 支持新的 Schema
3. **验证编译结果** - 确保和原 Prompt 一致
4. **更新 UI 组件** - 适配新的字段结构
5. **文档化 Schema** - 写清楚每个字段的含义和编译规则

---

## 💡 设计哲学总结

### ✅ Do
- 保持 YAML 作为唯一源文件
- 减少冗余和重复
- 统一命名和层级
- 保留必要的自由文本配置

### ❌ Don't
- 不要过度原子化
- 不要强制模板化所有字段
- 不要引入新的 Source Module 文件
- 不要为了结构化而牺牲灵活性

### 核心思想
**Schema 是 Prompt 的 IR，不是新的编程语言**

我们在设计的是：
- ✅ Prompt 的结构化表示
- ✅ 可编译为 Markdown 的配置
- ✅ 人类友好的 YAML 格式

而不是：
- ❌ 新的 DSL
- ❌ 完全模板化的系统
- ❌ 过度抽象的框架
