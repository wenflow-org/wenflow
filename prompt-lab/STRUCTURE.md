# Prompt Lab 目录结构

```
prompt-lab/
│
├── blueprints/                          # 基础设施数据（源文件）⭐
│   ├── goal-conversation.yaml               # 目标对话蓝图
│   └── goal-conversation.schema.json        # I/O 字段定义
│
├── prompts/                             # 编译产物（自动生成）✨
│   └── goal-conversation.md                 # 编译后的提示词
│
├── docs/                                # 文档
│   ├── ARCHITECTURE.md                      # 架构说明
│   ├── BLUEPRINT_SPEC_V3.md                 # 蓝图规范 v3.0
│   └── COMPILER_GUIDE.md                    # 编译器使用指南
│
├── prompts-legacy/                      # 旧版提示词（参考）
│   ├── skill.goal-conversation.md           # 原始手写提示词
│   ├── skill.path-planning.md
│   ├── skill.peer-reinforcement.md
│   ├── skill.session-wrapup.md
│   └── skill.teaching-turn.md
│
├── skills/                              # 旧版蓝本结构（待迁移）
│   └── goal-conversation/
│       ├── identity.md
│       ├── rules/
│       ├── io-schema.json
│       └── ...
│
└── README.md                            # 项目说明
```

---

## 目录说明

### 📁 blueprints/ - **核心工作目录**

**性质**: 源文件，可编辑

**内容**: YAML 蓝图 + JSON Schema

**用途**:
- ✅ 在 Prompt Lab 中编辑
- ✅ Git 版本控制
- ✅ 字段级别配置

**编辑方式**: 可视化表单编辑器

**文件格式**:
```
{skill-name}.yaml        # 蓝图主文件
{skill-name}.schema.json # I/O 字段定义
```

---

### 📁 prompts/ - **编译输出目录**

**性质**: 编译产物，只读

**内容**: Markdown 提示词

**用途**:
- ✅ 预览编译结果
- ✅ 复制到生产环境
- ⚠️ 不要手动编辑！

**生成方式**: 编译器自动生成

**文件格式**:
```
{skill-name}.md          # 编译后的提示词
```

---

### 📁 docs/ - **文档目录**

**内容**:
- `ARCHITECTURE.md` - 架构设计说明
- `BLUEPRINT_SPEC_V3.md` - YAML 蓝图格式规范
- `COMPILER_GUIDE.md` - 编译器使用指南

---

### 📁 prompts-legacy/ - **旧版参考**

**内容**: 原始手写的 Markdown 提示词

**用途**:
- 参考原有的提示词内容
- 迁移到 YAML 蓝图时对比

**状态**: 归档，不再维护

---

### 📁 skills/ - **旧版蓝本结构**

**内容**: 旧的分文件蓝本结构

**状态**: 待迁移到 YAML 格式

**迁移计划**:
- [ ] goal-conversation (已有 YAML)
- [ ] path-planning
- [ ] teaching-turn
- [ ] session-wrapup
- [ ] peer-reinforcement

---

## 工作流程

### 1. 编辑蓝图

```
在 Prompt Lab 中打开
  ↓
blueprints/goal-conversation.yaml
  ↓
修改字段：max_questions_per_turn: 2
  ↓
保存
```

### 2. 编译

```
点击"编译"按钮
  ↓
编译器读取 YAML
  ↓
生成 prompts/goal-conversation.md
```

### 3. 预览

```
查看编译结果
  ↓
prompts/goal-conversation.md (只读)
```

### 4. 测试

```
复制提示词
  ↓
在测试环境运行
  ↓
验证输出
```

### 5. 发布

```
编译通过
  ↓
复制到生产环境
  ↓
wenflow/prompts/skill.goal-conversation.md
```

---

## 文件命名规范

### 蓝图文件
```
blueprints/{skill-name}.yaml
blueprints/{skill-name}.schema.json
```

### 编译产物
```
prompts/{skill-name}.md
```

### 生产环境
```
wenflow/prompts/skill.{skill-name}.md
```

**注意**: 蓝图文件不带 `skill.` 前缀，生产环境才带。

---

## 当前状态

### ✅ 已完成
- [x] 目录结构重组
- [x] goal-conversation YAML 蓝图
- [x] 编译器实现
- [x] 文档完善

### 🚧 待完成
- [ ] 其他 4 个 skill 的 YAML 蓝图
- [ ] 前端 YAML 编辑器
- [ ] 自动化编译流程
- [ ] 生产环境部署

---

## 重要提醒

⚠️ **只编辑 blueprints/ 中的文件！**

- ✅ blueprints/*.yaml - 可编辑
- ❌ prompts/*.md - 只读，自动生成
- ❌ prompts-legacy/*.md - 归档，不要修改

⚠️ **prompts/ 目录的文件会被编译器覆盖！**

所有修改都应该在 blueprints/ 中进行。
