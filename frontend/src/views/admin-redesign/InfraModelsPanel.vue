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
          </div>
          <!-- 每张卡自己的添加入口（2026-11-04 用户「每个区域单独可以添加模型吧」）：
               点它按这条能力拉一份上游清单，勾几个就加进这条连接的模型池。 -->
          <div class="mk-card__head-right">
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
            :class="{ 'mpp-eng__row--menu': openMenu === rowKey(g.kind, m) }"
          >
            <div class="mpp-eng__main">
              <div class="mpp-eng__idline">
                <span class="mono mpp-eng__model" :title="m">{{ m }}</span>
                <!-- 「启用」徽标只在池子里不止一个模型时出现：只有一个模型时它恒等于
                     「这一行存在」，属于用布局就能读懂的事，不必再挂一枚标（2026-11-05）。 -->
                <span
                  v-if="m === g.entry.model && g.entry.models.length > 1"
                  class="mk-badge mk-badge--info mpp-eng__on"
                  title="运行时就调用这个模型"
                >启用</span>
              </div>
              <span
                v-if="testOf(g.kind, m)"
                class="mpp-eng__res"
                :class="{ 'is-bad': !testOf(g.kind, m)!.ok }"
                :title="testOf(g.kind, m)!.text"
              >{{ testOf(g.kind, m)!.ok ? '调用通过' : '调用失败' }}<template v-if="testOf(g.kind, m)!.detail"> · {{ testOf(g.kind, m)!.detail }}</template></span>
            </div>
            <!-- 动作集与对话卡对齐（2026-11-05 用户「里面的菜单按钮数量不一样啊」）：
                 配置 · 测试 同为 mk-link，删除与「设为启用」是低频/危险动作收进 ⋯。 -->
            <div class="mpp-eng__acts">
              <button type="button" class="mk-link" @click="openEdit(g.entry, m)">配置</button>
              <button
                v-if="g.entry.configured"
                type="button"
                class="mk-link"
                :disabled="testing === `${g.kind}|${m}`"
                @click="test(g.kind, m)"
              >{{ testing === `${g.kind}|${m}` ? '测试中…' : '测试' }}</button>
              <div class="mk-menu">
                <button
                  type="button"
                  class="mk-menu__btn"
                  aria-label="更多操作"
                  aria-haspopup="menu"
                  :aria-expanded="openMenu === rowKey(g.kind, m)"
                  @click.stop="toggleMenu(rowKey(g.kind, m))"
                >⋯</button>
                <div
                  v-if="openMenu === rowKey(g.kind, m)"
                  class="mk-menu__pop"
                  role="menu"
                  aria-label="更多操作"
                  :style="popStyle"
                  @click.stop
                >
                  <button
                    type="button"
                    class="mk-menu__item"
                    role="menuitem"
                    :disabled="saving || m === g.entry.model"
                    title="运行时改用这个模型，其余模型留在池子里备用"
                    @click="activate(g.kind, m)"
                  >设为启用</button>
                  <button
                    type="button"
                    class="mk-menu__item mk-menu__item--danger"
                    role="menuitem"
                    :disabled="saving"
                    @click="removeModel(g.kind, m)"
                  >删除</button>
                </div>
              </div>
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
            <!-- 与模型设置弹层同一套解剖（2026-11-05）：分区标题（模型 / 连接 / 参数）+ 两列栅格。
                 连接方式那一组**保留**（用户「之前设计向量和重拍有一个沿用对话模型 api 端点和 key
                 的设置，这个可以保留」）：复用时不出现地址与密钥，只说明复用的是哪条地址。
                 注意连接是**按能力**一份，池子里所有模型共用——这里改一次，整池都跟着变。 -->
            <section class="infra-sec">
              <div class="infra-sec__head">
                <h4 class="infra-sec__title">模型</h4>
              </div>
              <label class="mk-field">
                <span class="mk-field__label">模型 ID</span>
                <span class="infra-model-row">
                  <input
                    v-model="form.model"
                    class="mk-field__input mono"
                    :placeholder="editKind === 'embedding' ? '例如：BAAI/bge-m3' : '例如：BAAI/bge-reranker-v2-m3'"
                  />
                  <!-- 拉取（P1 2026-11-04 用户「它每一个接口都独立的自己去拉就行了」）：
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
            </section>

            <section class="infra-sec">
              <div class="infra-sec__head">
                <h4 class="infra-sec__title">连接</h4>
              </div>
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
         2026-11-05：多选——一次勾几个就进池子几个，其中第一个（或已有启用项）为启用态。 -->
    <PullModelsDialog
      ref="pullDialog"
      :title="addTitle"
      :models="addModels"
      :registered="addRegistered"
      :allow-manual="false"
      hint="勾选的模型都进这条连接的模型池，再用 ⋯「设为启用」决定运行时用哪个。"
      @confirm="addPicked"
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
import { askConfirm } from './useConfirm'
import { useEscape } from './useEscape'
import { useOverlay, useMaskClose } from './useOverlay'
import { useRowMenu } from './useRowMenu'
import { toast } from '@/utils/toast'

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

/* ---------- ⋯ 菜单（与对话卡同一套 useRowMenu） ---------- */
const { openMenu, toggleMenu, popStyle } = useRowMenu()

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
  const wasActive = model === entry.model
  const rest = entry.models.filter((id) => id !== model)
  const next = wasActive ? (rest[0] ?? '') : entry.model
  const ok = await askConfirm({
    title: `删除模型「${model}」`,
    message: wasActive
      ? (next
          ? `它是当前启用的模型，删除后会自动改用「${next}」。`
          : '它是这条连接唯一的模型，删除后这条能力暂时没有可用模型。')
      : '它只是备选模型，删除后不影响运行时。',
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
   2026-11-05：一次可以勾多个——「我拉去了四个，配置了四个，那我可以选择其中一个作为启用吧」。 */
const pullDialog = ref<InstanceType<typeof PullModelsDialog> | null>(null)
const addKind = ref<InfraKind | null>(null)
const addEntry = ref<InfraModelEntryView | null>(null)
const addModels = ref<string[]>([])
/** 弹窗标题：能力名本身已带「模型」（向量模型 / 重排模型），不再拼第二遍「模型」 */
const addTitle = computed(() => (addKind.value ? `添加${kindLabel(addKind.value)}` : '添加模型'))
const addRegistered = computed(() => addEntry.value?.models ?? [])

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
    openEdit(entry, entry.model)
  }
}

/** 勾选即入池：连接与参数沿用；池子原来是空的，就把第一个勾选的设为启用。
    以当前视图（最新写回结果）为基准合并，而不是弹窗打开时的快照——
    弹窗开着期间池子可能已经被别的动作改过，拿旧快照合并会把那次改动覆盖掉。 */
async function addPicked(ids: string[]) {
  const kind = addKind.value
  if (!kind || !ids.length) return
  const current = view.value?.[kind] ?? addEntry.value
  if (!current) return
  const merged = [...current.models]
  for (const id of ids) if (!merged.includes(id)) merged.push(id)
  const active = current.model || ids[0]
  if (await updatePool(kind, merged, active)) {
    toast.success(`已加入 ${ids.length} 个${kindLabel(kind)}，当前启用 ${active}`)
  }
}

/* ---------- 配置弹层：连接 + 参数 + 这一个模型的 ID ---------- */
const editKind = ref<InfraKind | null>(null)
const editEntry = ref<InfraModelEntryView | null>(null)
/** 打开时那一行的模型 id（空串 = 池子还没模型） */
const editingModel = ref('')
const editKindLabel = computed(() => (editKind.value ? kindLabel(editKind.value) : ''))
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

/** 打开配置弹层：改连接 / 参数 / 这一行的模型 ID */
function openEdit(entry: InfraModelEntryView, model: string) {
  editKind.value = entry.kind
  editEntry.value = entry
  editingModel.value = model
  candidates.value = []
  pullNote.value = ''
  form.value = {
    connectionMode: entry.connectionMode,
    /* inherit 的 endpoint 是后端解析结果，不能回填成独立地址。 */
    endpoint: entry.connectionMode === 'own' ? entry.endpoint : '',
    apiKey: '',
    clearKey: false,
    model,
    timeoutMs: entry.timeoutMs,
    batchSize: entry.batchSize ?? 32,
    dimensions: entry.dimensions,
  }
}

function closeEdit() {
  editKind.value = null
  editEntry.value = null
  editingModel.value = ''
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
  const entry = editEntry.value
  if (!kind || !entry) return
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
  const nextModel = form.value.model.trim()
  /* 模型 ID 可能被改名：池子里那一项跟着换，启用项若正是它也要跟着换。
     连接与参数是这条能力的，改一次整池生效。 */
  const renamed = editingModel.value && editingModel.value !== nextModel
  if (renamed && entry.models.includes(nextModel)) {
    toast.error(`「${nextModel}」已经在这条连接的模型列表里了`)
    return
  }
  const models = renamed
    ? entry.models.map((id) => (id === editingModel.value ? nextModel : id))
    : [...entry.models]
  const active = entry.model ? (renamed && entry.model === editingModel.value ? nextModel : entry.model) : nextModel
  if (!models.includes(nextModel)) models.push(nextModel)
  if (!models.includes(active)) models.push(active)

  const rawDimensions = form.value.dimensions as number | string | null
  const patch: Record<string, unknown> = {
    connectionMode: form.value.connectionMode,
    models,
    model: active,
    timeoutMs: form.value.timeoutMs,
    batchSize: kind === 'embedding' ? form.value.batchSize : null,
    dimensions: rawDimensions === null || rawDimensions === '' ? null : Number(rawDimensions),
  }
  if (form.value.connectionMode === 'own') {
    patch.endpoint = form.value.endpoint.trim()
    if (form.value.apiKey.trim()) patch.apiKey = form.value.apiKey.trim()
    if (form.value.clearKey) patch.clearKey = true
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
   2026-11-05 模型池上线后不再有「单例只有一行」的前提，行与行之间给发丝线。 */
.mpp-infra { display: grid; grid-template-columns: minmax(0, 1fr); gap: 10px; }
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
.mpp-eng__row--menu { background: var(--mk-table-row-hover-bg); }
.mpp-eng__main { display: grid; gap: 3px; min-width: 0; flex: 1 1 auto; }
.mpp-eng__idline { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; min-width: 0; }
.mpp-eng__id { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; min-width: 0; flex: 0 0 auto; }
.mpp-eng__acts { display: inline-flex; align-items: center; gap: 8px; flex-wrap: wrap; justify-content: flex-end; margin-left: auto; }
/* 类型标识（Embedding / Reranker）：与对话卡那枚 LLM 徽标同一套蓝调（2026-11-05 用户
   「不喜欢这个灰色」）——三张卡同处一层，一个是蓝底、两个是灰底，读起来像两种来历。
   这里不引 .mpp-type--platform（那是对话卡局部的修饰类），直接给出同一组值。 */
.mpp-type {
  padding: 1px 7px;
  border-radius: var(--mk-radius-sm);
  background: color-mix(in srgb, var(--mk-blue) 10%, transparent);
  color: var(--mk-blue);
  font-size: var(--mk-fs-micro);
  font-weight: 600;
  line-height: 1.5;
}
.mpp-eng__model { color: var(--mk-ink); font-size: var(--mk-fs-body); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mpp-eng__model--none { color: var(--mk-muted); }
/* 启用徽标：与对话卡的「默认」徽标同形（它讲的是「选了它」，不是「它有什么能力」） */
.mpp-eng__on { flex: none; }
.mpp-eng__res { color: var(--mk-green); white-space: nowrap; font-size: var(--mk-fs-micro); }
.mpp-eng__res.is-bad { color: var(--mk-red); font-weight: 600; }

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
  border-radius: var(--mk-radius-sm);
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
