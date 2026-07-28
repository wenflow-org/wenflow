# Prompt Lab 前端重构方案

## 🎯 目标

将 Prompt Lab 从"Markdown 蓝本编辑器"改造为"YAML 基础设施配置器 + 编译预览器"。

---

## 当前架构 vs 目标架构

### 当前架构（Markdown 蓝本）

```
前端 UI
  ↓ 加载
Markdown 蓝本 (blueprint.*.md)
  ↓ 解析
BlueprintParser (parseFrontmatter + parseFields)
  ↓
Store (blueprint: { meta, fields, schema })
  ↓
编辑器组件（Markdown 文本编辑）
  ↓ 保存
更新 Markdown 文件
```

**问题**:
- 编辑的是 Markdown 自然语言，不是结构化数据
- 需要手动维护编号（RULE-01, RULE-02...）
- 难以做字段级别的验证和约束

---

### 目标架构（YAML 蓝图）

```
前端 UI
  ↓ 加载
YAML 蓝图 (blueprints/*.yaml)
  ↓ 解析
YamlParser (js-yaml)
  ↓
Store (blueprint: { identity, rules, output, constraints })
  ↓
表单编辑器（字段级编辑）
  ↓ 实时编译
编译器 (blueprintCompiler)
  ↓
预览面板（只读 Markdown）
  ↓ 保存
更新 YAML 文件 + 编译生成 Markdown
```

**优势**:
- ✅ 编辑结构化数据，不是自然语言
- ✅ 编译器自动生成编号
- ✅ 表单验证，降低出错率
- ✅ 实时预览编译结果

---

## 文件改动清单

### 1. 工具层（Utils）

#### 1.1 blueprintParser.ts（需要重写）

**当前**: 解析 Markdown 蓝本

**目标**: 解析 YAML 蓝图

```typescript
// 之前
export async function loadBlueprint(skillId: string): Promise<ParsedBlueprint> {
  const markdown = await fetch(`/prompt-lab/blueprint.${skillId}.md`)
  return parseMarkdownBlueprint(markdown)
}

// 之后
export async function loadBlueprint(skillId: string): Promise<YamlBlueprint> {
  const yamlText = await fetch(`/prompt-lab/blueprints/${skillId}.yaml`)
  return yaml.load(yamlText) as YamlBlueprint
}
```

#### 1.2 blueprintCompiler.ts（已完成 ✅）

**当前**: 已实现 YAML → Markdown 编译器

**改动**: 前端集成，支持浏览器环境

```typescript
// 确保能在浏览器中运行
import yaml from 'js-yaml'

export function compileBlueprint(blueprint: YamlBlueprint): string {
  // 已实现
}
```

---

### 2. 类型定义层（Types）

#### 2.1 新增 YAML 蓝图类型

```typescript
// types/blueprint.ts

export interface YamlBlueprint {
  blueprintId: string
  archetype: 'conversational' | 'generator' | 'extractor' | 'distiller' | 'copywriter'
  name: string
  version: string
  
  identity: {
    role: string
    mission: string
    scope?: Record<string, boolean>
  }
  
  rules: {
    context_usage?: ContextUsageRules
    behavior?: BehaviorRules
    state_machine?: StateMachineRules
  }
  
  output: {
    format: 'json' | 'markdown' | 'text'
    wrapper: boolean
    top_level_fields?: string[]
    // ...
  }
  
  constraints: string[]
  
  io_schema: {
    input: Record<string, any>
    output: Record<string, any>
  }
}

export interface ContextUsageRules {
  evaluation_mode: 'fresh_turn' | 'continuation'
  priority: string
  conflict_resolution: string
  fabrication_policy: 'forbidden' | 'allowed'
  fabrication_fallback: string
}

export interface BehaviorRules {
  max_questions_per_turn?: number
  understanding_stage?: {
    reply_structure: string
    tone: string
    no_interrogation: string
  }
  proposing_stage?: {
    scope: string
    detail_level: string
  }
  ready_stage?: {
    scope: string
  }
  subject?: string
}

// ...
```

---

### 3. Store 层

#### 3.1 promptLab.ts（需要重构）

**当前**: 存储 Markdown 蓝本解析结果

**目标**: 存储 YAML 蓝图 + 编译结果

```typescript
// 之前
export interface Blueprint {
  meta: BlueprintMeta
  identity: string
  ioSchema: IOSchema
  ruleBlocks: RuleBlock[]
  stateMachine: StateMachine | null
  outputSpec: string
  constraints: string
  examples: any[]
}

// 之后
export interface PromptLabState {
  // 源数据
  yamlBlueprint: YamlBlueprint | null
  
  // 编译结果
  compiledPrompt: string
  compiledAt: number | null
  
  // UI 状态
  selectedSkillId: string
  currentTab: 'edit' | 'preview' | 'test' | 'publish'
  
  // 编译状态
  compileStatus: 'idle' | 'compiling' | 'success' | 'error'
  compileError: string | null
}

export const usePromptLabStore = defineStore('promptLab', () => {
  const state = reactive<PromptLabState>({
    yamlBlueprint: null,
    compiledPrompt: '',
    compiledAt: null,
    selectedSkillId: 'goal-conversation',
    currentTab: 'edit',
    compileStatus: 'idle',
    compileError: null
  })
  
  // 加载 YAML 蓝图
  async function loadBlueprint(skillId: string) {
    const yamlText = await fetch(`/prompt-lab/blueprints/${skillId}.yaml`)
      .then(r => r.text())
    
    state.yamlBlueprint = yaml.load(yamlText) as YamlBlueprint
    state.selectedSkillId = skillId
    
    // 自动编译
    compile()
  }
  
  // 编译
  function compile() {
    if (!state.yamlBlueprint) return
    
    state.compileStatus = 'compiling'
    
    try {
      state.compiledPrompt = compileBlueprint(state.yamlBlueprint)
      state.compiledAt = Date.now()
      state.compileStatus = 'success'
    } catch (err) {
      state.compileStatus = 'error'
      state.compileError = (err as Error).message
    }
  }
  
  // 更新蓝图字段
  function updateField(path: string, value: any) {
    if (!state.yamlBlueprint) return
    
    // 使用 lodash set 或手动更新
    set(state.yamlBlueprint, path, value)
    
    // 自动重新编译
    compile()
  }
  
  // 保存蓝图
  async function saveBlueprint() {
    if (!state.yamlBlueprint) return
    
    const yamlText = yaml.dump(state.yamlBlueprint)
    
    // 调用后端 API 保存
    await fetch(`/api/prompt-lab/blueprints/${state.selectedSkillId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'text/yaml' },
      body: yamlText
    })
    
    ElMessage.success('蓝图已保存')
  }
  
  return {
    state,
    loadBlueprint,
    compile,
    updateField,
    saveBlueprint
  }
})
```

---

### 4. 组件层

#### 4.1 PromptLab.vue（主页面，需要调整）

**改动**:
- 删除"架构预览"tab（不需要了）
- "编辑组件"改为"编辑蓝图"
- "编译预览"保留
- "测试验证"保留
- "发布"保留

```vue
<template>
  <div class="prompt-lab-page">
    <header class="lab-head">
      <!-- 保持现有 header 结构 -->
      <el-select v-model="store.selectedSkillId" @change="handleSkillChange">
        <el-option
          v-for="skill in availableSkills"
          :key="skill.id"
          :value="skill.id"
          :label="skill.name"
        />
      </el-select>
      <el-button @click="store.compile()">🔨 编译</el-button>
      <el-button @click="store.saveBlueprint()">💾 保存</el-button>
    </header>

    <nav class="lab-pills">
      <button
        :class="['lab-pill', { 'lab-pill--active': store.currentTab === 'edit' }]"
        @click="store.currentTab = 'edit'"
      >
        ✏️ 编辑蓝图
      </button>
      <button
        :class="['lab-pill', { 'lab-pill--active': store.currentTab === 'preview' }]"
        @click="store.currentTab = 'preview'"
      >
        👁 编译预览
      </button>
      <button
        :class="['lab-pill', { 'lab-pill--active': store.currentTab === 'test' }]"
        @click="store.currentTab = 'test'"
      >
        🧪 测试
      </button>
      <button
        :class="['lab-pill', { 'lab-pill--active': store.currentTab === 'publish' }]"
        @click="store.currentTab = 'publish'"
      >
        🚀 发布
      </button>
    </nav>

    <main class="lab-body">
      <BlueprintEditor v-if="store.currentTab === 'edit'" />
      <CompilePreview v-if="store.currentTab === 'preview'" />
      <TestValidator v-if="store.currentTab === 'test'" />
      <PublishPanel v-if="store.currentTab === 'publish'" />
    </main>
  </div>
</template>
```

#### 4.2 BlueprintEditor.vue（新建，替代 ComponentEditor）

**功能**: 结构化表单编辑 YAML 蓝图

```vue
<template>
  <div class="blueprint-editor">
    <div class="editor-sidebar">
      <div class="section-nav">
        <button
          v-for="section in sections"
          :key="section.key"
          :class="['section-btn', { active: currentSection === section.key }]"
          @click="currentSection = section.key"
        >
          {{ section.icon }} {{ section.label }}
        </button>
      </div>
    </div>

    <div class="editor-main">
      <IdentitySection v-if="currentSection === 'identity'" />
      <RulesSection v-if="currentSection === 'rules'" />
      <OutputSection v-if="currentSection === 'output'" />
      <ConstraintsSection v-if="currentSection === 'constraints'" />
      <IOSchemaSection v-if="currentSection === 'io_schema'" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'

const currentSection = ref('identity')

const sections = [
  { key: 'identity', icon: '🎭', label: '身份定义' },
  { key: 'rules', icon: '📋', label: '执行规则' },
  { key: 'output', icon: '📤', label: '输出规格' },
  { key: 'constraints', icon: '🚧', label: '边界约束' },
  { key: 'io_schema', icon: '🔌', label: 'I/O Schema' },
]
</script>
```

#### 4.3 IdentitySection.vue（新建）

**功能**: 编辑身份定义

```vue
<template>
  <div class="form-section">
    <h2>🎭 身份定义</h2>
    
    <el-form label-position="top">
      <el-form-item label="角色">
        <el-input
          :model-value="blueprint?.identity.role"
          @update:model-value="updateField('identity.role', $event)"
          placeholder="例如：学习目标澄清助手"
        />
      </el-form-item>

      <el-form-item label="任务">
        <el-input
          type="textarea"
          :rows="3"
          :model-value="blueprint?.identity.mission"
          @update:model-value="updateField('identity.mission', $event)"
          placeholder="例如：通过对话澄清学习目标"
        />
      </el-form-item>

      <el-form-item label="范围限定">
        <el-checkbox-group
          :model-value="getScopeArray()"
          @update:model-value="updateScope($event)"
        >
          <el-checkbox label="not_business_consultant">不是业务顾问</el-checkbox>
          <el-checkbox label="not_full_path_generator">不是正式路径生成器</el-checkbox>
        </el-checkbox-group>
      </el-form-item>
    </el-form>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { usePromptLabStore } from '@/stores/promptLab'

const store = usePromptLabStore()
const blueprint = computed(() => store.yamlBlueprint)

function updateField(path: string, value: any) {
  store.updateField(path, value)
}

function getScopeArray() {
  return Object.entries(blueprint.value?.identity.scope || {})
    .filter(([, v]) => v)
    .map(([k]) => k)
}

function updateScope(selected: string[]) {
  const scope: Record<string, boolean> = {}
  selected.forEach(key => {
    scope[key] = true
  })
  updateField('identity.scope', scope)
}
</script>
```

#### 4.4 RulesSection.vue（新建）

**功能**: 编辑执行规则

```vue
<template>
  <div class="form-section">
    <h2>📋 执行规则</h2>
    
    <el-collapse v-model="activeRules">
      <!-- 上下文使用规则 -->
      <el-collapse-item name="context_usage" title="上下文使用规则">
        <el-form label-position="top">
          <el-form-item label="评估模式">
            <el-select
              :model-value="blueprint?.rules.context_usage?.evaluation_mode"
              @update:model-value="updateField('rules.context_usage.evaluation_mode', $event)"
            >
              <el-option label="Fresh Turn" value="fresh_turn" />
              <el-option label="Continuation" value="continuation" />
            </el-select>
          </el-form-item>

          <el-form-item label="优先级">
            <el-input
              :model-value="blueprint?.rules.context_usage?.priority"
              @update:model-value="updateField('rules.context_usage.priority', $event)"
              placeholder="例如：state优先，依据state判断阶段和缺口"
            />
          </el-form-item>

          <el-form-item label="冲突解决策略">
            <el-input
              :model-value="blueprint?.rules.context_usage?.conflict_resolution"
              @update:model-value="updateField('rules.context_usage.conflict_resolution', $event)"
              placeholder="例如：userInput_always_wins"
            />
          </el-form-item>

          <el-form-item label="编造策略">
            <el-radio-group
              :model-value="blueprint?.rules.context_usage?.fabrication_policy"
              @update:model-value="updateField('rules.context_usage.fabrication_policy', $event)"
            >
              <el-radio label="forbidden">禁止</el-radio>
              <el-radio label="allowed">允许</el-radio>
            </el-radio-group>
          </el-form-item>

          <el-form-item label="编造回退策略">
            <el-input
              :model-value="blueprint?.rules.context_usage?.fabrication_fallback"
              @update:model-value="updateField('rules.context_usage.fabrication_fallback', $event)"
              placeholder="例如：不确定就空白或继续追问"
            />
          </el-form-item>
        </el-form>
      </el-collapse-item>

      <!-- 行为规则 -->
      <el-collapse-item name="behavior" title="行为规则">
        <el-form label-position="top">
          <el-form-item label="每次最多提问数">
            <el-input-number
              :model-value="blueprint?.rules.behavior?.max_questions_per_turn"
              @update:model-value="updateField('rules.behavior.max_questions_per_turn', $event)"
              :min="1"
              :max="5"
            />
          </el-form-item>

          <el-form-item label="理解阶段 - 回复结构">
            <el-input
              :model-value="blueprint?.rules.behavior?.understanding_stage?.reply_structure"
              @update:model-value="updateField('rules.behavior.understanding_stage.reply_structure', $event)"
              placeholder="例如：理解总结 + 说明 + 问题"
            />
          </el-form-item>

          <el-form-item label="理解阶段 - 语气">
            <el-input
              :model-value="blueprint?.rules.behavior?.understanding_stage?.tone"
              @update:model-value="updateField('rules.behavior.understanding_stage.tone', $event)"
              placeholder="例如：natural_transition"
            />
          </el-form-item>

          <el-form-item label="理解阶段 - 避免审问">
            <el-input
              :model-value="blueprint?.rules.behavior?.understanding_stage?.no_interrogation"
              @update:model-value="updateField('rules.behavior.understanding_stage.no_interrogation', $event)"
              placeholder="例如：不能像问卷或审问"
            />
          </el-form-item>
        </el-form>
      </el-collapse-item>
    </el-collapse>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { usePromptLabStore } from '@/stores/promptLab'

const store = usePromptLabStore()
const blueprint = computed(() => store.yamlBlueprint)
const activeRules = ref(['context_usage', 'behavior'])

function updateField(path: string, value: any) {
  store.updateField(path, value)
}
</script>
```

#### 4.5 CompilePreview.vue（需要重写）

**功能**: 显示编译后的 Markdown 提示词（只读）

```vue
<template>
  <div class="compile-preview">
    <div class="preview-header">
      <h2>⚙️ 编译预览</h2>
      <div class="preview-actions">
        <el-button :icon="Refresh" @click="store.compile()">重新编译</el-button>
        <el-button :icon="CopyDocument" @click="copyToClipboard">复制</el-button>
        <el-button :icon="Download" @click="downloadPrompt">下载</el-button>
      </div>
    </div>

    <div v-if="store.compileStatus === 'compiling'" class="preview-loading">
      <el-icon class="is-loading"><Loading /></el-icon>
      <span>编译中...</span>
    </div>

    <div v-else-if="store.compileStatus === 'error'" class="preview-error">
      <el-alert type="error" :title="store.compileError" show-icon />
    </div>

    <div v-else class="preview-content">
      <div class="preview-meta">
        <span class="meta-item">
          <el-icon><Clock /></el-icon>
          编译时间: {{ formatTime(store.compiledAt) }}
        </span>
        <span class="meta-item">
          <el-icon><Document /></el-icon>
          {{ lineCount }} 行
        </span>
      </div>

      <div class="markdown-viewer">
        <pre><code>{{ store.compiledPrompt }}</code></pre>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { Refresh, CopyDocument, Download, Clock, Document, Loading } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { usePromptLabStore } from '@/stores/promptLab'

const store = usePromptLabStore()

const lineCount = computed(() => {
  return store.compiledPrompt.split('\n').length
})

function formatTime(timestamp: number | null) {
  if (!timestamp) return '-'
  return new Date(timestamp).toLocaleString('zh-CN')
}

function copyToClipboard() {
  navigator.clipboard.writeText(store.compiledPrompt)
  ElMessage.success('已复制到剪贴板')
}

function downloadPrompt() {
  const blob = new Blob([store.compiledPrompt], { type: 'text/markdown' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${store.selectedSkillId}.md`
  a.click()
  URL.revokeObjectURL(url)
  ElMessage.success('已下载提示词')
}
</script>

<style scoped>
.compile-preview {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.preview-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
}

.preview-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.preview-meta {
  display: flex;
  gap: 16px;
  margin-bottom: 12px;
  padding: 12px;
  background: var(--admin-bg-surface-alt);
  border-radius: var(--admin-radius-card);
}

.meta-item {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: var(--admin-text-secondary);
}

.markdown-viewer {
  flex: 1;
  overflow: auto;
  padding: 20px;
  background: var(--admin-bg-surface);
  border: var(--admin-border);
  border-radius: var(--admin-radius-card);
}

.markdown-viewer pre {
  margin: 0;
  font-family: 'JetBrains Mono', Consolas, monospace;
  font-size: 13px;
  line-height: 1.6;
  color: var(--admin-text-primary);
  white-space: pre-wrap;
}
</style>
```

---

## 实现顺序

### Phase 1: 基础设施 ✅（已完成）
- [x] YAML 蓝图格式定义
- [x] 编译器实现
- [x] 测试脚本

### Phase 2: 前端集成（当前任务）
1. **更新 blueprintParser** - 支持加载 YAML
2. **重构 promptLab store** - 支持 YAML 蓝图 + 编译
3. **创建表单编辑器组件** - IdentitySection, RulesSection...
4. **更新 CompilePreview** - 显示编译结果
5. **调整主页面** - 移除无用 tab

### Phase 3: 后端 API（可选）
- 保存 YAML 蓝图 API
- 编译 API（服务端编译）
- 发布到生产环境 API

---

## 开发优先级

### 🔴 高优先级（核心功能）
1. blueprintParser 改为加载 YAML
2. promptLab store 重构
3. 简化版表单编辑器（只支持常用字段）
4. 编译预览

### 🟡 中优先级（提升体验）
5. 完整的表单编辑器（支持所有字段）
6. 实时编译（自动触发）
7. 错误提示和验证

### 🟢 低优先级（锦上添花）
8. 测试面板
9. 发布面板
10. 导入/导出 YAML

---

## 预期效果

### 编辑体验

**之前（Markdown）**:
```markdown
## 规则：行为规则

RULE-09: 每次最多问 1 个核心问题，避免连续追问。
RULE-10: 在 understanding 阶段...
```
- ❌ 需要手写 RULE-XX 编号
- ❌ 需要手写完整的自然语言
- ❌ 容易格式错误

**之后（表单）**:
```
[每次最多提问数] [1] ← 数字输入框
[理解阶段 - 回复结构] [理解总结 + 说明 + 问题] ← 文本输入框
[理解阶段 - 语气] [natural_transition] ← 下拉选择
```
- ✅ 字段级别编辑
- ✅ 类型验证
- ✅ 无需关心格式

### 预览效果

编辑后实时看到编译结果：

```markdown
RULE-09: 每次最多问 1 个核心问题，避免连续追问。
RULE-10: 在 understanding 阶段，reply 默认先用 理解总结 + 说明 + 问题。
```

---

## 总结

这个重构把 Prompt Lab 从"文本编辑器"转变为"基础设施配置器"：

| 维度 | 之前 | 之后 |
|------|------|------|
| 编辑对象 | Markdown 自然语言 | YAML 结构化数据 |
| 编辑方式 | 文本编辑器 | 表单编辑器 |
| 编号 | 手动维护 | 编译器自动生成 |
| 验证 | 无 | 字段级验证 |
| 预览 | 无 | 实时编译预览 |
| 版本对比 | 困难 | 清晰（YAML diff）|

这符合"蓝图不是提示词，而是基础设施数据"的核心理念。
