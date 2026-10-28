<template>
  <div class="mk-page mk-page--fill ac-host">
    <MkPageHead title="模型与接入">
      <template #actions>
        <button type="button" class="mk-btn mk-btn--sm" @click="providersRef?.refresh?.(true)">刷新注册表</button>
      </template>
    </MkPageHead>
    <!-- 页首 KPI 带已撤（2026-10-14 用户拍板「模型与接入的 kpi 也不要了」）：原两处带
         都是把下方卡里已有的读数抄一遍——密钥在连接页签（API Key 行的「留空 = 沿用已配置」
         + 连接徽标）、模型清单在模型页签、默认模型在生成参数页签。
         撤带后这些事实各有唯一出口，页首只留页名与主操作。 -->

    <!-- 单页（2026-10-26 用户「我不知为啥还要有默认设置。不就是配置的模型吗，这个页面我觉得
         可以和前面的合并了」）：一级页签「接入 / 调用」撤除，本页自上而下两段——
         ① 供应商面板：左列表 / 右详情；平台详情的二级页签 = 模型 / 连接 / 基础设施 / 生成参数
         ② 调用策略（尝试与降级、退避与超时、平台出站速率 + 近 1 小时 429 / 冷却读数）
         「平台默认生成参数」并进平台详情第四个页签：它就是「这些模型默认怎么生成」，
         与模型表是同一个对象，此前单独一张卡叫「平台默认生成参数」，读起来像另一套设置。
         旧键 ?tab=routing / runtime / model-routing 仍归一到这里（TAB_ALIAS），书签不失效。 -->
    <div class="ac-tab-body ac-conn-body" id="ac-panel-access">
      <!-- 接入域（live 层）读取失败：表单全空不得伪装成「未配置」，显式失败 + 重试 -->
      <div v-if="apiConfigFailed" class="mk-alert mk-alert--row" role="alert">
        <span class="mk-alert__msg">配置读取失败：为空不代表未配置</span>
        <button type="button" class="mk-alert__btn" @click="retryApiConfigLoad">重试</button>
      </div>
      <ModelProvidersPanel
        ref="providersRef"
        :upstream="models"
        @registered="onProvidersRegistered"
      >
        <!-- 2026-10-27 用户「这个重新设计，可以先放到第三个」：通道身份、连接状态与动作
             统一收到卡头一行。2026-10-28：连接编辑收进弹层，卡头只留「获取模型」。 -->
        <template #head-status>
          <span class="mk-badge" :class="connBadge.cls" :title="connBadgeTitle">{{ connBadge.text }}</span>
        </template>
        <template #head-actions>
          <div class="ac-conn__acts">
            <!-- 接入流程第 2 步：用这条通道的地址与密钥获取模型。
                 成功后连接一并落盘，不再要求先点「保存连接」。 -->
            <button
              type="button"
              class="mk-btn mk-btn--sm"
              :disabled="fetching || !providersReady"
              @click="onFetchClick"
            >
              <MkLoading v-if="fetching" inline text="获取中…" />
              <span v-else>{{ models.length ? '重新获取模型' : '获取模型' }}</span>
            </button>
          </div>
        </template>
        <template #platform-detail>
          <!-- 卡面不再裸露连接表单：一行摘要回答「连的是哪、密钥有没有、重试怎么配」，
               所有编辑进「连接设置」弹层，一次保存。 -->
          <div class="ac-conn-summary">
            <span class="ac-conn-summary__url mono" :title="form.apiUrl">{{ form.apiUrl || '未配置服务地址' }}</span>
            <span class="mk-badge" :class="keySet ? 'mk-badge--ok' : 'mk-badge--warn'">
              {{ keySet ? '密钥已配置' : '未配置密钥' }}
            </span>
            <span v-if="reliability" class="ac-conn-summary__policy" :title="policyTitle">
              重试 {{ reliability.maxUpstreamAttempts }} 次 · 间隔 {{ reliability.retryBaseDelayMs }}ms · RPM {{ reliability.platformRpmLimit || '不限' }}
            </span>
            <button type="button" class="mk-link ac-conn-summary__edit" @click="openConnModal">连接设置</button>
          </div>

          <!-- 调用策略读取失败仍在卡面提示；重试预算告警跟着参数走，只在连接设置弹层里出现 -->
          <div v-if="isLive && configLoadFailed && !reliability" class="ac-policy ac-policy--inline">
            <div class="mk-alert mk-alert--row ac-config-error" role="alert">
              <span class="mk-alert__msg">配置读取失败</span>
              <button type="button" class="mk-alert__btn" @click="retryConfigLoad">重试</button>
            </div>
          </div>
        </template>

        <!-- 上游读数不常驻（2026-10-28 用户「文案不要」）：只留异常与未保存两种需要处理的状态 -->
        <template #models-meta>
          <p v-if="(fetchError && !models.length) || hasUnsavedModels" class="ac-models-meta ac-models__line">
            <span v-if="fetchError && !models.length" :title="`错误原文：${fetchError}`">获取失败，请检查服务地址与密钥</span>
            <span v-if="hasUnsavedModels" class="mk-badge mk-badge--warn">未保存</span>
          </p>
        </template>
      </ModelProvidersPanel>

      <!-- 2026-10-28 用户「按能力角色拆成三个独立卡片」：向量 / 重排不再嵌在对话卡里，
           各自一张卡、各自一套连接（默认复用主通道，也可独立端点）。 -->
      <InfraModelsPanel />

    </div>

    <!-- 连接设置：地址 / 密钥 / 重试 / RPM 全部收进弹层，卡面只留摘要。
         一次「保存」同时写连接与调用策略，不再有分段保存钮。 -->
    <Teleport to="body">
      <div v-if="connOpen" ref="connMaskRef" class="mk-modal">
        <div ref="connPanelRef" class="mk-modal__panel ac-conn-modal" role="dialog" aria-label="连接设置">
          <div class="mk-modal__head">
            <h3 class="mk-modal__title">连接设置</h3>
            <button type="button" class="mk-modal__close" aria-label="关闭" @click="cancelConnModal">✕</button>
          </div>
          <div class="mk-modal__body">
            <label class="mk-field">
              <span class="mk-field__label">服务地址</span>
              <input class="mk-field__input" v-model="form.apiUrl" placeholder="https://api.example.com/v1" @input="markDirty('conn')" />
            </label>
            <label class="mk-field">
              <span class="mk-field__label">API Key</span>
              <span class="ac-key-wrap">
                <span class="ac-key-input-row">
                  <input
                    class="mk-field__input"
                    :type="keyVisible ? 'text' : 'password'"
                    v-model="form.apiKey"
                    autocomplete="new-password"
                    :placeholder="keySet ? '留空 = 沿用已配置' : '输入 API Key'"
                    @input="markDirty('conn')"
                  />
                  <button
                    v-if="keySet || form.apiKey"
                    type="button"
                    class="ac-key-toggle"
                    :title="keyVisible ? '隐藏' : '显示'"
                    @click="keyVisible = !keyVisible"
                  ><Eye v-if="keyVisible" :size="15" :stroke-width="1.75" />
                    <EyeOff v-else :size="15" :stroke-width="1.75" /></button>
                </span>
                <em v-if="keyHintNeeded" class="ac-keyhint">更换服务地址需重新输入密钥</em>
              </span>
            </label>

            <template v-if="isLive && reliability">
              <div class="ac-conn-modal__policy">
                <label class="mk-field">
                  <span class="mk-field__label" title="总尝试上限，含首次调用与改用备用模型">最大重试</span>
                  <input v-model.number="reliability.maxUpstreamAttempts" type="number" min="1" :max="limMax('maxUpstreamAttempts', 10)" class="mk-field__input" @input="markDirty('reliability')" />
                </label>
                <label class="mk-field">
                  <span class="mk-field__label">重试间隔（毫秒）</span>
                  <input v-model.number="reliability.retryBaseDelayMs" type="number" :min="limMin('minRetryBaseDelayMs', 100)" :max="limMax('maxRetryBaseDelayMs', 60000)" step="100" class="mk-field__input" @input="markDirty('reliability')" />
                </label>
                <label class="mk-field">
                  <span class="mk-field__label" title="0 = 不限，超出后排队等待">RPM 上限</span>
                  <input v-model.number="reliability.platformRpmLimit" type="number" min="0" max="100000" step="10" class="mk-field__input" @input="markDirty('reliability')" />
                </label>
              </div>
            </template>

            <div class="ac-conn-modal__test">
              <button type="button" class="mk-btn mk-btn--sm" :disabled="channelTesting" @click="testChannel">
                {{ channelTesting ? '测试中…' : '测试连通性' }}
              </button>
              <span
                v-if="channelResult && channelTestedUrl === form.apiUrl.trim()"
                class="ac-conn__testres"
                :class="{ 'is-bad': !channelResult.ok }"
                :title="channelResult.text"
              >{{ channelResult.ok ? `连通 · ${channelResult.text}` : '连接失败' }}</span>
            </div>

            <div v-if="configLoadFailed && !reliability" class="mk-alert mk-alert--row" role="alert">
              <span class="mk-alert__msg">调用策略读取失败</span>
              <button type="button" class="mk-alert__btn" @click="retryConfigLoad">重试</button>
            </div>
            <div v-if="reliability && fallbackDisabled" class="mk-alert mk-alert--row" role="alert">
              <span class="mk-alert__msg">当前重试预算下「模型降级」永远不会触发：同模型重试会先耗尽尝试次数，请把「最大重试」调大</span>
            </div>
          </div>
          <div class="mk-modal__foot ac-conn-modal__foot">
            <button
              type="button"
              class="mk-btn mk-btn--sm mk-btn--danger-ghost"
              :disabled="resetting"
              @click="resetConfig"
            >{{ resetting ? '重置中…' : '重置此通道' }}</button>
            <span class="ac-conn-modal__spacer"></span>
            <button type="button" class="mk-btn" @click="cancelConnModal">取消</button>
            <button type="button" class="mk-btn mk-btn--primary" :disabled="saving" @click="saveConnModal">
              {{ saving ? '保存中…' : '保存' }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, reactive, ref, watch } from 'vue'
/* Eye 与 EyeOff 成对使用（密钥显隐两态）：此前只导入了 EyeOff，
   点「显示密钥」后切到 <Eye> 是空白图标（f66cd78d 漏了孪生图标，2026-09-29 补） */
import { Eye, EyeOff } from 'lucide-vue-next'
import { onBeforeRouteLeave, useRoute, useRouter } from 'vue-router'
import { dataSource, isLive } from './store'
import ModelProvidersPanel from './ModelProvidersPanel.vue'
import InfraModelsPanel from './InfraModelsPanel.vue'
import {
  liveApiConfig as cfg,
  liveFetchModels,
  liveSaveApiConfig,
  timeAgo,
  errMsg,
  liveFailures,
  loadLiveData
} from './live'
import { adminPlatformSettingsApi, adminApiConfigApi } from '@/api/adminApi'
import { askConfirm } from './useConfirm'
import { useEscape } from './useEscape'
import { useOverlay, useMaskClose } from './useOverlay'
import MkLoading from '@/components/mk/MkLoading.vue'
import MkPageHead from '@/components/mk/MkPageHead.vue'
import { toast } from '@/utils/toast'

/* ---------- 宿主：单页（2026-10-26 用户「我不知为啥还要有默认设置。不就是配置的模型吗，
   这个页面我觉得可以和前面的合并了」）----------
   一级页签「接入 / 调用」撤除，本页自上而下两段：供应商面板 / 调用策略。
   平台那条供应商的详情里再分二级页签：模型 / 连接 / 基础设施 / 生成参数。
   已迁出：虚拟学习者容量 → /admin/virtual-learners；安全与访问 → 运营中心「访问与注册」页签；
   外挂能力 → /admin/addons（2026-10-19）。旧深链一律由 TAB_ALIAS / 路由改投。 */

/** 旧页签键别名归一：站内「配置 →」与量测脚本曾用 ?tab=model / ?tab=registry / ?tab=model-routing。
    2026-10-26 起本页没有一级页签，所有旧键（含 connection / overview / runtime /
    model-routing / virtual-learners）都只是「打开这一页」，归一后清掉 tab 参数，
    书签不 404，也不会在 URL 上留下一个不存在的页签。 */
const LEGACY_TAB_KEYS = new Set([
  'model', 'registry', 'connection', 'overview', 'runtime', 'model-routing', 'virtual-learners',
])
/** 已迁出的旧页签 → 独立页（旧书签直接落到新家，不在本页停一下再让人自己找） */
const MOVED_TABS: Record<string, string> = {
  security: '/admin/access-control',
  virtual: '/admin/virtual-learners',
}
const route = useRoute()
const router = useRouter()
/** 供应商面板（BYOK）：页头「刷新注册表」与写后重取都走它的 refresh */
const providersRef = ref<{ refresh?: (force?: boolean) => void; openHostPull?: () => void } | null>(null)
/** 供应商面板首次回传即视为注册表已就绪：同步按钮按 apiUrl 判禁用，首屏地址未回填时点不动 */
const providersLoaded = ref(false)
function onProvidersRegistered() {
  providersLoaded.value = true
}
/** 注册表已就绪：面板首次回传，或 live 配置已到（首屏未回填地址时按钮不该点不动） */
const providersReady = computed(() => providersLoaded.value || !!cfg.value)
function onFetchClick() {
  if (!providersReady.value || !form.apiUrl) {
    focusPlatformConnection()
    return
  }
  void fetchModels()
}
/* 2026-10-28 用户「表单不要直接裸露」：连接编辑收进弹层，卡面只留一行摘要。
   「获取模型」在地址未就绪时直接打开连接设置。 */
function focusPlatformConnection() {
  openConnModal()
}

/** 注册表读数（只读总览回传）：上游清单与「已添加」的对照只用 models 这一段。
    与生成参数页签的别名映射是同一份接口，不重复请求。 */
watch(
  () => route?.query?.tab,
  (t) => {
    const raw = typeof t === 'string' ? t : ''
    // 已迁出的页签：直接送到新家（旧书签/旧文档链接不失效）
    const moved = MOVED_TABS[raw]
    if (moved) {
      const rest = { ...(route.query as Record<string, string>) }
      delete rest.tab
      void router.replace({ path: moved, query: rest })
      return
    }
    /* 本页已无一级页签（2026-10-26）：旧键（access / routing / model / runtime…）一律清掉，
       只保留「打开这一页」的语义。不认识的键同样清掉，避免 URL 上留一个不存在的页签。 */
    if (raw && (LEGACY_TAB_KEYS.has(raw) || raw === 'access' || raw === 'routing')) {
      const rest = { ...(route.query as Record<string, string>) }
      delete rest.tab
      void router.replace({ query: rest })
    }
  },
  { immediate: true }
)
/* ---------- 表单状态（live 一套交互） ---------- */
/**
 * 接入域（live 层 getConfig）读取失败：表单全空 + 卡内 alert 显式说明「下方为空不代表未配置」。
 * 原实现失败时 keySet/models 全为初始值，读数伪装成确定态「未配置 / 未拉取」——把「读不到」
 * 说成「没配置」，是审计不可接受的假信号。（2026-10-14 页首 KPI 带撤除后，失败态只剩卡内
 * alert 一个出口，该 alert 因此不可省。）失败态由 liveFailures.apiConfig 驱动（live.ts 已导出；
 * 读取成功后自动清除，无需本地维护）。
 */
const apiConfigFailed = computed(() => !!liveFailures.value.apiConfig)
/** 重试：重新走中央加载器拉取 apiConfig 域（liveFetchAt 未落 → 不会被 TTL 缓存跳过） */
function retryApiConfigLoad() {
  void loadLiveData()
}
/* 2026-10-28 用户「这一块彻底不要了」：平台默认与别名（思考模式 / 思考强度 / 输出格式 /
   别名映射）整块撤出。模型级生成参数仍在模型编辑里，平台不再提供一份兜底默认。 */

const form = reactive({
  apiUrl: '',
  apiKey: '',
})
const fetchedModels = ref<string[]>([])
const keySet = ref(false)
const keyVisible = ref(false)
const connectionStatus = ref('unknown')
/** 本次会话内「获取模型」成功的时刻（connBadge「N 前」的时间源优先级高于 DB 落库值） */
const connCheckedAt = ref('')
/** 最近一次「获取模型」的失败原因：展示在模型清单空态，避免错误上下文丢失（刷新即消失） */
const fetchError = ref('')
/** 曾成功拉取过模型列表（含从已保存配置载入）：此后提交才携带 availableModels，避免空数组清空后端列表 */
const modelsFetchedOnce = ref(false)
/** 模型清单的拉取来源端点:与表单地址一致才允许随连接保存 */
const fetchedModelsEndpoint = ref('')
/** 已保存的服务地址：endpoint 被改动且 Key 留空时提示重新输入密钥 */
const savedApiUrl = ref('')

const dirty = ref<Set<string>>(new Set())
/** 正在保存的域（#19）：保存请求在途时，实时配置会因这次保存而回显、触发下方守卫 watch，
 *  而 dirty 要到请求全部返回后才清。守卫据此把在途域排除出「未保存」，避免「保存成功却被
 *  问要不要丢弃未保存修改」的假信号（更坏情况是点「覆盖」丢改动）。 */
const savingGroups = ref<Set<string>>(new Set())
function markDirty(group: string) {
  dirty.value = new Set([...dirty.value, group])
}

/** 脏位分域标注：保存条列出具体未保存组（连接 / 全站策略） */
const DIRTY_GROUP_LABELS: Record<string, string> = {
  conn: '连接',
  reliability: '全站策略'
}
const dirtyGroups = computed(() => [...dirty.value].map((g) => DIRTY_GROUP_LABELS[g] || g))

/* AI 可靠性（live 加载） */
interface Reliability {
  maxUpstreamAttempts: number
  maxTransportRetries: number
  maxLogicalRetries: number
  defaultRequestTimeoutMs: number
  retryBaseDelayMs: number
  maxRetryAfterMs: number
  jitterEnabled: boolean
  platformRpmLimit: number
}
const reliability = ref<Reliability | null>(null)
const configLoadFailed = ref(false)


/** 可靠性设置硬上限(后端 platform settings GET 返回,前端不再自带一套) */
const reliabilityLimits = ref<Record<string, number> | null>(null)
/** 最近一次加载的设置快照:数字输入被清空时保存前回退到该值(后端要求全整数字段) */
const reliabilityBase = ref<Record<string, number | boolean> | null>(null)
function limMax(field: string, fallback: number): number {
  return Number(reliabilityLimits.value?.[field] ?? fallback)
}
function limMin(field: string, fallback: number): number {
  return Number(reliabilityLimits.value?.[field] ?? fallback)
}

/** 当前重试配置下模型降级是否永不触发(executor 守卫语义:1 + 传输重试 < 上游最大尝试) */
const fallbackDisabled = computed(() => {
  const r = reliability.value
  if (!r) return false
  const upstream = Number(r.maxUpstreamAttempts)
  const transport = Number(r.maxTransportRetries)
  if (!Number.isInteger(upstream) || !Number.isInteger(transport)) return false
  return upstream <= 1 || 1 + transport >= upstream
})

async function loadReliability() {
  try {
    const res = await adminPlatformSettingsApi.getReliabilitySettings()
    const s = res.data?.data?.settings ?? res.data?.data ?? {}
    reliability.value = {
      maxUpstreamAttempts: Number(s.maxUpstreamAttempts ?? 3),
      maxTransportRetries: Number(s.maxTransportRetries ?? 1),
      maxLogicalRetries: Number(s.maxLogicalRetries ?? 1),
      defaultRequestTimeoutMs: Number(s.defaultRequestTimeoutMs ?? 600000),
      retryBaseDelayMs: Number(s.retryBaseDelayMs ?? 2000),
      maxRetryAfterMs: Number(s.maxRetryAfterMs ?? 30000),
      jitterEnabled: s.jitterEnabled !== false,
      platformRpmLimit: Number(s.platformRpmLimit ?? 0)
    }
    // 后端 hardLimits 是校验唯一真源:表单 min/max 与保存前的空值回退都以它为准
    reliabilityLimits.value = (res.data?.data?.hardLimits ?? null) as Record<string, number> | null
    reliabilityBase.value = { ...reliability.value }
    configLoadFailed.value = false
  } catch {
    reliability.value = null
    configLoadFailed.value = true
  }
}

/** 配置域重试：可靠性设置是这张卡唯一的配置源 */
function retryConfigLoad() {
  void loadReliability()
}

function applyLiveConfig() {
  if (!cfg.value) return
  form.apiUrl = cfg.value.apiUrl
  form.apiKey = ''
  fetchedModels.value = [...cfg.value.availableModels]
  fetchedModelsEndpoint.value = cfg.value.apiUrl
  keySet.value = cfg.value.apiKeyConfigured
  connectionStatus.value = cfg.value.connectionStatus
  savedApiUrl.value = cfg.value.apiUrl
  modelsFetchedOnce.value = true
  dirty.value = new Set()
}

watch(
  () => [dataSource.value, cfg.value] as const,
  async () => {
    // 全局刷新/数据源切换会用新配置覆盖表单:有未保存修改时先确认,拒绝则保留表单仅刷新后台状态
    // #19：把「正在保存」的域排除在未保存之外——保存带来的配置回显会先于 dirty 清除触发本 watch，
    // 不过滤就会在保存成功那一刻弹「丢弃未保存的配置修改」，把成功呈现成未保存。
    const pendingGroups = [...dirty.value].filter((g) => !savingGroups.value.has(g))
    if (pendingGroups.length > 0) {
      const ok = await askConfirm({
        title: '丢弃未保存的配置修改?',
        message: `配置数据已刷新,继续将覆盖以下未保存的修改:${pendingGroups.map((g) => DIRTY_GROUP_LABELS[g] || g).join(' / ')}。`,
        confirmText: '覆盖'
      })
      if (ok) applyLiveConfig()
    } else {
      applyLiveConfig()
    }
    if (!reliability.value) void loadReliability()
  },
  { immediate: true, deep: true }
)

// 路由离开守卫:与其他管理页(Skill 详情页等)同款,未保存修改不静默丢失
onBeforeRouteLeave(async () => {
  if (dirty.value.size === 0) return true
  const ok = await askConfirm({
    title: '有未保存的配置修改',
    message: `尚未保存的配置组:${dirtyGroups.value.join(' / ')}。离开将丢弃这些修改,确认离开?`,
    confirmText: '丢弃并离开'
  })
  return ok === true
})

function onBeforeUnloadHandler(e: BeforeUnloadEvent) {
  if (dirty.value.size > 0) {
    e.preventDefault()
    e.returnValue = ''
  }
}
window.addEventListener('beforeunload', onBeforeUnloadHandler)
onBeforeUnmount(() => {
  window.removeEventListener('beforeunload', onBeforeUnloadHandler)
})

const models = computed(() => fetchedModels.value)

/**
 * 当前清单是否已落盘（F8-2）：拉取只写本页内存 ref，只有随「保存连接」进 availableModels 才持久化。
 * 判定条件与 saveGroups 的归属规则（`fetchedModelsEndpoint === form.apiUrl` 才携带）严格对齐——
 * 即「下一次保存连接会落盘、但后端现值还不是它」时才提示，避免改地址未拉取时误报。
 */
const hasUnsavedModels = computed(() => {
  if (!models.value.length) return false
  if (fetchedModelsEndpoint.value !== form.apiUrl.trim()) return false
  const saved = cfg.value?.availableModels ?? []
  return models.value.length !== saved.length || models.value.some((m, i) => m !== saved[i])
})

/* 2026-10-21 用户走查：平台模型按 Skill 配置，默认路由三行退役（含解析读数与「未登记」警示）。
   2026-10-28 用户「这一块彻底不要了」：平台默认 / 思考 / 结构化输出整块也撤出，
   生成参数只保留在单个模型的编辑里。 */
/* modelListTitle / routeTitle 两个说明 computed 随页首 KPI 带一并删除（2026-10-14）：
   它们只喂过那三块 MkKpi 的 title。对应的诚实性提示改由卡内承接——模型清单卡的
   「本次拉取未保存」徽标 + 持久化说明行、路由行的逐条 title。 */
/* 2026-10-04 状态条退役：页头红/黄/绿基调 statusTone 随状态条整块删除（读取失败信号由
   接入卡内 mk-alert + KPI 卡「—」读数承载，不再有整页基调色） */
const connBadge = computed(() => {
  // 附「N 前」时间戳（P1#32 子集）：状态是上次获取模型时的连接结果，无时间的「连接成功」
  // 会把陈旧快照读成实时健康。时间源 = 本次会话刚获取成功的时刻，否则退回 DB lastCheckedAt
  // （与 connectionStatus 同源；不用健康快照 checkedAt——那是能力探测时间，语义不同）
  const at = connCheckedAt.value || cfg.value?.lastCheckedAt || ''
  if (connectionStatus.value === 'connected') {
    return { cls: 'mk-badge--ok', text: at ? `${timeAgo(at)}连接成功` : '最近连接成功' }
  }
  if (connectionStatus.value === 'failed') return { cls: 'mk-badge--bad', text: '上次连接失败' }
  return { cls: 'mk-badge--muted', text: '还没连接过' }
})
/** connBadge 悬停口径：说明「成功/失败」是什么时候、什么动作留下的，不冒充实时探活 */
const connBadgeTitle = computed(() => {
  const at = connCheckedAt.value || cfg.value?.lastCheckedAt || ''
  const when = at ? `上次连接：${new Date(at).toLocaleString('zh-CN', { hour12: false })}` : '还没有连接记录'
  return `${when}（点「获取模型」时更新）。展示的是上次结果，不是实时探测。`
})

/** 已配置密钥但改了服务地址且 Key 留空：密钥不会随地址迁移，需提示重新输入 */
const keyHintNeeded = computed(
  () => keySet.value && !!form.apiUrl && form.apiUrl !== savedApiUrl.value && !form.apiKey.trim()
)

/* ---------- 操作 ---------- */
const fetching = ref(false)
const saving = ref(false)

/* 通道级连通性测试：只回答「这个地址与密钥通不通」，与模型测试分开口径。
   密钥留空时后端会用已保存的那把（地址未变才回落），前端不接触明文。 */
const channelTesting = ref(false)
const channelResult = ref<{ ok: boolean; text: string } | null>(null)
const channelTestedUrl = ref('')

async function testChannel(): Promise<void> {
  if (channelTesting.value) return
  const apiUrl = form.apiUrl.trim()
  if (!apiUrl) {
    toast.error('先填写服务地址')
    focusPlatformConnection()
    return
  }
  if (keyHintNeeded.value) {
    toast.error('地址已更换，请先重填 API Key')
    return
  }
  channelTesting.value = true
  channelResult.value = null
  try {
    const res = await adminApiConfigApi.testConnection({ apiUrl, apiKey: form.apiKey.trim() })
    const data = res.data?.data ?? {}
    const count = Number(data.modelsCount ?? 0)
    channelResult.value = { ok: true, text: count ? `${count} 个模型` : '服务可达' }
    channelTestedUrl.value = apiUrl
  } catch (e) {
    channelResult.value = { ok: false, text: errMsg(e) }
    channelTestedUrl.value = apiUrl
  } finally {
    channelTesting.value = false
  }
}

/* ---------- 连接设置弹层：一次保存连接 + 调用策略 ---------- */
const connOpen = ref(false)
const connPanelRef = ref<HTMLElement | null>(null)
const connMaskRef = ref<HTMLElement | null>(null)
const connBackup = ref<{ apiUrl: string; apiKey: string; reliability: Reliability | null } | null>(null)

useEscape(() => connOpen.value, cancelConnModal)
useOverlay(connOpen, connPanelRef)
useMaskClose(connMaskRef, cancelConnModal)

const policyTitle = computed(() => {
  const r = reliability.value
  if (!r) return ''
  return `最大重试 ${r.maxUpstreamAttempts} 次（含首次与备用模型）· 间隔 ${r.retryBaseDelayMs}ms · RPM 上限 ${r.platformRpmLimit || '不限'}`
})

function openConnModal(): void {
  channelResult.value = null
  channelTestedUrl.value = ''
  connBackup.value = {
    apiUrl: form.apiUrl,
    apiKey: form.apiKey,
    reliability: reliability.value ? { ...reliability.value } : null
  }
  connOpen.value = true
}

/** 取消即回滚：弹层里的改动没有旁路，关掉就回到已保存状态。 */
function cancelConnModal(): void {
  const backup = connBackup.value
  if (backup) {
    form.apiUrl = backup.apiUrl
    form.apiKey = backup.apiKey
    if (reliability.value && backup.reliability) Object.assign(reliability.value, backup.reliability)
  }
  dirty.value = new Set([...dirty.value].filter((g) => g !== 'conn' && g !== 'reliability'))
  connOpen.value = false
  connBackup.value = null
}

async function saveConnModal(): Promise<void> {
  if (!form.apiUrl.trim()) {
    toast.error('服务地址不能为空')
    return
  }
  if (keyHintNeeded.value) {
    toast.error('请先重填 API Key 再保存')
    return
  }
  const ok = await saveGroups(['conn', 'reliability'])
  if (!ok) return
  connOpen.value = false
  connBackup.value = null
}

async function fetchModels() {
  if (fetching.value || !form.apiUrl) return
  /* 流程第 1 步要求「填链接和 key」：换地址却没重填密钥时，不能拿旧密钥去试新端点 */
  if (keyHintNeeded.value) {
    toast.error('更换服务地址后需重新输入 API Key')
    return
  }
  fetching.value = true
  try {
    const list = await liveFetchModels(form.apiUrl, form.apiKey)
    fetchedModels.value = list
    fetchedModelsEndpoint.value = form.apiUrl.trim()
    modelsFetchedOnce.value = true
    connectionStatus.value = 'connected'
    connCheckedAt.value = new Date().toISOString()
    fetchError.value = ''
    /* 获取即保存：用户流程是「填地址和 key → 获取模型」，不该再要求点一次保存。
       保存失败时不再往下走——连接没落盘，配好的模型也用不上。 */
    markDirty('conn')
    const saved = await saveGroups(['conn'], { silent: true })
    if (!saved) return
    toast.success(list.length ? `已保存连接，获取到 ${list.length} 个模型` : '已保存连接，但服务未返回模型列表')
    // 拉到的清单直接进入勾选浮窗：选模型 → 逐个配置
    if (list.length) {
      await nextTick()
      providersRef.value?.openHostPull?.()
    }
  } catch (e) {
    connectionStatus.value = 'failed'
    connCheckedAt.value = new Date().toISOString()
    fetchError.value = errMsg(e)
    toast.error(`连接失败：${errMsg(e)}`)
  } finally {
    fetching.value = false
  }
}

/** 按域保存：只提交传入且处于脏状态的域，不动其他未保存改动。
    UI 在每个分段的标题上挂「保存」，调用方传该段对应的域。 */
async function saveGroups(groups: string[], opts: { silent?: boolean } = {}): Promise<boolean> {
  if (saving.value) return false
  const set = new Set(groups.filter((g) => dirty.value.has(g)))
  if (!set.size) return true
  saving.value = true
  savingGroups.value = set
  try {
    // 分域保存:连接与路由各自独立提交(后端 PUT 为 partial 合并语义),
    // 修复「保存路由顺带落盘改了一半的连接」的范围错位
    if (set.has('conn')) {
      const payload: {
        apiUrl: string
        apiKey: string
        availableModels?: string[]
        connectionStatus?: string
        lastCheckedAt?: string
      } = {
        apiUrl: form.apiUrl,
        apiKey: form.apiKey
      }
      // 仅当模型清单来自「当前服务地址」的拉取时才携带,
      // 防止换地址后把上一个服务商的列表挂到新地址(applyLiveConfig 的回显同理按 savedApiUrl 归属)
      if (fetchedModelsEndpoint.value === form.apiUrl.trim()) payload.availableModels = fetchedModels.value
      // 拉取/测试是连接状态的真实来源；随连接域一起落盘，刷新后徽章时间不再回退到旧值
      if (connCheckedAt.value) {
        payload.connectionStatus = connectionStatus.value
        payload.lastCheckedAt = connCheckedAt.value
      }
      await liveSaveApiConfig(payload as Parameters<typeof liveSaveApiConfig>[0])
    }
    if (set.has('reliability') && reliability.value) {
      // 空值容错:v-model.number 清空后是字符串,后端要求全整数字段(400 且不定位)。
      // 保存前回退到最近一次加载值,并写回输入框,所见即所存
      const intOr = (v: unknown, fb: unknown): number => {
        if (typeof v === 'number' && Number.isInteger(v)) return v
        const f = Number(fb)
        return Number.isInteger(f) ? f : 0
      }
      const base = reliabilityBase.value ?? {}
      /* 2026-10-26 界面只露「最大重试」（= maxUpstreamAttempts，含降级跳转的总尝试上限）。
         同模型重试数、超时、退避上限、抖动这几项不再上屏，但必须原样回传库里的现值：
         后端 PUT 是 partial 合并，少传一项就等于把它重置成默认值。
         刻意不把「最大重试」联动到同模型重试数——执行器只在「上游尝试还有余量」时才会
         跳到备用模型，把同模型重试顶到 上游-1 会让降级永远不触发（本卡上面那条告警就是它）。 */
      const sanitized = {
        maxUpstreamAttempts: intOr(reliability.value.maxUpstreamAttempts, base.maxUpstreamAttempts),
        maxTransportRetries: intOr(reliability.value.maxTransportRetries, base.maxTransportRetries),
        maxLogicalRetries: intOr(reliability.value.maxLogicalRetries, base.maxLogicalRetries),
        defaultRequestTimeoutMs: intOr(reliability.value.defaultRequestTimeoutMs, base.defaultRequestTimeoutMs),
        retryBaseDelayMs: intOr(reliability.value.retryBaseDelayMs, base.retryBaseDelayMs),
        maxRetryAfterMs: intOr(reliability.value.maxRetryAfterMs, base.maxRetryAfterMs),
        platformRpmLimit: intOr(reliability.value.platformRpmLimit, base.platformRpmLimit),
        jitterEnabled: reliability.value.jitterEnabled !== false
      }
      Object.assign(reliability.value, sanitized)
      await adminPlatformSettingsApi.updateReliabilitySettings(sanitized)
    }
    // 只清除本次已保存的域，保留其他未保存改动（探针为热生效开关，不走统一保存条）
    dirty.value = new Set([...dirty.value].filter((g) => !set.has(g)))
    if (!opts.silent) toast.success('配置已保存并生效')
    return true
  } catch (e) {
    toast.error(`保存失败：${errMsg(e)}`)
    return false
  } finally {
    saving.value = false
    savingGroups.value = new Set()
  }
}

/* 重置接入配置：后端 POST /admin/api-config/reset 只删 platform_api_configs 一行
   （服务地址 / 密钥 / 模型清单 / 平台默认生成参数），不动全站策略与访问策略。高风险不可撤销，走二次确认。 */
const resetting = ref(false)
async function resetConfig() {
  if (resetting.value) return
  const ok = await askConfirm({
    title: '重置平台通道的接入配置',
    message: '将删除平台通道已保存的服务地址、API Key、模型清单与平台默认生成参数。此操作不可撤销。',
    confirmText: '确认重置'
  })
  if (!ok) return
  resetting.value = true
  try {
    await adminApiConfigApi.resetConfig()
    await loadLiveData(true)
    await loadReliability()
    dirty.value = new Set()
    connOpen.value = false
    connBackup.value = null
    toast.success('配置已重置为默认值')
  } catch (e) {
    toast.error(`重置失败：${errMsg(e)}`)
  } finally {
    resetting.value = false
  }
}

</script>

<style scoped>
/* ================= 宿主布局（单页：内容内滚，嵌入子页占满剩余高度） ================= */
/* 内容在宿主 flex 列内独立滚动（页头固定；底部保存条 sticky 于滚动容器） */
.ac-tab-body {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  display: grid;
  gap: 12px;
  align-content: start;
}
/* 子组件根节点（.mk-page--fill + 父级 scope 属性）：占满剩余高度 */
.ac-host > .mk-page--fill { flex: 1 1 auto; min-height: 0; }

/* 接入页 = 供应商面板一张卡（连接与基础设施在平台详情页签里），按内容高度自上而下，页签体统一内滚。
   2026-10-25 用户「这个组整个页面我觉得做的不好」：此前供应商卡被设成 flex:1 吃掉整屏剩余高度，
   而它只有 2 个供应商 / 3 个模型，卡内下方 600px 全是空白——满高工作台适合长表，
   不适合这张会随注册表变短的清单。改为按内容占高：内容多就长、内容少就短，不留假空白。 */
.ac-conn-body {
  display: flex;
  flex-direction: column;
  gap: 12px;
  overflow-y: auto;
  overflow-x: hidden;
}
/* 置顶告警（接入域读取失败）横跨全部列，不占卡位把卡片挤换行 */
.ac-conn-body > .mk-alert { grid-column: 1 / -1; }
/* 卡面连接摘要（2026-10-28 用户「表单不要直接裸露」）：一行回答连到哪、密钥是否就绪、
   重试怎么配；地址 / 密钥 / 策略的编辑都在「连接设置」弹层里，一次保存。 */
.ac-conn-summary {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  padding: 10px 0 2px;
  font-size: var(--mk-fs-micro);
}
.ac-conn-summary__url {
  color: var(--mk-ink);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ac-conn-summary__policy { color: var(--mk-muted); }
.ac-conn-summary__edit { margin-left: auto; }
/* 连接块头右组：获取模型 */
.ac-conn__acts { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; justify-content: flex-end; }

/* 连接设置弹层 */
.ac-conn-modal { width: min(560px, 94vw); }
.ac-conn-modal__policy {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}
@media (max-width: 640px) {
  .ac-conn-modal__policy { grid-template-columns: minmax(0, 1fr); }
}
.ac-conn-modal__test { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.ac-conn-modal__foot { display: flex; align-items: center; gap: 8px; }
.ac-conn-modal__spacer { flex: 1 1 auto; }

.ac-key-wrap { display: grid; gap: 4px; min-width: 0; }
.ac-key-input-row { display: flex; align-items: center; gap: 6px; }
.ac-key-input-row .mk-field__input { flex: 1; min-width: 0; }
.ac-key-toggle {
  flex-shrink: 0;
  border: 1px solid var(--mk-line);
  background: #fafbfc;
  border-radius: var(--mk-radius-sm);
  width: 32px;
  height: 32px;
  font-size: var(--mk-fs-body);
  line-height: 1;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s ease, border-color 0.15s ease;
}
.ac-key-toggle:hover { background: var(--mk-hover-surface); border-color: var(--mk-blue, #2f6ae0); }
.ac-keyhint {
  font-size: var(--mk-fs-micro);
  color: var(--mk-amber);
  font-weight: 600;
  font-style: normal;
  white-space: normal;
}
.ac-conn__testres {
  font-size: var(--mk-fs-micro);
  color: var(--mk-green);
  white-space: nowrap;
}
.ac-conn__testres.is-bad { color: var(--mk-red); font-weight: 600; }

/* 上游清单关系句（2026-10-16 用户走查重排）：原 30+ 枚模型胶囊（.ac-models/.ac-model）退役——
   与下方登记表并列成两份模型名单，被读成「同一件事说两遍」。现在只说关系，逐个名字在登记表折叠里。 */
.ac-models__line { margin: 0; font-size: var(--mk-fs-micro); color: var(--mk-muted); line-height: 1.6; }
/* 上游对齐条（2026-10-20 从连接块搬进模型清单块）：嵌在模型标题行里只占一行读数，
   与「模型 N 个」并排（2026-10-24 走查：不再在表头之上单起一行） */
.ac-models-meta {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 8px;
  margin: 0;
}
/* 调用策略异常（只在真有问题时出现） */
.ac-policy {
  display: grid;
  gap: 18px;
  padding-top: 14px;
}
.ac-policy--inline {
  margin-top: 18px;
  padding-top: 14px;
  border-top: 1px solid var(--mk-line);
  gap: 10px;
}


/* ========== 大屏/4K 适配（全站 mk 体系档位：≥2000px 字号放大；zoom 档 ≥2800px→1.15、≥3600px→1.3） ========== */
@media (min-width: 2000px) {
  .mk-field__label { font-size: var(--mk-fs-micro); }
  .mk-seg { border-radius: 12px; }
  .mk-seg__item { font-size: var(--mk-fs-micro); padding: 8px 14px; }
}
@media (min-width: 2800px) {
  /* zoom 1.15 档：字号继续放大 */
  .mk-field__label { font-size: var(--mk-fs-micro); }
  .mk-seg__item { font-size: var(--mk-fs-micro); padding: 9px 16px; }
}
@media (min-width: 3600px) {
  /* 4K（zoom 1.3 档）：字号继续放大，与页面基线对齐 */
  .mk-field__label { font-size: var(--mk-fs-body); }
  .mk-seg__item { font-size: var(--mk-fs-body); padding: 11px 19px; }
}

/* ================= 暗色模式（D1 补完）：模型与接入 ================= */
html[data-theme='dark'] {
  .ac-key-toggle:hover { background: color-mix(in srgb, var(--wf-color-primary) 14%, transparent); }
  /* 补漏：密钥切换钮浅底（模型胶囊随清单胶囊退役，2026-10-16） */
  .ac-key-toggle { background: #232325; color: var(--mk-muted); }
}
</style>
