<!--
  PromptPreviewPane
  ============================================================
  Skill 单次试运行：给 JSON 输入 → 调用当前 ACTIVE prompt → 看输出
  
  用途：日常调试、回归确认、查看 prompt 在真实输入下的行为
  路由：作为 AgentEditor 第 5 tab「试运行」
  
  从原 SkillPromptPreview.vue 抽离核心预览逻辑：
    - Sample Input JSON 编辑器
    - 运行预览（adminSkillsApi.testSkill）
    - Sample Output 展示 + 执行元信息（耗时/缓存/状态）
-->
<template>
  <div class="prompt-preview-pane">
    <el-card class="preview-card" shadow="never">
      <template #header>
        <div class="card-head">
          <span class="card-head__title">单次试运行</span>
          <div class="card-head__actions">
            <el-button type="primary" :icon="VideoPlay" :loading="loading" :disabled="!agent" @click="run">
              运行预览
            </el-button>
            <el-button :disabled="!sampleInputText.trim()" @click="formatJson">格式化 JSON</el-button>
            <el-button :disabled="!sampleInputText.trim()" :icon="DocumentCopy" @click="copy(sampleInputText, '输入 JSON 已复制')">
              复制输入
            </el-button>
          </div>
        </div>
      </template>

      <div class="editor-block">
        <div class="editor-block__header">
          <strong>Sample Input</strong>
          <span>这里的 JSON 将作为 Skill 输入直接发给运行时。</span>
        </div>
        <el-input
          v-model="sampleInputText"
          type="textarea"
          :rows="12"
          resize="vertical"
          class="json-editor"
          placeholder="{}"
        />
      </div>

      <div class="result-block">
        <div class="result-block__header">
          <strong>Sample Output</strong>
          <div class="card-head__actions">
            <el-button text @click="clear" :disabled="!result && !error">清空</el-button>
            <el-button
              text
              :icon="DocumentCopy"
              :disabled="!outputText"
              @click="copy(outputText, '输出结果已复制')"
            >
              复制输出
            </el-button>
          </div>
        </div>

        <div v-if="result" class="result-meta">
          <el-tag size="small" :type="result.success ? 'success' : 'danger'">
            {{ result.success ? '执行成功' : '执行失败' }}
          </el-tag>
          <el-tag size="small" effect="plain">耗时 {{ result.duration }} ms</el-tag>
          <el-tag size="small" effect="plain">{{ result.cached ? '命中缓存' : '实时执行' }}</el-tag>
          <el-tag v-if="runAt" size="small" effect="plain">{{ formatTime(runAt) }}</el-tag>
        </div>

        <el-alert
          v-if="error"
          class="result-alert"
          type="error"
          :closable="false"
          show-icon
          :title="error"
        />

        <pre v-if="outputText" class="code-block">{{ outputText }}</pre>
        <el-empty v-else-if="!error" description="点击「运行预览」查看当前 Skill 输出" :image-size="80" />
      </div>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { DocumentCopy, VideoPlay } from '@element-plus/icons-vue'
import { adminSkillsApi } from '@/api/adminApi'
import { toast } from '@/utils/toast'

interface AgentLike {
  agentId: string
}

const props = defineProps<{ agent: AgentLike | null }>()

const getErrorMessage = (error: unknown, fallback: string) => {
  const message = (error as { message?: unknown } | null)?.message
  return typeof message === 'string' && message ? message : fallback
}

const sampleInputText = ref('{}')
const loading = ref(false)
const result = ref<{ output?: unknown; data?: unknown; [key: string]: unknown } | null>(null)
const error = ref('')
const runAt = ref<string>('')

const outputText = computed(() => {
  if (!result.value) return ''
  const payload = result.value.output ?? result.value.data ?? result.value
  return typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2)
})

// 把 agentId 转成 skillId：skill:xxx → xxx，其它直接用
const targetSkillId = computed(() => {
  if (!props.agent) return ''
  const id = props.agent.agentId
  return id.startsWith('skill:') ? id.slice(6) : id
})

function formatJson() {
  try {
    const parsed = JSON.parse(sampleInputText.value)
    sampleInputText.value = JSON.stringify(parsed, null, 2)
  } catch (e) {
    toast.error(getErrorMessage(e, 'JSON 不合法'))
  }
}

async function copy(text: string, successMsg: string) {
  if (!text) return
  try {
    await navigator.clipboard.writeText(text)
    toast.success(successMsg)
  } catch {
    toast.error('复制失败')
  }
}

function clear() {
  result.value = null
  error.value = ''
  runAt.value = ''
}

async function run() {
  if (!targetSkillId.value) {
    toast.error('未选定 Skill')
    return
  }

  let parsedInput: unknown
  try {
    parsedInput = JSON.parse(sampleInputText.value)
  } catch (e) {
    toast.error(getErrorMessage(e, '输入 JSON 不合法'))
    return
  }

  loading.value = true
  error.value = ''
  try {
    const response = await adminSkillsApi.testSkill(targetSkillId.value, parsedInput)
    result.value = response.data?.data || null
    runAt.value = new Date().toISOString()
    toast.success('试运行完成')
  } catch (e: any) {
    result.value = null
    error.value = e?.response?.data?.error || e?.message || '试运行失败'
    toast.error(error.value)
  } finally {
    loading.value = false
  }
}

function formatTime(value: string) {
  if (!value) return '--'
  return new Date(value).toLocaleString('zh-CN')
}
</script>

<style scoped>
.prompt-preview-pane {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 16px;
}

.preview-card {
  border-radius: 16px;
}

.card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.card-head__title {
  font-size: 0.95rem;
  font-weight: 700;
  color: #22344d;
}

.card-head__actions {
  display: flex;
  gap: 8px;
}

.editor-block,
.result-block {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 10px;
  margin-top: 12px;
}

.editor-block__header,
.result-block__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.editor-block__header strong,
.result-block__header strong {
  color: #22344d;
  font-size: 0.92rem;
}

.editor-block__header span {
  color: #62758f;
  font-size: 0.82rem;
}

.json-editor :deep(.el-textarea__inner) {
  font-family: 'JetBrains Mono', 'Fira Code', Consolas, monospace;
  font-size: 12.5px;
  line-height: 1.6;
  background: rgba(247, 250, 255, 0.86);
}

.result-meta {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 4px;
}

.result-alert {
  margin-top: 8px;
}

.code-block {
  background: rgba(247, 250, 255, 0.86);
  border: 1px solid rgba(216, 224, 238, 0.94);
  border-radius: 12px;
  padding: 14px 16px;
  font-family: 'JetBrains Mono', 'Fira Code', Consolas, monospace;
  font-size: 12.5px;
  line-height: 1.65;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 480px;
  overflow: auto;
  color: #23344d;
  margin: 0;
}
</style>
