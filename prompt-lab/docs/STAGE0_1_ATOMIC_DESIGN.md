# Stage 0 & 1: 原子化架构设计方案

## 🎯 目标

将配置拆分为最小可重用单元（原子），通过组合构建完整的蓝图。

---

## 架构设计

```
Stage 0: 原子层 (Atoms)
    ↓ 组合
Stage 1: 模块层 (Modules)
    ↓ 组合
Stage 2: 蓝图层 (Blueprints)
```

---

## Stage 0: 原子层

### 什么是原子？

**原子 = 最小配置单元 + 编译模板**

一个原子定义：
- 单一配置项的元数据（类型、范围、默认值）
- 如何编译成 Prompt 文本的模板
- 验证规则

### 原子文件格式

```yaml
# atoms/behavior/max-questions-per-turn.yaml
atomId: max_questions_per_turn
category: behavior
type: number
range: [1, 5]
default: 1
description: "每次最多提问数"

# 编译模板
compileTemplate: |
  每次最多问 {{value}} 个核心问题，避免连续追问。

# 验证规则
validation:
  required: false
  min: 1
  max: 5
  errorMessage: "提问数必须在 1-5 之间"

# 适用的 Archetype
applicableArchetypes:
  - conversational

# 依赖关系
dependencies: []

# 示例值
examples:
  - value: 1
    compiledTo: "每次最多问 1 个核心问题，避免连续追问。"
  - value: 3
    compiledTo: "每次最多问 3 个核心问题，避免连续追问。"
```

### 原子目录结构

```
atoms/
├── context/                    # 上下文相关
│   ├── evaluation-mode.yaml
│   ├── priority.yaml
│   ├── conflict-resolution.yaml
│   ├── fabrication-policy.yaml
│   └── fabrication-fallback.yaml
│
├── behavior/                   # 行为相关
│   ├── max-questions-per-turn.yaml
│   ├── tone.yaml
│   ├── no-interrogation.yaml
│   ├── reply-structure.yaml
│   └── subject.yaml
│
├── output/                     # 输出相关
│   ├── format.yaml
│   ├── wrapper.yaml
│   ├── strict-schema.yaml
│   └── top-level-fields.yaml
│
└── identity/                   # 身份相关
    ├── role.yaml
    ├── mission.yaml
    └── scope.yaml
```

---

## Stage 1: 模块层

### 什么是模块？

**模块 = 一组相关原子的组合 + 章节模板**

一个模块定义：
- 包含哪些原子
- 原子的组合顺序
- 章节标题和结构
- 编译时的逻辑

### 模块文件格式

```yaml
# modules/context-usage-rules.yaml
moduleId: context_usage_rules
category: rules
displayName: "上下文使用规则"

# 包含的原子
atoms:
  - evaluation_mode
  - priority
  - conflict_resolution
  - fabrication_policy
  - fabrication_fallback

# 原子组合顺序（决定编译顺序）
compositionOrder:
  - evaluation_mode
  - conflict_resolution
  - fabrication_policy

# 章节模板
sectionTemplate: |
  ### 上下文使用规则
  
  {{atoms}}

# 编译逻辑
compileLogic:
  # 如果 fabrication_policy = forbidden，则必须包含 fabrication_fallback
  conditionalAtoms:
    - condition: "fabrication_policy === 'forbidden'"
      requiredAtoms: [fabrication_fallback]

# 适用的 Archetype
applicableArchetypes:
  - conversational
  - generator

# 依赖的其他模块
dependencies: []
```

### 模块目录结构

```
modules/
├── identity.yaml               # 身份定义模块
├── context-usage-rules.yaml    # 上下文使用规则模块
├── behavior-rules.yaml         # 行为规则模块
├── output-spec.yaml            # 输出规格模块
├── constraints.yaml            # 边界约束模块
└── state-machine.yaml          # 状态机模块
```

---

## Stage 2: 蓝图层（重构）

### 新的蓝图格式

**之前**（直接写配置）:
```yaml
blueprintId: goal-conversation
archetype: conversational
identity:
  role: 学习目标澄清助手
  mission: 通过对话澄清学习目标
rules:
  behavior:
    max_questions_per_turn: 1
```

**之后**（引用模块 + 赋值）:
```yaml
blueprintId: goal-conversation
archetype: conversational

# 引用模块
modules:
  - identity
  - context_usage_rules
  - behavior_rules
  - output_spec
  - constraints

# 只需要给原子赋值
values:
  # identity 模块的原子
  role: "学习目标澄清助手"
  mission: "通过对话澄清学习目标"
  scope:
    not_business_consultant: true
    not_full_path_generator: true
  
  # behavior_rules 模块的原子
  max_questions_per_turn: 1
  tone: "natural_transition"
  no_interrogation: "不能像问卷或审问"
  
  # context_usage_rules 模块的原子
  evaluation_mode: fresh_turn
  priority: "state优先"
  conflict_resolution: "userInput_always_wins"
  fabrication_policy: forbidden
  fabrication_fallback: "不确定就空白或继续追问"
  
  # output_spec 模块的原子
  format: json
  wrapper: false
  top_level_fields: [reply, state]
```

**优势**:
- ✅ 蓝图文件更简洁（只有值，没有结构）
- ✅ 模块可重用（多个 Skill 共享）
- ✅ 原子可重用（多个模块共享）
- ✅ 易于维护（修改原子模板，所有使用它的地方自动更新）

---

## 编译流程

### 原子化编译流程

```typescript
function compileAtomicBlueprint(blueprint: AtomicBlueprint): string {
  // 1. 加载引用的模块
  const modules = blueprint.modules.map(moduleId => loadModule(moduleId))
  
  // 2. 收集所有原子
  const atoms = modules.flatMap(module => 
    module.atoms.map(atomId => loadAtom(atomId))
  )
  
  // 3. 填充值到原子模板
  const compiledAtoms = atoms.map(atom => {
    const value = blueprint.values[atom.atomId]
    return compileAtomTemplate(atom.compileTemplate, value)
  })
  
  // 4. 按模块组合
  const sections = modules.map(module => {
    const moduleAtoms = compiledAtoms.filter(ca => 
      module.atoms.includes(ca.atomId)
    )
    return compileSectionTemplate(module.sectionTemplate, moduleAtoms)
  })
  
  // 5. 生成最终 Markdown
  return sections.join('\n\n')
}
```

---

## 实现计划

### Phase 1: 原子层基础设施
1. 定义原子类型接口
2. 创建原子加载器
3. 创建原子编译器
4. 创建 10 个核心原子

### Phase 2: 模块层基础设施
1. 定义模块类型接口
2. 创建模块加载器
3. 创建模块编译器
4. 创建 6 个核心模块

### Phase 3: 蓝图层重构
1. 更新蓝图格式
2. 创建原子化蓝图编译器
3. 迁移现有蓝图

### Phase 4: 前端集成
1. 原子编辑器组件
2. 模块编辑器组件
3. 可视化原子/模块浏览器

---

## 示例：完整原子化蓝图

### 原子定义

```yaml
# atoms/behavior/max-questions-per-turn.yaml
atomId: max_questions_per_turn
type: number
range: [1, 5]
default: 1
compileTemplate: "每次最多问 {{value}} 个核心问题，避免连续追问。"
```

### 模块定义

```yaml
# modules/behavior-rules.yaml
moduleId: behavior_rules
atoms: [max_questions_per_turn, tone, no_interrogation]
sectionTemplate: |
  ### 行为规则
  
  {{atoms}}
```

### 蓝图定义

```yaml
# blueprints/goal-conversation.yaml
blueprintId: goal-conversation
modules: [identity, behavior_rules, output_spec]
values:
  max_questions_per_turn: 1
  tone: "natural_transition"
  format: json
```

### 编译结果

```markdown
### 行为规则

每次最多问 1 个核心问题，避免连续追问。
```

---

## 优势总结

| 维度 | 之前 | 原子化后 |
|------|------|---------|
| 配置重用 | 复制粘贴 | 引用原子 |
| 修改影响 | 单个蓝图 | 所有使用该原子的蓝图 |
| 措辞一致性 | 手动保证 | 自动保证 |
| 可测试性 | 整体测试 | 原子级测试 |
| 学习曲线 | 需要理解所有规则 | 只需了解原子和模块 |
| 蓝图大小 | 177 行 | ~50 行（只有值） |

---

## 下一步

1. 创建原子类型定义
2. 实现原子加载器和编译器
3. 创建 10 个核心原子
4. 实现模块加载器和编译器
5. 创建 6 个核心模块
6. 重构现有蓝图为原子化格式

要开始实现吗？
