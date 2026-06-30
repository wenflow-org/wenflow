<!--
  PromptWorkbench v3
  ============================================================
  Skill Prompt 三步工作台 — 统一编辑 / 审核 / 发布

  三步流程:
    1️⃣  编辑   三种视图: GUI字段表 / 源文本 / 结构化编辑器 + 自动编译状态
    2️⃣  审核   双栏diff / LLM编译产物预览
    3️⃣  发布   参数配置 + 存草稿 / 热更换 / 发布为正式版

  编译机制:
    - 保存源 → 自动编译 → 失效 promptCache → 下次 LLM 调用立即生效
    - 不引入版本号 (原地更新 ACTIVE 版本的 systemPrompt 字段)
    - 快速编译: 保存时自动完成（秒级）
    - LLM编译: 源文件模式中手动触发（10-20秒）

  数据流:
    编辑     GET  /admin/prompt-ops/:agentId/compile-info  加载源
    快速编译  PUT  /admin/prompt-ops/:agentId/source        保存+编译+失效缓存
    快速编译  POST /admin/prompt-ops/:agentId/recompile      仅编译
    LLM编译   POST /admin/prompt-lab/compile-source         源文件→成品Prompt
    发布      POST /admin/prompt-lab/publish                备份→写文件→DB+model_configs同步
    源文件    GET  /admin/prompt-lab/source/:skillId        读取Lab源文件
    参数      GET  /admin/prompt-lab/params/:skillId        读取生产文件frontmatter参数
-->
<template>
  <div class="prompt-workbench" v-loading="loading">
    <!-- 顶部步骤指示器 -->
    <div class="workbench-steps">
      <div
        v-for="(step, idx) in steps"
        :key="step.key"
        class="workbench-step"
        :class="{
          'workbench-step--active': activeStep === step.key,
          'workbench-step--done': stepDone(step.key),
          'workbench-step--dirty': step.key === 'edit' && dirty
        }"
        @click="activeStep = step.key"
      >
        <span class="workbench-step__index">{{ idx + 1 }}</span>
        <span class="workbench-step__label">{{ step.label }}</span>
        <el-icon v-if="stepDone(step.key) && step.key !== 'edit'" class="workbench-step__check">
          <Check />
        </el-icon>
      </div>
    </div>

    <!-- 顶栏状态条 -->
    <div v-if="info || llmCompileStats" class="workbench-statusbar">
      <template v-if="paradigm === 'direct' && info">
        <el-tag size="small" :type="info.status === 'fresh' ? 'success' : 'danger'">
          {{ info.status === 'fresh' ? '产物 fresh' : '产物 failed' }}
        </el-tag>
        <el-tag v-if="info.storedCompiledAt" size="small" type="info" effect="plain">
          DB 产物时间: {{ formatTime(info.storedCompiledAt) }}
        </el-tag>
        <el-tag v-if="info.rewritten" size="small" type="warning" effect="plain">
          重写 {{ info.fieldsApplied }} 字段
        </el-tag>
        <span class="workbench-statusbar__meta">
          源 hash: <code>{{ shortHash(info.sourceHash) }}</code>
        </span>
      </template>
      <template v-if="paradigm === 'constrained'">
        <el-tag size="small" :type="llmCompileStats ? 'success' : 'warning'">
          {{ llmCompileStats ? 'LLM 编译完成' : 'LLM 编译未执行' }}
        </el-tag>
        <template v-if="llmCompileStats">
          <span class="workbench-statusbar__meta">
            {{ llmCompileStats.lines }} 行
          </span>
          <span class="workbench-statusbar__meta">
            {{ llmCompileStats.rules }} 条规则
          </span>
          <span class="workbench-statusbar__meta">
            {{ llmCompileStats.chars }} 字符
          </span>
        </template>
      </template>
      <span class="workbench-statusbar__spacer" />
      <el-tag v-if="dirty" type="warning" size="small">
        草稿未保存
      </el-tag>
      <el-button size="small" @click="loadInfo" :loading="loading">
        <el-icon><Refresh /></el-icon>
        重新加载
      </el-button>
    </div>

    <!-- ========== Step 1: 编辑 ========== -->
    <section v-show="activeStep === 'edit'" class="workbench-section">
      <!-- 编辑工具栏 -->
      <div class="workbench-edit-toolbar">
        <div class="toolbar-left">
          <span class="toolbar-label">编辑模式：</span>
          <el-segmented v-model="paradigm" :options="[
            { label: '源文件编辑', value: 'constrained' },
            { label: '直接编辑', value: 'direct' }
          ]" size="default" />
          
          <el-radio-group v-if="paradigm === 'direct'" v-model="editMode" size="small" style="margin-left: 16px">
            <el-radio-button value="text">
              <el-icon><Document /></el-icon>
              源文本
            </el-radio-button>
            <el-radio-button value="fields">
              <el-icon><Grid /></el-icon>
              字段表
            </el-radio-button>
          </el-radio-group>
        </div>
        
        <div class="toolbar-right">
          <el-button v-if="paradigm === 'constrained'" size="small" text @click="showCompileSpec">
            <el-icon><Document /></el-icon>
            查看编译约定
          </el-button>
        </div>
      </div>

      <!-- 根据范式显示不同的编辑视图 -->
      <div v-if="paradigm === 'constrained'" class="constrained-editor">
        <!-- 源文件编辑器（Lab 的 SourceView） -->
        <div v-if="structuredLoading" class="workbench-loading">
          <el-icon class="is-loading"><Loading /></el-icon>
          加载源文件...
        </div>
        <el-alert
          v-else-if="!structuredSourceDoc"
          type="warning"
          :closable="false"
          show-icon
          class="workbench-alert"
        >
          <template #title>
            此 Skill 暂无源文件
          </template>
          <template #default>
            <p>此 Skill 尚未创建源文件（DEFINITIONS / EXECUTION 格式）。</p>
            <el-button type="primary" size="small" @click="createSourceFile" style="margin-top: 8px">
              创建源文件模板
            </el-button>
            <el-button size="small" @click="paradigm = 'direct'" style="margin-top: 8px">
              或切换到直接编辑
            </el-button>
          </template>
        </el-alert>
        <template v-else>
          <div class="workbench-section__sub-actions">
            <el-button
              type="primary"
              size="small"
              :disabled="structuredModifiedCount === 0"
              @click="saveStructuredToSource"
            >
              <el-icon><DocumentChecked /></el-icon>
              保存修改
            </el-button>
            <span class="workbench-structured-hint" v-if="structuredModifiedCount > 0">
              {{ structuredModifiedCount }} 处修改
            </span>
            <span class="workbench-structured-hint" v-else>
              无未保存改动
            </span>
          </div>
          <SourceView
            :source-doc="structuredSourceDoc"
            @update="onStructuredUpdate"
          />
          
          <!-- LLM 编译区域 -->
          <div class="compile-section">
            <div class="compile-section__header">
              <h5>LLM 编译</h5>
              <p class="compile-section__hint">源文件将通过 LLM 编译为完整 Prompt（约 10-20 秒）</p>
            </div>
            <div class="compile-llm-state">
              <div v-if="llmCompiling" class="compile-llm-status">
                <el-icon class="is-loading"><Loading /></el-icon>
                LLM 正在编译，请稍候...
              </div>
              <div v-else-if="llmCompileStats" class="compile-llm-done">
                <div class="compile-meta-grid">
                  <div class="compile-meta-card">
                    <span class="compile-meta-card__label">状态</span>
                    <el-tag type="success">编译成功</el-tag>
                  </div>
                  <div class="compile-meta-card">
                    <span class="compile-meta-card__label">行数</span>
                    <strong>{{ llmCompileStats.lines }}</strong>
                  </div>
                  <div class="compile-meta-card">
                    <span class="compile-meta-card__label">规则数</span>
                    <strong>{{ llmCompileStats.rules }}</strong>
                  </div>
                  <div class="compile-meta-card">
                    <span class="compile-meta-card__label">总字符</span>
                    <strong>{{ llmCompileStats.chars }}</strong>
                  </div>
                </div>
              </div>
              <div v-else-if="llmCompileError" class="compile-llm-error">
                <el-alert type="error" :title="llmCompileError" :closable="false" show-icon />
              </div>
              <div v-else class="compile-llm-empty">
                <span class="compile-llm-hint">将使用源文件通过 LLM 编译为完整的 Prompt</span>
              </div>
            </div>
            <div class="compile-section__actions">
              <el-button size="small" type="primary" :loading="llmCompiling" @click="onLlmCompile">
                <el-icon><Cpu /></el-icon> 开始 LLM 编译
              </el-button>
              <el-button v-if="llmCompileStats" size="small" type="primary" plain @click="activeStep = 'review'">
                查看产物 <el-icon class="el-icon--right"><ArrowRight /></el-icon>
              </el-button>
            </div>
          </div>
        </template>
      </div>

      <!-- 直接编辑模式 -->
      <div v-else class="direct-editor">
        <!-- 源文本模式 -->
        <template v-if="editMode === 'text'">
          <div class="workbench-section__sub-actions">
            <el-button size="small" @click="pickerVisible = true">
              <el-icon><Connection /></el-icon>
              插入字段引用
            </el-button>
            <el-button v-if="dirty" size="small" @click="discardDraft">
              <el-icon><Close /></el-icon>
              放弃改动
            </el-button>
            <el-button
              type="primary"
              size="small"
              :loading="saving"
              :disabled="!dirty"
              @click="saveAndCompile"
            >
              <el-icon><DocumentChecked /></el-icon>
              保存并编译 (热更换)
            </el-button>
          </div>
          <el-input
            ref="sourceEditorRef"
            v-model="draftSource"
            type="textarea"
            :autosize="{ minRows: 22, maxRows: 36 }"
            resize="vertical"
            placeholder="按 PROMPT_AUTHORING_PROTOCOL v1.2 协议书写: ## 身份定义 / ## 输入说明 / ## 执行规则 / ## 输出规格 ..."
            class="workbench-source-editor"
          />
          <div class="workbench-source-stats">
            <span>字符: {{ draftSource.length }}</span>
            <span v-if="info">源 hash: <code>{{ shortHash(currentDraftHashPreview) }}</code></span>
            <span v-if="dirty" class="workbench-source-stats__dirty">
              有未保存改动 (Ctrl/Cmd+S 保存)
            </span>
          </div>
          
          <!-- 快速编译状态区域 -->
          <div class="compile-section" v-if="info">
            <div class="compile-section__header">
              <h5>编译状态</h5>
              <p class="compile-section__hint">快速编译：routing 表字段重写（秒级完成）</p>
            </div>
            <div class="compile-meta-grid">
              <div class="compile-meta-card">
                <span class="compile-meta-card__label">编译状态</span>
                <el-tag size="default" :type="info?.status === 'fresh' ? 'success' : 'danger'">
                  {{ info.status === 'fresh' ? 'fresh ✓' : 'failed ✗' }}
                </el-tag>
              </div>
              <div class="compile-meta-card">
                <span class="compile-meta-card__label">应用字段数</span>
                <strong>{{ info?.fieldsApplied ?? 0 }}</strong>
              </div>
              <div class="compile-meta-card">
                <span class="compile-meta-card__label">是否重写</span>
                <strong>{{ info?.rewritten ? '是' : '否 (no-op)' }}</strong>
              </div>
              <div class="compile-meta-card">
                <span class="compile-meta-card__label">DB 落库时间</span>
                <strong>{{ formatTime(info?.storedCompiledAt) }}</strong>
              </div>
            </div>
            <el-alert v-if="info?.error" type="error" :title="'编译错误: ' + info.error" :closable="false" show-icon class="workbench-alert" />
            <el-alert v-if="info?.warnings && info.warnings.length > 0" type="warning" :title="info.warnings.join(' · ')" :closable="false" show-icon class="workbench-alert" />
            <div class="compile-section__actions">
              <el-button size="small" :loading="compiling" @click="onRecompile">
                <el-icon><Setting /></el-icon> 重新编译
              </el-button>
              <el-button size="small" type="primary" plain @click="activeStep = 'review'">
                查看产物 <el-icon class="el-icon--right"><ArrowRight /></el-icon>
              </el-button>
            </div>
          </div>
        </template>

        <!-- 字段表模式 -->
        <FieldTableEditor
          v-else-if="editMode === 'fields'"
          :agent-id="agentId"
          @saved="onFieldsSaved"
        />
      </div>
    </section>

    <!-- ========== Step 2: 审核 ========== -->
    <section v-show="activeStep === 'review'" class="workbench-section">
      <header class="workbench-section__head">
        <div>
          <h4>2. 审核产物</h4>
          <p class="workbench-section__hint">
            <template v-if="paradigm === 'constrained'">LLM 编译产生的成品 Prompt，下方为编译统计信息。</template>
            <template v-else>左侧源, 右侧实际喂给 LLM 的产物。高亮区段为编译期被重写的部分。</template>
          </p>
        </div>
      </header>

      <!-- 快速编译: 双栏 diff -->
      <template v-if="paradigm === 'direct'">
        <div v-if="info" class="compile-diff">
          <section class="compile-col compile-col--source">
            <header class="compile-col__head">
              <span class="compile-col__tag">源 (PromptSource)</span>
              <span class="compile-col__meta">{{ info.source.length }} 字符</span>
            </header>
            <pre class="compile-text">{{ info.source }}</pre>
          </section>
          <section class="compile-col compile-col--compiled">
            <header class="compile-col__head">
              <span class="compile-col__tag compile-col__tag--prod">产物 (CompiledPrompt)</span>
              <span class="compile-col__meta">{{ info.compiled.length }} 字符 · 喂给 LLM</span>
            </header>
            <pre class="compile-text" :class="{ 'compile-text--changed': info.rewritten }">{{ info.compiled }}</pre>
          </section>
        </div>
        <el-empty v-else description="无编译信息 · 请先保存并编译" />
      </template>

      <!-- LLM 编译: 单栏 + 复制 -->
      <template v-else>
        <div v-if="llmCompiledPrompt" class="compile-llm-preview">
          <div class="compile-llm-preview__bar">
            <span class="compile-llm-preview__meta">编译产物 · {{ llmCompiledPrompt.length }} 字符</span>
            <el-button size="small" text @click="copyLlmPrompt"><el-icon><CopyDocument /></el-icon> 复制全文</el-button>
          </div>
          <pre class="compile-text compile-text--full">{{ llmCompiledPrompt }}</pre>
        </div>
        <el-empty v-else description="请先在编辑步骤中执行 LLM 编译" />
      </template>

      <div class="workbench-section__footer">
        <el-button size="small" @click="activeStep = 'edit'"><el-icon><ArrowLeft /></el-icon> 返回编辑</el-button>
        <div class="workbench-section__footer-actions">
          <el-button size="small" type="primary" plain @click="onReviewApprove">通过，发布 <el-icon class="el-icon--right"><ArrowRight /></el-icon></el-button>
        </div>
      </div>
    </section>

    <!-- ========== Step 3: 发布 ========== -->
    <section v-show="activeStep === 'publish'" class="workbench-section">
      <header class="workbench-section__head">
        <div>
          <h4>3. 发布运行</h4>
          <p class="workbench-section__hint">
            配置运行时参数（将同步到 skill_model_configs），选择发布方式
          </p>
          <el-alert
            type="info"
            :closable="false"
            show-icon
            style="margin-top: 12px; font-size: 13px;"
          >
            这些参数将作为 <strong>Skill 独立配置</strong>生效，优先级高于 Agent 默认和平台默认。发布后可在"模型运行时" Tab 中修改。
          </el-alert>
        </div>
      </header>

      <!-- 参数表单 -->
      <div class="publish-params">
        <div class="publish-params__row">
          <label class="publish-params__label">Temperature</label>
          <el-slider v-model="publishParams.temperature" :min="0" :max="2" :step="0.1" :show-input="true" class="publish-params__slider" />
        </div>
        <div class="publish-params__row">
          <label class="publish-params__label">Max Tokens</label>
          <el-slider v-model="publishParams.maxTokens" :min="1000" :max="64000" :step="500" :show-input="true" class="publish-params__slider" />
        </div>
        <div class="publish-params__grid">
          <div class="publish-params__col">
            <label class="publish-params__label">Model</label>
            <el-select v-model="publishParams.model" placeholder="使用默认模型" clearable size="small" class="publish-params__full">
              <el-option label="DeepSeek V4 Flash" value="deepseek-v4-flash" />
              <el-option label="DeepSeek V4 Pro" value="deepseek-v4-pro" />
              <el-option label="DeepSeek R1" value="deepseek-r1" />
            </el-select>
          </div>
          <div class="publish-params__col">
            <label class="publish-params__label">Thinking Mode</label>
            <el-select v-model="publishParams.thinkingMode" size="small" class="publish-params__full">
              <el-option label="default" value="default" />
              <el-option label="enabled" value="enabled" />
              <el-option label="disabled" value="disabled" />
            </el-select>
          </div>
          <div class="publish-params__col" v-if="publishParams.thinkingMode === 'enabled'">
            <label class="publish-params__label">Reasoning Effort</label>
            <el-select v-model="publishParams.reasoningEffort" size="small" class="publish-params__full">
              <el-option label="low" value="low" />
              <el-option label="medium" value="medium" />
              <el-option label="high" value="high" />
            </el-select>
          </div>
        </div>
      </div>

      <!-- 产物快照 -->
      <div class="publish-snapshot">
        <div class="publish-snapshot__bar">
          <el-tag size="small" type="info">{{ paradigm === 'constrained' ? 'LLM 编译' : '快速编译' }}</el-tag>
          <span class="publish-snapshot__meta">{{ publishTargetPrompt.length }} 字符</span>
        </div>
        <pre class="compile-text compile-text--compact">{{ publishTargetPrompt.slice(0, 600) }}{{ publishTargetPrompt.length > 600 ? '\n\n... (略)' : '' }}</pre>
      </div>

      <!-- 发布提示 -->
      <el-alert
        type="warning"
        :closable="false"
        show-icon
        class="workbench-alert"
        title="发布将覆盖 prompts/skill.xxx.md 生产文件，旧版本自动备份到 prompt-lab/backups/"
      />

      <div class="publish-actions">
        <el-popconfirm title="保存为新草稿版本，不覆盖当前 ACTIVE 版本？" @confirm="onSaveDraft">
          <template #reference>
            <el-button size="small" :loading="publishing">
              <el-icon><Plus /></el-icon>
              存为草稿
            </el-button>
          </template>
        </el-popconfirm>
        <el-popconfirm title="原地覆盖 ACTIVE 版本，立即生效？" @confirm="onHotReplace">
          <template #reference>
            <el-button size="small" :loading="saving" type="warning">
              <el-icon><DocumentChecked /></el-icon>
              热更换
            </el-button>
          </template>
        </el-popconfirm>
        <el-popconfirm title="发布为正式版本：备份旧文件 → 写入生产文件 → 创建 ACTIVE 版本 → 归档旧版？" @confirm="onPublishToProd">
          <template #reference>
            <el-button size="small" :loading="publishing" type="primary">
              <el-icon><UploadFilled /></el-icon>
              发布为正式版
            </el-button>
          </template>
        </el-popconfirm>
      </div>
    </section>

    <!-- 字段选择器 (drawer) -->
    <SkillFieldPicker
      v-model:visible="pickerVisible"
      :exclude-skill-id="agentId"
      @pick="onFieldPicked"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  Refresh,
  Setting,
  Check,
  Close,
  DocumentChecked,
  ArrowLeft,
  ArrowRight,
  Connection,
  Grid,
  Document,
  List,
  Cpu,
  CopyDocument,
  Edit,
  UploadFilled,
  Plus,
  Loading
} from '@element-plus/icons-vue'
import { adminPromptOpsApi, adminPromptLabApi, adminAgentPromptsApi } from '@/api/adminApi'
import { parseSource, serializeSource, type SourceDocument } from '@/utils/sourceParser'
import SkillFieldPicker from './SkillFieldPicker.vue'
import FieldTableEditor from './FieldTableEditor.vue'
import SourceView from '../promptLab/SourceView.vue'

// ========== Types ==========

interface CompileInfo {
  agentId: string
  routingKey: string
  promptVersion: number
  promptName: string
  source: string
  compiled: string
  status: 'fresh' | 'failed'
  error: string | null
  warnings: string[]
  rewritten: boolean
  fieldsApplied: number
  sourceHash: string
  compileContextHash: string
  storedCompiledAt: string | null
  storedSourceHash: string | null
  storedContextHash: string | null
  storedStatus: string | null
  fieldRefs?: {
    total: number
    resolved: number
    unresolved: number
  } | null
}

interface LlmCompileStats {
  lines: number
  rules: number
  chars: number
}

interface PublishParams {
  temperature: number
  maxTokens: number
  model: string | null
  thinkingMode: string
  reasoningEffort: string
}

// ========== Props & Computed ==========

const props = defineProps<{ agentId: string | null }>()

const route = useRoute()
const bareSkillId = computed(() => (props.agentId || '').replace(/^skill:/, ''))

const steps = [
  { key: 'edit',    label: '编辑', hint: '编辑与编译' },
  { key: 'review',  label: '审核', hint: '审阅产物' },
  { key: 'publish', label: '发布', hint: '参数与发布' }
] as const

type StepKey = typeof steps[number]['key']

// ========== Core State ==========

const activeStep = ref<StepKey>('edit')
// 新增：编辑范式（源文件编辑 vs 直接编辑）
const paradigm = ref<'constrained' | 'direct'>('direct')
const editMode = ref<'fields' | 'text' | 'structured'>('fields')
const compileMode = ref<'fast' | 'llm'>('fast')
const loading = ref(false)
const saving = ref(false)
const compiling = ref(false)
const publishing = ref(false)

// Fast compile state (existing)
const info = ref<CompileInfo | null>(null)
const draftSource = ref('')
const lastSavedSource = ref('')

// LLM compile state (new)
const llmCompiling = ref(false)
const llmCompiledPrompt = ref('')
const llmCompileError = ref<string | null>(null)
const llmCompileStats = ref<LlmCompileStats | null>(null)

// Structured editor state (new)
const structuredLoading = ref(false)
const structuredSourceDoc = ref<SourceDocument | null>(null)
const structuredModifiedCount = ref(0)

// Publish state (new)
const publishParams = ref<PublishParams>({
  temperature: 0.7,
  maxTokens: 8000,
  model: null,
  thinkingMode: 'default',
  reasoningEffort: 'default'
})

// ========== Helpers ==========

const pickerVisible = ref(false)
const sourceEditorRef = ref<any>(null)
const dirty = computed(() => draftSource.value !== lastSavedSource.value)

const stepDone = (key: StepKey): boolean => {
  if (key === 'edit') {
    // 编辑步骤完成：保存了内容且编译成功
    if (paradigm.value === 'constrained') {
      return !!llmCompileStats.value
    }
    return !dirty.value && lastSavedSource.value.length > 0 && !!info.value?.storedCompiledAt
  }
  if (key === 'review') return stepDone('edit')
  return false
}

const currentDraftHashPreview = computed(() => info.value?.sourceHash || '')

const publishTargetPrompt = computed(() => {
  if (paradigm.value === 'constrained') return llmCompiledPrompt.value
  return info.value?.compiled || ''
})

const shortHash = (hash: string | null | undefined) => hash ? hash.slice(0, 12) : '-'

const formatTime = (iso: string | null | undefined) => {
  if (!iso) return '-'
  try { return new Date(iso).toLocaleString('zh-CN', { hour12: false }) } catch { return iso }
}

// ========== Edit Tab: Load Info ==========

const loadInfo = async () => {
  if (!props.agentId) {
    info.value = null
    return
  }
  loading.value = true
  try {
    const res: any = await adminPromptOpsApi.getPromptCompileInfo(props.agentId)
    const data: CompileInfo = res.data?.data || res.data
    info.value = data
    if (!dirty.value) {
      draftSource.value = data.source || ''
      lastSavedSource.value = data.source || ''
    }
  } catch (error: any) {
    const msg = error?.response?.data?.error || error?.message || '加载编译信息失败'
    ElMessage.error(msg)
    info.value = null
  } finally {
    loading.value = false
  }
}

// ========== Edit Tab: Text Mode ==========

const saveAndCompile = async () => {
  if (!props.agentId) return
  if (!draftSource.value.trim()) { ElMessage.warning('源不能为空'); return }
  saving.value = true
  try {
    const res: any = await adminPromptOpsApi.savePromptSource(props.agentId, {
      systemPrompt: draftSource.value,
      autoCompile: true
    })
    const data = res.data?.data || res.data
    if (data?.compileStatus === 'fresh') {
      ElMessage.success(`保存并编译成功 · 重写 ${data.fieldsApplied || 0} 字段 · 已热更换`)
    } else if (data?.compileStatus === 'failed') {
      ElMessage.warning(`保存成功但编译失败: ${data?.error || '未知错误'}, 已降级用源`)
    } else {
      ElMessage.success('保存成功')
    }
    lastSavedSource.value = draftSource.value
    await loadInfo()
    activeStep.value = 'review'
  } catch (error: any) {
    const msg = error?.response?.data?.error || error?.message || '保存失败'
    ElMessage.error(msg)
  } finally {
    saving.value = false
  }
}

const discardDraft = async () => {
  if (!dirty.value) return
  try {
    await ElMessageBox.confirm('丢弃当前未保存的修改, 恢复到上次保存状态?', '确认放弃', {
      confirmButtonText: '放弃', cancelButtonText: '取消', type: 'warning'
    })
    draftSource.value = lastSavedSource.value
    ElMessage.info('已恢复')
  } catch { /* cancelled */ }
}

// ========== Edit Tab: Structured Mode ==========

watch(editMode, async (mode) => {
  if (mode === 'structured' && !structuredSourceDoc.value && !structuredLoading.value) {
    await loadStructuredSource()
  }
})

const loadStructuredSource = async () => {
  if (!bareSkillId.value) return
  structuredLoading.value = true
  structuredSourceDoc.value = null
  try {
    const res: any = await adminPromptLabApi.getSource(bareSkillId.value)
    const content = res.data?.data
    if (content) {
      structuredSourceDoc.value = parseSource(content)
      structuredModifiedCount.value = 0
    }
  } catch {
    structuredSourceDoc.value = null
  } finally {
    structuredLoading.value = false
  }
}

const onStructuredUpdate = (doc: SourceDocument) => {
  structuredSourceDoc.value = doc
  structuredModifiedCount.value++
}

const saveStructuredToSource = () => {
  if (!structuredSourceDoc.value) return
  draftSource.value = serializeSource(structuredSourceDoc.value)
  lastSavedSource.value = draftSource.value
  structuredModifiedCount.value = 0
  ElMessage.success('已同步到编辑区，可进入编译步骤')
}

// ========== Edit Tab: Fields Mode ==========

const onFieldsSaved = async () => {
  await loadInfo()
  activeStep.value = 'review'
}

// ========== Compile: Fast ==========

const onRecompile = async () => {
  if (!props.agentId) return
  compiling.value = true
  try {
    const res: any = await adminPromptOpsApi.recompilePrompt(props.agentId)
    const data = res.data?.data || res.data
    if (data?.status === 'fresh') {
      ElMessage.success(`编译成功 · 重写 ${data.fieldsApplied || 0} 字段 · 已热更换`)
    } else {
      ElMessage.warning(`编译失败: ${data?.error || '未知错误'}`)
    }
    await loadInfo()
  } catch (error: any) {
    ElMessage.error(error?.response?.data?.error || error?.message || '重编译失败')
  } finally {
    compiling.value = false
  }
}

// ========== Compile: LLM ==========

const onLlmCompile = async () => {
  if (!bareSkillId.value) { ElMessage.warning('未知 Skill ID'); return }
  llmCompiling.value = true
  llmCompileError.value = null
  llmCompileStats.value = null
  try {
    const res: any = await adminPromptLabApi.compileSource({ skillId: bareSkillId.value })
    const data = res.data
    if (!data?.success) throw new Error(data?.error || '编译失败')
    llmCompiledPrompt.value = data.prompt
    llmCompileStats.value = data.stats
    ElMessage.success('LLM 编译成功')
  } catch (error: any) {
    const msg = error?.response?.data?.error || error?.response?.data?.details || error?.message || 'LLM 编译失败'
    llmCompileError.value = msg
    ElMessage.error(msg)
  } finally {
    llmCompiling.value = false
  }
}

// ========== Review ==========

const onReviewApprove = async () => {
  if (!bareSkillId.value) return
  try {
    const res: any = await adminPromptLabApi.getParams(bareSkillId.value)
    if (res.data?.data) {
      publishParams.value = { ...publishParams.value, ...res.data.data }
    }
  } catch { /* keep defaults */ }
  activeStep.value = 'publish'
}

const copyLlmPrompt = () => {
  if (!llmCompiledPrompt.value) return
  navigator.clipboard.writeText(llmCompiledPrompt.value)
  ElMessage.success('已复制到剪贴板')
}

// ========== Publish ==========

const onSaveDraft = async () => {
  if (!props.agentId) return
  publishing.value = true
  try {
    const prompt = publishTargetPrompt.value
    const payload = {
      agentId: props.agentId,
      systemPrompt: prompt,
      name: `v-draft-${Date.now()}`,
      temperature: publishParams.value.temperature,
      maxTokens: publishParams.value.maxTokens
    }
    await adminAgentPromptsApi.createPrompt(payload)
    ElMessage.success('草稿已保存')
    activeStep.value = 'edit'
  } catch (error: any) {
    ElMessage.error(error?.response?.data?.error || error?.message || '保存草稿失败')
  } finally {
    publishing.value = false
  }
}

const onHotReplace = async () => {
  // 热更换只适用于直接编辑模式
  if (paradigm.value === 'constrained') {
    ElMessage.warning('源文件编辑模式请使用"发布为正式版"')
    return
  }
  await saveAndCompile()
}

const onPublishToProd = async () => {
  if (!bareSkillId.value) { ElMessage.warning('未知 Skill ID'); return }
  publishing.value = true
  try {
    const prompt = publishTargetPrompt.value
    if (!prompt) { ElMessage.warning('没有可发布的产物，请先编译'); publishing.value = false; return }

    const res: any = await adminPromptLabApi.publish({
      skillId: bareSkillId.value,
      prompt,
      params: publishParams.value
    })
    const data = res.data
    if (!data?.success) throw new Error(data?.error || '发布失败')

    ElMessageBox.confirm(
      `已发布 v${data.version} (${data.agentId})\n\n已自动备份旧文件到 prompt-lab/backups/\n已同步 skill_model_configs 运行时配置`,
      '发布成功',
      { confirmButtonText: '返回编辑', cancelButtonText: '查看列表', type: 'success', distinguishCancelAndClose: true }
    ).then(() => {
      activeStep.value = 'edit'
    }).catch(() => {
      // navigate to list — emit event
    })
  } catch (error: any) {
    ElMessage.error(error?.response?.data?.error || error?.message || '发布失败')
  } finally {
    publishing.value = false
  }
}

// ========== Field Picker ==========

const onFieldPicked = (payload: { skillId: string; fieldPath: string; kind: 'input' | 'output'; valueType: string | null; note: string; token: string }) => {
  const token = payload.token
  const textarea = sourceEditorRef.value?.textarea as HTMLTextAreaElement | undefined
  if (textarea && typeof textarea.selectionStart === 'number') {
    const start = textarea.selectionStart
    const end = textarea.selectionEnd
    const before = draftSource.value.slice(0, start)
    const after = draftSource.value.slice(end)
    draftSource.value = before + token + after
    requestAnimationFrame(() => {
      textarea.focus()
      const cursorPos = start + token.length
      textarea.setSelectionRange(cursorPos, cursorPos)
    })
  } else {
    draftSource.value = draftSource.value.trimEnd() + '\n\n' + token + '\n'
  }
  pickerVisible.value = false
}

// ========== 新增：源文件编辑相关方法 ==========

const showCompileSpec = async () => {
  try {
    const res: any = await adminPromptLabApi.getCompileSpec()
    const spec = res.data?.data || res.data?.spec || '编译约定加载失败'
    ElMessageBox.alert(spec, '编译约定', {
      dangerouslyUseHTMLString: false,
      confirmButtonText: '关闭',
      customClass: 'compile-spec-dialog'
    })
  } catch (error: any) {
    ElMessage.error('加载编译约定失败')
  }
}

const createSourceFile = async () => {
  if (!bareSkillId.value) {
    ElMessage.warning('未知 Skill ID')
    return
  }
  
  try {
    loading.value = true
    // 调用后端 API 创建源文件模板
    await adminPromptLabApi.createSourceFile(bareSkillId.value)
    ElMessage.success('源文件模板已创建')
    // 重新加载
    await loadStructuredSource()
  } catch (error: any) {
    ElMessage.error(error?.response?.data?.error || '创建源文件失败')
  } finally {
    loading.value = false
  }
}

// ========== Keyboard & Lifecycle ==========

const onKeydown = (e: KeyboardEvent) => {
  const isSave = (e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')
  if (isSave && activeStep.value === 'edit' && editMode.value === 'text' && dirty.value && !saving.value) {
    e.preventDefault()
    saveAndCompile()
  }
}

watch(() => props.agentId, () => {
  loadInfo()
  structuredSourceDoc.value = null
  structuredModifiedCount.value = 0
  llmCompiledPrompt.value = ''
  llmCompileStats.value = null
  llmCompileError.value = null
}, { immediate: false })

// 根据范式自动设置编译模式
watch(() => paradigm.value, (newParadigm) => {
  if (newParadigm === 'constrained') {
    compileMode.value = 'llm'
  } else {
    compileMode.value = 'fast'
  }
})

onMounted(() => {
  loadInfo()
  // 检查是否有源文件，自动设置范式
  checkAndSetParadigm()
  window.addEventListener('keydown', onKeydown)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
})

// 检查是否有源文件，自动设置范式
const checkAndSetParadigm = async () => {
  if (!bareSkillId.value) return
  
  // 1. 优先从 URL 参数读取 paradigm
  const urlParadigm = route.query.paradigm as string
  if (urlParadigm === 'constrained' || urlParadigm === 'direct') {
    paradigm.value = urlParadigm
    // 如果 URL 指定了 constrained 但没有源文件，显示创建提示
    if (urlParadigm === 'constrained') {
      try {
        await loadStructuredSource()
      } catch (error) {
        // 源文件不存在，保持 constrained 模式，用户会看到创建按钮
      }
    }
    return
  }
  
  // 2. 自动检测：尝试加载源文件
  try {
    await loadStructuredSource()
    // 如果成功加载，说明有源文件，设置为 constrained
    if (structuredSourceDoc.value) {
      paradigm.value = 'constrained'
    }
  } catch (error) {
    // 没有源文件，保持默认的 direct 模式
    paradigm.value = 'direct'
  }
}
</script>

<style scoped>
.prompt-workbench {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

/* ========== 新增：编辑工具栏 ========== */
.workbench-edit-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  margin-bottom: 16px;
}

.toolbar-left {
  display: flex;
  align-items: center;
  gap: 12px;
}

.toolbar-label {
  font-size: 13px;
  font-weight: 600;
  color: #475569;
}

.toolbar-right {
  display: flex;
  align-items: center;
  gap: 8px;
}

/* ========== Steps ========== */
.workbench-steps {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 0;
  margin-bottom: 16px;
}

.workbench-step {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  border: 1.5px solid #e5e7eb;
  border-radius: 8px;
  background: var(--admin-bg-surface);
  cursor: pointer;
  transition: all 0.18s ease;
  position: relative;
  flex: 1;
}

.workbench-step:hover {
  border-color: #c7d2fe;
  background: #fafbff;
}

.workbench-step--active {
  border-color: #4f46e5;
  background: linear-gradient(135deg, #eef2ff 0%, #fafbff 100%);
  box-shadow: 0 2px 6px rgba(79, 70, 229, 0.1);
}

.workbench-step--done .workbench-step__index {
  background: #10b981;
  color: #fff;
  border-color: #10b981;
}

.workbench-step--dirty {
  border-color: #f59e0b;
  background: linear-gradient(135deg, #fffbeb 0%, #fff 100%);
}

.workbench-step__index {
  width: 24px;
  height: 24px;
  flex-shrink: 0;
  border-radius: 50%;
  border: 1.5px solid #cbd5e1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  font-size: 12px;
  color: #475569;
  background: #f8fafc;
  transition: all 0.18s ease;
}

.workbench-step--active .workbench-step__index {
  background: #4f46e5;
  border-color: #4f46e5;
  color: #fff;
}

.workbench-step__label {
  font-weight: 600;
  font-size: 13px;
  color: #1f2937;
  white-space: nowrap;
}

.workbench-step__check {
  margin-left: auto;
  color: #10b981;
  font-size: 16px;
}

/* ========== Status Bar ========== */
.workbench-statusbar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
  padding: 8px 12px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  font-size: 12px;
}

.workbench-statusbar__meta {
  font-size: 11.5px;
  color: #64748b;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.workbench-statusbar__meta code {
  font-family: 'JetBrains Mono', Consolas, monospace;
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 4px;
  background: #e2e8f0;
  color: #1e293b;
}

.workbench-statusbar__spacer {
  flex: 1;
}

/* ========== Section ========== */
.workbench-section {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 16px;
  background: var(--admin-bg-surface);
  border: 1px solid #e5e7eb;
  border-radius: 12px;
}

.workbench-section__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.workbench-section__head h4 {
  margin: 0 0 4px 0;
  font-size: 15px;
  font-weight: 700;
  color: #1f2937;
}

.workbench-section__hint {
  margin: 0;
  font-size: 12.5px;
  color: #6b7280;
}

.workbench-section__actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}

.workbench-section__sub-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  align-items: center;
}

.workbench-section__footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding-top: 8px;
  border-top: 1px dashed #e5e7eb;
}

.workbench-section__footer-actions {
  display: flex;
  gap: 8px;
}

/* ========== Edit ========== */
.workbench-source-editor :deep(.el-textarea__inner) {
  font-family: 'JetBrains Mono', Consolas, 'Courier New', monospace;
  font-size: 12.5px;
  line-height: 1.6;
}

.workbench-source-stats {
  display: flex;
  align-items: center;
  gap: 14px;
  font-size: 11.5px;
  color: #64748b;
}

.workbench-source-stats code {
  font-family: 'JetBrains Mono', Consolas, monospace;
  font-size: 11px;
  padding: 1px 5px;
  border-radius: 4px;
  background: #f1f5f9;
  color: #334155;
}

.workbench-source-stats__dirty {
  margin-left: auto;
  color: #d97706;
  font-weight: 600;
}

.workbench-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 40px;
  color: #6b7280;
  font-size: 13px;
}

.workbench-structured-hint {
  font-size: 12px;
  color: #f59e0b;
  font-weight: 600;
}

/* ========== Compile Meta ========== */
.compile-meta-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 10px;
}

.compile-meta-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 12px 14px;
  background: #f8fafc;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
}

.compile-meta-card__label {
  font-size: 11.5px;
  color: #6b7280;
  font-weight: 600;
}

.compile-meta-card strong {
  font-size: 13.5px;
  color: #1f2937;
}

.compile-meta-card code {
  font-family: 'JetBrains Mono', Consolas, monospace;
  font-size: 11.5px;
  padding: 2px 7px;
  border-radius: 4px;
  background: #e2e8f0;
  color: #334155;
  width: fit-content;
}

.workbench-alert {
  margin: 0;
}

/* ========== LLM Compile ========== */
.compile-llm-state {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.compile-llm-status {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 30px;
  color: #6b7280;
  font-size: 13px;
}

.compile-llm-hint {
  font-size: 13px;
  color: #6b7280;
  text-align: center;
  display: block;
  padding: 20px;
}

/* ========== Review: Diff ========== */
.compile-diff {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.compile-col {
  display: flex;
  flex-direction: column;
  border: 1px solid #e5e7eb;
  border-radius: 10px;
  overflow: hidden;
  background: var(--admin-bg-surface);
}

.compile-col__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 12px;
  background: #f1f5f9;
  border-bottom: 1px solid #e5e7eb;
}

.compile-col__tag {
  font-size: 12px;
  font-weight: 700;
  color: #1e293b;
}

.compile-col__tag--prod {
  color: #047857;
}

.compile-col__meta {
  font-size: 11px;
  color: #94a3b8;
}

.compile-text {
  margin: 0;
  padding: 12px 14px;
  font-family: 'JetBrains Mono', Consolas, monospace;
  font-size: 11.5px;
  line-height: 1.55;
  color: #1f2937;
  white-space: pre-wrap;
  word-break: break-word;
  overflow-y: auto;
  max-height: 560px;
}

.compile-text--changed {
  background: linear-gradient(to right, rgba(16, 185, 129, 0.04), transparent 60%);
}

.compile-text--full {
  max-height: none;
}

.compile-text--compact {
  max-height: 200px;
}

/* ========== Review: LLM Preview ========== */
.compile-llm-preview {
  border: 1px solid #e5e7eb;
  border-radius: 10px;
  overflow: hidden;
}

.compile-llm-preview__bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  background: #f1f5f9;
  border-bottom: 1px solid #e5e7eb;
}

.compile-llm-preview__meta {
  font-size: 12px;
  color: #1e293b;
  font-weight: 600;
}

/* ========== Publish ========== */
.publish-params {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.publish-params__row {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.publish-params__label {
  font-size: 12px;
  font-weight: 600;
  color: #374151;
}

.publish-params__slider {
  width: 100%;
}

.publish-params__grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 14px;
}

.publish-params__col {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.publish-params__full {
  width: 100%;
}

.publish-snapshot {
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  overflow: hidden;
}

.publish-snapshot__bar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  background: #f8fafc;
  border-bottom: 1px solid #e5e7eb;
}

.publish-snapshot__meta {
  font-size: 12px;
  color: #64748b;
}

.publish-actions {
  display: flex;
  gap: 10px;
  justify-content: flex-end;
}

/* ========== Compile Section (in Edit Step) ========== */
.compile-section {
  margin-top: 24px;
  padding: 16px;
  background: #fafbfc;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
}

.compile-section__header {
  margin-bottom: 12px;
}

.compile-section__header h5 {
  margin: 0 0 4px 0;
  font-size: 14px;
  font-weight: 600;
  color: #1f2937;
}

.compile-section__hint {
  margin: 0;
  font-size: 12px;
  color: #6b7280;
}

.compile-section__actions {
  margin-top: 12px;
  display: flex;
  gap: 8px;
  justify-content: flex-start;
}

.editor-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
  padding-bottom: 12px;
  border-bottom: 1px solid #e5e7eb;
}

.editor-header h5 {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: #1f2937;
}

.constrained-editor,
.direct-editor {
  margin-top: 16px;
}

@media (max-width: 1024px) {
  .workbench-steps {
    grid-template-columns: 1fr 1fr;
  }
  .compile-diff {
    grid-template-columns: 1fr;
  }
}
</style>
