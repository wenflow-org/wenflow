<template>
  <section class="infra-card" :class="props.embedded ? 'infra-card--embedded' : 'mk-card'">
    <div v-if="!props.embedded" class="mk-card__head">
      <h3 class="mk-card__title">
        基础设施模型
        <span class="mk-badge mk-badge--info">平台必需</span>
      </h3>
      <button type="button" class="mk-link" :disabled="loading" @click="load">
        {{ loading ? '刷新中…' : '刷新' }}
      </button>
    </div>
    <div v-else class="infra-embedded__head">
      <span class="infra-embedded__title">
        基础设施模型
        <span class="mk-badge mk-badge--info">平台必需</span>
      </span>
      <button type="button" class="mk-link" :disabled="loading" @click="load">
        {{ loading ? '刷新中…' : '刷新' }}
      </button>
    </div>

    <div v-if="failed" class="mk-alert mk-alert--row infra-alert" role="alert">
      <span class="mk-alert__msg">{{ failed }}</span>
      <button type="button" class="mk-alert__btn" @click="load">重试</button>
    </div>

    <MkLoading v-if="loading && !view" min text="基础设施配置加载中…" />

    <template v-else-if="view">
      <div v-if="view.warnings.length" class="mk-alert mk-alert--row infra-alert" role="alert">
        <span class="mk-alert__msg">
          <span v-for="(warning, index) in view.warnings" :key="index" class="infra-alert__line">{{ warning }}</span>
        </span>
      </div>

      <div class="infra-grid">
        <article v-for="entry in entries" :key="entry.kind" class="infra-item">
          <div class="infra-item__head">
            <div class="infra-item__id">
              <strong>{{ entry.kind === 'embedding' ? '向量化' : '重排' }}</strong>
              <span class="infra-item__desc">{{ entry.kind === 'embedding' ? '文本 → 向量' : '查询 + 候选 → 相关分' }}</span>
            </div>
            <span class="mk-badge" :class="entry.configured ? 'mk-badge--ok' : 'mk-badge--bad'">
              {{ entry.configured ? '已配置' : '未配置' }}
            </span>
          </div>

          <dl class="infra-kv">
            <div><dt>模型</dt><dd class="mono" :title="entry.model">{{ entry.model || '—' }}</dd></div>
            <div><dt>服务地址</dt><dd class="mono" :title="entry.endpoint">{{ entry.endpoint || '—' }}</dd></div>
            <div><dt>密钥</dt><dd>{{ keyText(entry) }}</dd></div>
            <div><dt>超时</dt><dd>{{ entry.timeoutMs }} ms</dd></div>
            <div v-if="entry.kind === 'embedding'"><dt>批量</dt><dd>{{ entry.batchSize ?? '—' }}</dd></div>
            <div v-if="entry.dimensions"><dt>维度</dt><dd>{{ entry.dimensions }}</dd></div>
          </dl>

          <div class="infra-item__foot">
            <span class="infra-item__source">{{ sourceText(entry) }}</span>
            <div class="mk-actions">
              <button type="button" class="mk-btn mk-btn--sm" @click="openEdit(entry)">编辑</button>
              <button
                type="button"
                class="mk-link"
                :disabled="testing[entry.kind]"
                @click="test(entry.kind)"
              >{{ testing[entry.kind] ? '测试中…' : '测试连接' }}</button>
            </div>
          </div>

          <div
            v-if="testResults[entry.kind]"
            class="infra-test"
            :class="testResults[entry.kind]!.ok ? 'is-ok' : 'is-bad'"
          >
            <span class="mk-badge" :class="testResults[entry.kind]!.ok ? 'mk-badge--ok' : 'mk-badge--bad'">
              {{ testResults[entry.kind]!.ok ? '测试通过' : '测试失败' }}
            </span>
            <span class="infra-test__text">{{ testText(entry.kind) }}</span>
          </div>
        </article>
      </div>
    </template>

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
  </section>
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
import MkLoading from '@/components/mk/MkLoading.vue'

type InfraKind = 'embedding' | 'rerank'

const props = withDefaults(defineProps<{
  /** 嵌入平台详情时去掉外层卡片与重复大标题，只留一条紧凑块头 */
  embedded?: boolean
}>(), { embedded: false })

const loading = ref(false)
const failed = ref('')
const view = ref<InfraModelsView | null>(null)

const entries = computed<InfraModelEntryView[]>(() =>
  view.value ? [view.value.embedding, view.value.rerank] : [],
)

const testing = ref<Record<InfraKind, boolean>>({ embedding: false, rerank: false })
const testResults = ref<Record<InfraKind, { ok: boolean; text: string } | null>>({ embedding: null, rerank: null })

function keyText(entry: InfraModelEntryView): string {
  if (entry.keySource === 'none') return '未配置'
  if (entry.keySource === 'inherit') return `沿用向量化密钥${entry.keyHint ? `（${entry.keyHint}）` : ''}`
  return `${entry.keySource === 'db' ? '平台密文' : '环境变量'}${entry.keyHint ? `（${entry.keyHint}）` : ''}`
}

function sourceText(entry: InfraModelEntryView): string {
  return entry.configSource === 'db' ? '配置来源：平台配置' : '配置来源：环境变量回落'
}

function testText(kind: InfraKind): string {
  return testResults.value[kind]?.text || ''
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
          text: `${data.model || '—'} · ${data.latencyMs ?? '—'}ms${data.dimensions ? ` · ${data.dimensions} 维` : ''}`,
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
.infra-card { container-type: inline-size; }
.infra-card--embedded { display: grid; gap: 12px; }
.infra-embedded__head {
  display: flex;
  align-items: baseline;
  gap: 10px;
  flex-wrap: wrap;
  margin-bottom: 2px;
}
.infra-embedded__title {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: var(--mk-fs-emphasis);
  font-weight: 600;
  color: var(--mk-ink);
}
.infra-embedded__head .mk-link { margin-left: auto; }
.infra-card--embedded .infra-alert { margin: 0; }
.infra-card--embedded .infra-grid { padding: 0; }
.infra-alert { margin: 12px 16px 0; }
.infra-alert__line { display: block; }
.infra-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
  gap: 12px;
  padding: 4px 16px 12px;
}
.infra-item {
  display: grid;
  gap: 10px;
  min-width: 0;
  padding: 14px;
  border: 1px solid var(--mk-line);
  border-radius: var(--mk-radius-xl);
  background: var(--mk-surface);
}
.infra-item__head { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; }
.infra-item__id { display: grid; gap: 2px; min-width: 0; }
.infra-item__id strong { font-size: var(--mk-fs-body); color: var(--mk-ink); }
.infra-item__desc { font-size: var(--mk-fs-micro); color: var(--mk-muted); }
.infra-kv { display: grid; gap: 5px; margin: 0; }
.infra-kv > div { display: grid; grid-template-columns: 64px minmax(0, 1fr); gap: 8px; align-items: baseline; }
.infra-kv dt { font-size: var(--mk-fs-micro); color: var(--mk-faint); }
.infra-kv dd { margin: 0; font-size: var(--mk-fs-micro); color: var(--mk-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.infra-item__foot { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.infra-item__source { font-size: var(--mk-fs-micro); color: var(--mk-faint); }
.infra-test { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: var(--mk-fs-micro); }
.infra-test.is-ok { color: var(--mk-green); }
.infra-test.is-bad { color: var(--mk-red); }
.infra-test__text { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.infra-formrow { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.infra-check { display: flex; align-items: center; gap: 8px; font-size: var(--mk-fs-micro); color: var(--mk-muted); }
@container (max-width: 420px) {
  .infra-grid { grid-template-columns: minmax(0, 1fr); }
  .infra-formrow { grid-template-columns: minmax(0, 1fr); }
}
</style>
