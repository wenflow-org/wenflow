# 编译约定

## 输入

源文件使用 `#` 和 `##` 分区，分为两大块：

```markdown
# DEFINITIONS
  身份、输入变量、输出字段、状态机阶段的声明

# EXECUTION
  上下文处理、阶段逻辑、字段填充指导、格式约束、边界约束
```

具体到每个 Skill 的源文件结构：

```
## Identity       — 角色与任务
## Input          — 输入变量表格
## Output Schema  — 输出字段定义（类型、说明、正反例）
## Stages         — 状态机阶段与转换条件

## Format         — 输出格式约束
## Context Handling — 上下文处理规则
## Stage Logic    — 阶段切换逻辑
## Output Guidance — 各字段填充指导
## Constraints    — 边界约束
```

---

## 产出

编译后 Prompt 的章节顺序：

1. `## 身份定义` — 来自 Identity
2. `## 输入说明` — 来自 Input
3. `## 执行规则` — 来自 Context Handling + Stage Logic + Output Guidance 中与行为相关的部分
4. `## 状态机` — 来自 Stages + Stage Logic（仅在源文件包含 Stages 时生成）
5. `## 输出规格` — 来自 Output Schema + Output Guidance + Format
6. `## 边界约束` — 来自 Constraints

---

## 编译映射

### Identity → 身份定义

角色与任务描述，紧凑到 2-3 句。

### Input → 输入说明

表格转为变量列表。框架变量（userInput、state 等）用 JSON 块展示，业务变量用自然语言列表。

### Output Schema + Output Guidance + Format → 输出规格

先给格式约束，再列顶层字段。每个字段的定义紧邻它来自 Output Guidance 的功能说明。最后列出禁止输出的平台字段。

### Stages + Stage Logic → 状态机

先列阶段定义，再列硬条件（必须满足才能推进），再列软信息（参考但不阻止推进），最后给收敛判断逻辑。

### Context Handling + Stage Logic （行为部分） → 执行规则

按原有分组标题保留子分类。规则措辞保留原意，必要时润色表达。

### Constraints → 边界约束

每条独立一行。

---

## 编译原则

- 源文件的章节内容忠实保留到对应产物章节，语义不变
- 输出字段的功能说明紧邻字段定义，不分散在其他区域
- 措辞可润色，但结构不走样
