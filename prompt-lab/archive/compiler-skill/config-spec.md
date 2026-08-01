# 简化配置格式规范

## 设计理念

用户只需提供**核心数据**，Compiler Skill 自动生成完整的 Prompt。

---

## 配置结构

```yaml
meta:
  id: string                    # Skill ID (必需)
  name: string                  # Skill 名称 (必需)
  archetype: string             # conversational | generator | extractor | distiller (必需)
  description?: string          # 简短描述 (可选)

structure:
  variables:                    # 输入变量 (必需)
    - name: string              # 变量名
      type: string              # 类型
      description: string       # 说明
  
  output:                       # 输出定义 (必需)
    format: string              # json | markdown | text
    schema: object              # 输出字段定义

behavior:
  key_behaviors:                # 关键行为 (必需)
    - string                    # 行为描述
  
  constraints:                  # 边界约束 (可选)
    - string                    # 约束描述
  
  stage_specific?:              # 阶段特定规则 (可选)
    understanding:
      - string
    proposing:
      - string
```

---

## 示例 1: 简单问答

```yaml
meta:
  id: simple-qa
  name: 简单问答助手
  archetype: conversational

structure:
  variables:
    - name: question
      type: string
      description: 用户问题
    - name: context
      type: object
      description: 上下文信息
  
  output:
    format: json
    schema:
      answer: string
      confidence: number

behavior:
  key_behaviors:
    - 每次只回答一个问题
    - 回答要简洁明确
    - 不确定时要说明
  
  constraints:
    - 不编造信息
    - 不回答超出能力范围的问题
```

---

## 示例 2: 目标对话（简化版）

```yaml
meta:
  id: goal-conversation
  name: 目标对话
  archetype: conversational
  description: 学习目标澄清与方向收敛助手

structure:
  variables:
    - name: goal
      type: string
      description: 学习目标
    - name: history
      type: array
      description: 对话历史
    - name: profile
      type: object
      description: 用户画像
  
  output:
    format: json
    schema:
      reply: string
      state: object
      understanding: object
      confirmedProposal: object

behavior:
  key_behaviors:
    - 每次最多问 1 个核心问题
    - 提问语气自然，不像问卷或审问
    - 优先追问最近一次具体卡住场景
    - 对新手用户，优先建立认知框架
    - 信息足够时及时收敛到提议阶段
  
  constraints:
    - 默认面向提问者本人，不输出第三方计划
    - 不编造用户没提供的信息
    - 此阶段不直接解决业务问题，不展开完整路径
  
  stage_specific:
    understanding:
      - 先用 1-2 句总结理解，再提一个关键问题
      - 连续 3 轮后增加进度感知
      - 用户回复简短时，先整合已收集信息
    
    proposing:
      - 只给 2-4 句大致方向，不给详细计划
      - 明确指出先聚焦什么，不是什么都一起练
      - 给出 learning_direction、first_deliverable、key_stages
```

---

## 示例 3: 内容生成器

```yaml
meta:
  id: content-generator
  name: 内容生成器
  archetype: generator

structure:
  variables:
    - name: topic
      type: string
      description: 内容主题
    - name: style
      type: string
      description: 写作风格
    - name: length
      type: number
      description: 目标字数
  
  output:
    format: markdown
    schema:
      title: string
      content: string
      keywords: array

behavior:
  key_behaviors:
    - 内容要围绕主题展开
    - 风格要符合指定要求
    - 字数要接近目标长度
    - 结构要清晰有逻辑
  
  constraints:
    - 不使用低俗或不当内容
    - 不抄袭现有作品
    - 保持事实准确性
```

---

## 配置字段说明

### meta

| 字段 | 类型 | 必需 | 说明 |
|------|------|------|------|
| id | string | ✅ | Skill 唯一标识，用于生成 agentId |
| name | string | ✅ | Skill 显示名称，用于生成身份描述 |
| archetype | enum | ✅ | Skill 类型，决定整体结构 |
| description | string | ❌ | 简短描述，用于 frontmatter |

### structure.variables

| 字段 | 类型 | 必需 | 说明 |
|------|------|------|------|
| name | string | ✅ | 变量名 |
| type | string | ✅ | 数据类型 |
| description | string | ✅ | 变量说明，用于生成输入章节 |

### structure.output

| 字段 | 类型 | 必需 | 说明 |
|------|------|------|------|
| format | enum | ✅ | 输出格式：json / markdown / text |
| schema | object | ✅ | 输出字段定义 |

### behavior

| 字段 | 类型 | 必需 | 说明 |
|------|------|------|------|
| key_behaviors | array | ✅ | 关键行为描述，每条会展开为 1-2 条规则 |
| constraints | array | ❌ | 边界约束，会生成 CON-XX 规则 |
| stage_specific | object | ❌ | 阶段特定规则（仅 conversational） |

---

## 编译映射关系

### 简化配置 → 完整 Prompt

```
meta.id + meta.archetype 
  → frontmatter

meta.name + behavior.key_behaviors 
  → 身份定义

structure.variables 
  → 输入说明

behavior.key_behaviors 
  → 执行规则 (RULE-XX)

structure.output 
  → 输出规格 (OUT-XX)

behavior.constraints 
  → 边界约束 (CON-XX)
```

---

## 使用方式

1. 用户填写简化配置（YAML）
2. 提交给 Compiler Skill（LLM）
3. Compiler Skill 生成完整 Prompt（Markdown）
4. 用户验证和调整

---

## 设计原则

### ✅ Do
- 只定义核心数据和关键行为
- 用自然语言描述行为
- 保持简洁，避免冗余
- 关注"做什么"，不是"怎么做"

### ❌ Don't
- 不要写完整的规则文本
- 不要定义章节结构（自动生成）
- 不要添加编号（自动生成）
- 不要过度详细（让 Compiler 补充）

---

## 扩展性

将来可以添加：
- `examples`: 输入输出示例
- `tone`: 语气风格
- `temperature_override`: 覆盖默认温度
- `special_handling`: 特殊情况处理
- `validation_rules`: 输出验证规则
