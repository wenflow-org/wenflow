<template>
  <!-- 2026-10-28 用户「把这个按照对话的样子拆散了，并到对话列表里去，文案不要了」：
       基础设施不再自成区块，向量化 / 重排作为模型表里的两组行，沿用同一套分组行、
       状态徽标与行内动作；服务地址、密钥、超时等细节收进编辑弹层。未配置的降级
       说明不再上屏，状态徽标与测试结果已能表达。 -->
  <tr v-if="view" id="mpp-platform-panel-infra" class="mpp-group">
    <td colspan="4">
      <span class="mpp-group__name">基础设施</span>
      <span class="mpp-group__count">{{ entries.length }} 个</span>
    </td>
  </tr>
  <tr v-if="loading && !view">
    <td colspan="4" class="mpp-empty">基础设施读取中…</td>
  </tr>
  <tr v-else-if="failed">
    <td colspan="4" class="mpp-empty">
      {{ failed }}
      <button type="button" class="mk-link" @click="load">重试</button>
    </td>
  </tr>
  <tr v-for="entry in view ? entries : []" :key="entry.kind">
    <td class="mpp-model">
      <span class="mono mpp-model__id" :title="entry.model">{{ entry.model || '—' }}</span>
      <span
        v-if="testResults[entry.kind]"
        class="mpp-rowtest"
        :class="{ 'mpp-rowtest--bad': !testResults[entry.kind]!.ok }"
        :title="testResults[entry.kind]!.text"
      >{{ testResults[entry.kind]!.ok ? '调用通过' : '调用失败' }}<template v-if="testResults[entry.kind]!.text"> · {{ testResults[entry.kind]!.text }}</template></span>
    </td>
    <td class="mpp-fn">
      <span class="mpp-fn__chip">{{ kindLabel(entry.kind) }}</span>
    </td>
    <td>
      <span
        class="mk-badge"
        :class="entry.configured ? 'mk-badge--ok' : 'mk-badge--bad'"
        :title="sourceText(entry)"
      >{{ entry.configured ? '已配置' : '未配置' }}</span>
    </td>
    <td class="mpp-rowacts">
      <button
        type="button"
        class="mk-link"
        :disabled="testing[entry.kind]"
        @click="test(entry.kind)"
      >{{ testing[entry.kind] ? '测试中…' : '测试' }}</button>
      <button type="button" class="mk-link" @click="openEdit(entry)">编辑</button>
    </td>
  </tr>

    <Teleport to="body">
      <div v-if="editKind" ref="maskRef" class="mk-modal">
        <div ref="panelRef" class="mk-modal__panel" role="dialog" aria-label="编辑基础设施模型">
          <div class="mk-modal__head">
            <h3 class="mk-modal__title">编辑{{ editKind === 'embedding' ? '向量化' : '重排' }}模型</h3>
            <button type="button" class="mk-modal__close" aria-label="关闭" @click="closeEdit">✕</button>
          </div>
          <div class="mk-modal__body">
            <label class="mk-field">
              <span class="mk-field__label">模型 id</span>
              <input
                v-model="form.model"
                class="mk-field__input"
                :placeholder="editKind === 'embedding' ? '例如：BAAI/bge-m3' : '例如：BAAI/bge-reranker-v2-m3'"
              />
            </label>
            <label class="mk-field">
              <span class="mk-field__label">服务地址</span>
              <input
                v-model="form.endpoint"
                class="mk-field__input"
                :placeholder="editKind === 'embedding' ? 'https://gateway.example.com/v1/embeddings' : 'https://gateway.example.com/v1/rerank'"
              />
            </label>
            <label class="mk-field">
              <span class="mk-field__label">密钥环境变量</span>
              <input v-model="form.apiKeyEnv" class="mk-field__input" placeholder="EMBEDDING_API_KEY" />
            </label>
            <label class="mk-field">
              <span class="mk-field__label">API Key</span>
              <input
                v-model="form.apiKey"
                class="mk-field__input"
                type="password"
                autocomplete="new-password"
                :placeholder="editEntry?.keyHint ? `留空 = 沿用已配置（${editEntry.keyHint}）` : '输入 API Key'"
              />
            </label>
            <div class="infra-formrow">
              <label class="mk-field">
                <span class="mk-field__label">超时（毫秒）</span>
                <input v-model.number="form.timeoutMs" class="mk-field__input" type="number" min="1000" max="120000" step="1000" />
              </label>
              <label class="mk-field">
                <span class="mk-field__label">批量大小</span>
                <input
                  v-if="editKind === 'embedding'"
                  v-model.number="form.batchSize"
                  class="mk-field__input"
                  type="number"
                  min="1"
                  max="128"
                />
                <input v-else class="mk-field__input" value="不适用" disabled />
              </label>
            </div>
            <label v-if="editKind === 'embedding'" class="mk-field">
              <span class="mk-field__label">向量维度（可选）</span>
              <input v-model.number="form.dimensions" class="mk-field__input" type="number" min="1" max="16384" placeholder="留空由上游返回" />
            </label>
            <label class="infra-check">
              <input v-model="form.clearKey" type="checkbox" />
              <span>清除已保存的密钥（仍可回落环境变量）</span>
            </label>
          </div>
          <div class="mk-modal__foot">
            <button type="button" class="mk-btn" @click="closeEdit">取消</button>
            <button type="button" class="mk-btn mk-btn--primary" :disabled="saving" @click="save">
              {{ saving ? '保存中…' : '保存' }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { onMounted } from 'vue'
import {
  adminInfraModelsApi,
  type InfraModelEntryView,
  type InfraModelsView,
  type InfraModelsUpdateInput,
} from '@/api/adminApi'
import { errMsg } from './live'
import { useEscape } from './useEscape'
import { useOverlay, useMaskClose } from './useOverlay'
import { toast } from '@/utils/toast'

type InfraKind = 'embedding' | 'rerank'

const loading = ref(false)
const failed = ref('')
const view = ref<InfraModelsView | null>(null)

const entries = computed<InfraModelEntryView[]>(() =>
  view.value ? [view.value.embedding, view.value.rerank] : [],
)

const testing = ref<Record<InfraKind, boolean>>({ embedding: false, rerank: false })
const testResults = ref<Record<InfraKind, { ok: boolean; text: string } | null>>({ embedding: null, rerank: null })

function kindLabel(kind: InfraKind): string {
  return kind === 'embedding' ? '向量化' : '重排'
}

function sourceText(entry: InfraModelEntryView): string {
  return entry.configSource === 'db' ? '配置来源：平台配置' : '配置来源：环境变量回落'
}

async function load() {
  loading.value = true
  failed.value = ''
  try {
    const res = await adminInfraModelsApi.get()
    view.value = (res.data?.data ?? res.data) as InfraModelsView
  } catch (e) {
    failed.value = `基础设施配置读取失败：${errMsg(e)}`
  } finally {
    loading.value = false
  }
}

async function test(kind: InfraKind) {
  testing.value[kind] = true
  testResults.value[kind] = null
  try {
    const res = await adminInfraModelsApi.test(kind)
    const data = (res.data?.data ?? {}) as {
      ok?: boolean
      provider?: string
      model?: string
      latencyMs?: number
      dimensions?: number
      error?: string
      code?: string
    }
    testResults.value[kind] = data.ok
      ? {
          ok: true,
          text: [
            data.latencyMs != null ? `${data.latencyMs}ms` : '',
            data.dimensions ? `${data.dimensions} 维` : '',
          ].filter(Boolean).join(' · '),
        }
      : { ok: false, text: data.error || data.code || '调用失败' }
  } catch (e) {
    testResults.value[kind] = { ok: false, text: errMsg(e) }
  } finally {
    testing.value[kind] = false
  }
}

/* ---------- 编辑弹层 ---------- */
const editKind = ref<InfraKind | null>(null)
const editEntry = ref<InfraModelEntryView | null>(null)
const saving = ref(false)
const form = ref({
  model: '',
  endpoint: '',
  apiKeyEnv: '',
  apiKey: '',
  timeoutMs: 20000,
  batchSize: 32,
  dimensions: null as number | null,
  clearKey: false,
})

const panelRef = ref<HTMLElement | null>(null)
const maskRef = ref<HTMLElement | null>(null)
useEscape(() => Boolean(editKind.value), closeEdit)
useOverlay(computed(() => Boolean(editKind.value)), panelRef)
useMaskClose(maskRef, closeEdit)

function openEdit(entry: InfraModelEntryView) {
  editKind.value = entry.kind
  editEntry.value = entry
  form.value = {
    model: entry.model,
    endpoint: entry.endpoint,
    apiKeyEnv: entry.apiKeyEnv,
    apiKey: '',
    timeoutMs: entry.timeoutMs,
    batchSize: entry.batchSize ?? 32,
    dimensions: entry.dimensions,
    clearKey: false,
  }
}

function closeEdit() {
  editKind.value = null
  editEntry.value = null
}

async function save() {
  const kind = editKind.value
  if (!kind) return
  if (!form.value.model.trim() || !form.value.endpoint.trim()) {
    toast.error('模型 id 与服务地址不能为空')
    return
  }
  if (!Number.isInteger(form.value.timeoutMs) || form.value.timeoutMs < 1000 || form.value.timeoutMs > 120000) {
    toast.error('超时必须是 1000-120000 之间的整数毫秒')
    return
  }
  if (kind === 'embedding' && (!Number.isInteger(form.value.batchSize) || form.value.batchSize < 1 || form.value.batchSize > 128)) {
    toast.error('批量大小必须是 1-128 之间的整数')
    return
  }
  saving.value = true
  try {
    const rawDimensions = form.value.dimensions as number | string | null
    const patch: NonNullable<InfraModelsUpdateInput['embedding']> = {
      endpoint: form.value.endpoint.trim(),
      model: form.value.model.trim(),
      apiKeyEnv: form.value.apiKeyEnv.trim(),
      timeoutMs: form.value.timeoutMs,
      batchSize: kind === 'embedding' ? form.value.batchSize : null,
      dimensions: rawDimensions === null || rawDimensions === '' ? null : Number(rawDimensions),
    }
    if (form.value.apiKey.trim()) patch.apiKey = form.value.apiKey.trim()
    if (form.value.clearKey) patch.clearKey = true
    const res = await adminInfraModelsApi.update({ [kind]: patch })
    view.value = (res.data?.data ?? res.data) as InfraModelsView
    closeEdit()
    toast.success(`${kind === 'embedding' ? '向量化' : '重排'}模型已保存`)
  } catch (e) {
    toast.error(`保存失败：${errMsg(e)}`)
  } finally {
    saving.value = false
  }
}

onMounted(load)
</script>

<style scoped>
/* 行样式与模型表同源：父组件的 scoped 样式进不到子组件内部，这里补齐分组行、
   模型格、功能胶囊与行内动作的同一套观感。 */
.mpp-group td {
  height: 40px;
  background: var(--mk-surface-2);
  border-top: 1px solid var(--mk-line);
}
.mpp-group__name { font-size: var(--mk-fs-micro); font-weight: 700; color: var(--mk-ink); }
.mpp-group__count { margin-left: 6px; font-size: var(--mk-fs-micro); color: var(--mk-faint); font-variant-numeric: tabular-nums; }
.mpp-model { min-width: 180px; }
.mpp-model__id { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mpp-rowtest { display: block; margin-top: 2px; color: var(--mk-green); font-size: var(--mk-fs-micro); }
.mpp-rowtest--bad { color: var(--mk-red); }
.mpp-fn { white-space: normal; min-width: 88px; }
.mpp-fn__chip {
  display: inline-block;
  margin-right: 4px;
  margin-bottom: 2px;
  padding: 1px 7px;
  border-radius: 999px;
  background: var(--mk-blue-bg);
  font-size: var(--mk-fs-micro);
  font-weight: 700;
  color: var(--mk-blue);
  white-space: nowrap;
}
.mpp-rowacts { display: flex; align-items: center; gap: 8px; white-space: nowrap; }
.mpp-empty { color: var(--mk-muted); font-size: var(--mk-fs-micro); }
.infra-formrow { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.infra-check { display: flex; align-items: center; gap: 8px; font-size: var(--mk-fs-micro); color: var(--mk-muted); }
</style>
