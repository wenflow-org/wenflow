<template>
  <div class="admin-page prompt-lab-page">
    <AdminPageHeader
      title="Prompt 发布向导"
      :highlights="promptLabHighlights"
      dense
    >
      <template #actions>
        <el-button @click="goBack">
          <el-icon><ArrowLeft /></el-icon>
          返回运行节点
        </el-button>
        <span class="beta-badge">发布向导</span>
        <el-button @click="handleReset">重置</el-button>
      </template>
    </AdminPageHeader>

    <!-- ============ Stepper ============ -->
    <div class="stepper-bar">
      <div
        v-for="(step, idx) in steps"
        :key="idx"
        class="step-node"
        :class="{
          'step-node--done': idx < store.currentStep,
          'step-node--active': idx === store.currentStep
        }"
      >
        <div class="step-circle">{{ idx < store.currentStep ? '✓' : idx + 1 }}</div>
        <div class="step-text">
          <div class="step-title">{{ step.title }}</div>
          <div class="step-desc">{{ step.desc }}</div>
        </div>
      </div>
    </div>

    <!-- ============ Step 0: 编译定义 ============ -->
    <main class="lab-body" v-if="store.currentStep === 0">
      <div class="step-content">
        <div class="step-header">
          <h2>查看编译约定</h2>
          <span class="step-badge step-badge--lock">框架约束 · 不可编辑</span>
        </div>
        <div class="spec-card">
          <pre class="spec-text">{{ store.compileSpec || '加载中...' }}</pre>
        </div>
        <div class="step-actions">
          <el-button type="primary" size="large" @click="store.currentStep = 1">
            已了解，进入源文件 →
          </el-button>
        </div>
      </div>
    </main>

    <!-- ============ Step 1: 源文件 ============ -->
    <main class="lab-body" v-if="store.currentStep === 1">
      <div class="step-content">
        <div class="step-header">
          <h2>编辑源文件</h2>
          <span class="step-badge">Lab 目录</span>
        </div>

        <div class="source-selector">
          <span class="selector-label">选择 Skill：</span>
          <el-select
            v-model="store.skillId"
            @change="store.loadSource(store.skillId)"
            size="default"
            :loading="store.loadingSource"
          >
            <el-option
              v-for="s in store.sourceList"
              :key="s.id"
              :label="s.name"
              :value="s.id"
            />
          </el-select>
        </div>

        <div v-if="store.sourceDocument" class="source-editor">
          <SourceView
            :source-doc="store.sourceDocument"
            @update="store.syncSourceFromDocument()"
          />
        </div>
        <div v-else class="source-card source-card--loading">
          <el-icon class="is-loading" v-if="store.loadingSource"><Loading /></el-icon>
          <p v-else>加载源文件...</p>
        </div>

        <div class="step-actions">
          <el-button size="large" @click="store.currentStep = 0">上一步</el-button>
          <el-button
            type="primary"
            size="large"
            :disabled="!store.sourceDocument"
            @click="store.currentStep = 2"
          >
            下一步，编译 →
          </el-button>
        </div>
      </div>
    </main>

    <!-- ============ Step 2: LLM 编译 ============ -->
    <main class="lab-body" v-if="store.currentStep === 2">
      <div class="step-content">
        <div class="step-header">
          <h2>生成 Prompt</h2>
          <span class="step-badge step-badge--info">AI 编译</span>
        </div>

          <div v-if="!store.compiledPrompt && !store.compileError && !store.compiling" class="compile-ready">
            <el-icon class="compile-icon"><MagicStick /></el-icon>
            <p>点击开始编译。</p>
          </div>

          <div v-if="store.compiling" class="compile-progress">
            <el-icon class="is-loading"><Loading /></el-icon>
            <span>LLM 正在编译 {{ store.skillId }}...</span>
          </div>

          <div v-if="store.compileError" class="compile-error">
            <el-alert type="error" :title="store.compileError" :closable="false" show-icon />
          </div>

          <div v-if="store.compiledPrompt" class="compile-success">
            <el-alert type="success" title="编译完成" :closable="false" show-icon>
              <template #default>
                <span>{{ store.compileStats?.lines ?? '-' }} 行 · {{ store.compileStats?.rules ?? '-' }} 条规则 · {{ store.compileStats?.chars ?? '-' }} 字符</span>
              </template>
            </el-alert>
          </div>

        <div class="step-actions">
          <el-button size="large" @click="store.currentStep = 1">返回修改</el-button>
          <el-button
            v-if="!store.compiledPrompt"
            type="primary"
            size="large"
            :loading="store.compiling"
            @click="handleCompile"
          >
            开始编译
          </el-button>
          <el-button
            v-else
            type="primary"
            size="large"
            :disabled="store.compiling"
            @click="handleRetry"
          >
            重新编译
          </el-button>
          <el-button
            v-if="store.compiledPrompt"
            type="success"
            size="large"
            @click="store.currentStep = 3"
          >
            审核产物 →
          </el-button>
        </div>
      </div>
    </main>

    <!-- ============ Step 3: 审核 ============ -->
    <main class="lab-body" v-if="store.currentStep === 3">
      <div class="step-content">
        <div class="step-header">
          <h2>审核结果</h2>
          <span class="step-badge step-badge--warn">验收检查</span>
        </div>

          <div class="review-stat">
            <span class="review-stat__val">{{ store.compileStats?.lines ?? '-' }}</span>
            <span class="review-stat__label">行数</span>
          </div>
          <div class="review-stat">
            <span class="review-stat__val">{{ store.compileStats?.rules ?? '-' }}</span>
            <span class="review-stat__label">规则</span>
          </div>
          <div class="review-stat">
            <span class="review-stat__val">{{ store.compileStats?.chars ?? '-' }}</span>
            <span class="review-stat__label">字符</span>
          </div>

        <div class="prompt-card">
          <div class="prompt-card__header">
            <span>{{ store.skillId }} · 编译产物</span>
            <el-button :icon="CopyDocument" size="small" @click="copyPrompt">复制</el-button>
          </div>
          <pre class="prompt-card__body">{{ store.compiledPrompt }}</pre>
        </div>

        <div class="step-actions">
          <el-button size="large" @click="store.currentStep = 2">打回重新编译</el-button>
          <el-button size="large" @click="store.currentStep = 1">修改源文件</el-button>
          <el-button type="success" size="large" @click="goPublish">
            通过，发布 →
          </el-button>
        </div>
      </div>
    </main>

    <!-- ============ Step 4: 发布 ============ -->
    <main class="lab-body" v-if="store.currentStep === 4">
      <div class="step-content">
        <div class="step-header">
          <h2>发布生效</h2>
          <span class="step-badge step-badge--success">生产环境</span>
        </div>

        <div class="params-card">
          <div class="params-card__title">运行参数</div>
          <div class="params-row">
            <div class="param-item">
              <span class="param-label">Temperature</span>
              <el-input-number
                v-model="store.params.temperature"
                :min="0"
                :max="2"
                :step="0.1"
                :precision="1"
                size="small"
                controls-position="right"
              />
            </div>
            <div class="param-item">
              <span class="param-label">MaxTokens</span>
              <el-input-number
                v-model="store.params.maxTokens"
                :min="1000"
                :max="64000"
                :step="1000"
                size="small"
                controls-position="right"
              />
            </div>
          </div>
          <div class="params-row">
            <div class="param-item param-item--wide">
              <span class="param-label">Model</span>
              <el-select v-model="store.params.model" size="small" clearable placeholder="平台默认">
                <el-option label="deepseek-v4-flash" value="deepseek-v4-flash" />
                <el-option label="deepseek-v4-pro" value="deepseek-v4-pro" />
                <el-option label="deepseek-r1" value="deepseek-r1" />
              </el-select>
            </div>
            <div class="param-item">
              <span class="param-label">Thinking</span>
              <el-select v-model="store.params.thinkingMode" size="small">
                <el-option label="default" value="default" />
                <el-option label="enabled" value="enabled" />
                <el-option label="disabled" value="disabled" />
              </el-select>
            </div>
          </div>
        </div>

        <!-- Prompt 快照 -->
        <div class="prompt-card">
          <div class="prompt-card__header">
            <span>{{ store.skillId }} · 编译产物</span>
            <span class="prompt-card__size" v-if="store.compileStats">
              {{ store.compileStats.lines }} 行 · {{ store.compileStats.chars }} 字符
            </span>
          </div>
          <pre class="prompt-card__body">{{ store.compiledPrompt }}</pre>
        </div>

        <div class="publish-warning">
          <el-icon><Warning /></el-icon>
          <span>发布将覆盖 prompts/skill.{{ store.skillId }}.md，旧版本自动备份到 prompt-lab/backups/</span>
        </div>

        <div class="step-actions">
          <el-button size="large" @click="store.currentStep = 3">返回审核</el-button>
          <el-button
            type="primary"
            size="large"
            :icon="UploadFilled"
            :loading="store.compiling"
            @click="handlePublish"
          >
            发布到生产
          </el-button>
        </div>
      </div>
    </main>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { ArrowLeft, Loading, MagicStick, CopyDocument, UploadFilled, Warning } from '@element-plus/icons-vue'
import { usePromptLabStore } from '@/stores/promptLab'
import AdminPageHeader from './components/AdminPageHeader.vue'
import SourceView from './components/promptLab/SourceView.vue'

const router = useRouter()
const store = usePromptLabStore()

onMounted(() => {
  store.fetchCompileSpec()
  store.fetchSourceList()
  store.loadSource(store.skillId)
})

const steps = [
  { title: '查看约定' },
  { title: '编辑源文件' },
  { title: '生成 Prompt' },
  { title: '审核结果' },
  { title: '发布生效' }
]

const promptLabHighlights = computed(() => [
  { label: `当前步骤 ${store.currentStep + 1} / ${steps.length}`, tone: 'info' as const },
  { label: store.skillId ? `Skill ${store.skillId}` : '待选择 Skill', tone: store.skillId ? 'success' as const : 'warning' as const },
  { label: store.compiledPrompt ? '已生成编译产物' : '等待编译', tone: store.compiledPrompt ? 'success' as const : 'neutral' as const },
  { label: store.compileError ? '存在编译错误' : '发布链路正常', tone: store.compileError ? 'danger' as const : 'neutral' as const }
])

function goBack() {
  router.push('/admin/skills')
}

async function handleCompile() {
  try {
    await store.compile()
    store.currentStep = 3
  } catch {
    // error already handled in store
  }
}

function handleRetry() {
  store.compiledPrompt = ''
  store.compileError = null
  store.compileStats = null
  handleCompile()
}

function copyPrompt() {
  navigator.clipboard.writeText(store.compiledPrompt)
  ElMessage.success('已复制')
}

function goPublish() {
  store.fetchParams(store.skillId)
  store.currentStep = 4
}

async function handlePublish() {
  try {
    const result = await store.publish()
    ElMessageBox.confirm(
      `发布成功\n\nSkill: ${store.skillId}\n新版本: v${result.version}\n\n生成文件已写回 prompts/ 目录，DB 版本已激活。\n可在 Skill 目录中继续查看版本与配置。`,
      '发布成功',
      { confirmButtonText: '打开 Skill 目录', cancelButtonText: '完成', type: 'success' }
    ).then(() => {
      router.push('/admin/skills')
    }).catch(() => {})
  } catch {
    // error handled in store
  }
}

function handleReset() {
  store.reset()
  store.fetchCompileSpec()
  store.fetchSourceList()
  store.loadSource(store.skillId)
}
</script>

<style scoped>
.prompt-lab-page {
  display: grid;
  grid-template-rows: auto auto minmax(0, 1fr);
  min-height: calc(100vh - 32px);
  background: var(--admin-bg-page);
}

.beta-badge {
  display: inline-flex;
  align-items: center;
  padding: 3px 10px;
  background: linear-gradient(135deg, #f59e0b 0%, #f97316 100%);
  color: white;
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  border-radius: 999px;
  box-shadow: 0 2px 4px rgba(245, 158, 11, 0.2);
}

.stepper-bar {
  display: flex;
  gap: 0;
  padding-bottom: 14px;
  border-bottom: var(--admin-border-subtle);
}

.step-node {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 12px;
  cursor: default;
  position: relative;
}

.step-node + .step-node::before {
  content: '';
  position: absolute;
  top: 16px;
  left: -50%;
  right: 50%;
  height: 2px;
  background: var(--admin-border-color, #e5e7eb);
  z-index: 0;
}

.step-node--done + .step-node::before {
  background: var(--admin-color-brand, #3b82f6);
}

.step-circle {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  font-weight: 700;
  background: var(--admin-bg-hover, #f3f4f6);
  color: var(--admin-text-muted, #9ca3af);
  border: 2px solid var(--admin-border-color, #e5e7eb);
  flex-shrink: 0;
  z-index: 1;
}

.step-node--done .step-circle {
  background: var(--admin-color-brand, #3b82f6);
  color: #fff;
  border-color: var(--admin-color-brand, #3b82f6);
}

.step-node--active .step-circle {
  background: var(--admin-color-brand-bg, #eff6ff);
  color: var(--admin-color-brand, #3b82f6);
  border-color: var(--admin-color-brand, #3b82f6);
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.15);
}

.step-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.step-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--admin-text-muted, #9ca3af);
}

.step-node--active .step-title {
  color: var(--admin-color-brand, #3b82f6);
}

.step-node--done .step-title {
  color: var(--admin-text-primary, #111827);
}

.step-desc {
  font-size: 11px;
  color: var(--admin-text-muted, #d1d5db);
}

.lab-body {
  display: flex;
  justify-content: center;
  padding: 12px 0 0;
  overflow-y: auto;
}

.step-content {
  width: 100%;
  max-width: 840px;
  display: flex;
  flex-direction: column;
  gap: 20px;
  padding-top: 8px;
}

.step-header {
  display: flex;
  align-items: center;
  gap: 12px;
}

.step-header h2 {
  margin: 0;
  font-size: 22px;
  font-weight: 700;
  color: var(--admin-text-primary, #111827);
}

.step-badge {
  display: inline-flex;
  align-items: center;
  height: 24px;
  padding: 0 10px;
  border-radius: 12px;
  font-size: 12px;
  font-weight: 600;
  background: var(--admin-bg-hover, #f3f4f6);
  color: var(--admin-text-secondary, #6b7280);
}

.step-badge--lock {
  background: #fef3c7;
  color: #92400e;
}

.step-badge--info {
  background: var(--admin-color-brand-bg, #eff6ff);
  color: var(--admin-color-brand, #3b82f6);
}

.step-badge--warn {
  background: #fef3c7;
  color: #92400e;
}

.step-badge--success {
  background: #d1fae5;
  color: #065f46;
}

.step-intro {
  margin: 0;
  font-size: 14px;
  color: var(--admin-text-secondary, #6b7280);
  line-height: 1.6;
}

.spec-card {
  padding: 20px 24px;
  background: var(--admin-bg-surface-alt);
  border: var(--admin-border-subtle);
  border-radius: 8px;
  max-height: 460px;
  overflow-y: auto;
}

.spec-text {
  margin: 0;
  font-family: 'JetBrains Mono', Consolas, monospace;
  font-size: 13px;
  line-height: 1.7;
  color: var(--admin-text-primary, #111827);
  white-space: pre-wrap;
}

.source-selector {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  background: var(--admin-bg-surface-alt);
  border: var(--admin-border-subtle);
  border-radius: 8px;
}

.selector-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--admin-text-primary, #111827);
  flex-shrink: 0;
}

.source-editor {
  flex: 1;
  overflow-y: auto;
  min-height: 0;
}

.source-card {
  background: var(--admin-bg-surface-alt);
  border: var(--admin-border-subtle);
  border-radius: 8px;
  overflow: hidden;
  max-height: 520px;
  display: flex;
  flex-direction: column;
}

.source-card__header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 16px;
  background: var(--admin-bg-hover, #f9fafb);
  border-bottom: 1px solid var(--admin-border-color, #e5e7eb);
  font-size: 13px;
  font-weight: 600;
  color: var(--admin-text-primary, #111827);
}

.source-card__size {
  font-size: 11px;
  font-weight: 400;
  color: var(--admin-text-muted, #9ca3af);
}

.source-card__body {
  margin: 0;
  padding: 16px;
  font-family: 'JetBrains Mono', Consolas, monospace;
  font-size: 13px;
  line-height: 1.7;
  color: var(--admin-text-primary, #111827);
  white-space: pre-wrap;
  overflow-y: auto;
  flex: 1;
}

.source-card--loading {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 120px;
  color: var(--admin-text-muted, #9ca3af);
  font-size: 14px;
}

.compile-area {
  padding: 24px;
  background: var(--admin-bg-surface-alt);
  border: var(--admin-border-subtle);
  border-radius: 8px;
}

.compile-ready {
  text-align: center;
  padding: 24px 0;
}

.compile-icon {
  font-size: 40px;
  color: var(--admin-color-brand, #3b82f6);
  margin-bottom: 12px;
}

.compile-ready p {
  color: var(--admin-text-secondary, #6b7280);
  font-size: 14px;
}

.compile-progress {
  display: flex;
  align-items: center;
  gap: 12px;
  justify-content: center;
  padding: 24px 0;
  font-size: 15px;
  color: var(--admin-color-brand, #3b82f6);
}

.compile-progress .el-icon {
  font-size: 24px;
}

.review-stats {
  display: flex;
  gap: 16px;
}

.review-stat {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 16px;
  background: var(--admin-bg-surface-alt);
  border: var(--admin-border-subtle);
  border-radius: 8px;
}

.review-stat__val {
  font-size: 28px;
  font-weight: 700;
  color: var(--admin-color-brand, #3b82f6);
  font-family: 'JetBrains Mono', Consolas, monospace;
}

.review-stat__label {
  font-size: 12px;
  color: var(--admin-text-muted, #9ca3af);
  font-weight: 500;
}

.prompt-card {
  background: var(--admin-bg-surface-alt);
  border: var(--admin-border-subtle);
  border-radius: 8px;
  overflow: hidden;
}

.prompt-card__header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  background: var(--admin-bg-hover, #f9fafb);
  border-bottom: 1px solid var(--admin-border-color, #e5e7eb);
  font-size: 13px;
  font-weight: 600;
  color: var(--admin-text-primary, #111827);
}

.prompt-card__body {
  margin: 0;
  padding: 20px;
  font-family: 'JetBrains Mono', Consolas, monospace;
  font-size: 13px;
  line-height: 1.7;
  color: var(--admin-text-primary, #111827);
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 500px;
  overflow-y: auto;
}

.publish-meta {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 20px;
  background: var(--admin-bg-surface);
  border: 1px solid var(--admin-border-color, #e5e7eb);
  border-radius: 8px;
}

.publish-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.publish-label {
  font-size: 11px;
  font-weight: 600;
  color: var(--admin-text-muted, #9ca3af);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.publish-val {
  font-size: 14px;
  color: var(--admin-text-primary, #111827);
}

.step-actions {
  display: flex;
  gap: 12px;
  justify-content: flex-end;
  padding-top: 8px;
  border-top: var(--admin-border-subtle);
}

/* ============ Params ============ */
.params-card {
  padding: 16px 20px;
  background: var(--admin-bg-surface);
  border: 1px solid var(--admin-border-color, #e5e7eb);
  border-radius: 8px;
}

.params-card__title {
  font-size: 13px;
  font-weight: 700;
  color: var(--admin-text-primary, #111827);
  margin-bottom: 12px;
}

.params-row {
  display: flex;
  gap: 16px;
  margin-bottom: 12px;
}

.params-row:last-child {
  margin-bottom: 0;
}

.param-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 140px;
}

.param-item--wide {
  flex: 1;
  min-width: 200px;
}

.param-label {
  font-size: 11px;
  font-weight: 600;
  color: var(--admin-text-muted, #9ca3af);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.publish-warning {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  background: #fef3c7;
  border-radius: 6px;
  font-size: 12px;
  color: #92400e;
  line-height: 1.5;
}

.publish-warning .el-icon {
  font-size: 16px;
  flex-shrink: 0;
}
</style>
