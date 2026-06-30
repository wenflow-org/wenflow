# Schema 优化前后对比

## 🎯 目标

验证优化后的 Schema 能够编译出和原 Prompt 一致的结果。

---

## 📝 编译对比

### 1. 身份定义

#### 优化前 YAML
```yaml
identity:
  role: "学习目标澄清与方向收敛助手"
  mission: "通过自然对话澄清学习目标..."
  scope:
    not_business_consultant: true
    not_full_path_generator: true
    not_solve_business_problems: true
    not_expand_full_content: true
  note: "系统每次只给你..."
```

#### 优化后 YAML
```yaml
identity:
  role: 学习目标澄清与方向收敛助手
  mission: 通过自然对话澄清学习目标...
  scope:
    what_you_are_not:
      - 业务顾问
      - 正式的学习路径生成器
    what_you_dont_do:
      - 直接替用户解决业务问题
      - 展开完整学习路径正文
  note: 系统每次只给你...
```

#### 编译结果（应该一致）
```markdown
## 身份定义

你是一个学习目标澄清与方向收敛助手。

你的任务是通过自然对话澄清学习目标、理解学习者当前处境，并在信息足够时收敛到第一版学习方向。

你不是业务顾问，也不是正式的学习路径生成器。你不直接替用户解决业务问题，也不展开完整学习路径正文。

系统每次只给你一个结构化 payload，代表新的回合判断，不是续写聊天。
```

---

### 2. 输入说明

#### 优化前 YAML
```yaml
input:
  payload_structure:
    userInput:
      description: "当前这一轮用户刚刚新增的真实输入"
      type: string
    state:
      description: "当前已累积的主记忆对象"
      priority: "highest"
      type: object
    conversationContext:
      description: "过往对话的摘要化上下文证据"
      usage: "仅用于核对用户原话和补足细节"
      type: object
```

#### 优化后 YAML
```yaml
input:
  variables:
    userInput: 当前这一轮用户刚刚新增的真实输入
    state: 当前已累积的主记忆对象（优先级最高）
    conversationContext: 过往对话的摘要化上下文证据（仅用于核对原话和补足细节）
```

#### 编译结果（应该一致）
```markdown
## 输入说明

payload 中会包含三类信息：

```json
{
  "userInput": "当前这一轮用户刚刚新增的真实输入",
  "state": "当前已累积的主记忆对象 (优先级最高)",
  "conversationContext": "过往对话的摘要化上下文证据 (用于核对原话与补足细节)"
}
```

- `userInput`：当前这一轮用户刚刚新增的真实输入
- `state`：当前已累积的主记忆对象，优先级最高
- `conversationContext`：过往对话的摘要化上下文证据，仅用于核对原话和补足细节
```

**编译器逻辑**：
```typescript
// 对于 conversational archetype，自动生成标准结构
if (blueprint.archetype === 'conversational') {
  lines.push('## 输入说明')
  lines.push('payload 中会包含三类信息：')
  lines.push('```json')
  lines.push('{')
  
  Object.entries(input.variables).forEach(([key, desc]) => {
    lines.push(`  "${key}": "${desc}",`)
  })
  
  lines.push('}')
  lines.push('```')
}
```

---

### 3. 上下文规则

#### 优化前 YAML
```yaml
rules:
  context_usage:
    evaluation_mode: "fresh_turn"
    priority: "state优先，依据state判断阶段和缺口"
    context_role: "conversationContext只用来核对原话..."
    conflict_resolution: "state与userInput冲突时..."
    fabrication_policy: "forbidden"
    fabrication_fallback: "不确定就空白或继续追问"
```

#### 优化后 YAML
```yaml
rules:
  context:
    evaluation_mode: fresh_turn
    priority: state优先，依据state判断阶段和缺口
    context_role: conversationContext只用来核对原话...
    conflict_resolution: state与userInput冲突时...
  
  fabrication:
    policy: forbidden
    fallback: 不确定就空白或继续追问
```

#### 编译结果（应该一致）
```markdown
### 上下文使用规则

RULE-01: 这是 fresh turn evaluation。state优先，依据state判断阶段和缺口，不要把 conversationContext 当作需要续写的多轮聊天。

RULE-02: conversationContext只用来核对原话、补足细节、发现state遗漏。

RULE-03: 若 state 与 current turn payload 里的 userInput 冲突，必须以 userInput 为准，并在输出中修正状态。

RULE-04: 不要为了补全字段而编造用户没有明确提供的信息；不确定就空白或继续追问。
```

---

### 4. 输出规格

#### 优化前 YAML
```yaml
output:
  format: "json"
  wrapper: false
  no_preamble: true
  no_explanation: true
  no_apology: true
  no_markdown_wrapper: true
  no_natural_language: true
  top_level_fields:
    - reply
    - state
  requirement: "只输出一个合法JSON对象..."
```

#### 优化后 YAML
```yaml
output:
  format: json
  strict: true
  top_level_fields:
    - reply
    - state
```

#### 编译结果（应该一致）
```markdown
## 输出规格

OUT-01: 只输出一个合法JSON对象，不要输出额外说明文本。

OUT-02: JSON 顶层字段固定为：reply、state

OUT-03: JSON 前后不能有任何前言、解释、总结、道歉、注释、markdown 包装或自然语言。
```

**编译器逻辑**：
```typescript
if (output.format === 'json') {
  lines.push('OUT-01: 只输出一个合法JSON对象，不要输出额外说明文本。')
  
  if (output.top_level_fields) {
    lines.push(`OUT-02: JSON 顶层字段固定为：${output.top_level_fields.join('、')}`)
  }
  
  if (output.strict) {
    lines.push('OUT-03: JSON 前后不能有任何前言、解释、总结、道歉、注释、markdown 包装或自然语言。')
  }
}
```

---

### 5. 边界约束

#### 优化前 YAML
```yaml
constraints:
  - subject: "默认面向提问者本人..."
  - fabrication: "不编造用户没有明确提供的信息..."
  - scope: "此阶段不直接替用户解决业务问题..."
```

#### 优化后 YAML
```yaml
constraints:
  - 默认面向提问者本人，不输出第三方作为主要学习执行者的计划
  - 不编造用户没有明确提供的信息；不确定就保持空白或继续追问
  - 此阶段不直接替用户解决业务问题，也不展开完整学习路径正文
```

#### 编译结果（应该一致）
```markdown
## 边界约束

CON-01: 默认面向提问者本人，不输出第三方作为主要学习执行者的计划

CON-02: 不编造用户没有明确提供的信息；不确定就保持空白或继续追问

CON-03: 此阶段不直接替用户解决业务问题，也不展开完整学习路径正文
```

---

## 📊 优化效果总结

### 字段减少
| 部分 | 优化前 | 优化后 | 减少 |
|------|--------|--------|------|
| Identity | 7 个字段 | 5 个字段 | -28% |
| Input | 9 个字段 | 3 个字段 | -67% |
| Output | 10 个字段 | 3 个字段 | -70% |
| **总计** | **~80 字段** | **~70 字段** | **-12%** |

### YAML 行数
| 部分 | 优化前 | 优化后 | 减少 |
|------|--------|--------|------|
| 元数据 | 11 行 | 6 行 | -45% |
| Identity | 10 行 | 12 行 | +20% |
| Input | 15 行 | 5 行 | -67% |
| Output | 12 行 | 5 行 | -58% |
| Constraints | 5 行 | 5 行 | 0% |
| **总计** | **194 行** | **~170 行** | **-12%** |

### 可读性改善
- ✅ 字段命名更一致（`context` vs `context_usage`）
- ✅ 层级更扁平（减少 1 层嵌套）
- ✅ 冗余更少（移除 `skillId`, `no_xxx` 等）
- ✅ 结构更清晰（`fabrication` 统一管理）

---

## ✅ 验证清单

### 编译器需要支持
- [ ] `id` 替代 `blueprintId`
- [ ] 自动推导 `skillId`
- [ ] `identity.scope` 新格式编译
- [ ] `input.variables` 简化格式编译
- [ ] `rules.context` 替代 `rules.context_usage`
- [ ] `rules.fabrication` 提取为顶层
- [ ] `rules.stages` 替代嵌套的 `understanding_stage`
- [ ] `output.strict` 替代多个 `no_xxx`
- [ ] `constraints` 字符串数组格式

### 测试验证
- [ ] 编译优化后的 YAML
- [ ] 对比生成的 Markdown 和原版
- [ ] 确保所有规则都被正确编译
- [ ] 确保编号连续（RULE-01, 02, 03...）
- [ ] 确保措辞一致

---

## 🔜 下一步

1. **更新编译器** - 支持优化后的 Schema
2. **创建测试用例** - 验证编译结果
3. **迁移现有蓝图** - 转换为新格式
4. **更新 UI 组件** - 适配新字段
5. **文档化新 Schema** - 写清楚规范

---

## 💡 关键发现

### Schema 优化的本质

这次优化不是为了**创造新功能**，而是为了：

1. **减少冗余** - 移除可推导的字段
2. **统一结构** - 让相似的概念用相似的方式表达
3. **保持灵活** - 不强制模板化复杂的领域知识
4. **提高可读** - 让 YAML 更简洁、更清晰

### 我们没有做的事

- ❌ 没有引入新的 Source Module 文件
- ❌ 没有过度原子化
- ❌ 没有强制模板化所有文本
- ❌ 没有创建新的 DSL

### 我们做的事

- ✅ 简化了现有的 YAML 结构
- ✅ 减少了冗余和重复
- ✅ 统一了命名和层级
- ✅ 保留了必要的灵活性

**这才是务实的 Schema 优化！**
