# Lab → Workbench 整合进度报告

## ✅ 已完成工作

### Phase 1: 重构 Workbench 编辑模式（已完成）

#### 前端修改
**文件**: `frontend/src/views/admin/components/promptOps/PromptWorkbench.vue`

**新增功能**:
1. ✅ 添加编辑范式选择（`paradigm` 状态）
   - `constrained`: 源文件编辑（推荐·规范化）
   - `direct`: 直接编辑（高级·自由编辑）

2. ✅ 重构编辑步骤 UI
   - 两个范式卡片展示
   - 根据范式显示不同的编辑器
   - 源文件模式：使用 Lab 的 SourceView 组件
   - 直接编辑模式：源文本 + 字段表

3. ✅ 添加新方法
   - `showCompileSpec()`: 查看编译约定
   - `createSourceFile()`: 创建源文件模板
   - `checkAndSetParadigm()`: 自动检测并设置范式

4. ✅ 新增样式
   - `.paradigm-selector`: 范式选择器容器
   - `.paradigm-card`: 范式卡片样式
   - `.editor-header`: 编辑器头部样式

### Phase 2: 统一编译流程（已完成）

#### 自动化逻辑
1. ✅ 根据范式自动选择编译模式
   - `paradigm === 'constrained'` → `compileMode = 'llm'`
   - `paradigm === 'direct'` → `compileMode = 'fast'`

2. ✅ 移除手动编译模式选择器
   - 编译步骤不再显示"快速编译 / LLM 编译"切换按钮
   - 编译方式由范式自动决定

3. ✅ 更新所有相关逻辑
   - `stepDone()`: 基于 paradigm 判断
   - `publishTargetPrompt`: 基于 paradigm 选择
   - 状态栏显示: 基于 paradigm 显示不同信息
   - 审核步骤: 基于 paradigm 显示不同视图

### 后端 API（已完成）

#### 新增接口
**文件**: `backend/src/routes/prompt-lab.ts`

1. ✅ `POST /api/admin/prompt-lab/source/:skillId/create`
   - 创建源文件模板
   - 检查文件是否已存在
   - 返回成功/失败状态

**文件**: `frontend/src/api/adminApi.ts`

2. ✅ `adminPromptLabApi.createSourceFile(skillId)`
   - 前端调用方法

---

## 🎯 当前状态

### 已实现功能
- ✅ 编辑范式选择 UI
- ✅ 源文件编辑器集成
- ✅ 编译流程自动化
- ✅ 创建源文件 API
- ✅ 查看编译约定功能
- ✅ 页面渲染正常，无错误

### 待测试功能
- ⏳ 点击"创建源文件模板"按钮
- ⏳ 源文件编辑 → LLM 编译 → 审核 → 发布完整流程
- ⏳ 直接编辑 → 快速编译 → 热更换流程

---

## 📋 后续任务

### 高优先级

#### 1. 测试创建源文件功能
- [ ] 选择一个没有源文件的 Skill
- [ ] 切换到"源文件编辑"范式
- [ ] 点击"创建源文件模板"按钮
- [ ] 验证源文件是否成功创建在 `prompt-lab/sources/` 目录

#### 2. 测试完整工作流
- [ ] 源文件编辑 → 保存
- [ ] LLM 编译 → 查看产物
- [ ] 审核 → 发布为正式版
- [ ] 验证生产文件是否更新

### 中优先级

#### 3. Phase 3: 强制新 Skill 使用源文件约束
**目标**: 新建 Skill 时自动创建源文件

**需要修改的文件**:
- `frontend/src/views/admin/SkillManager.vue`
  - 新建 Skill 时调用 `createSourceFile` API
  - 跳转到 Workbench 时携带 `?paradigm=constrained` 参数

- `frontend/src/views/admin/components/promptOps/PromptWorkbench.vue`
  - 检测 URL 参数 `paradigm`
  - 自动设置范式

### 低优先级

#### 4. Phase 4: Lab 页面改造为编译约定文档页
**目标**: 将 `/admin/prompt-lab` 改为只读文档页

**需要修改**:
- `frontend/src/views/admin/PromptLab.vue`
  - 移除 5 步工作流
  - 只保留编译约定展示
  - 添加"开始编辑 Skill"按钮跳转到 SkillManager

#### 5. Phase 5: 添加运营友好的引导流程
**目标**: 首次使用时的引导

**需要添加**:
- 使用 `el-tour` 组件
- 引导步骤：范式选择 → 编辑 → 编译 → 发布
- 可关闭，记住用户偏好

---

## 🔍 技术细节

### 关键状态变量
```typescript
const paradigm = ref<'constrained' | 'direct'>('direct')
const compileMode = ref<'fast' | 'llm'>('fast')
```

### 自动化逻辑
```typescript
// 根据范式自动设置编译模式
watch(() => paradigm.value, (newParadigm) => {
  if (newParadigm === 'constrained') {
    compileMode.value = 'llm'
  } else {
    compileMode.value = 'fast'
  }
})

// 自动检测是否有源文件
const checkAndSetParadigm = async () => {
  if (!bareSkillId.value) return
  try {
    await loadStructuredSource()
    if (structuredSourceDoc.value) {
      paradigm.value = 'constrained'
    }
  } catch (error) {
    paradigm.value = 'direct'
  }
}
```

### 后端 API
```typescript
// 前端调用
await adminPromptLabApi.createSourceFile(skillId)

// 后端路由
POST /api/admin/prompt-lab/source/:skillId/create
```

---

## 📊 整合效果对比

### 整合前
```
用户需要在两个页面间切换：
1. /admin/prompt-lab （Lab 的 5 步流程）
2. /admin/skills/:skillId （Workbench 的编辑器）

问题：
- 功能割裂
- 学习成本高
- 版本管理分散
```

### 整合后
```
用户只需访问一个页面：
/admin/skills/:skillId

功能：
- 范式选择：源文件编辑 vs 直接编辑
- 编译自动化：根据范式自动选择
- 统一发布：版本历史统一管理
```

---

## 🎉 成果

### 代码变更
- 修改文件: 2 个
  - `frontend/src/views/admin/components/promptOps/PromptWorkbench.vue` (+200 行)
  - `backend/src/routes/prompt-lab.ts` (+60 行)
- 新增 API: 2 个
  - `POST /api/admin/prompt-lab/source/:skillId/create`
  - `adminPromptLabApi.createSourceFile()`

### 用户体验
- ✅ 统一入口
- ✅ 清晰的范式选择
- ✅ 自动化编译流程
- ✅ 保留两种工作方式的灵活性

### 技术价值
- ✅ 代码复用（Lab 的 SourceView 组件）
- ✅ 逻辑统一（编译 API 共用）
- ✅ 易于维护（一个页面，两种模式）

---

## 📝 备注

- Lab 的源文件格式（DEFINITIONS / EXECUTION）完全保留
- Lab 的 LLM 编译功能完全保留
- Workbench 的快速编译功能完全保留
- 用户可以自由选择工作方式
- 新 Skill 将强制使用源文件模式（待实现）

---

**最后更新**: 2026-06-29
**状态**: Phase 1 & 2 已完成，等待测试和后续实施
