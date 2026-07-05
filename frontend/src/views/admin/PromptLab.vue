<template>
  <div class="admin-page prompt-lab-page">
    <AdminPageHeader
      title="Prompt 发布向导"
      :icon="EditPen"
      :highlights="promptLabHighlights"
    >
      <template #actions>
        <el-button @click="goBack">
          <el-icon><ArrowLeft /></el-icon>
          返回运行节点
        </el-button>
        <el-popover
          placement="bottom-end"
          :width="360"
          trigger="click"
          popper-class="prompt-lab-help-popover"
        >
          <template #reference>
            <el-button class="assistant-trigger" aria-label="查看发布向导说明">
              发布助手
            </el-button>
          </template>

          <div class="help-card">
            <div class="help-card__title">发布向导</div>
            <div class="help-card__grid">
              <article class="help-item">
                <strong>1. 改源</strong>
                <span>编辑 source 与元数据。</span>
              </article>
              <article class="help-item">
                <strong>2. 编译</strong>
                <span>生成候选 Prompt。</span>
              </article>
              <article class="help-item">
                <strong>3. 审核</strong>
                <span>确认产物是否可用。</span>
              </article>
              <article class="help-item">
                <strong>4. 发布</strong>
                <span>写回平台运行目标。</span>
              </article>
            </div>
          </div>
        </el-popover>
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
        </div>
      </div>
    </div>

    <!-- ============ Step 0: 编译定义 ============ -->
    <main class="lab-body" v-if="store.currentStep === 0">
      <div class="step-content step-content--spec">
        <div class="step-header">
          <div class="step-header__main">
            <h2>编译约定</h2>
            <span class="step-badge step-badge--lock">只读</span>
          </div>
        </div>
        <div class="spec-card">
          <pre class="spec-text">{{ store.compileSpec || '未返回内容' }}</pre>
        </div>
        <div class="step-actions">
          <el-button type="primary" size="large" @click="store.currentStep = 1">返回编辑</el-button>
        </div>
      </div>
    </main>

    <!-- ============ Step 1: 源文件 ============ -->
    <main class="lab-body" v-if="store.currentStep === 1">
      <div class="step-content step-content--edit">
        <div class="step-header">
          <div class="step-header__main">
            <h2>编辑源文件</h2>
            <span class="step-badge">Lab 目录</span>
          </div>
          <div class="step-header__actions">
            <el-button text @click="store.currentStep = 0">查看编译约定</el-button>
          </div>
        </div>

        <div class="source-selector">
          <span class="selector-label">选择 Skill：</span>
          <el-select
            v-model="selectedSkillId"
            @change="handleSkillChange"
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

        <el-alert
          v-if="store.sourceDirty || store.manifestDirty"
          type="warning"
          :closable="false"
          show-icon
          title="当前有未保存改动，编译前会自动保存。"
        />

        <div class="manifest-card" v-loading="store.loadingManifest">
          <div class="manifest-card__header">
            <div>
              <div class="manifest-card__title">Skill 元数据</div>
              <div class="manifest-card__hint">维护编译与发布所用元数据。</div>
            </div>
            <el-button size="small" :loading="savingManifest" @click="handleSaveManifest">
              保存元数据
            </el-button>
          </div>

          <div class="manifest-grid">
            <div class="manifest-field">
              <span class="manifest-label">Skill ID</span>
              <el-input :model-value="store.manifest.skillId" disabled />
            </div>
            <div class="manifest-field">
              <span class="manifest-label">Agent ID</span>
              <el-input :model-value="store.manifest.agentId" disabled />
            </div>
            <div class="manifest-field">
              <span class="manifest-label">Name</span>
              <el-input v-model="store.manifest.name" placeholder="default-skill-xxx" @input="store.markManifestDirty()" />
            </div>
            <div class="manifest-field">
              <span class="manifest-label">Archetype</span>
              <el-select v-model="store.manifest.archetype" placeholder="选择类型" @change="store.markManifestDirty()">
                <el-option label="conversational" value="conversational" />
                <el-option label="generator" value="generator" />
                <el-option label="extractor" value="extractor" />
                <el-option label="distiller" value="distiller" />
                <el-option label="copywriter" value="copywriter" />
                <el-option label="code-only" value="code-only" />
              </el-select>
            </div>
            <div class="manifest-field manifest-field--full">
              <span class="manifest-label">Description</span>
              <el-input v-model="store.manifest.description" type="textarea" :rows="2" placeholder="Skill 简短描述" @input="store.markManifestDirty()" />
            </div>
            <div class="manifest-field manifest-field--full">
              <span class="manifest-label">Acceptable Agent IDs</span>
              <el-input
                v-model="acceptableAgentIdsText"
                type="textarea"
                :rows="2"
                placeholder="每行一个，例如：&#10;skill:goal-conversation&#10;goal-conversation"
                @input="store.markManifestDirty()"
              />
            </div>
          </div>

          <div class="manifest-card__subhead">Runtime Defaults</div>
          <div class="manifest-grid manifest-grid--runtime">
            <div class="manifest-field">
              <span class="manifest-label">Tier</span>
              <el-select v-model="store.params.tier" @change="store.markManifestDirty()">
                <el-option label="chat" value="chat" />
                <el-option label="reasoning" value="reasoning" />
                <el-option label="light" value="light" />
              </el-select>
            </div>
            <div class="manifest-field">
              <span class="manifest-label">Temperature</span>
              <el-input-number v-model="store.params.temperature" :min="0" :max="2" :step="0.1" :precision="1" controls-position="right" @change="store.markManifestDirty()" />
            </div>
            <div class="manifest-field">
              <span class="manifest-label">MaxTokens</span>
              <el-input-number v-model="store.params.maxTokens" :min="1000" :max="64000" :step="1000" controls-position="right" @change="store.markManifestDirty()" />
            </div>
            <div class="manifest-field">
              <span class="manifest-label">Model</span>
              <el-select v-model="store.params.model" clearable placeholder="继承平台默认" @change="store.markManifestDirty()">
                <el-option label="deepseek-v4-flash" value="deepseek-v4-flash" />
                <el-option label="deepseek-v4-pro" value="deepseek-v4-pro" />
                <el-option label="deepseek-r1" value="deepseek-r1" />
              </el-select>
            </div>
            <div class="manifest-field">
              <span class="manifest-label">Thinking</span>
              <el-select v-model="store.params.thinkingMode" @change="store.markManifestDirty()">
                <el-option label="default" value="default" />
                <el-option label="enabled" value="enabled" />
                <el-option label="disabled" value="disabled" />
              </el-select>
            </div>
            <div class="manifest-field">
              <span class="manifest-label">Reasoning Effort</span>
              <el-select v-model="store.params.reasoningEffort" @change="store.markManifestDirty()">
                <el-option label="default" value="default" />
                <el-option label="high" value="high" />
                <el-option label="max" value="max" />
              </el-select>
            </div>
          </div>
        </div>

        <div v-if="store.sourceDocument" class="source-editor">
          <SourceView
            :source-doc="store.sourceDocument"
            @update="store.syncSourceFromDocument()"
          />
        </div>
        <div v-else class="source-card source-card--loading">
          <el-icon class="is-loading" v-if="store.loadingSource"><Loading /></el-icon>
          <template v-else>
            <p>当前 Skill 还没有 Prompt Lab 源文件。</p>
            <el-button size="small" type="primary" @click="handleCreateSource">创建源文件模板</el-button>
          </template>
        </div>

        <div class="step-actions">
          <el-button
            v-if="store.sourceDocument"
            size="large"
            :loading="savingSource"
            @click="handleSaveSource"
          >
            保存源文件
          </el-button>
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
      <div class="step-content step-content--compile">
        <div class="step-header">
          <div class="step-header__main">
            <h2>生成 Prompt</h2>
            <span class="step-badge step-badge--info">AI 编译</span>
          </div>
        </div>

        <div v-if="store.compiling" class="compile-progress">
          <el-icon class="is-loading"><Loading /></el-icon>
              <span>
                {{ store.compilePhase === 'saving' ? '正在保存 source / manifest...' : `正在编译 ${store.skillId}...` }}
                <template v-if="compileElapsedText">{{ compileElapsedText }}</template>
              </span>
        </div>

        <div v-if="store.compileError" class="compile-error">
          <el-alert type="error" :title="store.compileError" :closable="false" show-icon />
        </div>

        <div v-if="store.compiledPrompt" class="compile-success">
          <el-alert type="success" title="编译完成" :closable="false" show-icon>
            <template #default>
              <span>{{ store.compileStats?.lines ?? '-' }} 行 · {{ store.compileStats?.chars ?? '-' }} 字符<span v-if="compileElapsedText"> · {{ compileElapsedText }}</span></span>
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
      <div class="step-content step-content--review">
        <div class="step-header">
          <div class="step-header__main">
            <h2>审核结果</h2>
            <span class="step-badge step-badge--warn">验收检查</span>
          </div>
        </div>

        <div class="review-stats">
          <div class="review-stat">
            <span class="review-stat__val">{{ store.compileStats?.lines ?? '-' }}</span>
            <span class="review-stat__label">行数</span>
          </div>
          <div class="review-stat">
            <span class="review-stat__val">{{ store.compileStats?.chars ?? '-' }}</span>
            <span class="review-stat__label">字符</span>
          </div>
          <div class="review-stat">
            <span class="review-stat__val">{{ compileElapsedText || '-' }}</span>
            <span class="review-stat__label">耗时</span>
          </div>
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
      <div class="step-content step-content--publish">
        <div class="step-header">
          <div class="step-header__main">
            <h2>发布生效</h2>
            <span class="step-badge step-badge--success">生产环境</span>
          </div>
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
                @change="store.markRuntimeParamsDirty()"
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
                @change="store.markRuntimeParamsDirty()"
              />
            </div>
          </div>
          <div class="params-row">
            <div class="param-item">
              <span class="param-label">Tier</span>
              <el-select v-model="store.params.tier" size="small" @change="store.markRuntimeParamsDirty()">
                <el-option label="chat" value="chat" />
                <el-option label="reasoning" value="reasoning" />
                <el-option label="light" value="light" />
              </el-select>
            </div>
            <div class="param-item param-item--wide">
              <span class="param-label">Model</span>
              <el-select v-model="store.params.model" size="small" clearable placeholder="平台默认" @change="store.markRuntimeParamsDirty()">
                <el-option label="deepseek-v4-flash" value="deepseek-v4-flash" />
                <el-option label="deepseek-v4-pro" value="deepseek-v4-pro" />
                <el-option label="deepseek-r1" value="deepseek-r1" />
              </el-select>
            </div>
            <div class="param-item">
              <span class="param-label">Thinking</span>
              <el-select v-model="store.params.thinkingMode" size="small" @change="store.markRuntimeParamsDirty()">
                <el-option label="default" value="default" />
                <el-option label="enabled" value="enabled" />
                <el-option label="disabled" value="disabled" />
              </el-select>
            </div>
            <div class="param-item">
              <span class="param-label">Reasoning Effort</span>
              <el-select v-model="store.params.reasoningEffort" size="small" @change="store.markRuntimeParamsDirty()">
                <el-option label="default" value="default" />
                <el-option label="high" value="high" />
                <el-option label="max" value="max" />
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
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { ArrowLeft, Loading, CopyDocument, UploadFilled, Warning, EditPen } from '@element-plus/icons-vue'
import { usePromptLabStore } from '@/stores/promptLab'
import AdminPageHeader from './components/AdminPageHeader.vue'
import SourceView from './components/promptLab/SourceView.vue'

const router = useRouter()
const store = usePromptLabStore()
const savingSource = ref(false)
const savingManifest = ref(false)
const selectedSkillId = ref(store.skillId)

const acceptableAgentIdsText = computed({
  get: () => store.manifest.acceptableAgentIds.join('\n'),
  set: (value: string) => {
    store.manifest.acceptableAgentIds = value
      .split(/\r?\n/)
      .map(item => item.trim())
      .filter(Boolean)
  }
})

onMounted(() => {
  if (store.currentStep === 0) {
    store.currentStep = 1
  }
  initializePromptLab()
})

const steps = [
  { title: '编译约定' },
  { title: '编辑源文件' },
  { title: '生成 Prompt' },
  { title: '审核结果' },
  { title: '发布生效' }
]

const promptLabHighlights = computed(() => [
  { label: `当前步骤 ${store.currentStep + 1} / ${steps.length}`, tone: 'info' as const },
  { label: store.skillId ? `Skill ${store.skillId}` : '待选择 Skill', tone: store.skillId ? 'success' as const : 'warning' as const },
  {
    label: store.compiling ? (store.compilePhase === 'saving' ? '保存中' : '编译中') : store.compileError ? '编译错误' : store.compiledPrompt ? '已编译' : '未编译',
    tone: store.compiling ? 'info' as const : store.compileError ? 'danger' as const : store.compiledPrompt ? 'success' as const : 'neutral' as const
  }
])

const compileElapsedText = computed(() => {
  if (!store.compileElapsedMs) return ''
  if (store.compileElapsedMs < 100) return '<0.1s'
  if (store.compileElapsedMs < 1000) return `${store.compileElapsedMs}ms`
  const seconds = store.compileElapsedMs / 1000
  return `${seconds.toFixed(seconds >= 10 ? 0 : 1)}s`
})

function goBack() {
  router.push('/admin/skills')
}

async function maybePersistBeforeLeaveCurrentSkill() {
  if (!store.sourceDirty && !store.manifestDirty) return true
  try {
    await ElMessageBox.confirm(
      '当前 Skill 有未保存改动。是否先保存再切换？',
      '未保存改动',
      {
        confirmButtonText: '保存并切换',
        cancelButtonText: '取消',
        type: 'warning'
      }
    )
    await store.persistDrafts(store.skillId)
    ElMessage.success('已保存当前改动')
    return true
  } catch {
    selectedSkillId.value = store.skillId
    return false
  }
}

function handleSkillChange(nextSkillId: string) {
  ;(async () => {
    if (nextSkillId === store.skillId) return
    const ok = await maybePersistBeforeLeaveCurrentSkill()
    if (!ok) return
    await store.loadSource(nextSkillId)
    selectedSkillId.value = store.skillId
  })()
}

async function initializePromptLab() {
  store.fetchCompileSpec()
  await store.fetchSourceList()
  await store.loadSource(store.skillId)
  selectedSkillId.value = store.skillId
}

async function handleCompile() {
  try {
    store.beginCompileSavingPhase()
    await store.persistDrafts()
    await store.compile()
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
  store.currentStep = 4
}

async function handleSaveSource() {
  if (!store.sourceDocument) return
  savingSource.value = true
  try {
    await store.saveSource(store.skillId, store.sourceContent)
    ElMessage.success('源文件已保存')
  } catch (error: any) {
    ElMessage.error(error?.message || '保存源文件失败')
  } finally {
    savingSource.value = false
  }
}

async function handleSaveManifest() {
  savingManifest.value = true
  try {
    await store.saveManifest(store.skillId)
    ElMessage.success('元数据已保存')
  } catch (error: any) {
    ElMessage.error(error?.message || '保存元数据失败')
  } finally {
    savingManifest.value = false
  }
}

async function handleCreateSource() {
  try {
    await store.createSourceFile(store.skillId)
    ElMessage.success('源文件模板已创建')
  } catch (error: any) {
    ElMessage.error(error?.message || '创建源文件失败')
  }
}

async function handlePublish() {
  try {
    const result = await store.publish()
    const compileHint = result.compileStatus && result.compileStatus !== 'fresh'
      ? `\n\n编译状态: ${result.compileStatus}${result.compileError ? `\n编译错误: ${result.compileError}` : ''}`
      : result.compileWarnings?.length
        ? `\n\n编译提示: ${result.compileWarnings.join('；')}`
        : ''
    ElMessageBox.confirm(
      `发布成功\n\nSkill: ${store.skillId}\n新版本: v${result.version}\n\n生成文件已写回 prompts/ 目录，DB 版本已激活。\n可在 Skill 目录中继续查看版本与配置。${compileHint}`,
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
  store.currentStep = 1
  initializePromptLab()
}
</script>

<style scoped>
.prompt-lab-page {
  /* 继承 admin-page 的 padding 和 gap */
  grid-template-rows: auto auto minmax(0, 1fr);
  min-height: calc(100vh - 32px);
}

.assistant-trigger {
  border-color: rgba(245, 158, 11, 0.22);
  color: #c66700;
  background: linear-gradient(135deg, rgba(255, 247, 237, 0.96), rgba(255, 237, 213, 0.96));
  font-weight: 800;
  border-radius: 999px;
  padding: 0 14px;
}

.assistant-trigger:hover {
  border-color: rgba(245, 158, 11, 0.34);
  color: #9a4d00;
  background: linear-gradient(135deg, rgba(255, 243, 224, 0.98), rgba(255, 232, 196, 0.98));
}

.help-card {
  display: grid;
  gap: 14px;
}

.help-card__title {
  font-size: 14px;
  font-weight: 800;
  color: var(--admin-text-primary, #111827);
}

.help-card__grid {
  display: grid;
  gap: 10px;
}

.help-item {
  display: grid;
  gap: 4px;
  padding: 10px 12px;
  border-radius: 12px;
  background: var(--admin-bg-surface-alt, #f8fafc);
  border: 1px solid rgba(226, 232, 240, 0.9);
}

.help-item strong {
  font-size: 13px;
  color: var(--admin-text-primary, #111827);
}

.help-item span {
  font-size: 12px;
  line-height: 1.55;
  color: var(--admin-text-secondary, #6b7280);
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
  top: 17px;
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
  position: relative;
  z-index: 1;
  padding-right: 10px;
}

.step-title {
  width: fit-content;
  padding-right: 6px;
  font-size: 13px;
  font-weight: 600;
  color: var(--admin-text-muted, #9ca3af);
  background: var(--admin-bg-base, #ffffff);
}

.step-node--active .step-title {
  color: var(--admin-color-brand, #3b82f6);
}

.step-node--done .step-title {
  color: var(--admin-text-primary, #111827);
}

.lab-body {
  display: flex;
  justify-content: center;
  padding: 12px 0 0;
  overflow-y: auto;
}

.step-content {
  width: 100%;
  max-width: 980px;
  display: flex;
  flex-direction: column;
  gap: 20px;
  padding-top: 8px;
}

.step-content--edit,
.step-content--review,
.step-content--publish {
  max-width: 1240px;
}

.step-content--compile,
.step-content--spec {
  max-width: 980px;
}

.step-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 12px;
}

.step-header__main {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.step-header__actions {
  display: flex;
  align-items: center;
  gap: 8px;
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

.manifest-card {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 18px 20px;
  background: var(--admin-bg-surface-alt);
  border: var(--admin-border-subtle);
  border-radius: 10px;
}

.manifest-card__header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
}

.manifest-card__title {
  font-size: 14px;
  font-weight: 700;
  color: var(--admin-text-primary, #111827);
}

.manifest-card__hint {
  margin-top: 4px;
  font-size: 12px;
  line-height: 1.55;
  color: var(--admin-text-secondary, #6b7280);
}

.manifest-card__subhead {
  font-size: 12px;
  font-weight: 700;
  color: var(--admin-text-muted, #9ca3af);
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

.manifest-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px 16px;
}

.manifest-grid--runtime {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.manifest-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.manifest-field--full {
  grid-column: 1 / -1;
}

.manifest-label {
  font-size: 11px;
  font-weight: 700;
  color: var(--admin-text-muted, #9ca3af);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.manifest-field :deep(.el-input-number),
.manifest-field :deep(.el-select) {
  width: 100%;
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
  flex-direction: column;
  gap: 10px;
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

@media (max-width: 900px) {
  .manifest-grid,
  .manifest-grid--runtime,
  .params-row {
    grid-template-columns: 1fr;
    display: grid;
  }

  .step-actions {
    flex-wrap: wrap;
  }
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
