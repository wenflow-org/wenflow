# 优化层测试用例

## 测试用例 1: 去重约束

### 输入
```yaml
constraints:
  - "默认面向提问者本人"
  - "不编造信息"
  - "默认面向提问者本人"  # 重复
  - "不解决业务问题"
  - "不编造信息"  # 重复
```

### 优化后
```yaml
constraints:
  - "默认面向提问者本人"
  - "不编造信息"
  - "不解决业务问题"
```

### 优化变更
```
[移除] constraints: 移除 2 个重复约束
```

---

## 测试用例 2: 自动推断 - JSON 格式

### 输入
```yaml
output:
  format: json
  wrapper: false
  # 缺少 forbidden_extra_text
```

### 优化后
```yaml
output:
  format: json
  wrapper: false
  forbidden_extra_text:
    - "前言"
    - "解释"
    - "总结"
    - "道歉"
    - "注释"
    - "markdown 包装"
    - "自然语言"
```

### 优化变更
```
[新增] output.forbidden_extra_text: JSON 格式自动添加禁止额外文本列表
```

---

## 测试用例 3: Archetype 补全 - conversational

### 输入
```yaml
archetype: conversational
# 缺少 rules
```

### 优化后
```yaml
archetype: conversational
rules:
  context_usage:
    evaluation_mode: fresh_turn
    priority: state优先
    conflict_resolution: userInput_always_wins
    fabrication_policy: forbidden
    fabrication_fallback: 不确定就空白或继续追问
  behavior:
    max_questions_per_turn: 1
```

### 优化变更
```
[新增] rules.context_usage: conversational archetype 自动添加上下文使用规则
[新增] rules.behavior: conversational archetype 自动添加行为规则块
[新增] rules.behavior.max_questions_per_turn: conversational archetype 默认每次最多提问 1 个
```

---

## 测试用例 4: Archetype 补全 - generator

### 输入
```yaml
archetype: generator
output:
  format: json
  # 缺少 strict_schema
```

### 优化后
```yaml
archetype: generator
output:
  format: json
  strict_schema: true
```

### 优化变更
```
[新增] output.strict_schema: generator archetype 默认使用严格 schema
```

---

## 测试用例 5: Archetype 补全 - extractor

### 输入
```yaml
archetype: extractor
output:
  # 缺少 format
  wrapper: false
```

### 优化后
```yaml
archetype: extractor
output:
  format: json
  wrapper: false
```

### 优化变更
```
[新增] output.format: extractor archetype 默认输出 JSON 格式
```

---

## 测试用例 6: 规则顺序优化

### 输入
```yaml
rules:
  state_machine: {...}
  behavior: {...}
  context_usage: {...}
```

### 优化后
```yaml
rules:
  context_usage: {...}  # 移到最前
  behavior: {...}
  state_machine: {...}
```

### 优化变更
```
[修改] rules: 优化规则顺序以提高可读性
```

---

## 测试用例 7: 综合优化

### 输入
```yaml
blueprintId: test
archetype: conversational
name: 测试
identity:
  role: 助手
  mission: 帮助用户
output:
  format: json
  # 缺少 wrapper
constraints:
  - "约束1"
  - "约束2"
  - "约束1"  # 重复
```

### 优化后
```yaml
blueprintId: test
archetype: conversational
name: 测试
identity:
  role: 助手
  mission: 帮助用户
rules:
  context_usage:
    evaluation_mode: fresh_turn
    priority: state优先
    conflict_resolution: userInput_always_wins
    fabrication_policy: forbidden
    fabrication_fallback: 不确定就空白或继续追问
  behavior:
    max_questions_per_turn: 1
output:
  format: json
  wrapper: false
  forbidden_extra_text:
    - "前言"
    - "解释"
    - "总结"
    - "道歉"
    - "注释"
    - "markdown 包装"
    - "自然语言"
constraints:
  - "约束1"
  - "约束2"
```

### 优化变更
```
[移除] constraints: 移除 1 个重复约束
[新增] output.wrapper: 默认不使用包装符
[新增] output.forbidden_extra_text: JSON 格式自动添加禁止额外文本列表
[新增] rules.context_usage: conversational archetype 自动添加上下文使用规则
[新增] rules.behavior: conversational archetype 自动添加行为规则块
[新增] rules.behavior.max_questions_per_turn: conversational archetype 默认每次最多提问 1 个
```

**总计**: 6 项优化

---

## 如何测试

### 方式 1: 在浏览器中测试
1. 访问 `http://localhost:5176/admin/prompt-lab`
2. 编辑蓝图，故意留空某些字段
3. 点击"编译"
4. 查看优化提示

### 方式 2: 单元测试
```typescript
import { optimizeBlueprint } from '@/utils/blueprintOptimizer'

test('去重约束', () => {
  const blueprint = {
    // ... 基础字段
    constraints: ['约束1', '约束2', '约束1']
  }
  
  const result = optimizeBlueprint(blueprint)
  
  expect(result.optimized.constraints).toEqual(['约束1', '约束2'])
  expect(result.changes.length).toBe(1)
  expect(result.changes[0].type).toBe('removed')
})
```

---

## 优化策略总结

| 优化类型 | 触发条件 | 优化内容 |
|---------|---------|---------|
| 去重 | constraints 有重复 | 移除重复项 |
| 推断 | JSON 格式 + 无 wrapper | 添加 forbidden_extra_text |
| 推断 | wrapper 未定义 | 默认设为 false |
| 补全 | conversational + 无 behavior | 添加行为规则 |
| 补全 | conversational + 无 context_usage | 添加上下文规则 |
| 补全 | generator + 无 strict_schema | 添加严格模式 |
| 补全 | extractor + 无 format | 设为 json |
| 重排 | rules 顺序不推荐 | 按推荐顺序重排 |
