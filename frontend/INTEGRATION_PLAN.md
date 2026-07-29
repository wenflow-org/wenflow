# 已归档：Lab → Workbench 整合实施方案（v2）

> 本文描述的 `prompt-lab/sources` 集成路径已退役。
> 当前入口为 `prompts/core/*.yaml` 与 Admin「Prompt 工作台」。

## 🎯 目标
将 Prompt Lab 的功能完全整合进 PromptWorkbench，统一编辑入口。

## 📋 实施步骤（简化版）

### Phase 1: 重构编辑模式（核心变更）

#### 1.1 修改 PromptWorkbench.vue
**变更点**：
- 将当前的 3 种编辑模式（字段表/源文本/结构化）改为 2 层选择
- 第一层：编辑范式（constrained 源文件编辑 / direct 直接编辑）
- 第二层：视图模式（根据范式自动展示）

**UI 结构**：
```
编辑范式选择（新增）
├── 源文件编辑（推荐）← 对应原"结构化"模式
│   └── SourceView 组件
│   └── 编译约定查看（新增）
└── 直接编辑
    ├── 源文本视图 ← 原"源文本"模式
    └── 字段表视图 ← 原"字段表"模式
```

#### 1.2 编译流程自动化
- 源文件编辑 → 强制 LLM 编译
- 直接编辑 → 快速编译
- 移除编译模式选择器（compileMode 自动根据 paradigm 决定）

### Phase 2: 强制新 Skill 使用源文件

#### 2.1 后端 API
**新增接口**：`POST /api/admin/prompt-ops/skills/:skillId/init-source`
- 自动创建 `prompt-lab/sources/{skillId}.md` 模板文件

#### 2.2 前端创建流程
- SkillManager 新建 Skill 时，自动调用 init-source
- 跳转到 Workbench 时，URL 携带 `?paradigm=constrained`
- Workbench 检测到新 Skill，自动进入"源文件编辑"模式

### Phase 3: Lab 页面降级

#### 3.1 保留为文档页
- `/admin/prompt-lab` 改为静态文档展示
- 只展示编译约定内容
- 移除 5 步工作流

#### 3.2 从导航菜单调整
- "Prompt 实验台" 改为 "编译约定文档"
- 或者直接移除，在 Workbench 中内嵌查看

## 🔧 技术细节

### 关键组件不变
- ✅ SourceView 组件（Lab 的结构化编辑器）
- ✅ FieldTableEditor 组件
- ✅ 编译 API（fast compile 和 LLM compile）
- ✅ 发布 API

### 需要新增
- 🆕 编辑范式选择 UI
- 🆕 编译约定内嵌展示
- 🆕 新 Skill 创建源文件 API

### 需要移除
- ❌ compileMode 手动选择器
- ❌ Lab 的 5 步工作流页面

## 📅 实施顺序

1. **先做 Phase 1**：重构 PromptWorkbench 编辑模式
2. **再做 Phase 2**：新 Skill 强制源文件
3. **最后 Phase 3**：Lab 页面降级（可选）

## ⚠️ 注意事项

- 现有的 5 个 Lab 源文件不受影响
- 老 Skill 可以继续用直接编辑模式
- 所有编译 API 保持不变
- 版本管理逻辑不变

## 🎯 预期效果

- 用户只需访问 `/admin/skills/:skillId` 一个页面
- 新 Skill 自动引导使用源文件编辑
- 运营人员在统一界面中调整
