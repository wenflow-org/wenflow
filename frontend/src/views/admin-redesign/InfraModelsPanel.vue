<template>
  <!-- 2026-10-28 用户「向量与重排是全局单例引擎，不要套多模型卡片」：
       两张卡只回答「当前挂的是哪个模型、健不健康、走哪条连接」，不再铺表单。
       连接方式与模型参数统一收进「配置」弹层，一次保存。 -->
  <div id="mpp-platform-panel-infra" class="mpp-infra">
    <p v-if="loading && !view" class="mpp-infra__state">模型配置读取中…</p>
    <p v-else-if="failed" class="mpp-infra__state">
      {{ failed }}
      <button type="button" class="mk-link" @click="load">重试</button>
    </p>
    <template v-else-if="view">
      <section v-for="g in groups" :key="g.kind" class="mk-card mpp-eng">
        <div class="mk-card__head">
          <div class="mpp-eng__id">
            <h3 class="mk-card__title">{{ g.label }}</h3>
            <span class="mpp-type">{{ g.kind === 'embedding' ? 'Embedding' : 'Reranker' }}</span>
            <span
              class="mk-badge"
              :class="g.entry.configured ? 'mk-badge--ok' : 'mk-badge--bad'"
              :title="sourceText(g.entry)"
            >{{ g.entry.configured ? '已配置' : '未配置' }}</span>
          </div>
          <div class="mpp-eng__acts">
            <button
              v-if="g.entry.configured"
              type="button"
              class="mk-link"
              :disabled="testing[g.kind]"
              @click="test(g.kind)"
            >{{ testing[g.kind] ? '测试中…' : '测试' }}</button>
            <button type="button" class="mk-btn mk-btn--sm" @click="openEdit(g.entry)">配置</button>
          </div>
        </div>
        <div class="mpp-eng__summary">
          <span class="mono mpp-eng__model" :title="g.entry.model">{{ g.entry.model || '未选择模型' }}</span>
          <span class="mpp-eng__meta">
            {{ g.kind === 'embedding'
              ? (g.entry.dimensions ? `${g.entry.dimensions} 维` : '维度由上游返回')
              : 'Cohere 兼容' }}
          </span>
          <span class="mpp-eng__conn" :title="g.entry.endpoint">{{ connectionSummary(g.entry) }}</span>
          <span
            v-if="testResults[g.kind]"
            class="mpp-eng__res"
            :class="{ 'is-bad': !testResults[g.kind]!.ok }"
            :title="testResults[g.kind]!.text"
          >{{ testResults[g.kind]!.ok ? '调用通过' : '调用失败' }}<template v-if="testResults[g.kind]!.text"> · {{ testResults[g.kind]!.text }}</template></span>
        </div>
      </section>
    </template>

    <Teleport to="body">
      <div v-if="editKind" ref="maskRef" class="mk-modal">
        <div ref="panelRef" class="mk-modal__panel" role="dialog" :aria-label="`配置${editKindLabel}`">
          <div class="mk-modal__head">
            <h3 class="mk-modal__title">配置{{ editKindLabel }}</h3>
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

            <div class="mk-field">
              <span class="mk-field__label">连接方式</span>
              <div class="infra-choice" role="radiogroup" aria-label="连接方式">
                <label class="infra-choice__opt" :class="{ 'is-on': form.connectionMode === 'inherit' }">
                  <input v-model="form.connectionMode" type="radio" value="inherit" />
                  <span class="infra-choice__text">
                    <strong>复用对话模型的连接</strong>
                    <small>地址与密钥都取对话卡，按类型自动拼接路径</small>
                  </span>
                </label>
                <label class="infra-choice__opt" :class="{ 'is-on': form.connectionMode === 'own' }">
                  <input v-model="form.connectionMode" type="radio" value="own" />
                  <span class="infra-choice__text">
                    <strong>独立服务</strong>
                    <small>这个能力走自己的地址与密钥</small>
                  </span>
                </label>
              </div>
            </div>

            <p v-if="form.connectionMode === 'inherit'" class="infra-inherit">
              当前复用 <span class="mono">{{ view?.platformBaseUrl || '对话卡的服务地址' }}</span>
            </p>
            <template v-else>
              <div class="infra-conn" :class="{ 'infra-conn--rerank': editKind === 'rerank' }">
                <label class="mk-field">
                  <span class="mk-field__label">服务地址</span>
                  <input
                    v-model="form.endpoint"
                    class="mk-field__input"
                    :placeholder="editKind === 'embedding' ? 'https://api.example.com/v1/embeddings' : 'https://api.example.com/v1/rerank'"
                  />
                </label>
                <label v-if="editKind === 'rerank'" class="mk-field">
                  <span class="mk-field__label">接口规范</span>
                  <input class="mk-field__input" value="Cohere 兼容" disabled title="当前只支持 Cohere 兼容的重排协议" />
                </label>
                <label class="mk-field">
                  <span class="mk-field__label">API Key</span>
                  <input
                    v-model="form.apiKey"
                    class="mk-field__input"
                    type="password"
                    autocomplete="new-password"
                    :placeholder="keyPlaceholder"
                  />
                </label>
              </div>
              <label v-if="editEntry?.keySource === 'db'" class="infra-clearkey">
                <input v-model="form.clearKey" type="checkbox" />
                <span>清除已保存的密钥（仍可回落环境变量）</span>
              </label>
            </template>

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
              <!-- 非必填不补「（可选）」：占位符「留空由上游返回」已说明留空后果 -->
              <span class="mk-field__label">向量维度</span>
              <input v-model.number="form.dimensions" class="mk-field__input" type="number" min="1" max="16384" placeholder="留空由上游返回" />
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
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import {
  adminInfraModelsApi,
  type InfraModelEntryView,
  type InfraModelsUpdateInput,
  type InfraModelsView,
} from '@/api/adminApi'
import { errMsg } from './live'
import { MODEL_TYPE_LABEL } from './modelTypeLabels'
import { useEscape } from './useEscape'
import { useOverlay, useMaskClose } from './useOverlay'
import { toast } from '@/utils/toast'

type InfraKind = 'embedding' | 'rerank'
type ConnectionMode = 'inherit' | 'own'

const loading = ref(false)
const failed = ref('')
const view = ref<InfraModelsView | null>(null)

const groups = computed(() =>
  view.value
    ? [
        { kind: 'embedding' as const, label: MODEL_TYPE_LABEL.embedding, entry: view.value.embedding },
        { kind: 'rerank' as const, label: MODEL_TYPE_LABEL.rerank, entry: view.value.rerank },
      ]
    : [],
)

const testing = ref<Record<InfraKind, boolean>>({ embedding: false, rerank: false })
const testResults = ref<Record<InfraKind, { ok: boolean; text: string } | null>>({ embedding: null, rerank: null })

function kindLabel(kind: InfraKind): string {
  return kind === 'embedding' ? MODEL_TYPE_LABEL.embedding : MODEL_TYPE_LABEL.rerank
}

function sourceText(entry: InfraModelEntryView): string {
  if (entry.connectionMode === 'inherit') return '配置来源：对话模型的连接'
  return entry.configSource === 'db' ? '配置来源：平台配置' : '配置来源：环境变量回落'
}

/** 卡面只留一句连接归属，细节进弹层。 */
function connectionSummary(entry: InfraModelEntryView): string {
  if (entry.connectionMode === 'inherit') return '复用对话模型的连接'
  if (!entry.endpoint) return '独立端点 · 未填写地址'
  try {
    return `独立端点 · ${new URL(entry.endpoint).host}`
  } catch {
    return `独立端点 · ${entry.endpoint}`
  }
}

async function load() {
  loading.value = true
  failed.value = ''
  try {
    const res = await adminInfraModelsApi.get()
    view.value = (res.data?.data ?? res.data) as InfraModelsView
  } catch (e) {
    failed.value = `模型配置读取失败：${errMsg(e)}`
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

/* ---------- 配置弹层：连接 + 模型参数一次保存 ---------- */
const editKind = ref<InfraKind | null>(null)
const editEntry = ref<InfraModelEntryView | null>(null)
const editKindLabel = computed(() => (editKind.value ? kindLabel(editKind.value) : ''))
const saving = ref(false)
const form = ref({
  connectionMode: 'inherit' as ConnectionMode,
  endpoint: '',
  apiKey: '',
  clearKey: false,
  model: '',
  timeoutMs: 20000,
  batchSize: 32,
  dimensions: null as number | null,
})

const keyPlaceholder = computed(() => {
  const entry = editEntry.value
  if (entry?.keySource === 'db') return `留空 = 沿用已配置${entry.keyHint ? `（${entry.keyHint}）` : ''}`
  if (entry?.keySource === 'env') return '留空 = 沿用环境变量'
  if (entry?.keySource === 'inherit') return '留空 = 沿用向量模型的密钥'
  return '粘贴 API Key'
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
    connectionMode: entry.connectionMode,
    /* inherit 的 endpoint 是后端解析结果，不能回填成独立地址。 */
    endpoint: entry.connectionMode === 'own' ? entry.endpoint : '',
    apiKey: '',
    clearKey: false,
    model: entry.model,
    timeoutMs: entry.timeoutMs,
    batchSize: entry.batchSize ?? 32,
    dimensions: entry.dimensions,
  }
}

function closeEdit() {
  editKind.value = null
  editEntry.value = null
}

async function save() {
  const kind = editKind.value
  if (!kind) return
  if (!form.value.model.trim()) {
    toast.error('模型 id 不能为空')
    return
  }
  if (form.value.connectionMode === 'own' && !form.value.endpoint.trim()) {
    toast.error('独立服务需要填写服务地址')
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
      connectionMode: form.value.connectionMode,
      model: form.value.model.trim(),
      timeoutMs: form.value.timeoutMs,
      batchSize: kind === 'embedding' ? form.value.batchSize : null,
      dimensions: rawDimensions === null || rawDimensions === '' ? null : Number(rawDimensions),
    }
    if (form.value.connectionMode === 'own') {
      patch.endpoint = form.value.endpoint.trim()
      if (form.value.apiKey.trim()) patch.apiKey = form.value.apiKey.trim()
      if (form.value.clearKey) patch.clearKey = true
    }
    const res = await adminInfraModelsApi.update({ [kind]: patch })
    view.value = (res.data?.data ?? res.data) as InfraModelsView
    testResults.value[kind] = null
    closeEdit()
    toast.success(`${kindLabel(kind)}已保存`)
  } catch (e) {
    toast.error(`保存失败：${errMsg(e)}`)
  } finally {
    saving.value = false
  }
}

onMounted(load)
</script>

<style scoped>
/* 单例引擎：卡面只有一行摘要，不再铺连接表单与模型列表。 */
.mpp-infra { display: grid; gap: 10px; }
.mpp-infra__state { margin: 0; color: var(--mk-muted); font-size: var(--mk-fs-micro); }
.mpp-eng { display: flex; flex-direction: column; flex: none; }
.mpp-eng__id { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; min-width: 0; }
.mpp-eng__acts { display: inline-flex; align-items: center; gap: 8px; flex-wrap: wrap; justify-content: flex-end; }
.mpp-type {
  padding: 1px 7px;
  border-radius: 999px;
  background: var(--mk-surface-2);
  color: var(--mk-muted);
  font-size: var(--mk-fs-micro);
  font-weight: 600;
  line-height: 1.5;
}
.mpp-eng__summary {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  padding: 0 16px 14px;
  font-size: var(--mk-fs-micro);
}
.mpp-eng__model { color: var(--mk-ink); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mpp-eng__meta { color: var(--mk-faint); white-space: nowrap; }
.mpp-eng__conn { color: var(--mk-muted); white-space: nowrap; }
.mpp-eng__res { color: var(--mk-green); white-space: nowrap; }
.mpp-eng__res.is-bad { color: var(--mk-red); font-weight: 600; }

/* 连接方式用两枚说明卡，而不是一个裸复选框 */
.infra-choice { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
.infra-choice__opt {
  display: flex;
  align-items: flex-start;
  gap: 9px;
  padding: 10px 12px;
  border: 1px solid var(--mk-line);
  border-radius: var(--mk-radius-md);
  cursor: pointer;
  min-width: 0;
}
.infra-choice__opt.is-on {
  border-color: color-mix(in srgb, var(--mk-blue) 45%, transparent);
  background: color-mix(in srgb, var(--mk-blue) 5%, transparent);
}
.infra-choice__opt input { margin-top: 2px; flex: none; }
.infra-choice__text { display: grid; gap: 3px; min-width: 0; }
.infra-choice__text strong { font-size: var(--mk-fs-micro); color: var(--mk-ink); }
.infra-choice__text small { font-size: var(--mk-fs-micro); color: var(--mk-muted); line-height: 1.5; }
@media (max-width: 760px) {
  .infra-choice { grid-template-columns: minmax(0, 1fr); }
}
.infra-inherit {
  margin: 0;
  padding: 9px 11px;
  border-radius: var(--mk-radius-sm);
  background: var(--mk-surface-2);
  color: var(--mk-muted);
  font-size: var(--mk-fs-micro);
}
.infra-conn {
  display: grid;
  grid-template-columns: minmax(0, 1.6fr) minmax(0, 1fr);
  gap: 12px;
  align-items: end;
}
.infra-conn--rerank { grid-template-columns: minmax(0, 1.4fr) 140px minmax(0, 1fr); }
@media (max-width: 760px) {
  .infra-conn, .infra-conn--rerank { grid-template-columns: minmax(0, 1fr); }
}
.infra-clearkey {
  display: flex;
  align-items: center;
  gap: 7px;
  color: var(--mk-muted);
  font-size: var(--mk-fs-micro);
}
.infra-formrow { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
</style>
