<template>
  <!-- 2026-10-28 用户「向量与重排是全局单例引擎，不要套多模型卡片」：
       两张卡只回答「配了哪些模型、哪个在用、健不健康」，不再铺表单。
       2026-11-05 用户「对于向量模型，重排模型，为什么没有三个点的默认模型的操作了」：
       一条连接可以配多个模型，其中一个是启用态——卡面因此从「一行」变成「一池」，
       行内动作与对话卡同序同形（配置 · 测试 · ⋯），⋯ 里是「设为启用 / 删除」。 -->
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
            <!-- 2026-11-05 用户「已配置这个 pill 不要了」：卡头不挂状态徽标——
                 「配没配好」由下面的模型行自己说。 -->
            <!-- 2026-11-09 用户「隐藏具体 URL」：这条能力接在哪收进一枚轻量标签，
                 完整地址进 title 与「连接配置」弹窗，卡面不再拖一条尾栏。 -->
            <span class="mk-badge mk-badge--muted" :title="connLineText(g.entry)">{{ connBadgeText(g.entry) }}</span>
          </div>
          <!-- 每张卡自己的添加入口（2026-11-04 用户「每个区域单独可以添加模型吧」）：
               点它按这条能力拉一份上游清单，勾几个就加进这条连接的模型池。 -->
          <div class="mk-card__head-right">
            <button type="button" class="mk-link" @click="openConnEditor(g.entry)">连接配置</button>
            <button
              type="button"
              class="mk-btn mk-btn--sm mk-btn--primary"
              title="按这条能力向上游拉模型清单，勾选要挂到这条连接的模型"
              @click="openAdd(g.entry)"
            >＋ 添加模型</button>
          </div>
        </div>

        <!-- 模型池：一行一个已配置的模型。启用中的那个挂「启用」徽标，
             其余是在池子里等着的备选（运行时不调用它们）。 -->
        <div v-if="g.entry.models.length" class="mpp-eng__rows">
          <div
            v-for="m in g.entry.models"
            :key="m"
            class="mpp-eng__row"
          >
            <div class="mpp-eng__main">
              <div class="mpp-eng__idline">
                <span class="mono mpp-eng__model" :title="m">{{ m }}</span>
                <!-- 「启用」徽标只在池子里不止一个模型时出现：只有一个模型时它恒等于
                     「这一行存在」，属于用布局就能读懂的事，不必再挂一枚标（2026-11-05）。 -->
                <!-- 与对话卡同一枚「默认」（2026-11-07 用户「向量/重排没标默认」）：
                     它讲的是「这条能力运行时调用谁」。池子里只有一个模型时也要标——
                     恰好只有一个不等于没有默认。 -->
                <span
                  v-if="m === g.entry.model"
                  class="mk-badge mk-badge--default mpp-eng__on"
                  title="这条能力当前调用的模型"
                >默认</span>
              </div>
              <span
                v-if="labelOf(g.kind, m)"
                class="mpp-eng__label"
                :title="labelOf(g.kind, m)"
              >{{ labelOf(g.kind, m) }}</span>
              <!-- 与对话卡同一条读数解剖（2026-11-05 用户「调用通过确实还是换行好看一些」）：
                   判词带色加粗，时延 / 维度退成弱色。 -->
              <span
                v-if="testOf(g.kind, m)"
                class="mk-rowres"
                :class="{ 'mk-rowres--bad': !testOf(g.kind, m)!.ok }"
                :title="testOf(g.kind, m)!.text"
              ><span class="mk-rowres__verdict">{{ testOf(g.kind, m)!.ok ? '调用通过' : '调用失败' }}</span><span
                v-if="testOf(g.kind, m)!.detail"
                class="mk-rowres__meta"
              >· {{ testOf(g.kind, m)!.detail }}</span></span>
            </div>
            <!-- 动作集与对话卡完全一致（2026-11-07 用户「向量/重排没和上面对齐」）：
                 设为默认（非默认行）/ 配置 / 测试 / 删除；默认行的删除置灰。 -->
            <div class="mpp-eng__acts">
              <button
                v-if="m !== g.entry.model"
                type="button"
                class="mk-link"
                :disabled="saving"
                title="这条能力运行时改用这个模型，其余模型留在池子里备用"
                @click="activate(g.kind, m)"
              >设为默认</button>
              <button type="button" class="mk-link" @click="openEdit(g.entry, m)">配置</button>
              <button
                v-if="g.entry.configured"
                type="button"
                class="mk-link mk-link--hold mk-link--hold-test"
                :disabled="testing === `${g.kind}|${m}`"
                @click="test(g.kind, m)"
              >{{ testing === `${g.kind}|${m}` ? '测试中…' : '测试' }}</button>
              <button
                type="button"
                class="mk-link mk-link--danger mpp-eng__danger"
                :disabled="saving || m === g.entry.model"
                :title="m === g.entry.model ? '当前为默认模型，请先将其他模型设为默认后再删除' : '删除这个模型'"
                :aria-label="m === g.entry.model ? `删除 ${m}（当前为默认模型，需先改默认）` : `删除 ${m}`"
                @click="removeModel(g.kind, m)"
              >删除</button>
            </div>
          </div>
        </div>
        <!-- 池子空着：给一句「还没配」+ 唯一能做的下一步，不摆一张空表 -->
        <div v-else class="mpp-eng__row">
          <div class="mpp-eng__main">
            <span class="mpp-eng__model mpp-eng__model--none">未选择模型</span>
          </div>
          <div class="mpp-eng__acts">
            <button type="button" class="mk-link" @click="openEdit(g.entry, '')">配置</button>
          </div>
        </div>

        <!-- 这条能力接在哪（2026-11-07 用户「弹窗里别再塞连接」）：
             默认沿用对话卡那条通道；只有自建向量 / 重排服务才需要独立地址。
             2026-11-09 用户「隐藏具体 URL 和参数细节」：连接状态收进卡头标签，
             编辑搬到「连接配置」弹窗（原先在卡片底部原地展开表单 + 一条常驻地址尾栏）。 -->

      </section>

      <!-- 配置这条能力的连接（2026-11-09）：与页顶「配置服务连接」同族的小号弹窗，
           落在卡片外部（Teleport），卡面不再被表单撑高。 -->
      <Teleport to="body">
        <div v-if="connEditorKind" ref="connMaskRef" class="mk-modal">
          <div ref="connPanelRef" class="mk-modal__panel mpp-conn-dlg" role="dialog" aria-modal="true" :aria-label="`配置${connKindLabel}连接`">
            <div class="mk-modal__head">
              <h3 class="mk-modal__title">配置{{ connKindLabel }}连接</h3>
              <button type="button" class="mk-modal__close" aria-label="关闭" @click="closeConnEditor">✕</button>
            </div>
            <div class="mk-modal__body">
              <label class="infra-own">
                <input v-model="addConn.mode" type="checkbox" true-value="own" false-value="inherit" />
                <span>使用独立接口地址覆盖全局通道</span>
              </label>
              <p v-if="addConn.mode === 'inherit'" class="infra-inherit">
                地址与密钥取对话卡：<span class="mono">{{ view?.platformBaseUrl || '对话卡的服务地址' }}</span>
              </p>
              <template v-else>
                <div class="infra-conn" :class="{ 'infra-conn--rerank': connEditorKind === 'rerank' }">
                  <label class="mk-field">
                    <span class="mk-field__label">服务地址</span>
                    <input v-model="addConn.endpoint" class="mk-field__input mono" :title="addConn.endpoint" placeholder="https://api.example.com" />
                  </label>
                  <label class="mk-field">
                    <span class="mk-field__label">API Key</span>
                    <input
                      v-model="addConn.apiKey"
                      class="mk-field__input"
                      type="password"
                      autocomplete="new-password"
                      :placeholder="addKeyPlaceholder"
                    />
                  </label>
                </div>
                <p class="infra-endpoint" :title="addResolvedEndpoint">
                  实际请求 <span class="mono">{{ addResolvedEndpoint || '—' }}</span>
                </p>
                <label v-if="addEntry?.keySource === 'db' && !addConn.apiKey.trim()" class="infra-clearkey">
                  <input v-model="addConn.clearKey" type="checkbox" />
                  <span>清除已保存的密钥（之后改用环境变量中的密钥）</span>
                </label>
              </template>
            </div>
            <div class="mk-modal__foot">
              <button type="button" class="mk-btn" @click="closeConnEditor">取消</button>
              <button
                type="button"
                class="mk-btn mk-btn--primary"
                :disabled="saving || !addConnDirty"
                :title="addConnDirty ? '保存这条能力的连接' : '没有未保存的改动'"
                @click="saveCardConn"
              >{{ saving ? '保存中…' : '保存连接' }}</button>
            </div>
          </div>
        </div>
      </Teleport>
    </template>

    <Teleport to="body">
      <div v-if="editKind" ref="maskRef" class="mk-modal">
        <div ref="panelRef" class="mk-modal__panel" role="dialog" :aria-label="`配置${editKindLabel}`">
          <div class="mk-modal__head">
            <h3 class="mk-modal__title">配置{{ editKindLabel }}</h3>
            <button type="button" class="mk-modal__close" aria-label="关闭" @click="closeEdit">✕</button>
          </div>
          <div class="mk-modal__body">
            <!-- 与模型设置弹层同一套解剖（2026-11-05）：只留「模型」与「参数」两段。
                 连接不在这里——2026-11-05 用户「配置里面还有 url，添加模型还有」：
                 同一条连接原来能在两处填（行内「配置」与卡头「＋ 添加模型」的拉取），
                 现在只留「＋ 添加模型」那一处，与对话卡「只保留添加模型」同一口径。 -->
            <section class="infra-sec">
              <div class="infra-sec__head">
                <h4 class="infra-sec__title">模型</h4>
              </div>
              <!-- 与模型设置弹层同一对标识（2026-11-05 用户「模型id和模型名称不能改吗，为啥不在配置里面靠齐」）：
                   模型 ID 只读——它是键，改名等于换模型（对话模型那边也是锁的，得删了重加）；
                   能改的是显示名称，默认跟随 ID，填了就在卡行与清单里替 ID 说话。 -->
              <div v-if="editingModel" class="infra-formrow">
                <label class="mk-field">
                  <span class="mk-field__label">模型 ID</span>
                  <input class="mk-field__input mono infra-id--locked" :value="editingModel" disabled :title="editingModel" />
                </label>
                <label class="mk-field">
                  <span class="mk-field__label">显示名称</span>
                  <input v-model="form.label" class="mk-field__input" placeholder="默认跟随模型 ID" />
                </label>
              </div>
              <p v-else class="infra-model-name infra-model-name--none">{{ NO_MODEL_HINT }}</p>
            </section>

            <section class="infra-sec">
              <div class="infra-sec__head">
                <h4 class="infra-sec__title">参数</h4>
              </div>
              <div class="infra-formrow">
                <label class="mk-field">
                  <span class="mk-field__label">超时（毫秒）</span>
                  <input v-model.number="form.timeoutMs" class="mk-field__input mono" type="number" min="1000" max="120000" step="1000" />
                </label>
                <label class="mk-field">
                  <span class="mk-field__label">批量大小</span>
                  <input
                    v-if="editKind === 'embedding'"
                    v-model.number="form.batchSize"
                    class="mk-field__input mono"
                    type="number"
                    min="1"
                    max="128"
                  />
                  <input v-else class="mk-field__input" value="不适用" disabled />
                </label>
              </div>
              <!-- 维度只对向量有意义（重排没有输出维度），所以单独一行、只在向量卡出现 -->
              <label v-if="editKind === 'embedding'" class="mk-field">
                <span class="mk-field__label">向量维度</span>
                <input v-model.number="form.dimensions" class="mk-field__input mono" type="number" min="1" max="16384" placeholder="留空由上游返回" />
              </label>
            </section>
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
         2026-11-05 多选：一次勾几个就进池子几个。
         2026-11-05 连接段并入本弹窗（用户「配置里面还有 url，添加模型还有」）：此前地址与密钥
         只在行内「配置」里改，而卡头这颗按钮又拿已保存的连接去拉——想改地址得关掉弹窗、
         开「配置」、存完再回来。现在连接只有这一处，拉清单可以直接用草稿连接。 -->
    <PullModelsDialog
      ref="pullDialog"
      :title="addTitle"
      :models="addModels"
      :registered="addRegistered"
      :labels="addEntry?.labels ?? {}"
      :allow-manual="false"
      :loading="addLoading"
      :error="addError"
      :stale="addStale"
      :hidden-count="addHiddenCount"
      :empty-text="addEmptyText"
      :tester="testPicked"
      :hint="addHint"
      @confirm="addPicked"
      @refetch="pullUpstream()"
      @show-all="addShowAll = true"
      @closed="onAddClosed"
    >
    </PullModelsDialog>
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
import { askConfirm } from './useConfirm'
import { useEscape } from './useEscape'
import { useOverlay, useMaskClose } from './useOverlay'
import { toast } from '@/utils/toast'

/** 池子空着时的那句话：弹层里的空态与保存前的拦截说的是同一件事，收一处（文案守卫 R6） */
const NO_MODEL_HINT = '这条能力还没有模型，先在卡头「＋ 添加模型」里挑一个'

type InfraKind = 'embedding' | 'rerank'
type ConnectionMode = 'inherit' | 'own'

const loading = ref(false)
const failed = ref('')
const view = ref<InfraModelsView | null>(null)
const saving = ref(false)

const groups = computed(() =>
  view.value
    ? [
        { kind: 'embedding' as const, label: MODEL_TYPE_LABEL.embedding, entry: view.value.embedding },
        { kind: 'rerank' as const, label: MODEL_TYPE_LABEL.rerank, entry: view.value.rerank },
      ]
    : [],
)

/* ---------- 逐模型测试 ----------
   同一张卡里可能挂着好几个模型（2026-11-05 模型池）：测试因此按模型落结果，
   不再按能力落一条——否则测完 A 再点 B，结果会互相覆盖。 */
const testing = ref('')
const testResults = ref<Record<string, { ok: boolean; detail: string; text: string }>>({})

/** 测试结果与 ⋯ 菜单都按「能力 + 模型」定位：两张卡里可能有同名模型 */
function rowKey(kind: InfraKind, model: string): string {
  return `${kind}|${model}`
}
function testOf(kind: InfraKind, model: string) {
  return testResults.value[rowKey(kind, model)] ?? null
}

function kindLabel(kind: InfraKind): string {
  return kind === 'embedding' ? MODEL_TYPE_LABEL.embedding : MODEL_TYPE_LABEL.rerank
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

async function test(kind: InfraKind, model: string) {
  const key = rowKey(kind, model)
  testing.value = key
  /* 清掉这一行上一次的结果（重新测就重新给读数，不拿旧结果显示成「还在通过」） */
  const { [key]: _stale, ...rest } = testResults.value
  testResults.value = rest
  try {
    const res = await adminInfraModelsApi.test(kind, model)
    const data = (res.data?.data ?? {}) as {
      ok?: boolean
      latencyMs?: number
      dimensions?: number
      error?: string
      code?: string
    }
    testResults.value = {
      ...testResults.value,
      [key]: data.ok
        ? {
            ok: true,
            detail: [
              data.latencyMs != null ? `${data.latencyMs}ms` : '',
              data.dimensions ? `${data.dimensions} 维` : '',
            ].filter(Boolean).join(' · '),
            text: '',
          }
        : { ok: false, detail: '', text: data.error || data.code || '调用失败' },
    }
  } catch (e) {
    testResults.value = { ...testResults.value, [key]: { ok: false, detail: '', text: errMsg(e) } }
  } finally {
    testing.value = ''
  }
}

/** 一次写回整条能力：连接 / 参数是这一份的，模型池一起交（后端按池子 + 启用项落库） */
async function persist(kind: InfraKind, patch: Record<string, unknown>) {
  try {
    const res = await adminInfraModelsApi.update({ [kind]: patch } as InfraModelsUpdateInput)
    view.value = (res.data?.data ?? res.data) as InfraModelsView
    return true
  } catch (e) {
    toast.error(`保存失败：${errMsg(e)}`)
    return false
  }
}

/** 池子改动只动 models / model 两项，连接与参数原样沿用（不发就不会被重置） */
async function updatePool(kind: InfraKind, models: string[], active: string): Promise<boolean> {
  saving.value = true
  const ok = await persist(kind, { models, model: active })
  saving.value = false
  return ok
}

/** 设为启用：只切启用项，其余模型留在池子里（用户「我可以选择其中一个作为启用吧」） */
async function activate(kind: InfraKind, model: string) {
  const entry = view.value?.[kind]
  if (!entry) return
  if (await updatePool(kind, entry.models, model)) {
    toast.success(`${kindLabel(kind)}已启用 ${model}`)
  }
}

async function removeModel(kind: InfraKind, model: string) {
  const entry = view.value?.[kind]
  if (!entry) return
  /* 默认项已在行内置灰（2026-11-07），删除只可能落在备选模型上；
     仍保留「删后改指」的兜底计算——别的入口（如接口脚本）仍可能删到启用项。 */
  const wasActive = model === entry.model
  const rest = entry.models.filter((id) => id !== model)
  const next = wasActive ? (rest[0] ?? '') : entry.model
  const ok = await askConfirm({
    title: `删除模型「${model}」`,
    message: '删除后它不再参与调用，运行时仍使用当前默认模型。',
    confirmText: '删除模型',
  })
  if (ok !== true) return
  if (await updatePool(kind, rest, next)) {
    const { [rowKey(kind, model)]: _dropped, ...kept } = testResults.value
    testResults.value = kept
    toast.success(next ? `${kindLabel(kind)}已改用 ${next}` : `${kindLabel(kind)}已清空模型`)
  }
}

/* ---------- 添加模型：与对话卡同一张上游清单弹窗（多选） ----------
   2026-11-04 用户「这两个拉取，弹窗怎么还不一样呢」：向量 / 重排与对话卡共用 PullModelsDialog。
   2026-11-05：一次可以勾多个——「我拉去了四个，配置了四个，那我可以选择其中一个作为启用吧」。
   2026-11-05：连接段也搬进本弹窗（用户「配置里面还有 url，添加模型还有」）——
   同一条连接此前能在两处填，现在与对话卡同序：连在上、清单在下、一次提交。 */
const pullDialog = ref<InstanceType<typeof PullModelsDialog> | null>(null)
const addKind = ref<InfraKind | null>(null)
const addEntry = ref<InfraModelEntryView | null>(null)
/** 上游这次拉到的**全量**清单：卡面按用途筛一份，其余留在「显示全部」后面 */
const addAll = ref<string[]>([])
/** 显示全部（含没被识别出用途的模型）：筛选猜错名字时还有一条退路 */
const addShowAll = ref(false)
const addLoading = ref(false)
const addError = ref('')
const addEmpty = ref('')
/** 清单是在哪条连接下拉的：勾选框改了就与它不符，清单随之过期 */
const addFetchedSig = ref('')
/** 哪张卡的连接弹窗开着（一次只开一个）；null = 都关着（2026-11-09 由卡内展开改弹窗） */
const connEditorKind = ref<InfraKind | null>(null)
const addConn = ref({
  mode: 'inherit' as ConnectionMode,
  /** 独立服务的**根地址**（路径由 addResolvedEndpoint 拼；存库时写完整端点） */
  endpoint: '',
  apiKey: '',
  clearKey: false,
})
/** 弹窗标题带上文（2026-11-09）：能力名本身已带「模型」（向量模型 / 重排模型），
    再补一枚类型标签，与对话卡「添加对话模型（LLM）」同一形态，一眼知道在给哪条能力挑模型。 */
const addTitle = computed(() =>
  addKind.value
    ? `添加${kindLabel(addKind.value)}（${addKind.value === 'embedding' ? 'Embedding' : 'Reranker'}）`
    : '添加模型',
)
const addKindLabel = computed(() => (addKind.value ? kindLabel(addKind.value) : '模型'))
const addRegistered = computed(() => addEntry.value?.models ?? [])

/** 这个能力的路径尾巴：与后端按类型拼路径同一口径 */
function kindSuffix(kind: InfraKind): string {
  return kind === 'rerank' ? '/v1/rerank' : '/v1/embeddings'
}
/** 已经带类型路径的地址原样用（自建服务可能不是 /v1），否则拼上标准路径 */
function resolveEndpoint(kind: InfraKind, root: string): string {
  const raw = String(root || '').trim().replace(/\/+$/, '')
  if (!raw) return ''
  if (/\/(embeddings|rerank)$/i.test(raw)) return raw
  return raw + kindSuffix(kind)
}
const addResolvedEndpoint = computed(() => (addKind.value ? resolveEndpoint(addKind.value, addConn.value.endpoint) : ''))

/** 按用途筛一份（名字里带 embedding / rerank 这类标记的）；「显示全部」时原样列 */
const addModels = computed(() => {
  if (!addKind.value || addShowAll.value) return addAll.value
  const kind = addKind.value
  return addAll.value.filter((id) => inferModelCapabilities(id).role === kind)
})
/** 被筛掉的条数：给弹窗底部的「显示全部」用 */
const addHiddenCount = computed(() => (addShowAll.value ? 0 : addAll.value.length - addModels.value.length))
const addEmptyText = computed(() => {
  if (addEmpty.value) return addEmpty.value
  if (addModels.value.length) return ''
  return addAll.value.length ? `上游 ${addAll.value.length} 个模型里没有识别出${addKindLabel.value}，可点「显示全部」自己找` : ''
})

/** 当前连接草稿的指纹：拉取时记一份，勾选框一改就能看出清单过期 */
const addConnSig = computed(() => `${addConn.value.mode}|${addConn.value.mode === 'own' ? addResolvedEndpoint.value : ''}`)
const addStale = computed(() => Boolean(addFetchedSig.value) && addFetchedSig.value !== addConnSig.value)
/** 连接是否有未保存改动（收起按钮与「保存连接」都看它） */
const addConnDirty = computed(() => {
  const entry = addEntry.value
  if (!entry) return false
  if (addConn.value.mode !== entry.connectionMode) return true
  if (addConn.value.apiKey.trim() || addConn.value.clearKey) return true
  return addConn.value.mode === 'own' && addConn.value.endpoint.trim() !== rootOf(entry.endpoint)
})

const addKeyPlaceholder = computed(() => {
  const entry = addEntry.value
  if (entry?.keySource === 'db') return `留空 = 沿用已配置${entry.keyHint ? `（${entry.keyHint}）` : ''}`
  if (entry?.keySource === 'env') return '留空 = 沿用环境变量'
  return '粘贴 API Key'
})

/** 卡片里的连接行文案：一句话说清这条能力接在哪（现在挂在卡头标签的 title 上） */
function connLineText(entry: InfraModelEntryView): string {
  if (entry.connectionMode === 'own') {
    return entry.endpoint ? `独立地址 ${entry.endpoint}` : '独立地址未配置'
  }
  /* 不把平台地址再写一遍：页顶「服务连接」卡上就是同一个地址，
     同屏两处同一串只会让人疑心它们是不是两条连接。弹窗里那句
     「地址与密钥取对话卡：…」才是需要看到具体值的地方。 */
  return '沿用对话模型'
}
/** 卡头标签：这条能力接在哪（弹窗里改，卡面只留这一枚轻量标签） */
function connBadgeText(entry: InfraModelEntryView): string {
  return entry.connectionMode === 'own' ? '独立连接' : '跟随全局'
}
/** 连接弹窗的标题用哪张卡（一次只开一个） */
const connKindLabel = computed(() => (connEditorKind.value ? kindLabel(connEditorKind.value) : '模型'))
const connMaskRef = ref<HTMLElement | null>(null)
const connPanelRef = ref<HTMLElement | null>(null)
useEscape(() => Boolean(connEditorKind.value), closeConnEditor)
useOverlay(computed(() => Boolean(connEditorKind.value)), connPanelRef)
useMaskClose(connMaskRef, closeConnEditor)

/** 打开连接弹窗：种子直接复用弹窗时代那套（模式 / 根地址 / 密钥） */
function openConnEditor(entry: InfraModelEntryView): void {
  connEditorKind.value = entry.kind
  addKind.value = entry.kind
  addEntry.value = entry
  addConn.value = {
    mode: entry.connectionMode,
    endpoint: entry.connectionMode === 'own' ? rootOf(entry.endpoint) : '',
    apiKey: '',
    clearKey: false,
  }
}
/** 关窗：有未保存的连接改动先问一句（原内联态是「收起」——改动不能藏进一次关闭里） */
function closeConnEditor(): void {
  if (!connEditorKind.value) return
  if (!addConnDirty.value) {
    discardConnEditor()
    return
  }
  void (async () => {
    const ok = await askConfirm({
      title: '关闭并放弃连接改动',
      message: '关闭后未保存的地址 / 密钥改动会丢弃。',
      confirmText: '放弃改动'
    })
    if (ok) discardConnEditor()
  })()
}
/** 真正落关（确认过、或本来就没改动）：单独一枚，免得 confirm 回来时又被守卫拦一次 */
function discardConnEditor(): void {
  connEditorKind.value = null
}
/** 保存连接弹窗里的改动（与弹窗时代同一个提交路径，只是触发点换了） */
async function saveCardConn(): Promise<void> {
  const kind = connEditorKind.value
  if (!kind) return
  addKind.value = kind
  addEntry.value = view.value?.[kind] ?? addEntry.value
  await saveAddConn()
  /* 脏位要按**写回后**的那份配置重判：saveAddConn 里 persist 已经把 view 换成后端结果，
     拿保存前的 entry 比会把「服务器按自己的口径存的地址」读成未保存改动，弹窗关不上。 */
  addEntry.value = view.value?.[kind] ?? addEntry.value
  if (!addConnDirty.value) discardConnEditor()
}

/** 弹窗底部那句筛选说明：别再讲「⋯ 里挑一个设为启用」（那份菜单已经不存在） */
const addHint = computed(() => (addKind.value ? `已自动筛选匹配的${kindLabel(addKind.value)}` : ''))

/** 行内测试：向量 / 重排走自己这条连接（不是供应商，所以由宿主给测试函数） */
async function testPicked(modelId: string): Promise<{ latency: string; text: string }> {
  const kind = addKind.value
  if (!kind) return { latency: '', text: '' }
  const res = await adminInfraModelsApi.test(kind, modelId)
  const data = (res.data?.data ?? {}) as { latencyMs?: number; dimensions?: number }
  return {
    latency: [
      data.latencyMs != null ? `${data.latencyMs}ms` : '',
      data.dimensions ? `${data.dimensions} 维` : '',
    ].filter(Boolean).join(' · '),
    text: '',
  }
}

/** 拉上游清单。`background` = 开窗时顺带拉的那一次：失败只在弹窗里说，不弹 toast。 */
async function pullUpstream(background = false): Promise<void> {
  const kind = addKind.value
  if (!kind || addLoading.value) return
  if (addConn.value.mode === 'own' && !addConn.value.endpoint.trim()) {
    addEmpty.value = '还没有服务地址：勾「使用独立接口地址覆盖全局通道」并填一条。'
    if (!background) toast.error('先填服务地址')
    return
  }
  addLoading.value = true
  addError.value = ''
  addEmpty.value = ''
  try {
    /* 带草稿连接去拉：填完地址与密钥就能直接拉，不必先保存一次（与对话卡同一顺序）。
       沿用对话卡时不带草稿——让后端按平台那条通道解析。 */
    const draft = addConn.value.mode === 'own'
      ? { endpoint: addResolvedEndpoint.value, apiKey: addConn.value.apiKey.trim() }
      : {}
    const res = await adminInfraModelsApi.pull({ kind, ...draft })
    const all = ((res.data?.data?.models ?? []) as unknown[]).map((m) => String(m))
    addAll.value = all
    addShowAll.value = false
    addFetchedSig.value = addConnSig.value
    if (!background) toast.success(all.length ? `获取到 ${all.length} 个模型` : '服务未返回模型列表')
  } catch (e) {
    addError.value = errMsg(e)
    addAll.value = []
    addFetchedSig.value = ''
    if (!background) toast.error(`拉取失败：${errMsg(e)}`)
  } finally {
    addLoading.value = false
  }
}

/** 连接草稿 → 写回字段：沿用对话卡时只写「用哪条」，独立地址才带地址与密钥 */
function addConnPatch(): Record<string, unknown> {
  if (addConn.value.mode === 'inherit') return { connectionMode: 'inherit' }
  const patch: Record<string, unknown> = { connectionMode: 'own', endpoint: addResolvedEndpoint.value }
  if (addConn.value.apiKey.trim()) patch.apiKey = addConn.value.apiKey.trim()
  if (addConn.value.clearKey && !addConn.value.apiKey.trim()) patch.clearKey = true
  return patch
}

/** 「保存连接」：只提交连接（弹窗里也能只改地址不挑模型） */
async function saveAddConn(): Promise<void> {
  const kind = addKind.value
  if (!kind) return
  if (addConn.value.mode === 'own' && !addConn.value.endpoint.trim()) {
    toast.error('独立服务需要填写服务地址')
    return
  }
  saving.value = true
  const ok = await persist(kind, addConnPatch())
  saving.value = false
  if (!ok) return
  addConn.value.apiKey = ''
  addConn.value.clearKey = false
  // 连接换了，手里这份清单就是旧连接拉的：清掉，等用户点「获取模型」
  addAll.value = []
  addFetchedSig.value = addConnSig.value
  addEmpty.value = '连接已保存，点「获取模型」拉一份新清单。'
  toast.success(`${kindLabel(kind)}的连接已保存`)
}

function onAddClosed(): void {
  addAll.value = []
  addShowAll.value = false
  addError.value = ''
  addEmpty.value = ''
  addFetchedSig.value = ''
}

function onAddOpened(entry: InfraModelEntryView): void {
  addConn.value = {
    mode: entry.connectionMode,
    /* inherit 的 endpoint 是后端解析结果，不能回填成独立地址；own 的回填成根地址 */
    endpoint: entry.connectionMode === 'own' ? rootOf(entry.endpoint) : '',
    apiKey: '',
    clearKey: false,
  }
}

async function openAdd(entry: InfraModelEntryView) {
  connEditorKind.value = null
  addKind.value = entry.kind
  addEntry.value = entry
  addAll.value = []
  addShowAll.value = false
  addError.value = ''
  addEmpty.value = ''
  addFetchedSig.value = ''
  onAddOpened(entry)
  pullDialog.value?.openWith()
  /* 开窗顺带拉一次（只读）：连不通时这一行读数就在弹窗里，
     用户当场就能展开连接改地址，不必先关弹窗再找别的入口。 */
  void pullUpstream(true)
}

/** 勾选即入池：参数沿用；池子原来是空的，就把第一个勾选的设为启用。
    以当前视图（最新写回结果）为基准合并，而不是弹窗打开时的快照——
    弹窗开着期间池子可能已经被别的动作改过，拿旧快照合并会把那次改动覆盖掉。
    连接的未保存改动随这次提交一起落盘（弹窗里只有这一个提交点）。 */
async function addPicked(ids: string[]) {
  const kind = addKind.value
  if (!kind || !ids.length) return
  const current = view.value?.[kind] ?? addEntry.value
  if (!current) return
  const merged = [...current.models]
  for (const id of ids) if (!merged.includes(id)) merged.push(id)
  const active = current.model || ids[0]
  saving.value = true
  /* 参数与连接都沿用：只有连接被改过（勾选框 / 地址 / 密钥）才把那几个字段一起带上，
     没改就一个字段都不发——PUT 是 partial 合并，多带等于替用户重写一遍连接。 */
  const patch = { models: merged, model: active, ...(addConnDirty.value ? addConnPatch() : {}) }
  const ok = await persist(kind, patch)
  saving.value = false
  if (ok) {
    addConn.value.apiKey = ''
    addConn.value.clearKey = false
    toast.success(`已加入 ${ids.length} 个${kindLabel(kind)}，当前启用 ${active}`)
  }
}

/* ---------- 配置弹层：这一个模型的 ID（只读）+ 参数 ----------
   连接不在这里：它归「＋ 添加模型」那张弹窗（2026-11-05 用户「配置里面还有 url，添加模型还有」）。 */
const editKind = ref<InfraKind | null>(null)
const editEntry = ref<InfraModelEntryView | null>(null)
/** 打开时那一行的模型 id（空串 = 池子还没模型） */
const editingModel = ref('')
const editKindLabel = computed(() => (editKind.value ? kindLabel(editKind.value) : ''))
const form = ref({
  /** 显示名称：空串 = 没起名（卡行与清单里退回显示 id） */
  label: '',
  timeoutMs: 20000,
  batchSize: 32,
  dimensions: null as number | null,
})

/** 卡行与清单行的次级说明：起过名就显示名称，没起名不硬编一句话（2026-11-04「版面自己说话」） */
function labelOf(kind: InfraKind, model: string): string {
  return view.value?.[kind]?.labels?.[model] ?? ''
}

/** 显示名称的写回值：清空即删掉这一条（不留一个空串键），其余行的名字原样带回 */
function labelPatch(base: Record<string, string> | undefined, model: string, name: string): Record<string, string> {
  const out = { ...(base ?? {}) }
  delete out[model]
  const trimmed = name.trim()
  if (trimmed) out[model] = trimmed
  return out
}

/** 回填时把完整端点还原成根地址（编辑一次不会把 /v1/embeddings 越叠越多） */
function rootOf(value: string): string {
  return String(value || '').trim().replace(/\/(v\d+\/)?(embeddings|rerank)\/?$/i, '').replace(/\/+$/, '')
}

const panelRef = ref<HTMLElement | null>(null)
const maskRef = ref<HTMLElement | null>(null)
useEscape(() => Boolean(editKind.value), closeEdit)
useOverlay(computed(() => Boolean(editKind.value)), panelRef)
useMaskClose(maskRef, closeEdit)

/** 打开配置弹层：改这一个模型的参数（模型 ID 与连接都不在这一层） */
function openEdit(entry: InfraModelEntryView, model: string) {
  editKind.value = entry.kind
  editEntry.value = entry
  editingModel.value = model
  form.value = {
    label: entry.labels?.[model] ?? '',
    timeoutMs: entry.timeoutMs,
    batchSize: entry.batchSize ?? 32,
    dimensions: entry.dimensions,
  }
}

function closeEdit() {
  editKind.value = null
  editEntry.value = null
  editingModel.value = ''
}

async function save() {
  const kind = editKind.value
  const entry = editEntry.value
  if (!kind || !entry) return
  if (!editingModel.value) {
    toast.error(NO_MODEL_HINT)
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
  /* 模型 ID 只读（2026-11-05）：换模型归卡头的「＋ 添加模型」，
     这一层只改参数。池子与启用项原样带回。
     连接也不写：PUT 是 partial 合并，少传就保持库里的现值。 */
  const models = [...entry.models]
  const active = entry.model || editingModel.value
  if (!models.includes(editingModel.value)) models.push(editingModel.value)
  if (!models.includes(active)) models.push(active)

  const rawDimensions = form.value.dimensions as number | string | null
  const patch: Record<string, unknown> = {
    models,
    model: active,
    /* 显示名称按池子整体提交（后端按池子裁剪）：只改这一行的名字，
       其余行的名字要原样带回，否则一次保存会把别人的名字抹掉。 */
    labels: labelPatch(entry.labels, editingModel.value, form.value.label),
    timeoutMs: form.value.timeoutMs,
    batchSize: kind === 'embedding' ? form.value.batchSize : null,
    dimensions: rawDimensions === null || rawDimensions === '' ? null : Number(rawDimensions),
  }
  saving.value = true
  const ok = await persist(kind, patch)
  saving.value = false
  if (!ok) return
  testResults.value = {}
  closeEdit()
  toast.success(`${kindLabel(kind)}已保存`)
}

onMounted(load)
</script>

<style scoped>
/* 两张卡各自一条模型池：卡头一块、下面一行一个模型。
   2026-11-05 模型池上线后不再有「单例只有一行」的前提，行与行之间给发丝线。
   2026-11-07 高分屏：宽屏下向量 / 重排两张卡并排（用户要求 grid-cols-2）。
   分界取 1280 而非 1024：这一块在「模型与接入」里位于对话卡下方，1280 以下右侧列
   还要放模型池行（配置 · 测试 · ⋯），再劈成两半每张卡只剩 ~440px、行内按钮会被挤换行。 */
.mpp-infra { display: grid; grid-template-columns: minmax(0, 1fr); gap: 10px; }
@media (min-width: 1280px) {
  .mpp-infra { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
}
.mpp-infra__state { margin: 0; color: var(--mk-muted); font-size: var(--mk-fs-micro); }
.mpp-eng { display: block; flex: none; }
.mpp-eng__rows { display: grid; }
.mpp-eng__row {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 10px 16px 12px;
  border-top: 1px solid var(--mk-line);
  flex-wrap: wrap;
  transition: background 0.12s var(--mk-ease-out);
}
/* 行悬停整行高亮：行内左侧是模型名、右端是动作，通栏后中间隔着大片空白，
   鼠标不跟着走就极易串行点错（与对话卡同一处理）。 */
.mpp-eng__row:hover { background: var(--mk-table-row-hover-bg); }
/* 菜单打开时给所属行留底（菜单浮在行与行之间，没有行底分不清从哪一行打开） */
.mpp-eng__main { display: grid; gap: 3px; min-width: 0; flex: 1 1 auto; }
.mpp-eng__idline { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; min-width: 0; }
.mpp-eng__id { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; min-width: 0; flex: 0 0 auto; }
.mpp-eng__acts { display: inline-flex; align-items: center; gap: 8px; flex-wrap: wrap; justify-content: flex-end; margin-left: auto; }
/* 删除与前三枚拉开距离（与对话卡同一口径） */
.mpp-eng__danger { margin-left: 12px; }
/* 卡片级连接（2026-11-09）：卡头一枚轻量标签 [独立连接] / [跟随全局]，
   完整地址进标签 title 与「连接配置」弹窗——卡面不再拖尾栏。
   配置弹窗与页顶「配置服务连接」同宽（小号窗，不随全站断点长到半屏）。 */
.mpp-conn-dlg.mk-modal__panel { width: min(560px, 100%); max-width: none; }
/* 类型标识（Embedding / Reranker）：与对话卡那枚 LLM 徽标同一套蓝调（2026-11-05 用户
   「不喜欢这个灰色」）——三张卡同处一层，一个是蓝底、两个是灰底，读起来像两种来历。
   这里不引 .mpp-type--platform（那是对话卡局部的修饰类），直接给出同一组值。 */
.mpp-type {
  padding: 1px 7px;
  border-radius: var(--mk-radius-sm);
  background: color-mix(in srgb, var(--mk-blue) 10%, transparent);
  color: var(--mk-blue-text);
  font-size: var(--mk-fs-micro);
  font-weight: 600;
  line-height: 1.5;
}
.mpp-eng__model { color: var(--mk-ink); font-size: var(--mk-fs-body); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* 显示名称：id 下面的一行，只在运营起过名时出现（没起名不硬编一句话） */
.mpp-eng__label {
  color: var(--mk-muted);
  font-size: var(--mk-fs-micro);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mpp-eng__model--none { color: var(--mk-muted); }
/* 启用徽标：与对话卡的「默认」徽标同形（它讲的是「选了它」，不是「它有什么能力」） */
.mpp-eng__on { flex: none; }

/* 弹层分区（2026-11-05）：与模型设置弹层同一套「分区标题 + 两列栅格」解剖。 */
.infra-sec { display: grid; gap: 10px; align-content: start; }
.infra-sec + .infra-sec { margin-top: 18px; padding-top: 18px; border-top: 1px solid var(--mk-line); }
.infra-sec__head { display: flex; align-items: baseline; gap: 8px; }
.infra-sec__title {
  margin: 0;
  color: var(--mk-ink);
  font-size: var(--mk-fs-body);
  font-weight: 700;
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
/* 拼出来的实际请求地址：一行读完，放不下省略（它是用来核对地址的，折行反而读不出全貌） */
.infra-endpoint {
  margin: 0;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--mk-muted);
  font-size: var(--mk-fs-micro);
}
.infra-clearkey {
  display: flex;
  align-items: center;
  gap: 7px;
  color: var(--mk-muted);
  font-size: var(--mk-fs-micro);
}
/* 收起时的连接摘要：接在哪 + 密钥从哪来（与对话卡同一条解剖：地址左、状态右） */
.infra-own {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--mk-ink);
  font-size: var(--mk-fs-micro);
  cursor: pointer;
}
.infra-own input { margin: 0; flex: none; }
/* 只读的模型 ID：它是这一行的身份，不是待填字段 */
.infra-model-name {
  margin: 0;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--mk-ink);
  font-size: var(--mk-fs-body);
}
.infra-model-name--none { color: var(--mk-muted); font-size: var(--mk-fs-micro); }
/* 只读的模型 ID：与模型设置弹层同一处理——回到正文色 + 次级底，读作「这里是值」而不是「禁用控件」 */
.mk-field__input.infra-id--locked {
  color: var(--mk-ink);
  -webkit-text-fill-color: currentColor;
  background: var(--mk-surface-2);
  opacity: 1;
}
.infra-formrow { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }

</style>
