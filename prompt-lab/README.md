# Prompt Lab - 基础设施配置工作区

这个目录不是存储"提示词"的地方，而是存储**基础设施数据**的地方。

## 核心概念

```
蓝图（Blueprint）         →  Skill 编译  →  提示词（Prompt）
基础设施数据，字段化            编译器         LLM 可执行
```

类比编程语言：

```
TypeScript 源码          →  tsc 编译  →  JavaScript
高级语言                    编译器         可执行代码

YAML 蓝图               →  Skill 编译  →  Markdown Prompt
基础设施数据                 编译器         LLM 可执行
```

---

## 目录结构

```
prompt-lab/
├── blueprints/                    # 基础设施数据（源文件）
│   ├── goal-conversation.yaml           # 目标对话蓝图
│   ├── goal-conversation.schema.json    # I/O 字段定义
│   ├── path-planning.yaml               # 路径规划蓝图
│   └── ...
│
├── prompts/                       # 编译产物（只读，自动生成）
│   ├── goal-conversation.md             # 编译后的提示词
│   ├── path-planning.md
│   └── ...
│
├── docs/                          # 规范文档
│   ├── BLUEPRINT_SPEC_V3.md             # 蓝图规范 v3.0
│   ├── COMPILER_GUIDE.md                # 编译器使用指南
│   └── ARCHITECTURE.md                  # 架构说明
│
└── README.md                      # 本文件
```

---

## 文件类型说明

### 1. 蓝图（Blueprints）- 可编辑的基础设施数据

**位置**: `blueprints/*.yaml`

**性质**:
- ✅ 结构化数据（YAML 格式）
- ✅ 字段级别编辑
- ✅ 声明式（what，不是 how）
- ✅ 无编号、无冗余
- ✅ 人类可读、机器可解析
- ❌ 不能直接给 LLM 执行

**用途**:
- 在 Prompt Lab 中可视化编辑
- 版本控制（Git）
- 字段级别的修改和配置

**示例**:
```yaml
rules:
  behavior:
    max_questions_per_turn: 1
    tone: "natural_transition"
```

---

### 2. 提示词（Prompts）- 编译产物

**位置**: `prompts/*.md`

**性质**:
- ✅ 自然语言（Markdown 格式）
- ✅ 详细展开说明
- ✅ 带编号（RULE-XX）
- ✅ 指令式（how，明确指示）
- ✅ LLM 可直接执行
- ⚠️ 只读文件（自动生成，不要手动编辑）

**用途**:
- 实际运行时给 LLM 执行
- 测试验证
- 预览编译结果

**示例**:
```markdown
RULE-09: 每次最多问 1 个核心问题，避免连续追问。
RULE-11: 提问语气不能像问卷或审问，优先使用自然过渡...
```

---

## 工作流程

### 1. 编辑阶段（人工操作）

```
运营人员在 Prompt Lab 中
  ↓
打开蓝图：blueprints/goal-conversation.yaml
  ↓
字段级别编辑：max_questions_per_turn: 2
  ↓
保存蓝图
```

### 2. 编译阶段（平台自动）

```
点击"编译"按钮
  ↓
Skill 编译器读取 YAML
  ↓
应用 conversational archetype 模板
  ↓
自动生成 RULE-XX 编号
  ↓
生成自然语言描述
  ↓
输出到 prompts/goal-conversation.md
```

### 3. 测试阶段（验证）

```
预览编译后的提示词
  ↓
在测试环境运行
  ↓
验证 LLM 输出
  ↓
通过 → 发布到生产
失败 → 回到编辑阶段
```

### 4. 发布阶段（部署）

```
编译通过
  ↓
复制 prompts/goal-conversation.md
  ↓
到生产环境：wenflow/prompts/skill.goal-conversation.md
  ↓
LLM 执行新提示词
```

---

## 蓝图规范

详见 `docs/BLUEPRINT_SPEC_V3.md`

核心原则：
1. **结构化** - YAML 格式，类型清晰
2. **无编号** - 编译器自动生成 RULE-XX
3. **声明式** - 描述"是什么"，不是"怎么做"
4. **字段化** - 每个配置项都是独立字段

---

## 编译器

详见 `docs/COMPILER_GUIDE.md`

**位置**: `wenflow/frontend/src/utils/blueprintCompiler.ts`

**命令行使用**:
```bash
cd wenflow/frontend
npx tsx scripts/test-compiler.ts
```

**前端集成**:
```typescript
import { compileBlueprint } from '@/utils/blueprintCompiler'

const compiled = compileBlueprint(blueprint)
```

---

## 当前状态

### ✅ 已完成
- [x] YAML 蓝图格式规范 v3.0
- [x] 蓝图编译器实现
- [x] goal-conversation 蓝图示例
- [x] 编译测试通过

### 🚧 进行中
- [ ] 前端 YAML 蓝图加载器
- [ ] 可视化蓝图编辑器
- [ ] 编译按钮和预览功能

### 📋 待完成
- [ ] 其他 4 个 skill 的蓝图
- [ ] 生产环境部署流程
- [ ] CI/CD 自动编译

---

## 重要提醒

⚠️ **prompts/ 目录中的文件是编译产物，不要手动编辑！**

如果需要修改提示词内容：
1. 编辑 `blueprints/*.yaml`（基础设施数据）
2. 运行编译器
3. 查看 `prompts/*.md`（自动生成）

⚠️ **blueprints/ 才是源文件，才应该被版本控制和编辑！**
