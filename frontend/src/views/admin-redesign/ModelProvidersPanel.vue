<template>
  <!-- 模型供应商与模型（BYOK 重做，2026-10-18；2026-10-19 去分区；2026-10-28 新人视角收敛）。
       左=供应商列表（当前通道 + 其余启用中的上游；停用条目默认收起），右=选中供应商的详情
       （服务地址、密钥三件套、模型清单可增删改、上游未登记折叠；当前通道的服务地址与密钥、
        连通性验证由宿主经 #platform-detail 注入）。
       2026-10-19 用户「就不分区，不要做什么平台提供，对于运营来说就是平台本身，自行接入又是什么
       意义呢」：原先按 id==='platform' 硬切「平台提供 / 自行接入」两组，详情头还挂「平台提供」
       徽标——那是「这条通道是谁给的」的来历视角，运营不需要，两栏看着还像两种东西。现在平铺成
       一份供应商清单（当前通道排最前），来历词全部撤掉。
       2026-10-28 用户「不应该出现新建供应商，走两家供应商的事情」：撤掉「添加供应商」入口，
       新人只需要把当前通道配好；停用的示例条目不占第一屏。价格不再占模型表一列，收进模型编辑的
       高级设置（单价只服务成本分析，不是接入路径）。
       编辑是**即时保存**：点保存就落盘并热生效，不并入页脚保存条——只有当前通道的服务地址与
       密钥仍是连接设置的脏位保存（那段表单由宿主经 #platform-detail 插槽注入）。
       运行面读数（冷却/健康/配置漂移告警）另取 GET /admin/model-registry：编辑面只有配置值，
       把「这个模型现在能不能用」也算在这里会让两个接口互相复述。 -->
  <section class="mk-card mpp">
    <!-- 2026-10-27 用户「这个重新设计，可以先放到第三个」：卡头承接通道身份与状态——
         平台通道 + 平台内置 + 连接状态，右侧是写盘状态与本页动作；详情里不再单起一行标题。 -->
    <div class="mk-card__head">
      <div class="mpp-head__id">
        <h3 class="mk-card__title">{{ selected ? providerName(selected) : '接入通道' }}</h3>
        <span v-if="selected" class="mpp-type mpp-type--platform">{{ providerTypeLabel(selected) }}</span>
        <!-- 宿主注入的连接状态（「连接正常 · N 前」）：与通道身份同一行 -->
        <slot v-if="selected" name="head-status" />
        <span v-if="headBadge" class="mk-badge" :class="headBadge.cls">{{ headBadge.label }}</span>
      </div>
      <div class="mk-card__head-right">
        <span class="mk-card__meta" :title="registryPathTitle">{{ registryMeta }}</span>
        <button v-if="registry?.readOnly" type="button" class="mk-btn mk-btn--sm mk-btn--danger" disabled title="配置文件所在目录不可写，请在部署侧开放写权限">
          只读
        </button>
        <!-- 宿主动作（获取模型 / 保存连接 / 重置此通道）：与通道状态同一行 -->
        <slot v-if="selected" name="head-actions" />
      </div>
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

    <MkLoading v-if="loading && !view" inline text="读取接入通道…" />
    <MkEmptyState
      v-else-if="failed"
      tone="error"
      title="接入通道读取失败"
      :description="errorText"
      action-text="重试"
      @action="refresh(true)"
    />

    <div v-else class="mpp-body">
      <!-- 2026-10-27 用户「这个区域不要了」：撤掉左栏通道清单。这一页就是平台通道本身，
           一栏列表只为一个通道占 260px，还把模型表挤到断行；自建通道改由配置文件/接口维护。 -->
      <div v-if="selected" class="mpp-detail">
        <!-- 接入 API 段：只剩服务地址与密钥（2026-10-27 用户「一块负责 api 一块配置」）。
             模型清单、基础设施与生成默认都在下面第二张「平台配置」卡里。 -->
        <div id="mpp-platform-panel-conn">
          <slot name="platform-detail" />
        </div>

      </div>
      <MkEmptyState v-else compact title="还没有接入通道" />
    </div>

    <PullModelsDialog
      ref="pullDialog"
      :provider-name="selected ? providerName(selected) : ''"
      :provider-id="selected?.id ?? ''"
      :models="fetchableModels"
      :registered="[...registeredIds]"
      @confirm="startConfigure"
      @navigate="onPullNavigate"
    />
    <ModelEditorDialog ref="modelEditor" :fallback-options="fallbackOptions" @saved="onModelSaved" @closed="onEditorClosed" />
    <!-- 逐个配置队列：常驻进度与「跳过剩余」，中途关掉模型弹窗也能知道还剩几个 -->
    <div v-if="configureQueue.length" class="mpp-queue" role="status">
      <span>还剩 {{ configureQueue.length }} 个模型未配置</span>
      <button type="button" class="mk-link" @click="skipRemaining">跳过剩余</button>
    </div>
  </section>

  <!-- 2026-10-27 用户「没有本地模型，都属于基础设施模型，一块负责 api 一块配置」：
     第一张卡只管接入 API（地址、密钥）；模型清单、向量化 / 重排与生成默认都在这里配。 -->
  <section v-if="selected" class="mk-card mpp-config">
    <div class="mk-card__head">
      <h3 class="mk-card__title">平台配置</h3>
    </div>
    <div class="mpp-config__body">
      <div
        id="mpp-platform-panel-models"
        class="mpp-block mpp-models"
      >
        <div class="mpp-models__head">
          <!-- 平台详情只有一页：标题直接给模型计数（原页签计数随页签一起退役）。
               上游清单状态与计数同一行（2026-10-24 走查）：原先是表头之上独立一条，
               读起来像一行空记录。 -->
          <div class="mpp-models__title">
            <span class="mpp-sec">已接入 {{ selected.models.length }} 个模型</span>
            <slot name="models-meta" />
          </div>
          <span class="mpp-models__acts">
            <!-- 拉取结果收进浮窗（2026-10-24）：清单不在详情里铺开，勾选后再逐个配置。
                 拉取过一次就保留入口，关掉浮窗还能回来再选。 -->
            <button v-if="pullableCount" type="button" class="mk-link" @click="openPull">
              选择要添加的（{{ pullableCount }}）
            </button>
            <button type="button" class="mk-btn mk-btn--sm" :disabled="busy || registry?.readOnly" @click="openManualAdd">＋ 添加模型</button>
          </span>
        </div>

        <!-- 上游清单不再铺在详情里（2026-10-24 用户「拉取作为浮窗」）：拉取只拿到清单，
             勾选与用途分流都在 PullModelsDialog 里做——详情区只留已登记模型这张表。 -->

        <!-- 空模型时的下一步（2026-10-28 新人视角）：不丢一张空表，直接说清先做什么 -->
        <div v-if="selected.enabled && !selected.models.length" class="mpp-setup">
          <div class="mpp-setup__text">
            <strong>还没有登记模型</strong>
            <span>先配置服务地址与 API Key，再拉取上游模型，或手动添加模型 ID。</span>
          </div>
          <button
            type="button"
            class="mk-btn mk-btn--sm"
            @click="scrollToConn"
          >去配置连接</button>
        </div>

        <!-- 模型表常驻：基础设施行也在这张表里，没有对话模型时不能把表整张藏掉 -->
        <div class="mk-table-scroll">
          <table class="mk-table mk-table--dense mk-table--fixed mpp-table">
            <colgroup>
              <col style="width: 38%" /><col style="width: 26%" /><col style="width: 16%" /><col style="width: 20%" />
            </colgroup>
            <thead>
              <tr>
                <th>模型</th>
                <th>功能</th>
                <th>状态</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              <!-- 按用途分组（2026-10-21 用户「按功能区分一下」）：同一张表里用分组行切段，
                   不拆多张表——列宽与对齐保持一处。组内再按能力标「功能」列，运营一眼看得出
                   哪个模型能思考、能调推理强度、能读图。 -->
              <template v-for="g in modelGroups" :key="g.tier">
                <tr class="mpp-group">
                  <td colspan="4">
                    <span class="mpp-group__name">{{ g.label }}</span>
                    <span class="mpp-group__count">{{ g.models.length }} 个</span>
                  </td>
                </tr>
                <tr v-for="m in g.models" :key="m.id">
                <td class="mpp-model">
                  <span class="mono mpp-model__id" :title="m.id">{{ m.id }}</span>
                  <span v-if="m.label && m.label !== m.id" class="mpp-desc" :title="m.label">{{ m.label }}</span>
                  <span
                    v-if="testResults[m.id]"
                    class="mpp-rowtest"
                    :class="{ 'mpp-rowtest--bad': !testResults[m.id].ok }"
                    :title="testResults[m.id].text"
                  >{{ testResults[m.id].ok ? '调用通过' : '调用失败' }}<template v-if="testResults[m.id].latency"> · {{ testResults[m.id].latency }}</template></span>
                </td>
                <td class="mpp-fn">
                  <span v-for="tag in functionTags(m)" :key="tag" class="mpp-fn__chip">{{ tag }}</span>
                  <span v-if="!functionTags(m).length" class="mpp-fn__none">基础对话</span>
                </td>
                <td>
                  <span v-if="cooldownOf(m)" class="mk-badge mk-badge--warn" :title="`已触发熔断冷却，降级时会被跳过（剩余 ${Math.ceil(cooldownOf(m)!.remainingMs / 1000)}s）`">冷却中</span>
                  <span v-else class="mk-badge mk-badge--ok">● 健康</span>
                  <span v-if="modelWarnings(m).length" class="mk-badge mk-badge--warn mpp-label" :title="modelWarnings(m).join('\n')">⚠ {{ warningLabel(m) }}</span>
                </td>
                <td class="mpp-rowacts">
                  <!-- 高频两枚平铺（测试 / 编辑）；删除是低频且不可撤销，收进 ⋯ 菜单
                       ——与公告、账号、虚拟学习者同一套行内操作层级（useRowMenu 同源） -->
                  <button type="button" class="mk-link" :disabled="testingId === m.id" @click="testModel(selected, m.id)">{{ testingId === m.id ? '测试中…' : '测试' }}</button>
                  <button type="button" class="mk-link" :disabled="busy || registry?.readOnly" @click="modelEditor?.openWith({ providerId: selected.id, model: m })">编辑</button>
                  <div class="mk-menu">
                    <button
                      type="button"
                      class="mk-menu__btn"
                      aria-label="更多操作"
                      aria-haspopup="menu"
                      :aria-expanded="openMenu === m.id"
                      @click.stop="toggleMenu(m.id)"
                    >⋯</button>
                    <div v-if="openMenu === m.id" class="mk-menu__pop" role="menu" aria-label="更多操作" :style="popStyle" @click.stop>
                      <button
                        type="button"
                        class="mk-menu__item mk-menu__item--danger"
                        role="menuitem"
                        :disabled="busy || registry?.readOnly"
                        @click="removeModel(m)"
                      >删除</button>
                    </div>
                  </div>
                </td>
                </tr>
              </template>
              <tr v-if="!selected.enabled">
                <td colspan="4" class="mpp-empty">
                  这条通道当前停用，模型不参与路由。
                </td>
              </tr>
              <!-- 基础设施（向量化 / 重排）也在这张表里，由宿主经 #models-infra 注入两组行：
                   与对话模型同一套分组行、列宽与行内动作（2026-10-28 用户「按照对话的样子
                   拆散了，并到对话列表里去」）。 -->
              <slot name="models-infra" />
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { adminApiConfigApi, adminModelProvidersApi } from '@/api/adminApi'
import MkEmptyState from '@/components/mk/MkEmptyState.vue'
import MkLoading from '@/components/mk/MkLoading.vue'
import ModelEditorDialog, { type ModelLike } from './ModelEditorDialog.vue'
import PullModelsDialog from './PullModelsDialog.vue'
import { modelKindOf } from './platformModelKind'
import { askConfirm } from './useConfirm'
import { useRowMenu } from './useRowMenu'
import { errMsg } from './live'

/** 注册表编辑视图（后端 services/admin/model-providers.service.ts 的 ProviderRegistryView） */
interface ProviderView {
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
const testingId = ref('')
/** 单模型测试结果（按模型 id 落在行内，不再用卡上方一条全局结果条） */
const testResults = ref<Record<string, { ok: boolean; latency: string; text: string }>>({})
const router = useRouter()
/** 行内 ⋯ 菜单（低频/危险操作）：与公告、账号、虚拟学习者同一套实现 */
const { openMenu, toggleMenu, popStyle } = useRowMenu()

const modelEditor = ref<InstanceType<typeof ModelEditorDialog> | null>(null)
const pullDialog = ref<InstanceType<typeof PullModelsDialog> | null>(null)
/** 勾选后逐个配置的待办队列（保存一个进下一个；数量用于弹层标题 2/5） */
const configureQueue = ref<string[]>([])
const configureTotal = ref(0)

const providers = computed(() => view.value?.providers ?? [])
/** 目录文件状态（路径/可写/最近一次热重载错误）：模板里多处按它决定是否禁用编辑 */
const registry = computed(() => view.value?.registry ?? null)
/** 这一页只呈现平台通道（2026-10-27 用户「这个区域不要了」）：自建通道不再在页面里切换 */
const selected = computed(() => providers.value.find((p) => p.id === 'platform') ?? null)

/* 2026-10-21 用户「不要了」：卡头 meta 只留可写/只读这个会改变操作的结论，
   数据来源（来自模型目录文件）与生效方式进 title */
const registryMeta = computed(() => {
  const r = view.value?.registry
  if (!r) return ''
  if (r.readOnly) return '只读'
  return '保存即生效'
})
const registryPathTitle = computed(() => {
  const r = view.value?.registry
  if (!r) return ''
  const parts = [`目录文件：${r.path}`]
  if (r.lastError) parts.push(`最近更新失败：${r.lastError}`)
  return parts.join('\n')
})

/** 供应商展示名：文件里的 dev 默认名「平台」不带到界面上——没有平台默认这回事，
    它就是「这个部署当前实际调用的通道」。别的部署给 platform 起了真名就照实显示。 */
function providerName(p: ProviderView): string {
  return p.id === 'platform' && p.name === '平台' ? '平台通道' : p.name
}
/** 通道类型：内置 / 自建。接入通道 = 一个服务地址 + 一套凭据 + 模型清单。 */
function providerTypeLabel(p: ProviderView): string {
  return p.id === 'platform' ? '内置' : '自建'
}
const registeredIds = computed(() => new Set(selected.value?.models.map((m) => m.id) ?? []))
/** 上游模型清单：平台通道的清单来自连接设置（宿主注入） */
const fetchableModels = computed(() => props.upstream)
/** 还能登记进模型清单的对话模型数：拉取结果里已添加的不再计入 */
const pullableCount = computed(() =>
  fetchableModels.value.filter((name) => modelKindOf(name) === 'chat' && !registeredIds.value.has(name)).length
)

const fallbackOptions = computed(() =>
  providers.value.flatMap((p) => p.models.map((m) => `${p.id}/${m.id}`))
)

/** 已登记模型 id 回传宿主（上游清单的关系句由宿主渲染，数据同源一次算） */
function emitRegistered(): void {
  emit('registered', providers.value.flatMap((p) => p.models.map((m) => m.id)))
}

/** 详情头徽标：只出「能不能用」。「用连接设置」这一档返回 null——那句话由下面「连接」段
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
/**
 * 状态列里的告警徽标必须自带一句人话（2026-10-24 用户「警告图标是什么」）：
 * 只有 ⚠ 时没人知道该修什么。当前唯一的告警类型是「未被别名引用」，
 * 其它新增类型统一退回「告警」，细节仍在 title 里。
 */
function warningLabel(m: ModelLike): string {
  const ws = modelWarnings(m)
  return ws.length && ws.every((w) => w.includes('未被任何别名引用')) ? '未被引用' : '告警'
}
/** 未配单价 = 成本分析页这个模型的金额会显示「—」，是可在模型编辑高级设置里补的配置缺口 */
const MODEL_GROUPS = [
  { tier: 'chat' as const, label: '对话' },
  { tier: 'reasoning' as const, label: '推理' }
]
/** 按用途（对话 / 推理）分组；空组不渲染，单组时也保留组头——它就是这个模型的功能归属 */
const modelGroups = computed(() => {
  const models = selected.value?.models ?? []
  return MODEL_GROUPS
    .map((g) => ({ ...g, models: models.filter((m) => m.tier === g.tier) }))
    .filter((g) => g.models.length > 0)
})
/** 模型能力标签：功能列只列「有没有」，用途由分组行表达，不在此复述 */
function functionTags(m: ModelLike): string[] {
  const tags: string[] = []
  if (m.supportsThinking) tags.push('思考')
  if (m.supportsReasoningEffort) tags.push('推理强度')
  if (m.vision) tags.push('读图')
  return tags
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
    emitRegistered()
  }
  writeWarnings.value = warnings
  emit('changed')
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

async function onModelSaved(payload: { modelId: string; warnings: string[] }): Promise<void> {
  const fromQueue = configureQueue.value.length > 0
  if (fromQueue) configureQueue.value = configureQueue.value.filter((id) => id !== payload.modelId)
  await reloadAfterDialog(payload.warnings)
  if (fromQueue) openNextConfigure()
}

/**
 * 弹层保存后：写接口的回吐在弹层里被吃掉了，这里重新拉一次视图（唯一需要再拉一次的场景），
 * 并把告警透传到面板顶部。
 */
async function reloadAfterDialog(warnings: string[]): Promise<void> {
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

/** 打开拉取结果浮窗：清单只用于勾选，不再在详情里铺开 */
function openPull(): void {
  if (!selected.value) return
  if (!fetchableModels.value.length) {
    actionError.value = '还没有拉取到模型'
    return
  }
  pullDialog.value?.openWith()
}

/** 平台通道同步上游清单后直接弹浮窗 */
function openHostPull(): void {
  openPull()
}

/** 手动新增：清掉勾选队列，避免保存后误跳到上一个批次的下一个模型 */
function openManualAdd(): void {
  if (!selected.value) return
  configureQueue.value = []
  configureTotal.value = 0
  modelEditor.value?.openWith({ providerId: selected.value.id, model: null })
}

/** 浮窗确认：按勾选顺序逐个打开模型设置，保存一个自动进下一个 */
function startConfigure(ids: string[]): void {
  if (!selected.value || !ids.length) return
  configureQueue.value = [...ids]
  configureTotal.value = ids.length
  openNextConfigure()
}

/** 连接段常驻在模型表上方：空态里的「去配置连接」滚过去，不再需要切页签 */
function scrollToConn(): void {
  document.getElementById('mpp-platform-panel-conn')?.scrollIntoView?.({ behavior: 'smooth', block: 'start' })
}

function openNextConfigure(): void {
  const id = configureQueue.value[0]
  if (!id || !selected.value) {
    configureQueue.value = []
    configureTotal.value = 0
    return
  }
  const step = configureTotal.value > 1
    ? { index: configureTotal.value - configureQueue.value.length + 1, total: configureTotal.value }
    : undefined
  modelEditor.value?.openWith({ providerId: selected.value.id, model: null, presetId: id, step })
}

/** 跳过剩余：队列清空，已保存的模型保持原样 */
function skipRemaining(): void {
  configureQueue.value = []
  configureTotal.value = 0
  modelEditor.value?.close?.()
}

/** 模型弹窗被关掉（取消/ESC/遮罩）：队列没有续接入口，直接清空避免「还剩 N 个」常挂 */
function onEditorClosed(): void {
  configureQueue.value = []
  configureTotal.value = 0
}

/** 非对话模型的去向：向量化 / 重排在本页「基础设施」段，生图/决策在插件页 */
function onPullNavigate(target: 'infra' | 'plugins'): void {
  if (target === 'plugins') {
    void router.push('/admin/addons')
    return
  }
  document.getElementById('mpp-platform-panel-infra')?.scrollIntoView?.({ behavior: 'smooth', block: 'start' })
}

onMounted(() => {
  void refresh()
})

defineExpose({ refresh, openPull, openHostPull })
</script>

<style scoped>
.mpp-alert { margin: 8px 14px 0; }
.mpp-note {
  margin: 8px 14px 0;
  color: var(--mk-muted);
  font-size: var(--mk-fs-micro);
}
/* 2026-10-27 用户「这个区域不要了」：左栏通道清单撤掉后，详情独占整卡宽度。
   2026-10-27 拆成两张卡后组件有多个根，宿主页的 `.ac-conn-body > .mpp` 不再命中原语，
   卡片自身给「不收缩」；接入卡只剩地址与密钥，高度随内容。 */
.mpp { display: flex; flex-direction: column; flex: none; }
.mpp-body {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 0;
  border-top: 1px solid var(--mk-line);
  flex: 1 1 auto;
  min-height: 0;
}
.mpp-detail { padding: 12px 16px 16px; min-width: 0; overflow-y: auto; }
/* 接入卡里只剩连接段：紧跟卡头，不再重复顶线。 */
.mpp-detail > #mpp-platform-panel-conn > .ac-conn { margin-top: 0; padding-top: 0; border-top: 0; }

/* 2026-10-27 两张卡：接入 API（连接）/ 平台配置（模型清单 + 基础设施 + 生成默认）。
   配置卡按内容自然撑高；模型清单作为第一段，不再自带顶线。 */
.mpp-config { flex: none; }
.mpp-config__body { display: grid; gap: 18px; padding: 12px 16px 16px; }
.mpp-config__body > div { min-width: 0; }
.mpp-config__body > #mpp-platform-panel-models { margin-top: 0; padding-top: 0; border-top: 0; }
/* 详情分区：连接 / 模型清单 / 上游，三块同一套标题 + 发丝线节奏（v4：1px 发丝线分隔） */
.mpp-block { margin-top: 14px; padding-top: 12px; border-top: 1px solid var(--mk-line); }
.mpp-block:first-of-type { margin-top: 10px; }
/* 卡头左组：通道名 + 类型 + 连接状态（2026-10-27 由详情头并入卡头） */
.mpp-head__id { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; min-width: 0; }
/* 通道类型：平台内置 / 自建通道 */
.mpp-type {
  padding: 1px 7px;
  border-radius: 999px;
  background: var(--mk-surface-2);
  color: var(--mk-muted);
  font-size: var(--mk-fs-micro);
  font-weight: 600;
  line-height: 1.5;
}
.mpp-type--platform {
  background: color-mix(in srgb, var(--mk-blue) 10%, transparent);
  color: var(--mk-blue);
}
.mpp-models { margin-top: 14px; padding-top: 12px; border-top: 1px solid var(--mk-line); }
.mpp-models__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 12px;
  margin-bottom: 8px;
}
/* 计数与上游清单状态同一行：两个都弱化，动作按钮仍独占右侧 */
.mpp-models__title { display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; min-width: 0; }
.mpp-models__acts { display: inline-flex; gap: 6px; flex-wrap: wrap; }
.mpp-sec { font-size: var(--mk-fs-body); }
/* 上游清单已移入 PullModelsDialog（2026-10-24 用户「拉取作为浮窗」），详情区只留已登记模型表 */
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
.mpp-model { min-width: 180px; }
.mpp-model__id { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mpp-rowtest { display: block; margin-top: 2px; color: var(--mk-green); font-size: var(--mk-fs-micro); }
.mpp-rowtest--bad { color: var(--mk-red); }
/* 空模型时的下一步：一句话 + 一个动作，不丢一张只有表头的空表 */
.mpp-setup {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
  margin: 4px 0 12px;
  padding: 12px 14px;
  border: 1px dashed var(--mk-line);
  border-radius: var(--mk-radius-md);
  background: var(--mk-surface-2);
}
.mpp-setup__text { display: grid; gap: 4px; min-width: 0; }
.mpp-setup__text strong { font-size: var(--mk-fs-body); color: var(--mk-ink); }
.mpp-setup__text span { font-size: var(--mk-fs-micro); line-height: 1.5; color: var(--mk-muted); }
/* 功能分组行：一张表里切段（对话 / 推理）。2026-10-27 去掉说明句后压成一条窄带，
   只留「分组名 + 条数」——它是分节线，不该占一个正文行的高度（仍守住 40px 下限）。 */
.mpp-table tbody .mpp-group td {
  height: 40px;
  background: var(--mk-surface-2);
  border-top: 1px solid var(--mk-line);
}
.mpp-group__name { font-size: var(--mk-fs-micro); font-weight: 700; color: var(--mk-ink); }
.mpp-group__count { margin-left: 6px; font-size: var(--mk-fs-micro); color: var(--mk-faint); font-variant-numeric: tabular-nums; }
/* 功能列：能力标签；「基础对话」是缺省态，弱化成正文色不抢眼。
   标签允许换行——窄档功能列只有百来像素，nowrap 会把整表宽度顶出去。 */
.mpp-fn { white-space: normal; min-width: 88px; }
.mpp-fn__chip {
  display: inline-block; margin-right: 4px; margin-bottom: 2px; padding: 1px 7px;
  border-radius: 999px; background: var(--mk-blue-bg);
  font-size: var(--mk-fs-micro); font-weight: 700; color: var(--mk-blue);
  white-space: nowrap;
}
.mpp-fn__none { font-size: var(--mk-fs-micro); color: var(--mk-faint); }
.mpp-rowacts { display: flex; align-items: center; gap: 8px; white-space: nowrap; }
.mpp-empty { color: var(--mk-muted); font-size: var(--mk-fs-micro); }
.mpp-queue {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 16px;
  border-top: 1px solid var(--mk-line);
  font-size: var(--mk-fs-micro);
  color: var(--mk-muted);
}
</style>
