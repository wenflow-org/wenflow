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
         平台通道 + 平台内置 + 连接状态，右侧是写盘状态与本页动作；详情里不再单起一行标题。
         2026-10-28 三卡重构：本卡只负责「对话与推理模型」这一类能力，连接参数仍是平台通道。 -->
    <div class="mk-card__head">
      <div class="mpp-head__id">
        <h3 class="mk-card__title">对话与推理模型</h3>
        <span class="mpp-type mpp-type--platform" :title="registryPathTitle">LLM</span>
        <!-- 宿主注入的连接状态（「连接正常 · N 前」）：与通道身份同一行 -->
        <slot v-if="selected" name="head-status" />
        <slot name="models-meta" />
        <span v-if="headBadge" class="mk-badge" :class="headBadge.cls">{{ headBadge.label }}</span>
      </div>
      <div class="mk-card__head-right">
        <button v-if="registry?.readOnly" type="button" class="mk-btn mk-btn--sm mk-btn--danger" disabled title="配置文件所在目录不可写，请在部署侧开放写权限">
          只读
        </button>
        <!-- 宿主动作（获取模型）：与通道状态同一行 -->
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
             模型清单与下方向量 / 重排配置区在同一张卡的下半段，见 mpp-models。 -->
        <div id="mpp-platform-panel-conn">
          <slot name="platform-detail" />
        </div>

        <!-- 2026-10-28 用户「两个卡片合成一个卡片」：模型清单并入平台通道卡，
             连接段与模型表之间只留一条发丝线，不再另起「平台配置」卡。 -->
        <div
          id="mpp-platform-panel-models"
          class="mpp-block mpp-models"
        >
          <!-- 2026-10-28 用户「合并为一个强动作入口」：不再并列「选择要添加」与「添加模型」，
               上游有待选时按钮直接带上数量；没有上游清单时才落到手动录入。 -->
          <div class="mpp-models__head">
            <div class="mpp-models__title">
              <span class="mpp-sec">挂载模型</span>
              <span class="mpp-models__count">{{ selected.models.length }} 个</span>
            </div>
            <span class="mpp-models__acts">
              <button type="button" class="mk-btn mk-btn--sm" :disabled="busy || registry?.readOnly" @click="openAdd">
                ＋ 添加模型<template v-if="pullableCount">（上游有 {{ pullableCount }} 个待选）</template>
              </button>
            </span>
          </div>

          <!-- 上游清单不再铺在详情里（2026-10-24 用户「拉取作为浮窗」）：拉取只拿到清单，
               勾选在 PullModelsDialog 里做——详情区只留已登记模型这张表。 -->

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

          <!-- 对话模型列表（2026-10-28 用户「喜欢下面的设计」）：与向量 / 重排区同一套
               「身份 + 状态 + 行内动作」语言，不再用带列头的表格。 -->
          <div v-if="selected.models.length" class="mpp-models__list">
            <div v-for="m in selected.models" :key="m.id" class="mpp-model-row">
              <div class="mpp-model-row__main">
                <div class="mpp-model-row__idline">
                  <span class="mono mpp-model-row__id" :title="m.id">{{ m.id }}</span>
                  <span v-for="tag in functionTags(m)" :key="tag" class="mpp-fn__chip">{{ tag }}</span>
                </div>
                <span
                  v-if="testResults[m.id]"
                  class="mpp-rowtest"
                  :class="{ 'mpp-rowtest--bad': !testResults[m.id].ok }"
                  :title="testResults[m.id].text"
                >{{ testResults[m.id].ok ? '调用通过' : '调用失败' }}<template v-if="testResults[m.id].latency"> · {{ testResults[m.id].latency }}</template></span>
              </div>
              <div class="mpp-model-row__status">
                <span v-if="cooldownOf(m)" class="mk-badge mk-badge--warn" :title="`已触发熔断冷却，降级时会被跳过（剩余 ${Math.ceil(cooldownOf(m)!.remainingMs / 1000)}s）`">冷却中</span>
                <span v-else class="mk-badge mk-badge--ok">● 健康</span>
                <span v-if="modelWarnings(m).length" class="mk-badge mk-badge--warn mpp-label" :title="modelWarnings(m).join('\n')">⚠ {{ warningLabel(m) }}</span>
              </div>
              <div class="mpp-rowacts">
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
              </div>
            </div>
          </div>
          <p v-if="!selected.enabled" class="mpp-empty">
            这条通道当前停用，模型不参与路由。
          </p>
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
      @confirm="addSelected"
      @manual="openManualAdd"
    />
    <ModelEditorDialog ref="modelEditor" :fallback-options="fallbackOptions" @saved="onModelSaved" />
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { adminApiConfigApi, adminModelProvidersApi } from '@/api/adminApi'
import MkEmptyState from '@/components/mk/MkEmptyState.vue'
import MkLoading from '@/components/mk/MkLoading.vue'
import ModelEditorDialog, { type ModelLike } from './ModelEditorDialog.vue'
import PullModelsDialog from './PullModelsDialog.vue'
import { inferModelCapabilities } from './modelCapabilityInference'
import { askConfirm } from './useConfirm'
import { useRowMenu } from './useRowMenu'
import { errMsg } from './live'
import { toast } from '@/utils/toast'

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
/** 行内 ⋯ 菜单（低频/危险操作）：与公告、账号、虚拟学习者同一套实现 */
const { openMenu, toggleMenu, popStyle } = useRowMenu()

const modelEditor = ref<InstanceType<typeof ModelEditorDialog> | null>(null)
const pullDialog = ref<InstanceType<typeof PullModelsDialog> | null>(null)

const providers = computed(() => view.value?.providers ?? [])
/** 目录文件状态（路径/可写/最近一次热重载错误）：模板里多处按它决定是否禁用编辑 */
const registry = computed(() => view.value?.registry ?? null)
/** 这一页只呈现平台通道（2026-10-27 用户「这个区域不要了」）：自建通道不再在页面里切换 */
const selected = computed(() => providers.value.find((p) => p.id === 'platform') ?? null)

/* 2026-10-21 用户「不要了」：卡头不再挂数据来源 / 生效方式；路径与最近错误进 LLM 徽标 title */
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
const registeredIds = computed(() => new Set(selected.value?.models.map((m) => m.id) ?? []))
/** 上游模型清单：平台通道的清单来自连接设置（宿主注入） */
const fetchableModels = computed(() => props.upstream)
/** 还能登记进模型清单的模型数：拉取结果里已添加的不再计入（不再按名字筛用途） */
const pullableCount = computed(() =>
  fetchableModels.value.filter((name) => !registeredIds.value.has(name)).length
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
/** 模型能力标签：能力列只列「有没有」，类型不在这张表里猜 */
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
  await reloadAfterDialog(payload.warnings)
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

/** 单一添加入口：上游有待选就开选择器，否则直接手动录入。 */
function openAdd(): void {
  if (pullableCount.value > 0) openPull()
  else openManualAdd()
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

/** 手动新增（选择器底部的兜底通道） */
function openManualAdd(): void {
  if (!selected.value) return
  modelEditor.value?.openWith({ providerId: selected.value.id, model: null })
}

/**
 * 选择器确认：批量引入，能力标签按模型名推断后随写入落盘。
 * 不再逐个弹配置框——运营勾完即可在列表里直接测试。
 */
async function addSelected(ids: string[]): Promise<void> {
  if (!selected.value || !ids.length) return
  busy.value = true
  actionError.value = ''
  try {
    const models = ids.map((id) => {
      const inferred = inferModelCapabilities(id)
      return {
        id,
        supportsThinking: inferred.supportsThinking,
        supportsReasoningEffort: inferred.supportsReasoningEffort,
        vision: inferred.vision
      }
    })
    const res = await adminModelProvidersApi.addModels(selected.value.id, models)
    adopt(res?.data, res?.data?.warnings ?? [])
    toast.success(`已引入 ${ids.length} 个模型`)
  } catch (e) {
    actionError.value = errMsg(e)
  } finally {
    busy.value = false
  }
}

/** 连接段常驻在模型表上方：空态里的「去配置连接」滚过去，不再需要切页签 */
function scrollToConn(): void {
  document.getElementById('mpp-platform-panel-conn')?.scrollIntoView?.({ behavior: 'smooth', block: 'start' })
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
   2026-10-28 用户「两个卡片合成一个卡片」：接入与模型清单同卡，卡片按内容自然撑高。 */
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
/* 对话模型区标题行：区名 + 条数在左，添加入口在右（2026-10-28 用户「三个区域各自入口」） */
.mpp-models__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 12px;
  margin-bottom: 8px;
}
.mpp-models__title { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; min-width: 0; }
.mpp-sec { font-size: var(--mk-fs-body); }
/* 对话模型区标题行的添加入口 */
.mpp-models__acts { display: inline-flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.mpp-label {
  margin-left: 6px;
  color: var(--mk-muted);
  font-size: var(--mk-fs-micro);
}
/* 对话模型列表：与向量 / 重排配置区同一套「身份 + 状态 + 行内动作」语言，不用列头表格 */
.mpp-models__list { display: grid; }
.mpp-model-row {
  display: flex;
  align-items: center;
  gap: 14px;
  min-height: 52px;
  padding: 8px 0;
  border-bottom: 1px solid var(--mk-line);
}
.mpp-model-row:last-child { border-bottom: 0; }
.mpp-model-row__main { display: grid; gap: 2px; min-width: 0; flex: 1 1 auto; }
.mpp-model-row__idline { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; min-width: 0; }
.mpp-model-row__id { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mpp-model-row__status { display: inline-flex; align-items: center; gap: 6px; flex: none; }
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
/* 对话模型区计数：与区名同一基线，弱化处理 */
.mpp-models__count { font-size: var(--mk-fs-micro); color: var(--mk-faint); font-variant-numeric: tabular-nums; }
/* 能力标签：跟在模型 ID 后面；没有额外能力时留空，不写占位文案 */
.mpp-fn__chip {
  display: inline-block; margin-right: 4px; margin-bottom: 2px; padding: 1px 7px;
  border-radius: 999px; background: var(--mk-blue-bg);
  font-size: var(--mk-fs-micro); font-weight: 700; color: var(--mk-blue);
  white-space: nowrap;
}
.mpp-rowacts { display: flex; align-items: center; gap: 8px; white-space: nowrap; }
.mpp-empty { color: var(--mk-muted); font-size: var(--mk-fs-micro); }
</style>
