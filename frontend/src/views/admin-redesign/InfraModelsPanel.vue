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
        <!-- 2026-11-04 用户「和上面的对话模型卡片设计，不做成一行，分块」：
             与对话卡同一套解剖——卡头（标题 + 类型 + 状态）单独一块，下面一条模型行
             （模型 id 一行、参数摘要一行，右侧 测试 / 配置）。单例引擎只有这一行。 -->
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
          <!-- 每张卡自己的添加入口（2026-11-04 用户「每个区域单独可以添加模型吧」）：
               点它即按这条能力向上游拉一份清单并过滤成该用途，选一个填进模型 ID，
               与对话卡的「＋ 添加模型」是同一个动作。 -->
          <div class="mk-card__head-right">
            <button
              type="button"
              class="mk-btn mk-btn--sm mk-btn--primary"
              title="按这条能力向上游拉模型清单，选一个挂到这张卡"
              @click="openAdd(g.entry)"
            >＋ 添加模型</button>
          </div>
        </div>
        <div class="mpp-eng__row">
          <!-- 2026-11-04 用户「不要这种文案，上『Avoid unnecessary secondary labels and
               descriptions. Let the layout do the explaining.』」：模型行下方那行
               「维度 / Cohere 兼容 · 独立端点 · 域名」整行撤除——它们都在「配置」弹层里，
               行上只留模型 id 与动作；测试结果跟在「测试」旁边，不放第二行。 -->
          <span class="mono mpp-eng__model" :title="g.entry.model">{{ g.entry.model || '未选择模型' }}</span>
          <div class="mpp-eng__acts">
            <span
              v-if="testResults[g.kind]"
              class="mpp-eng__res"
              :class="{ 'is-bad': !testResults[g.kind]!.ok }"
              :title="testResults[g.kind]!.text"
            >{{ testResults[g.kind]!.ok ? '调用通过' : '调用失败' }}<template v-if="testResults[g.kind]!.text"> · {{ testResults[g.kind]!.text }}</template></span>
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
              <span class="mk-field__label">模型 ID</span>
              <span class="infra-model-row">
                <input
                  v-model="form.model"
                  class="mk-field__input"
                  :placeholder="editKind === 'embedding' ? '例如：BAAI/bge-m3' : '例如：BAAI/bge-reranker-v2-m3'"
                />
                <!-- 拉取（P1 2026-11-04 用户「它每一个接口都独立的自己去拉就行了」）：
                     向量 / 重排也向上游拉一份清单再挑，不必凭记忆手打模型 ID。
                     独立服务时带草稿连接去拉——「填地址和 key → 拉取 → 选」是自然顺序。 -->
                <button
                  type="button"
                  class="mk-btn mk-btn--sm infra-model-pull"
                  :disabled="pulling"
                  title="用这条能力的连接向上游拉模型清单（复用对话连接时取对话卡的地址与密钥）"
                  @click="pullCandidates"
                >{{ pulling ? '拉取中…' : '拉取' }}</button>
              </span>
            </label>
            <!-- 拉取结果：只留这条能力用得上的那些，点一下填进模型 ID -->
            <div v-if="candidates.length" class="infra-cands">
              <div class="infra-cands__head">
                <span>{{ candidateNote }}</span>
                <button type="button" class="mk-link" @click="candidates = []">收起</button>
              </div>
              <div class="infra-cands__list">
                <button
                  v-for="c in candidates"
                  :key="c.id"
                  type="button"
                  class="infra-cand"
                  :class="{ 'is-on': c.id === form.model }"
                  @click="form.model = c.id"
                >{{ c.id }}</button>
              </div>
            </div>
            <p v-else-if="pullNote" class="infra-cands__note">{{ pullNote }}</p>

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
                    class="mk-field__input mono"
                    :title="form.endpoint"
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

    <!-- 添加模型：与对话卡同一张上游清单弹窗（2026-11-04 用户「这两个拉取，弹窗怎么还不一样呢」）。
         单例引擎用单选、无全选、无能力确认提示；「使用中」那一行置灰。 -->
    <PullModelsDialog
      ref="pullDialog"
      :title="addTitle"
      :models="addModels"
      :registered="addRegistered"
      single
      :allow-manual="false"
      hint=""
      @confirm="usePicked"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import PullModelsDialog from './PullModelsDialog.vue'
import {
  adminInfraModelsApi,
  type InfraModelEntryView,
  type InfraModelsUpdateInput,
  type InfraModelsView,
} from '@/api/adminApi'
import { errMsg } from './live'
import { MODEL_TYPE_LABEL } from './modelTypeLabels'
import { inferModelCapabilities } from './modelCapabilityInference'
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

/* ---------- 添加模型：与对话卡同一张上游清单弹窗 ----------
   2026-11-04 用户「这两个拉取，弹窗怎么还不一样呢」：此前向量 / 重排走的是「配置表单 + 候选小胶囊」，
   对话卡走的是「上游清单弹窗」，同一件事两种弹窗。现在统一用 PullModelsDialog（single 单选），
   确认后只替换模型，连接与参数沿用当前配置；要改连接或手填 ID 仍走「配置」。 */
const pullDialog = ref<InstanceType<typeof PullModelsDialog> | null>(null)
const addKind = ref<InfraKind | null>(null)
const addEntry = ref<InfraModelEntryView | null>(null)
const addModels = ref<string[]>([])
const addTitle = computed(() => `添加${addKind.value ? kindLabel(addKind.value) : ''}`)
const addRegistered = computed(() => (addEntry.value?.model ? [addEntry.value.model] : []))

async function openAdd(entry: InfraModelEntryView) {
  addKind.value = entry.kind
  addEntry.value = entry
  addModels.value = []
  try {
    const res = await adminInfraModelsApi.pull({ kind: entry.kind })
    const all = ((res.data?.data?.models ?? []) as unknown[]).map((m) => String(m))
    const matched = all.filter((id) => inferModelCapabilities(id).role === entry.kind)
    addModels.value = matched
    if (!matched.length) {
      toast.error(all.length
        ? `上游 ${all.length} 个模型里没识别出${kindLabel(entry.kind)}，可在「配置」里直接填模型 ID`
        : '这次没有拉取到模型')
    }
    pullDialog.value?.openWith()
  } catch (e) {
    toast.error(`拉取失败：${errMsg(e)}`)
    // 连接不通时落到配置弹层：那里能改地址 / 密钥，改完再拉
    openEdit(entry)
  }
}

/** 选定即用：只换模型，连接（含密钥）与超时 / 批量 / 维度沿用当前配置 */
async function usePicked(ids: string[]) {
  const kind = addKind.value
  const entry = addEntry.value
  const model = ids[0]
  if (!kind || !entry || !model) return
  try {
    const patch: NonNullable<InfraModelsUpdateInput['embedding']> = {
      connectionMode: entry.connectionMode,
      model,
      timeoutMs: entry.timeoutMs,
      batchSize: kind === 'embedding' ? (entry.batchSize ?? 32) : null,
      dimensions: entry.dimensions,
    }
    if (entry.connectionMode === 'own') patch.endpoint = entry.endpoint
    const res = await adminInfraModelsApi.update({ [kind]: patch })
    view.value = (res.data?.data ?? res.data) as InfraModelsView
    testResults.value[kind] = null
    toast.success(`${kindLabel(kind)}已使用 ${model}`)
  } catch (e) {
    toast.error(`保存失败：${errMsg(e)}`)
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

/** 打开配置弹层（改连接 / 参数 / 手动填模型 ID） */
function openEdit(entry: InfraModelEntryView) {
  editKind.value = entry.kind
  editEntry.value = entry
  candidates.value = []
  pullNote.value = ''
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
  candidates.value = []
  pullNote.value = ''
}

/* ---------- 拉取上游清单（P1 2026-11-04） ---------- */
const pulling = ref(false)
const pullNote = ref('')
const candidates = ref<Array<{ id: string }>>([])
const candidateNote = computed(() =>
  `上游匹配到 ${candidates.value.length} 个${editKind.value ? kindLabel(editKind.value) : ''}，点一个填进模型 ID`
)

/**
 * 拉一份上游清单并按用途过滤：向量卡只留推断为 embedding 的，重排卡只留 rerank 的
 * （判据与对话侧同一套 `inferModelCapabilities`，不另造一份规则）。
 * 独立服务时把弹层里填的地址与密钥一起发过去——用户还没保存就拉，是自然顺序。
 */
async function pullCandidates() {
  const kind = editKind.value
  if (!kind || pulling.value) return
  pulling.value = true
  pullNote.value = ''
  try {
    const payload: { kind: InfraKind; endpoint?: string; apiKey?: string } = { kind }
    if (form.value.connectionMode === 'own') {
      payload.endpoint = form.value.endpoint.trim()
      payload.apiKey = form.value.apiKey.trim()
    }
    const res = await adminInfraModelsApi.pull(payload)
    const all = ((res.data?.data?.models ?? []) as unknown[]).map((m) => String(m))
    const matched = all.filter((id) => inferModelCapabilities(id).role === kind)
    candidates.value = matched.map((id) => ({ id }))
    if (!matched.length) {
      pullNote.value = all.length
        ? `上游 ${all.length} 个模型里没识别出${kindLabel(kind)}，可直接填模型 ID`
        : '这次没有拉取到模型'
    }
  } catch (e) {
    candidates.value = []
    pullNote.value = `拉取失败：${errMsg(e)}`
  } finally {
    pulling.value = false
  }
}

async function save() {
  const kind = editKind.value
  if (!kind) return
  if (!form.value.model.trim()) {
    toast.error('模型 ID 不能为空')
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
/* 单例引擎：卡面只有一行摘要，不再铺连接表单与模型列表。
   两张卡并排（2026-11-03 评审）：向量与重排是两个平级的全局单例引擎，各自只有一行摘要，
   通栏下一条长条右侧全是空白。两列并排后与上面模型区的卡片同一档节拍。 */
/* 单列、每张卡分两块（2026-11-04 用户「不做成一行，分块」）：卡头（标题 / 类型 / 状态），
   下面一行模型（id 与 测试 / 配置）。2026-11-04 再按「让布局自己说话」撤掉模型行下的
   维度 / 连接归属摘要——它们都在「配置」弹层里。 */
.mpp-infra { display: grid; grid-template-columns: minmax(0, 1fr); gap: 10px; }
.mpp-infra__state { margin: 0; color: var(--mk-muted); font-size: var(--mk-fs-micro); }
.mpp-eng { display: block; flex: none; }
.mpp-eng__row {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 10px 16px 12px;
  flex-wrap: wrap;
}
.mpp-eng__id { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; min-width: 0; flex: 0 0 auto; }
.mpp-eng__acts { display: inline-flex; align-items: center; gap: 8px; flex-wrap: wrap; justify-content: flex-end; margin-left: auto; }
.mpp-type {
  padding: 1px 7px;
  border-radius: 999px;
  background: var(--mk-surface-2);
  color: var(--mk-muted);
  font-size: var(--mk-fs-micro);
  font-weight: 600;
  line-height: 1.5;
}
.mpp-eng__model { color: var(--mk-ink); font-size: var(--mk-fs-body); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
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

/* 模型 ID 行 + 拉取（P1 2026-11-04）：输入框占满，拉取贴右，拉取中禁用 */
.infra-model-row { display: flex; align-items: center; gap: 8px; }
.infra-model-row .mk-field__input { flex: 1 1 auto; min-width: 0; }
.infra-model-pull { flex: none; white-space: nowrap; }
/* 拉取结果：一条能被点选的模型清单。候选可能几十个，限高内滚，不把弹层撑长 */
.infra-cands { display: grid; gap: 6px; }
.infra-cands__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  color: var(--mk-muted);
  font-size: var(--mk-fs-micro);
}
.infra-cands__list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  max-height: 132px;
  overflow-y: auto;
  padding: 8px;
  border: 1px solid var(--mk-line);
  border-radius: var(--mk-radius-md);
}
.infra-cand {
  padding: 3px 9px;
  border: 1px solid var(--mk-line);
  border-radius: 999px;
  background: var(--mk-surface-2);
  color: var(--mk-ink);
  font: inherit;
  font-size: var(--mk-fs-micro);
  cursor: pointer;
  white-space: nowrap;
}
.infra-cand:hover { border-color: var(--mk-blue); color: var(--mk-blue); }
.infra-cand.is-on {
  border-color: color-mix(in srgb, var(--mk-blue) 45%, transparent);
  background: var(--mk-blue-bg);
  color: var(--mk-blue);
  font-weight: 700;
}
.infra-cands__note { margin: 0; color: var(--mk-muted); font-size: var(--mk-fs-micro); line-height: 1.5; }
</style>
