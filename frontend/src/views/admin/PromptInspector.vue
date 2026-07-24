<template>
  <div class="admin-page prompt-inspector">
    <AdminPageHeader title="Prompt 检视与 Dry Run" :icon="DocumentChecked">
      <template #actions>
        <el-button @click="loadSelected" :loading="loading">刷新</el-button>
        <el-button @click="goBack">返回 Skill 目录</el-button>
      </template>
    </AdminPageHeader>

    <el-alert type="info" :closable="false" show-icon>
      <template #title>正式 Prompt 由文件和 Git 管理</template>
      Admin 不再保存、热更换或发布 Prompt。Dry Run 只在内存生成候选产物，不写文件、不修改 DB ACTIVE。
    </el-alert>

    <section class="inspector-control">
      <el-select v-model="selectedSkillId" filterable placeholder="选择 Skill" @change="loadSelected">
        <el-option v-for="item in sources" :key="item.id" :label="item.name" :value="item.id" />
      </el-select>
      <div class="inspector-control__meta">
        <span>{{ source.length }} 字符</span>
        <span>{{ compiledPrompt ? `${compiledPrompt.length} 字符候选产物` : '尚未执行 Dry Run' }}</span>
      </div>
    </section>

    <div class="inspector-grid">
      <section class="inspector-panel">
        <header><strong>Prompt Lab Source</strong><el-button text @click="copy(source)">复制</el-button></header>
        <pre>{{ source || '当前 Skill 没有 Prompt Lab Source' }}</pre>
      </section>
      <section class="inspector-panel inspector-panel--result">
        <header>
          <strong>Dry Run 候选产物</strong>
          <div class="inspector-panel__actions">
            <el-radio-group v-if="compiledPrompt" v-model="viewMode" size="small">
              <el-radio-button value="result">产物</el-radio-button>
              <el-radio-button value="diff">差异对比</el-radio-button>
            </el-radio-group>
            <el-button text :disabled="!compiledPrompt" @click="copy(compiledPrompt)">复制</el-button>
            <el-button type="primary" :loading="compiling" :disabled="!selectedSkillId || !source" @click="compile">执行 Dry Run</el-button>
          </div>
        </header>
        <pre v-if="viewMode === 'result'">{{ compiledPrompt || '执行 Dry Run 后在此查看候选内容' }}</pre>
        <div v-else class="diff-view" role="table" aria-label="Source 与候选产物差异">
          <div class="diff-view__summary">
            <span class="diff-view__stat diff-view__stat--add">+{{ diffResult.added }} 行新增</span>
            <span class="diff-view__stat diff-view__stat--del">−{{ diffResult.removed }} 行删除</span>
            <span class="diff-view__hint">与 Source 对比：− 为原有内容，+ 为候选新增</span>
          </div>
          <div
            v-for="(line, i) in diffResult.lines"
            :key="i"
            class="diff-line"
            :class="`diff-line--${line.type}`"
          >
            <span class="diff-line__sign">{{ line.type === 'add' ? '+' : line.type === 'del' ? '−' : ' ' }}</span>
            <span class="diff-line__text">{{ line.text || ' ' }}</span>
          </div>
        </div>
      </section>
      <section class="inspector-panel inspector-panel--contract">
        <header>
          <strong>Runtime Contract</strong>
          <el-button text :disabled="!runtimeContract" @click="copy(JSON.stringify(runtimeContract, null, 2))">复制</el-button>
        </header>
        <pre>{{ runtimeContract ? JSON.stringify(runtimeContract, null, 2) : '执行 Dry Run 后查看运行时契约' }}</pre>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { DocumentChecked } from '@element-plus/icons-vue'
import { adminPromptLabApi } from '@/api/adminApi'
import { toast } from '@/utils/toast'
import { diffLines } from '@/utils/diffLines'
import AdminPageHeader from './components/AdminPageHeader.vue'

const router = useRouter()
const sources = ref<Array<{ id: string; name: string }>>([])
const selectedSkillId = ref('')
const source = ref('')
const compiledPrompt = ref('')
const runtimeContract = ref<any>(null)
const loading = ref(false)
const compiling = ref(false)
const viewMode = ref<'result' | 'diff'>('result')

// 候选产物 vs Source 的行级差异
const diffResult = computed(() => diffLines(source.value, compiledPrompt.value))

async function initialize() {
  loading.value = true
  try {
    const response = await adminPromptLabApi.getSources()
    sources.value = response.data?.data || []
    if (!selectedSkillId.value && sources.value.length) selectedSkillId.value = sources.value[0].id
    await loadSelected()
  } catch (error: any) {
    toast.error(error.response?.data?.error || error.message || '加载 Prompt Source 失败')
  } finally {
    loading.value = false
  }
}

// 请求序号：切换 Skill 时仅最新一次 getSource 响应允许写回，避免慢响应覆盖新选择
let loadSeq = 0

async function loadSelected() {
  if (!selectedSkillId.value) return
  const seq = ++loadSeq
  loading.value = true
  compiledPrompt.value = ''
  viewMode.value = 'result'
  try {
    const response = await adminPromptLabApi.getSource(selectedSkillId.value)
    if (seq !== loadSeq) return
    source.value = response.data?.data || ''
  } catch (error) {
    if (seq !== loadSeq) return
    source.value = ''
    const responseError = (error as { response?: { data?: { error?: unknown } } } | null)?.response?.data?.error
    const message = typeof responseError === 'string' && responseError
      ? responseError
      : (error as Error | null)?.message || '加载 Prompt Source 失败'
    toast.error(message)
  } finally {
    if (seq === loadSeq) loading.value = false
  }
}

async function compile() {
  compiling.value = true
  try {
    const response = await adminPromptLabApi.compileSource({ skillId: selectedSkillId.value })
    // 后端 compile-source 响应的 prompt 在顶层（无 data 包裹），与其它接口的 data.data.* 不同
    compiledPrompt.value = response.data?.prompt || ''
    runtimeContract.value = response.data?.runtimeContract || null
    toast.success('Dry Run 完成，未写入文件或数据库')
  } catch (error: any) {
    toast.error(error.response?.data?.error || error.message || 'Dry Run 失败')
  } finally {
    compiling.value = false
  }
}

async function copy(content: string) {
  if (!content) return
  try {
    await navigator.clipboard.writeText(content)
    toast.success('已复制')
  } catch {
    toast.error('复制失败：剪贴板不可用（需 HTTPS 或授权）')
  }
}

function goBack() {
  router.push('/admin/skills')
}

onMounted(initialize)
</script>

<style scoped>
.prompt-inspector {
  display: grid;
  gap: 16px;
}

.inspector-control {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.inspector-control .el-select {
  width: min(420px, 100%);
}

.inspector-control__meta {
  display: flex;
  gap: 16px;
  color: var(--admin-text-muted);
  font-size: 12px;
}

.inspector-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}

.inspector-panel {
  min-width: 0;
  border: 1px solid rgba(211, 221, 237, 0.94);
  border-radius: 16px;
  overflow: hidden;
  background: rgba(250, 252, 255, 0.92);
}

.inspector-panel--result {
  background: rgba(246, 250, 255, 0.96);
}

.inspector-panel header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 14px;
  border-bottom: 1px solid rgba(223, 231, 243, 0.92);
}

.inspector-panel header div {
  display: flex;
  align-items: center;
}

.inspector-panel pre {
  margin: 0;
  height: calc(100vh - 310px);
  min-height: 420px;
  overflow: auto;
  padding: 16px;
  white-space: pre-wrap;
  word-break: break-word;
  font: 12px/1.65 Consolas, Monaco, monospace;
  color: #263950;
}

.inspector-panel__actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

/* diff 视图 */
.diff-view {
  height: calc(100vh - 310px);
  min-height: 420px;
  overflow: auto;
  padding: 8px 0 16px;
  font: 12px/1.65 Consolas, Monaco, monospace;
}

.diff-view__summary {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 6px 16px 10px;
  border-bottom: 1px solid rgba(223, 231, 243, 0.92);
  margin-bottom: 6px;
  font-family: inherit;
  font-size: 12px;
}

.diff-view__stat {
  font-weight: 700;
}

.diff-view__stat--add {
  color: var(--admin-color-success);
}

.diff-view__stat--del {
  color: var(--admin-color-error);
}

.diff-view__hint {
  margin-left: auto;
  color: var(--admin-text-muted);
  font-size: 11px;
}

.diff-line {
  display: flex;
  gap: 10px;
  padding: 0 16px 0 10px;
  white-space: pre-wrap;
  word-break: break-word;
  color: #263950;
}

.diff-line__sign {
  flex-shrink: 0;
  width: 14px;
  text-align: center;
  color: var(--admin-text-muted);
  user-select: none;
}

.diff-line--add {
  background: var(--admin-color-success-bg);
}

.diff-line--add .diff-line__sign,
.diff-line--add .diff-line__text {
  color: var(--admin-color-success);
}

.diff-line--del {
  background: var(--admin-color-error-bg);
}

.diff-line--del .diff-line__sign,
.diff-line--del .diff-line__text {
  color: var(--admin-color-error);
}

@media (max-width: 900px) {
  .inspector-grid {
    grid-template-columns: 1fr;
  }

  .inspector-control {
    align-items: stretch;
    flex-direction: column;
  }
}
</style>
