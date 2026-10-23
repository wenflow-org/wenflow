<template>
  <!-- 模型供应商与模型（BYOK 重做，2026-10-18；2026-10-19 去分区）。
       左=供应商列表（平台自己的通道 + 若干自加上游，平铺一份清单、不分组），右=选中供应商的详情
       （服务地址、密钥三件套、模型清单可增删改、上游未登记折叠；平台通道的服务地址与密钥、
        连通性验证由宿主经 #platform-detail 注入）。
       2026-10-19 用户「就不分区，不要做什么平台提供，对于运营来说就是平台本身，自行接入又是什么
       意义呢」：原先按 id==='platform' 硬切「平台提供 / 自行接入」两组，详情头还挂「平台提供」
       徽标——那是「这条通道是谁给的」的来历视角，运营不需要，两栏看着还像两种东西。现在平铺成
       一份供应商清单（平台通道排最前），来历词全部撤掉。
       编辑是**即时保存**：点保存就落盘并热生效，不并入页脚保存条——只有平台通道的服务地址与
       密钥仍是连接设置的脏位保存（那段表单由宿主经 #platform-detail 插槽注入）。
       运行面读数（冷却/健康/配置漂移告警）另取 GET /admin/model-registry：编辑面只有配置值，
       把「这个模型现在能不能用」也算在这里会让两个接口互相复述。 -->
  <section class="mk-card mpp">
    <div class="mk-card__head">
      <h3 class="mk-card__title">模型供应商</h3>
      <span class="mk-card__meta" :title="registryPathTitle">{{ registryMeta }}</span>
      <button v-if="registry?.readOnly" type="button" class="mk-btn mk-btn--sm mk-btn--danger" disabled title="配置文件所在目录不可写，请在部署侧开放写权限">
        只读
      </button>
      <!-- 2026-10-23：与页头「刷新注册表」是同一动作（refresh(true)），同屏只留页头那一颗 -->
    </div>

    <div v-if="actionError" class="mk-alert mk-alert--row mpp-alert" role="alert">
      <span class="mk-alert__msg">{{ actionError }}</span>
      <button type="button" class="mk-alert__btn" @click="actionError = ''">知道了</button>
    </div>
    <div v-for="(w, i) in writeWarnings" :key="`w-${i}`" class="mk-alert mk-alert--row mpp-alert" role="status">
      <span class="mk-alert__msg">{{ w }}</span>
    </div>
    <p v-if="registry?.readOnly" class="mpp-note">
      注册表文件所在目录当前不可写，页面只能查看。请由部署侧开放写权限后再编辑。
    </p>

    <MkLoading v-if="loading && !view" inline text="读取供应商…" />
    <MkEmptyState
      v-else-if="failed"
      tone="error"
      title="供应商读取失败"
      :description="errorText"
      action-text="重试"
      @action="refresh(true)"
    />

    <div v-else class="mpp-body">
      <!-- 左：供应商列表（平铺一份清单，平台通道在最前；不再按来历分组） -->
      <aside class="mpp-list" role="tablist" aria-label="模型供应商" @keydown="onTablistKeydown">
        <div
          v-for="p in orderedProviders"
          :key="p.id"
          class="mpp-item"
          :class="{ 'mpp-item--on': p.id === selectedId }"
          role="tab"
          :aria-selected="p.id === selectedId"
          :data-provider="p.id"
          :tabindex="p.id === selectedId ? 0 : -1"
          @click="select(p.id)"
          @keydown.enter.prevent="select(p.id)"
          @keydown.space.prevent="select(p.id)"
        >
          <span class="mpp-item__dot" :class="`mpp-item__dot--${p.status}`" :title="statusLabel(p)" aria-hidden="true"></span>
          <span class="mpp-item__grow">
            <span class="mpp-item__name">{{ p.name }}</span>
            <span class="mpp-item__meta">{{ p.models.length }} 个模型</span>
          </span>
          <MkSwitch
            :model-value="p.enabled"
            :disabled="busy"
            :aria-label="`启用供应商 ${p.name}`"
            @update:model-value="(v: boolean) => toggleEnabled(p, v)"
          />
        </div>
        <button type="button" class="mk-btn mk-btn--sm mpp-add" :disabled="busy || registry?.readOnly" @click="providerEditor?.openWith(null)">
          ＋ 添加供应商
        </button>
      </aside>

      <!-- 右：详情 -->
      <div v-if="selected" class="mpp-detail">
        <div class="mpp-detail__head">
          <div class="mpp-detail__id">
            <strong class="mpp-detail__name">{{ selected.name }}</strong>
            <span class="mono mpp-detail__code">{{ selected.id }}</span>
            <!-- 状态徽标只出「能不能用」；平台通道那一档（endpointSource=inherit）不出徽标——
                 它用不用得了由下面「连接」段的连接徽标回答，同屏两处说同一件事是复读 -->
            <span v-if="headBadge" class="mk-badge" :class="headBadge.cls">{{ headBadge.label }}</span>
          </div>
          <div class="mpp-detail__acts">
            <button type="button" class="mk-btn mk-btn--sm" :disabled="busy || registry?.readOnly" @click="providerEditor?.openWith(selected)">设置</button>
            <button
              v-if="selected.id !== 'platform'"
              type="button"
              class="mk-btn mk-btn--sm mk-btn--danger"
              :disabled="busy || registry?.readOnly"
              @click="removeProvider(selected)"
            >删除</button>
          </div>
        </div>
        <p v-if="selected.description && selected.id !== 'platform'" class="mpp-detail__desc">{{ selected.description }}</p>

        <!-- 平台通道（endpointSource=inherit）：二级页签把「模型 / 连接 / 基础设施 / 生成参数」
             收进同一详情；宿主仍通过插槽注入连接表单、基础设施与生成默认，面板本身不持业务状态。 -->
        <template v-if="selected.id === 'platform'">
          <div class="mpp-tabs">
            <MkSubTabs id-base="mpp" :tabs="platformTabs" v-model="platformTab" />
          </div>
          <div
            v-show="platformTab === 'conn'"
            id="mpp-panel-conn"
            class="mpp-tabpanel"
            role="tabpanel"
            aria-labelledby="mpp-tab-conn"
          >
            <slot name="platform-detail" />
          </div>
          <div
            v-show="platformTab === 'infra'"
            id="mpp-panel-infra"
            class="mpp-tabpanel"
            role="tabpanel"
            aria-labelledby="mpp-tab-infra"
          >
            <slot name="platform-infra" />
          </div>
          <div
            v-show="platformTab === 'generation'"
            id="mpp-panel-generation"
            class="mpp-tabpanel"
            role="tabpanel"
            aria-labelledby="mpp-tab-generation"
          >
            <slot name="platform-generation" />
          </div>
        </template>

        <template v-else>
          <div class="mpp-block">
            <div class="mpp-block__head">
              <span class="mpp-sec">连接</span>
            </div>
          <div class="mpp-endpoint">
            <div class="mpp-endpoint__row">
              <span class="mpp-endpoint__label">服务地址</span>
              <span class="mono mpp-endpoint__value">{{ selected.baseUrl }}</span>
            </div>
            <div class="mpp-endpoint__row">
              <span class="mpp-endpoint__label">API Key</span>
              <span class="mpp-endpoint__key">
                <input
                  v-model="keyDraft"
                  class="mk-field__input"
                  :type="keyVisible ? 'text' : 'password'"
                  autocomplete="new-password"
                  :placeholder="selected.keyHint ? `已配置 ${selected.keyHint}，留空 = 沿用` : '输入 API Key'"
                  :disabled="registry?.readOnly"
                />
                <button
                  v-if="selected.keyHint || keyDraft"
                  type="button"
                  class="mpp-key-toggle"
                  :title="keyVisible ? '隐藏' : '显示'"
                  @click="keyVisible = !keyVisible"
                >{{ keyVisible ? '隐藏' : '显示' }}</button>
              </span>
              <span class="mpp-endpoint__acts">
                <button
                  type="button"
                  class="mk-btn mk-btn--sm mk-btn--primary"
                  :disabled="busy || !keyDraft.trim() || registry?.readOnly"
                  @click="saveKey(selected)"
                >保存密钥</button>
                <button type="button" class="mk-btn mk-btn--sm" :disabled="busy || registry?.readOnly" @click="clearKey(selected)">移除密钥</button>
              </span>
            </div>
          </div>
          </div>
        </template>

        <div
          v-show="selected.id !== 'platform' || platformTab === 'models'"
          class="mpp-block mpp-models"
          :role="selected.id === 'platform' ? 'tabpanel' : undefined"
          :id="selected.id === 'platform' ? 'mpp-panel-models' : undefined"
          :aria-labelledby="selected.id === 'platform' ? 'mpp-tab-models' : undefined"
        >
          <div class="mpp-models__head">
            <span class="mpp-sec">模型<span class="mpp-sec__count">{{ selected.models.length }} 个</span></span>
            <span class="mpp-models__acts">
              <button
                v-if="selected.endpointSource === 'own'"
                type="button"
                class="mk-btn mk-btn--sm"
                :disabled="pulling || !selected.keyHint"
                :title="selected.keyHint ? undefined : '先保存密钥'"
                @click="pullModels(selected)"
              >{{ pulling ? '拉取中…' : '获取模型列表' }}</button>
              <button type="button" class="mk-btn mk-btn--sm" :disabled="busy || registry?.readOnly" @click="modelEditor?.openWith({ providerId: selected.id, model: null })">＋ 添加模型</button>
            </span>
          </div>

          <slot v-if="selected.id === 'platform'" name="models-meta" />

          <!-- 上游模型：一条一行，逐条添加（2026-10-21 用户走查：不做批量「按对话档登记」，
               每个模型自己配置基础信息）。平台通道的清单由连接设置拉取，自带端点由本页拉取。 -->
          <div v-if="fetchableModels.length" class="mpp-fetch">
            <div v-if="selected.id !== 'platform' || fetchableModels.length > 8" class="mpp-fetch__head">
              <span v-if="selected.id !== 'platform'">上游模型 <b>{{ fetchableModels.length }}</b> 个</span>
              <input
                v-if="fetchableModels.length > 8"
                v-model="modelFilter"
                class="mk-field__input mpp-fetch__filter"
                placeholder="筛选模型"
                aria-label="筛选上游模型"
              />
            </div>
            <div class="mpp-fetch__list">
              <div v-for="name in filteredFetched" :key="name" class="mpp-fetch__row">
                <span class="mono mpp-fetch__id" :title="name">{{ name }}</span>
                <span v-if="registeredIds.has(name)" class="mk-badge mk-badge--muted">已添加</span>
                <button
                  v-else
                  type="button"
                  class="mk-link"
                  :disabled="busy || registry?.readOnly"
                  @click="openAddModel(name)"
                >添加</button>
              </div>
              <p v-if="!filteredFetched.length" class="mpp-fetch__empty">没有匹配的模型</p>
            </div>
          </div>

          <div class="mk-table-scroll">
            <table class="mk-table mk-table--dense mpp-table">
              <colgroup>
                <col style="width: 50%" /><col style="width: 22%" /><col style="width: 14%" /><col style="width: 14%" />
              </colgroup>
              <thead>
                <tr>
                  <th>模型</th>
                  <th>单价</th>
                  <th>状态</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="m in selected.models" :key="m.id">
                  <td class="mpp-model">
                    <span class="mono mpp-model__id">{{ m.id }}</span>
                    <span v-if="m.label && m.label !== m.id" class="mpp-desc" :title="m.label">{{ m.label }}</span>
                    <span
                      v-if="testResults[m.id]"
                      class="mpp-rowtest"
                      :class="{ 'mpp-rowtest--bad': !testResults[m.id].ok }"
                      :title="testResults[m.id].text"
                    >{{ testResults[m.id].ok ? '调用通过' : '调用失败' }}<template v-if="testResults[m.id].latency"> · {{ testResults[m.id].latency }}</template></span>
                  </td>
                  <!-- 价格是「入 / 出」中文标签 + 数字，走正文 + 等宽数字对齐 -->
                  <td class="mpp-price" :class="{ 'mpp-price--missing': priceMissing(m) }" :title="priceTitle(m)">{{ priceText(m) }}</td>
                  <td>
                    <span v-if="cooldownOf(m)" class="mk-badge mk-badge--warn" :title="`已触发熔断冷却，降级时会被跳过（剩余 ${Math.ceil(cooldownOf(m)!.remainingMs / 1000)}s）`">冷却中</span>
                    <span v-else class="mk-badge mk-badge--ok">● 健康</span>
                    <span v-if="modelWarnings(m).length" class="mk-badge mk-badge--warn mpp-label" :title="modelWarnings(m).join('\n')">⚠</span>
                  </td>
                  <td class="mpp-rowacts">
                    <button type="button" class="mk-link" :disabled="testingId === m.id" @click="testModel(selected, m.id)">{{ testingId === m.id ? '测试中…' : '测试' }}</button>
                    <button type="button" class="mk-link" :disabled="busy || registry?.readOnly" @click="modelEditor?.openWith({ providerId: selected.id, model: m })">编辑</button>
                    <button type="button" class="mk-link mk-link--danger" :disabled="busy || registry?.readOnly" @click="removeModel(m)">删除</button>
                  </td>
                </tr>
                <tr v-if="!selected.models.length">
                  <td colspan="4" class="mpp-empty">
                    {{ selected.enabled ? '还没有模型' : '这个供应商当前停用，模型不参与路由。' }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
      <MkEmptyState v-else compact title="还没有供应商。用左栏底部的「添加供应商」建一个。" />
    </div>

    <ProviderEditorDialog ref="providerEditor" @saved="onProviderSaved" />
    <ModelEditorDialog ref="modelEditor" :fallback-options="fallbackOptions" @saved="onModelSaved" />
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { adminApiConfigApi, adminModelProvidersApi } from '@/api/adminApi'
import MkEmptyState from '@/components/mk/MkEmptyState.vue'
import MkLoading from '@/components/mk/MkLoading.vue'
import MkSubTabs from '@/components/mk/MkSubTabs.vue'
import MkSwitch from '@/components/mk/MkSwitch.vue'
import ProviderEditorDialog, { type ProviderLike } from './ProviderEditorDialog.vue'
import ModelEditorDialog, { type ModelLike } from './ModelEditorDialog.vue'
import { askConfirm } from './useConfirm'
import { errMsg } from './live'

/** 注册表编辑视图（后端 services/admin/model-providers.service.ts 的 ProviderRegistryView） */
interface ProviderView extends ProviderLike {
  id: string
  name: string
  description: string | null
  enabled: boolean
  recommended: boolean
  endpointSource: 'inherit' | 'own'
  baseUrl: string | null
  apiKeyEnv: string | null
  keySource: 'db' | 'env' | 'none'
  keyHint: string | null
  status: 'ready' | 'unconfigured' | 'inherit' | 'disabled'
  supportsSystemRole: boolean | null
  models: ModelLike[]
}
interface ProvidersView {
  registry: { path: string; source: 'file' | 'embedded-fallback'; mtimeMs: number | null; lastError: string | null; readOnly: boolean }
  providers: ProviderView[]
}
/** 运行面读数（GET /admin/model-registry 的子集）：冷却、告警、候选上限 */
interface RegistryHealth {
  models: Array<{ id: string; providerId: string }>
  cooldowns: Array<{ providerId: string; model: string; remainingMs: number }>
  warnings: string[]
  runtime?: { maxModelCandidates: number }
}

const props = withDefaults(defineProps<{
  /** 上游模型清单（宿主连接设置里拉到的，平台通道用） */
  upstream?: string[]
}>(), { upstream: () => [] })

const emit = defineEmits<{
  /** 注册表被改动（增删改）→ 宿主决定是否重取别名/默认解析 */
  changed: []
  /** 已登记的模型 id（宿主用它算「上游还有几个没登记」的关系句，避免两处各算一遍） */
  registered: [ids: string[]]
}>()

const view = ref<ProvidersView | null>(null)
const health = ref<RegistryHealth | null>(null)
const loading = ref(false)
const failed = ref(false)
const errorText = ref('')
const busy = ref(false)
const actionError = ref('')
const writeWarnings = ref<string[]>([])
const selectedId = ref('')
const keyDraft = ref('')
const keyVisible = ref(false)
const testingId = ref('')
const pulling = ref(false)
/** 单模型测试结果（按模型 id 落在行内，不再用卡上方一条全局结果条） */
const testResults = ref<Record<string, { ok: boolean; latency: string; text: string }>>({})
const pulled = ref<string[]>([])
const modelFilter = ref('')

const providerEditor = ref<InstanceType<typeof ProviderEditorDialog> | null>(null)
const modelEditor = ref<InstanceType<typeof ModelEditorDialog> | null>(null)

const providers = computed(() => view.value?.providers ?? [])
/** 目录文件状态（路径/可写/最近一次热重载错误）：模板里多处按它决定是否禁用编辑 */
const registry = computed(() => view.value?.registry ?? null)
const selected = computed(() => providers.value.find((p) => p.id === selectedId.value) ?? null)
/** 平台详情的二级页签：全局的基础设施与生成默认都收在这里；自定义供应商保持线性详情 */
const platformTab = ref('models')
const platformTabs = computed(() => [
  { key: 'models', label: '模型', count: selected.value?.models.length ?? 0 },
  { key: 'conn', label: '连接' },
  { key: 'infra', label: '基础设施' },
  { key: 'generation', label: '生成参数' }
])
watch(selectedId, () => { platformTab.value = 'models' })

/* 2026-10-21 用户「不要了」：卡头 meta 只留可写/只读这个会改变操作的结论，
   数据来源（来自模型目录文件）与生效方式进 title */
const registryMeta = computed(() => {
  const r = view.value?.registry
  if (!r) return ''
  if (r.readOnly) return '只读'
  return '改动即时生效'
})
const registryPathTitle = computed(() => {
  const r = view.value?.registry
  if (!r) return ''
  const parts = [`目录文件：${r.path}`]
  if (r.lastError) parts.push(`最近更新失败：${r.lastError}`)
  return parts.join('\n')
})

/** 平铺一份清单：平台通道在最前（它是平台自己的通道），其余按文件声明序。
    2026-10-19 去分区：原按 id==='platform' 切「平台提供 / 自行接入」两组，那是来历视角。 */
const orderedProviders = computed(() => {
  const list = providers.value
  return [...list.filter((p) => p.id === 'platform'), ...list.filter((p) => p.id !== 'platform')]
})

const registeredIds = computed(() => new Set(selected.value?.models.map((m) => m.id) ?? []))
/** 上游模型清单：平台通道来自连接设置（宿主注入），自带端点来自本页「获取模型列表」 */
const fetchableModels = computed(() =>
  selected.value?.endpointSource === 'inherit' ? props.upstream : pulled.value
)
const filteredFetched = computed(() => {
  const q = modelFilter.value.trim().toLowerCase()
  return q ? fetchableModels.value.filter((n) => n.toLowerCase().includes(q)) : fetchableModels.value
})
const fallbackOptions = computed(() =>
  providers.value.flatMap((p) => p.models.map((m) => `${p.id}/${m.id}`))
)

/** 已登记模型 id 回传宿主（上游清单的关系句由宿主渲染，数据同源一次算） */
function emitRegistered(): void {
  emit('registered', providers.value.flatMap((p) => p.models.map((m) => m.id)))
}

function statusLabel(p: ProviderView): string {
  if (p.status === 'disabled') return '已停用'
  if (p.status === 'inherit') return '用连接设置里的地址与密钥'
  if (p.status === 'unconfigured') return '还没配置密钥'
  return '可用'
}
/** 详情头徽标：只出「能不能用」。「用平台连接设置」这一档返回 null——那句话由下面「连接」段
    的连接徽标回答（同屏一处事实一个控件）。 */
function statusBadge(p: ProviderView): { cls: string; label: string } | null {
  if (p.status === 'inherit') return null
  if (p.status === 'disabled') return { cls: 'mk-badge--muted', label: '已停用' }
  if (p.status === 'unconfigured') return { cls: 'mk-badge--warn', label: '待配置密钥' }
  return { cls: 'mk-badge--ok', label: '可用' }
}
const headBadge = computed(() => (selected.value ? statusBadge(selected.value) : null))

function cooldownOf(m: ModelLike) {
  return (health.value?.cooldowns ?? []).find((c) => c.model === m.id && c.providerId === selected.value?.id) ?? null
}
function modelWarnings(m: ModelLike): string[] {
  return (health.value?.warnings ?? []).filter((w) => w.includes(`模型「${m.id}」`))
}
/** 未配单价 = 成本分析页这个模型的金额会显示「—」，是可在本页补的配置缺口 */
function priceMissing(m: ModelLike): boolean {
  const p = m.pricing
  return !p || (p.inputPer1M == null && p.outputPer1M == null)
}
function priceText(m: ModelLike): string {
  if (priceMissing(m)) return '未配置'
  const p = m.pricing!
  return `入 ${p.inputPer1M ?? '—'} / 出 ${p.outputPer1M ?? '—'}`
}
function priceTitle(m: ModelLike): string {
  const p = m.pricing
  if (priceMissing(m)) return '未配单价：成本分析页这个模型的金额会显示「—」。点「编辑」补输入与输出单价'
  const cached = p!.cachedInputPer1M != null ? ` / 缓存 ${p!.cachedInputPer1M}` : ''
  return `单价 入 ${p!.inputPer1M ?? '—'}${cached} / 出 ${p!.outputPer1M ?? '—'}（USD / 1M tokens，只影响成本分析）`
}
/** 列表是一组 role=tab：按 WAI-ARIA 走 roving tabindex + 方向键，避免 N 个供应商占 N 个 Tab 位 */
function onTablistKeydown(e: KeyboardEvent): void {
  const keys = ['ArrowDown', 'ArrowUp', 'Home', 'End']
  if (!keys.includes(e.key)) return
  const items = orderedProviders.value
  if (!items.length) return
  e.preventDefault()
  const cur = items.findIndex((p) => p.id === selectedId.value)
  const next = e.key === 'Home' ? 0
    : e.key === 'End' ? items.length - 1
      : e.key === 'ArrowDown' ? (cur < 0 ? 0 : (cur + 1) % items.length)
        : (cur < 0 ? items.length - 1 : (cur - 1 + items.length) % items.length)
  select(items[next].id)
  nextTick(() => {
    const host = e.currentTarget as HTMLElement | null
    host?.querySelector<HTMLElement>(`[data-provider="${items[next].id}"]`)?.focus()
  })
}

function select(id: string): void {
  selectedId.value = id
  keyDraft.value = ''
  keyVisible.value = false
  testResults.value = {}
  pulled.value = []
  modelFilter.value = ''
}

/** 选中项被删/首次加载后归位：优先平台通道，其次第一个 */
function ensureSelection(): void {
  if (providers.value.some((p) => p.id === selectedId.value)) return
  const first = providers.value.find((p) => p.id === 'platform') ?? providers.value[0]
  selectedId.value = first?.id ?? ''
}

async function refresh(force = false): Promise<void> {
  if (view.value && !force) return
  loading.value = true
  failed.value = false
  try {
    const [providersRes, registryRes] = await Promise.all([
      adminModelProvidersApi.get(),
      adminModelRegistryHealth()
    ])
    view.value = (providersRes?.data?.data ?? null) as ProvidersView | null
    health.value = registryRes
    ensureSelection()
    emitRegistered()
  } catch (e) {
    failed.value = true
    errorText.value = errMsg(e)
  } finally {
    loading.value = false
  }
}

/**
 * 运行面读数失败不该让整块面板报「读取失败」：它只喂状态列与告警角标，
 * 缺了就按「没有冷却记录」渲染，编辑面照常用。
 */
async function adminModelRegistryHealth(): Promise<RegistryHealth | null> {
  try {
    const res = await adminApiConfigApi.getModelRegistry()
    return (res?.data?.data ?? null) as RegistryHealth | null
  } catch {
    return null
  }
}

/** 写接口统一回吐最新视图：直接换掉本地数据，不再多一次 GET */
function adopt(payload: unknown, warnings: string[]): void {
  const data = (payload as { data?: unknown })?.data ?? payload
  if (data && typeof data === 'object' && 'providers' in (data as object)) {
    view.value = data as ProvidersView
    ensureSelection()
    emitRegistered()
  }
  writeWarnings.value = warnings
  emit('changed')
}

async function toggleEnabled(p: ProviderView, value: boolean): Promise<void> {
  busy.value = true
  actionError.value = ''
  try {
    const res = await adminModelProvidersApi.update(p.id, { enabled: value })
    adopt(res?.data, res?.data?.warnings ?? [])
  } catch (e) {
    actionError.value = errMsg(e)
  } finally {
    busy.value = false
  }
}

async function saveKey(p: ProviderView): Promise<void> {
  if (!keyDraft.value.trim()) return
  busy.value = true
  actionError.value = ''
  try {
    const res = await adminModelProvidersApi.update(p.id, { apiKey: keyDraft.value.trim() })
    adopt(res?.data, res?.data?.warnings ?? [])
    keyDraft.value = ''
  } catch (e) {
    actionError.value = errMsg(e)
  } finally {
    busy.value = false
  }
}

async function clearKey(p: ProviderView): Promise<void> {
  const ok = await askConfirm({
    title: '移除已保存的密钥',
    message: `移除「${p.name}」当前保存的密钥后，运行时会回落到服务器环境变量 ${p.apiKeyEnv || '（未配置）'}。若两处都没有，它的模型会直接报错。`,
    confirmText: '移除密钥'
  })
  if (ok !== true) return
  busy.value = true
  actionError.value = ''
  try {
    const res = await adminModelProvidersApi.removeKey(p.id)
    adopt(res?.data, res?.data?.warnings ?? [])
  } catch (e) {
    actionError.value = errMsg(e)
  } finally {
    busy.value = false
  }
}

async function removeProvider(p: ProviderView): Promise<void> {
  const ok = await askConfirm({
    title: `删除供应商「${p.name}」`,
    message: `将从模型目录里删掉这个供应商和它下面的 ${p.models.length} 个模型，并清除已保存的密钥。删掉后引用这些模型的默认路由与别名会失效（系统会拦下那种情况）。`,
    confirmText: '删除供应商'
  })
  if (ok !== true) return
  busy.value = true
  actionError.value = ''
  try {
    const res = await adminModelProvidersApi.remove(p.id)
    select('')
    adopt(res?.data, res?.data?.warnings ?? [])
  } catch (e) {
    actionError.value = errMsg(e)
  } finally {
    busy.value = false
  }
}

async function removeModel(m: ModelLike): Promise<void> {
  const ok = await askConfirm({
    title: `删除模型「${m.id}」`,
    message: '从模型目录里删掉它，此后不再参与路由。若它正被默认路由或别名引用，系统会拦下并说明。',
    confirmText: '删除模型'
  })
  if (ok !== true) return
  busy.value = true
  actionError.value = ''
  try {
    const res = await adminModelProvidersApi.removeModel(selected.value!.id, m.id)
    adopt(res?.data, res?.data?.warnings ?? [])
  } catch (e) {
    actionError.value = errMsg(e)
  } finally {
    busy.value = false
  }
}

function onProviderSaved(payload: { providerId: string; warnings: string[] }): void {
  void reloadAfterDialog(payload.providerId, payload.warnings)
}
function onModelSaved(payload: { modelId: string; warnings: string[] }): void {
  void reloadAfterDialog(null, payload.warnings)
}

/**
 * 弹层保存后：写接口的回吐在弹层里被吃掉了，这里重新拉一次视图（唯一需要再拉一次的场景），
 * 并把告警透传到面板顶部。
 */
async function reloadAfterDialog(providerId: string | null, warnings: string[]): Promise<void> {
  if (providerId) selectedId.value = providerId
  await refresh(true)
  writeWarnings.value = warnings
  emit('changed')
}

async function testModel(p: ProviderView, modelId: string): Promise<void> {
  testingId.value = modelId
  actionError.value = ''
  try {
    const res = await adminModelProvidersApi.test(p.id, { modelId })
    testResults.value = {
      ...testResults.value,
      [modelId]: { ok: true, latency: `${res?.data?.data?.durationMs ?? 0}ms`, text: res?.data?.data?.content ?? '' }
    }
  } catch (e) {
    testResults.value = { ...testResults.value, [modelId]: { ok: false, latency: '', text: errMsg(e) } }
  } finally {
    testingId.value = ''
  }
}

async function pullModels(p: ProviderView): Promise<void> {
  pulling.value = true
  actionError.value = ''
  try {
    const res = await adminModelProvidersApi.pullModels(p.id)
    pulled.value = (res?.data?.data?.models ?? []) as string[]
    modelFilter.value = ''
  } catch (e) {
    actionError.value = errMsg(e)
  } finally {
    pulling.value = false
  }
}

/** 上游清单逐条添加：把模型 id 带进编辑弹层，基础信息由用户确认后保存 */
function openAddModel(name: string): void {
  if (!selected.value) return
  modelEditor.value?.openWith({ providerId: selected.value.id, model: null, presetId: name })
}

onMounted(() => {
  void refresh()
})

defineExpose({ refresh })
</script>

<style scoped>
.mpp-alert { margin: 8px 14px 0; }
.mpp-note {
  margin: 8px 14px 0;
  color: var(--mk-muted);
  font-size: var(--mk-fs-micro);
}
/* 2026-10-20 走查：接入页是一张满高工作台——卡片撑满页签剩余高度，左列表 / 右详情各自内滚，
   不在长屏上留出整屏空白（此前卡随内容高度，1920×1080 下方空 300+px）。 */
.mpp { display: flex; flex-direction: column; min-height: 0; }
.mpp-body {
  display: grid;
  grid-template-columns: 260px minmax(0, 1fr);
  gap: 0;
  border-top: 1px solid var(--mk-line);
  flex: 1 1 auto;
  min-height: 0;
}
@media (max-width: 900px) {
  .mpp-body { grid-template-columns: minmax(0, 1fr); }
  .mpp-list { border-right: 0; border-bottom: 1px solid var(--mk-line); }
}
.mpp-list {
  padding: 10px;
  border-right: 1px solid var(--mk-line);
  overflow-y: auto;
  min-height: 0;
}
.mpp-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 6px;
  border-radius: var(--mk-radius-md);
  cursor: pointer;
}
.mpp-item:hover { background: var(--mk-surface-2); }
.mpp-item--on { background: var(--mk-surface-2); box-shadow: inset 2px 0 0 var(--mk-accent-deep); }
.mpp-item__dot {
  width: 8px;
  height: 8px;
  flex: 0 0 auto;
  border-radius: 50%;
  background: var(--mk-muted);
}
.mpp-item__dot--ready { background: var(--mk-green); }
.mpp-item__dot--unconfigured { background: var(--mk-amber); }
.mpp-item__dot--disabled { background: var(--mk-muted); }
.mpp-item__dot--inherit { background: var(--mk-accent-deep); }
.mpp-item__grow { min-width: 0; flex: 1 1 auto; }
.mpp-item__name { display: block; font-size: var(--mk-fs-body); }
.mpp-item__meta {
  display: block;
  color: var(--mk-muted);
  font-size: var(--mk-fs-micro);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mpp-add { width: 100%; margin-top: 10px; }
.mpp-detail { padding: 12px 16px 16px; min-width: 0; overflow-y: auto; }
/* 二级页签贴顶：详情自身是滚动容器，切页签后标题与操作不用滚回去找 */
.mpp-tabs {
  position: sticky;
  top: 0;
  z-index: 1;
  margin: 0 -16px 10px;
  padding: 0 16px;
  background: var(--mk-surface);
}
.mpp-tabpanel { min-width: 0; }
.mpp-tabpanel > .mpp-block:first-child { margin-top: 0; padding-top: 0; border-top: 0; }
.mpp-detail > .mpp-models[role="tabpanel"] { margin-top: 0; padding-top: 0; border-top: 0; }

/* 详情分区：连接 / 模型清单 / 上游，三块同一套标题 + 发丝线节奏（v4：1px 发丝线分隔） */
.mpp-block { margin-top: 14px; padding-top: 12px; border-top: 1px solid var(--mk-line); }
.mpp-block:first-of-type { margin-top: 10px; }
.mpp-block__head { display: flex; align-items: baseline; gap: 10px; margin-bottom: 10px; flex-wrap: wrap; }
.mpp-detail__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}
.mpp-detail__id { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.mpp-detail__name { font-size: var(--mk-fs-emphasis); }
.mpp-detail__code { color: var(--mk-muted); font-size: var(--mk-fs-micro); }
.mpp-detail__acts { display: inline-flex; gap: 6px; }
.mpp-detail__desc {
  margin: 6px 0 0;
  color: var(--mk-muted);
  font-size: var(--mk-fs-micro);
}
.mpp-endpoint {
  margin-top: 12px;
  padding: 10px 12px;
  border: 1px solid var(--mk-line);
  border-radius: var(--mk-radius-lg);
}
.mpp-endpoint__row {
  display: flex;
  align-items: center;
  gap: 10px;
}
.mpp-endpoint__row + .mpp-endpoint__row { margin-top: 8px; }
.mpp-endpoint__label {
  flex: 0 0 72px;
  color: var(--mk-muted);
  font-size: var(--mk-fs-micro);
}
.mpp-endpoint__value { min-width: 0; overflow-wrap: anywhere; font-size: var(--mk-fs-body); }
.mpp-endpoint__key { display: flex; align-items: center; gap: 6px; min-width: 0; flex: 1 1 auto; }
.mpp-key-toggle {
  background: none;
  border: 0;
  padding: 2px 6px;
  color: var(--mk-muted);
  font-size: var(--mk-fs-micro);
  cursor: pointer;
}
.mpp-endpoint__acts { display: inline-flex; gap: 6px; flex: 0 0 auto; }
.mpp-models { margin-top: 14px; padding-top: 12px; border-top: 1px solid var(--mk-line); }
.mpp-models__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 8px;
}
.mpp-models__acts { display: inline-flex; gap: 6px; flex-wrap: wrap; }
.mpp-sec { font-size: var(--mk-fs-body); }
.mpp-sec__count {
  margin-left: 8px;
  color: var(--mk-muted);
  font-size: var(--mk-fs-micro);
}
/* 上游模型清单：一条一行，逐条添加；超过 8 条给筛选框（31 个模型靠肉眼找太慢） */
.mpp-fetch {
  margin-bottom: 10px;
  border: 1px solid var(--mk-line);
  border-radius: var(--mk-radius-lg);
}
.mpp-fetch__head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--mk-line);
  color: var(--mk-muted);
  font-size: var(--mk-fs-micro);
}
.mpp-fetch__head b { color: var(--mk-ink); }
.mpp-fetch__filter { width: 180px; margin-left: auto; }
.mpp-fetch__list { display: grid; max-height: 188px; overflow-y: auto; }
.mpp-fetch__row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 5px 12px;
  border-bottom: 1px solid var(--mk-line);
  font-size: var(--mk-fs-micro);
}
.mpp-fetch__row:last-child { border-bottom: 0; }
.mpp-fetch__id { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mpp-fetch__empty { margin: 0; padding: 10px 12px; color: var(--mk-muted); font-size: var(--mk-fs-micro); }
.mpp-table { width: 100%; }
.mpp-label {
  margin-left: 6px;
  color: var(--mk-muted);
  font-size: var(--mk-fs-micro);
}
.mpp-desc {
  display: block;
  margin-top: 2px;
  color: var(--mk-muted);
  font-size: var(--mk-fs-micro);
  max-width: 240px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* 模型格承载 id + 显示名 + 最近一次测试结果 */
.mpp-model { min-width: 220px; }
.mpp-model__id { overflow-wrap: anywhere; }
.mpp-rowtest { display: block; margin-top: 2px; color: var(--mk-green); font-size: var(--mk-fs-micro); }
.mpp-rowtest--bad { color: var(--mk-red); }
/* 单价是一句读数（入 x / 出 y），断行会把它拆成两截读不出配对关系 */
.mpp-price { color: var(--mk-faint); font-size: var(--mk-fs-micro); white-space: nowrap; }
/* 未配单价是能直接修的配置缺口：用警示色把「单价未知」从限额副行里拎出来，别读成普通弱字 */
.mpp-price--missing { color: var(--mk-amber); }
.mpp-rowacts { display: flex; gap: 8px; white-space: nowrap; }
.mpp-empty { color: var(--mk-muted); font-size: var(--mk-fs-micro); }
</style>
