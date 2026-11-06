<template>
  <div :class="embedded ? 'ac-host ac-host--embedded' : 'mk-page mk-page--fill ac-host'">
    <!-- 2026-11-03 用户拍板：本页**不做限宽，通栏**（推翻了当天上午按 SPEC §10 加的 .mk-narrow）。
         理由是同页五个页签宽度必须一致——「会话安全」是表格、「数据导出」是三列勾选，
         两者只能通栏；只有本页与「访问与注册」被收到 1200，来回切页签卡片会一宽一窄地跳。 -->
    <!-- 嵌入「系统设置」时页头归宿主，本组件不再自带页头与主操作——与访问与注册嵌入态同一写法。
         2026-11-03：页面级「刷新注册表」按钮从两个页头一并撤除（用户「最右上角那个多余的
         按钮…移入运维工具或合并处理，保持顶部干净」）——它重读的是本机登记文件，与卡片同源，
         现收进卡片右上的图标钮，悬停说明「不向上游拉取」。 -->
    <MkPageHead v-if="!embedded" title="模型与接入" />
    <!-- 页首 KPI 带已撤（2026-10-14 用户拍板「模型与接入的 kpi 也不要了」）：原两处带
         都是把下方卡里已有的读数抄一遍——密钥在连接页签（API Key 行的「留空 = 沿用已配置」
         + 连接徽标）、模型清单在模型页签、默认模型在生成参数页签。
         撤带后这些事实各有唯一出口，页首只留页名与主操作。 -->

    <!-- 单页（2026-10-26 用户「我不知为啥还要有默认设置。不就是配置的模型吗，这个页面我觉得
         可以和前面的合并了」）：一级页签「接入 / 调用」撤除，本页自上而下两段——
         ① 供应商面板：左列表 / 右详情；平台详情的二级页签 = 模型 / 连接 / 基础设施 / 生成参数
         ② 调用策略（尝试与重试、退避与超时、平台出站速率 + 近 1 小时 429 读数）
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
        :default-model="defaultModel"
        :pull-loading="fetching"
        :pull-error="fetchError"
        :pull-stale="pullStale"
        :add-state-line="addStateLine"
        :add-state-line-title="addStateLineTitle"
        @registered="onProvidersRegistered"
        @platform-models="onPlatformModels"
        @fetch-upstream="onFetchClick"
        @add-opened="snapshotConn"
        @add-closed="onAddClosed"
        @set-default="onSetDefault"
        @remove-model="onModelRemoved"
      >
        <!-- 2026-10-27 用户「这个重新设计，可以先放到第三个」：通道身份、连接状态与动作
             统一收到卡头一行。2026-10-28：连接编辑收进弹层，卡头只留「添加模型」。 -->
        <!-- 2026-11-01 外部评审（二轮）：连接状态原挂在卡头标题旁，读起来像下面模型健康状态的
             「父级结论」——通道「未做过连接测试」+ 三个模型绿色「健康」被判成父子打架。
             两者本就不同源（一次「获取模型」的结果 vs 逐模型能力探测），因此把它下移到摘要行，
             与「密钥已配置 / 重试策略」并排，作为通道自身的一条事实。 -->
        <template #head-status />

        <!-- 2026-11-05 用户「连接设置和添加模型合并到一起吧，只保留添加模型」：
             连接的编辑不再有自己的入口，全部搬进「＋ 添加模型」那张弹窗。
             同日再精简（用户「这个区域精简一下，占太多空间，下方的拉取模型是重点」）：
             默认只显示一行摘要，点「修改连接」才展开表单——这张弹窗的正题是下面的清单，
             连接是偶尔改一次的东西，不该常驻占掉三分之一屏。 -->
        <template #add-conn>
          <p v-if="!connOpen" class="ac-conn-summary">
            <span class="mono ac-conn-summary__addr" :title="form.apiUrl || '未配置服务地址'">{{ form.apiUrl || '未配置服务地址' }}</span>
            <span v-if="isLive && reliability" class="ac-conn-summary__policy">重试 {{ reliability.maxUpstreamAttempts }} 次 · {{ reliability.platformRpmLimit > 0 ? `RPM ${reliability.platformRpmLimit}` : 'RPM 不限' }}</span>
          </p>
          <div v-else class="ac-conn-form">
            <div class="ac-conn-pair">
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
            </div>

            <template v-if="isLive && reliability">
              <div class="ac-conn-policy">
                <label class="mk-field">
                  <span class="mk-field__label">最大重试</span>
                  <input v-model.number="reliability.maxUpstreamAttempts" type="number" min="1" :max="limMax('maxUpstreamAttempts', 10)" class="mk-field__input" @input="markDirty('reliability')" />
                  <span class="mk-field__hint">含首次调用，单位为次</span>
                </label>
                <label class="mk-field">
                  <span class="mk-field__label">重试间隔（毫秒）</span>
                  <input v-model.number="reliability.retryBaseDelayMs" type="number" :min="limMin('minRetryBaseDelayMs', 100)" :max="limMax('maxRetryBaseDelayMs', 60000)" step="100" class="mk-field__input" @input="markDirty('reliability')" />
                </label>
                <label class="mk-field">
                  <span class="mk-field__label">RPM 上限</span>
                  <input v-model.number="reliability.platformRpmLimit" type="number" min="0" max="100000" step="10" class="mk-field__input" @input="markDirty('reliability')" />
                  <span class="mk-field__hint">0 表示不限</span>
                </label>
              </div>
            </template>

            <div v-if="configLoadFailed && !reliability" class="mk-alert mk-alert--row" role="alert">
              <span class="mk-alert__msg">调用策略读取失败</span>
              <button type="button" class="mk-alert__btn" @click="retryConfigLoad">重试</button>
            </div>
          </div>
        </template>
        <!-- 危险动作写明作用范围（只清本条通道的接入配置，不动全站策略与其它通道），
             并保留二次确认。它属于「连接」这一段，所以在弹窗的连接段标题右侧。
             旁边的「保存连接」只在有未保存改动时可用：用户点「获取模型 / 重新获取」会连连接
             一起落盘（打开弹窗时那次拉取只读），但只改重试 / RPM 时不发任何请求，需要一个显式出口。 -->
        <template #add-conn-actions>
          <button
            v-if="!connOpen"
            type="button"
            class="mk-link"
            @click="connOpen = true"
          >修改连接</button>
          <template v-else>
            <button
              type="button"
              class="mk-link"
              :disabled="connDirty"
              :title="connDirty ? '还有未保存的改动' : '收起连接设置'"
              @click="connOpen = false"
            >收起</button>
            <button
              v-if="connDirty"
              type="button"
              class="mk-btn mk-btn--sm mk-btn--primary"
              :disabled="saving"
              @click="saveConnFromDialog"
            >{{ saving ? '保存中…' : '保存连接' }}</button>
            <button
              type="button"
              class="mk-btn mk-btn--sm mk-btn--danger-ghost ac-conn__danger"
              :disabled="resetting"
              title="只清本条通道的地址、密钥与模型清单"
              @click="resetConfig"
            >{{ resetting ? '重置中…' : '重置此通道' }}</button>
          </template>
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
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, reactive, ref, watch } from 'vue'
/* Eye 与 EyeOff 成对使用（密钥显隐两态）：此前只导入了 EyeOff，
   点「显示密钥」后切到 <Eye> 是空白图标（f66cd78d 漏了孪生图标，2026-09-29 补） */
import { Eye, EyeOff } from 'lucide-vue-next'
import { onBeforeRouteLeave } from 'vue-router'
import { dataSource, isLive } from './store'
import ModelProvidersPanel from './ModelProvidersPanel.vue'
import InfraModelsPanel from './InfraModelsPanel.vue'
import {
  liveApiConfig as cfg,
  liveFetchModels,
  liveSaveApiConfig,
  liveSetDefaultModel,
  timeAgo,
  errMsg,
  liveFailures,
  loadLiveData
} from './live'
import { adminPlatformSettingsApi, adminApiConfigApi } from '@/api/adminApi'
import { askConfirm } from './useConfirm'
import MkPageHead from '@/components/mk/MkPageHead.vue'
import { toast } from '@/utils/toast'

/* ---------- 宿主：单页（2026-10-26 用户「我不知为啥还要有默认设置。不就是配置的模型吗，
   这个页面我觉得可以和前面的合并了」）----------
   一级页签「接入 / 调用」撤除，本页自上而下两段：供应商面板 / 调用策略。
   平台那条供应商的详情里再分二级页签：模型 / 连接 / 基础设施 / 生成参数。
   已迁出：虚拟学习者容量 → /admin/virtual-learners；外挂能力 → /admin/addons（2026-10-19）。
   2026-11-01 起本页是「系统设置」宿主里的第一个页签（模型与接入），
   旧键（含 ?tab=model / virtual / security / access 等）的改投**全部在路由层**
   （router/index.ts 的 /admin/api-config 别名），本组件不再自己读写 ?tab=：
   组件里那份归一化 watch 会删掉宿主当前合法的页签（它把 access 当旧键清掉、
   把 security / virtual 整页弹走），合并后必须让位给路由。 */

defineOptions({ name: 'ApiConfigPage' })

/* 嵌入「系统设置」时不渲染自己的页头（页头与「刷新注册表」归宿主） */
const props = withDefaults(defineProps<{ embedded?: boolean }>(), { embedded: false })
void props

/** 供应商面板（BYOK）：页头「刷新注册表」与写后重取都走它的 refresh */
const providersRef = ref<{ refresh?: (force?: boolean) => void; openHostPull?: () => void } | null>(null)

/* ---------- 平台默认模型（P0 2026-11-04） ----------
   为什么这里要有：默认模型只认 DB `platform_api_configs.defaultModel`，文件里的 `defaults`
   只是展示（MODEL_GATEWAY_DESIGN.md §0 补记）。2026-10-28 把「平台默认与别名」整块撤出后，
   纯 UI 部署（不写 env AI_MODEL）走完「填地址 → 拉清单 → 挂模型」也没有落点，
   运行时 `router.resolveModel` 直接抛 `AI model is not configured`——流程缺的正是这一步。 */
const defaultModel = computed(() => cfg.value?.defaultModel ?? '')
/** 已挂载的模型 id（面板回传）：默认只能在这些里选，删模型时也用它挑替补 */
const mountedModelIds = ref<string[]>([])

/**
 * 首个挂载模型自动成为平台默认（只在默认为空时兜底一次）。
 * 已有默认绝不改写——默认是「没单独配的 Skill 走哪个」的落点，静默换掉它等于换掉一批技能的行为。
 * 失败不抛给用户：这是兜底便利，不是用户动作；他仍可在模型行的 ⋯ 里手动设。
 */
const defaultSeeded = ref(false)
async function seedDefaultModel(): Promise<void> {
  if (defaultSeeded.value || saving.value) return
  // 连接设置还有未保存改动时先不种：写默认会重拉配置回显，把未保存的连接改动冲掉
  if (dirty.value.has('conn')) return
  if (!cfg.value || defaultModel.value || !mountedModelIds.value.length) return
  if (!cfg.value.apiUrl) return
  defaultSeeded.value = true
  try {
    const first = mountedModelIds.value[0]
    await liveSetDefaultModel({ defaultModel: first })
    toast.success(`已把「${first}」设为平台默认模型`)
  } catch {
    defaultSeeded.value = false
  }
}

/** 显式设默认：连接设置还有未保存改动时先挡下——写默认会重新拉配置回显，
    未保存的连接改动会被「丢弃未保存的配置修改?」拦一次，把一次点击变成一次意外提问。 */
async function onSetDefault(modelId: string): Promise<void> {
  if (saving.value) return
  if (dirty.value.has('conn')) {
    toast.error('连接设置还有未保存的改动，先保存再设默认模型')
    return
  }
  try {
    await liveSetDefaultModel({ defaultModel: modelId })
    toast.success(`平台默认已设为 ${modelId}`)
  } catch (e) {
    toast.error(`设置默认模型失败：${errMsg(e)}`)
  }
}

/** 删掉默认模型后改指下一个可用模型：默认不能指向已不存在的 id，否则调用同样失败 */
async function onModelRemoved(modelId: string): Promise<void> {
  if (modelId !== defaultModel.value) return
  const next = mountedModelIds.value.find((id) => id !== modelId) ?? ''
  try {
    await liveSetDefaultModel({ defaultModel: next })
    toast.success(next ? `原默认模型已删除，平台默认改为 ${next}` : '原默认模型已删除，请另设平台默认模型')
  } catch (e) {
    toast.error(`更新默认模型失败：${errMsg(e)}`)
  }
}

function onProvidersRegistered(): void {
  /* 注册表就绪曾经用来解锁「保存并获取模型」按钮（首屏地址未回填时点不动）。
     合并弹窗后这颗按钮在弹窗里、拉取地址取自连接段，不再需要这个就绪位；
     保留处理器只为槽位契约不变（面板变更时仍会回传）。 */
}

/** 平台通道挂载的模型变更（增删后都会回传）：默认候选跟着它走，空默认时顺手种一个 */
function onPlatformModels(ids: string[]): void {
  mountedModelIds.value = ids
  void seedDefaultModel()
}

/* 2026-11-05 用户「连接设置和添加模型合并到一起吧，只保留添加模型」：
   连接不再有自己的入口与弹层，它成了「添加模型」弹窗的第一段。
   因此这里不再有「先开连接设置填地址」的分支——地址空着也直接发拉取，
   拉取前的校验在 fetchModels 里（地址为空 / 换了地址没重填密钥，都先给一句人话）。 */
function onFetchClick(source: 'open' | 'refetch' = 'refetch') {
  void fetchModels(source)
}

/** 弹窗标题下那行连接读数（原「连接设置」弹层里的两枚徽标）：合并后它是「能不能拉」的唯一读数 */
const addStateLine = computed(
  () => `${keySet.value ? '密钥已配置' : '未配置密钥'} · ${connBadge.value.text}`
)
/** 那行读数的悬停全文：说明「成功/失败」是什么时候、什么动作留下的，不冒充实时探活 */
const addStateLineTitle = computed(() => connBadgeTitle.value)

/** 连接段有未保存改动：用户主动拉清单会连连接一起落盘，但只改重试 / RPM 时得有个显式保存出口 */
const connDirty = computed(() => dirty.value.has('conn') || dirty.value.has('reliability'))

/**
 * 手动保存连接（只改策略、没拉清单时用）。
 * 「换了地址却没重填密钥」在这里也要拦：否则旧密钥会被存到新地址上，
 * 之后每次调用都撞一个不属于它的端点。
 */
async function saveConnFromDialog(): Promise<void> {
  if (!form.apiUrl.trim()) {
    toast.error('服务地址不能为空')
    return
  }
  if (keyHintNeeded.value) {
    toast.error('请先重填 API Key 再保存')
    return
  }
  await saveGroups(['conn', 'reliability'])
}

/** 清单是不是过期：拉来的那批属于另一个地址（换了地址但还没重拉），先用旧的选模型会挂错端点 */
const pullStale = computed(
  () => models.value.length > 0 && fetchedModelsEndpoint.value !== form.apiUrl.trim()
)

/** 宿主（系统设置）的页头「刷新注册表」经此转发，不必去摸供应商面板的子 ref */
defineExpose({ refresh: () => providersRef.value?.refresh?.(true) })

/** 注册表读数（只读总览回传）：上游清单与「已添加」的对照只用 models 这一段。
    与生成参数页签的别名映射是同一份接口，不重复请求。
    2026-11-01：原先这里还有一条 ?tab= 归一化 watch（LEGACY_TAB_KEYS / MOVED_TABS），
    已随「系统设置」合并整体迁到路由层——宿主自己拥有 ?tab=，组件再删改就会冲掉宿主页签。 */
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
    /* 2026-11-02 评审：历史测试结果与「密钥已配置」并排时都用了成功绿，
       18 小时前的快照被读成当前状态。改成中性徽标并把「上次」写进文案，
       绿色只留给「当前成立」的事实（密钥已配置）。 */
    return { cls: 'mk-badge--muted', text: at ? `上次获取模型：${timeAgo(at)}成功` : '上次获取模型：已成功' }
  }
  if (connectionStatus.value === 'failed') return { cls: 'mk-badge--bad', text: '上次获取模型：失败' }
  /* 2026-11-01 外部评审：「还没连接过」与右侧三个模型的绿色「健康」同屏，被读成
     「没连通却健康」的自相矛盾。它讲的其实只是「没点过获取模型 / 测试连接」这一动作，
     不是通道与模型的可用性——文案改成描述动作，缺省态不再冒充连通性结论。
    2026-11-01 五轮评审仍被判「底层没测、上层全绿」：把另一半写进同一枚徽章。
    另一半的准确说法是「已登记 N 个模型在跑」——列表里那枚绿标是运行面读数（未熔断），
    不是探活结论，不能写成「探活正常」。 */
  const alive = models.value.length
  return {
    cls: 'mk-badge--muted',
    text: alive ? `还没获取过清单（${alive} 个模型已在用）` : '还没获取过清单'
  }
})
/** connBadge 悬停口径：说明「成功/失败」是什么时候、什么动作留下的，不冒充实时探活 */
const connBadgeTitle = computed(() => {
  const at = connCheckedAt.value || cfg.value?.lastCheckedAt || ''
  if (!at) {
    return '还没有获取过上游清单。这里只记这一步的结果；模型能不能调由列表里逐模型的「测试」回答。'
  }
  const when = `上次获取：${new Date(at).toLocaleString('zh-CN', { hour12: false })}`
  return `${when}（点「获取模型」时更新）。展示的是上次结果，不是实时探测。`
})

/** 已配置密钥但改了服务地址且 Key 留空：密钥不会随地址迁移，需提示重新输入 */
const keyHintNeeded = computed(
  () => keySet.value && !!form.apiUrl && form.apiUrl !== savedApiUrl.value && !form.apiKey.trim()
)

/* ---------- 操作 ---------- */
const fetching = ref(false)
const saving = ref(false)

/* 通道级「测试连通性」按钮 2026-11-03 撤除（用户「只有模型级别的连通性」）：
   连通性是模型自己的事实——同一个地址上，A 模型能调、B 模型可能没权限或已被上游下线，
   通道级那枚绿勾既盖不住这种差异，又会与列表里逐模型的「测试」读成两套口径。
   现在通道层面只保留一件事：获取上游清单（它本身就要连一次上游），结果就是连接条上那枚读数。 */

/* 2026-11-05 用户「连接设置和添加模型合并到一起吧，只保留添加模型」：
   「连接设置」弹层撤除——它整段成了「添加模型」弹窗的第一段（地址 / 密钥 / 重试 / RPM /
   重置此通道）。快照与回滚因此改挂在那个弹窗的开合上：弹窗打开（opened）记一份已保存的连接，
   关窗（closed）时若还有未保存改动就回到快照，与旧「取消即回滚」同一语义。 */
const connBackup = ref<{ apiUrl: string; apiKey: string; reliability: Reliability | null } | null>(null)
/** 连接段折叠（默认收起：这张弹窗的正题是下面的模型清单）。
 *  没配地址时自动展开——首次部署进来就是要填它；有未保存改动时不许收。 */
const connOpen = ref(false)

function snapshotConn(): void {
  // 每次打开弹窗回到「收起」：没配地址时展开（首次部署就是要填它）
  connOpen.value = !form.apiUrl.trim()
  if (connBackup.value) return
  connBackup.value = {
    apiUrl: form.apiUrl,
    apiKey: form.apiKey,
    reliability: reliability.value ? { ...reliability.value } : null
  }
}

/**
 * 弹窗关闭：把没保存的连接改动退回去（有未保存改动才回滚）。
 * 之所以是**静默回滚**而不是弹「丢弃未保存的修改?」：这两栏只在弹窗里可编辑，关窗就是
 * 用户说的「算了」。已经保存过（拉清单会自动连连接一起落盘，或点了「保存连接」）时
 * dirty 已清空，这里什么都不做——否则会把刚存下去的值又改回开窗前的旧值。
 */
function onAddClosed(): void {
  connOpen.value = false
  const backup = connBackup.value
  connBackup.value = null
  if (!backup) return
  if (!dirty.value.has('conn') && !dirty.value.has('reliability')) return
  form.apiUrl = backup.apiUrl
  form.apiKey = backup.apiKey
  if (reliability.value && backup.reliability) Object.assign(reliability.value, backup.reliability)
  dirty.value = new Set([...dirty.value].filter((g) => g !== 'conn' && g !== 'reliability'))
}

/**
 * 拉一份上游清单。
 *
 * `source === 'open'` 是**打开弹窗时顺带拉的那一次**：它只读——不写连接、不弹成功提示
 * （2026-11-05 用户「为什么每次点开添加模型右上角会这样」，那枚「已保存连接，获取到 36 个模型」
 * 就是每次打开都落盘一次留下的）。只有用户自己点「获取模型 / 重新获取」才把连接一起落盘：
 * 那是「填地址和 key → 获取」这条流程的提交点，选模型顺带改连接不该反过来变成写连接的时机。
 */
async function fetchModels(source: 'open' | 'refetch' = 'refetch'): Promise<void> {
  if (fetching.value) return
  const background = source === 'open'
  /* 合并弹窗后这里是唯一拉取入口，校验必须给话：地址空着点「获取模型」不能毫无反应。
     打开弹窗的那一次不给——首次部署时地址本来就还是空的。 */
  if (!form.apiUrl.trim()) {
    if (!background) toast.error('先填服务地址')
    return
  }
  /* 流程第 1 步要求「填链接和 key」：换地址却没重填密钥时，不能拿旧密钥去试新端点 */
  if (keyHintNeeded.value) {
    if (!background) toast.error('更换服务地址后需重新输入 API Key')
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
    if (!background) {
      /* 获取即保存：用户流程是「填地址和 key → 获取模型」，不该再要求点一次保存。
         保存失败时不再往下走——连接没落盘，配好的模型也用不上。 */
      markDirty('conn')
      const saved = await saveGroups(['conn'], { silent: true })
      if (!saved) return
      toast.success(list.length ? `已保存连接，获取到 ${list.length} 个模型` : '已保存连接，但服务未返回模型列表')
    }
    /* 2026-11-05 合并弹窗：清单换成这次拉到的，勾选面板原地刷新。
       走到这里时弹窗通常已经开着（入口就在弹窗里）；只有宿主从别处触发时才需要开。 */
    await nextTick()
    providersRef.value?.openHostPull?.()
  } catch (e) {
    connectionStatus.value = 'failed'
    connCheckedAt.value = new Date().toISOString()
    fetchError.value = errMsg(e)
    // 打开弹窗时的那次失败不弹提示：弹窗里本来就有一行「连接失败：…」，再弹一遍是同一个事实说两次
    if (!background) toast.error(`连接失败：${errMsg(e)}`)
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
      /* 2026-10-26 界面只露「最大重试」（= maxUpstreamAttempts，本次调用的总尝试上限）。
         同模型重试数、超时、退避上限、抖动这几项不再上屏，但必须原样回传库里的现值：
         后端 PUT 是 partial 合并，少传一项就等于把它重置成默认值。
         刻意不把「最大重试」联动到同模型重试数：两者是各自独立的预算。
         2026-11-04 用户「去掉降级这个功能，不要」：模型降级整条下线，原先「降级永不触发」
         那条告警一并撤除。 */
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

/* 嵌入「系统设置」宿主时：根节点不再是 .mk-page--fill，得自己把剩余高度吃下来，
   否则里面的 .ac-tab-body（flex:1 + overflow-y:auto）没有可解析的父高度，滚动会失效 */
.ac-host--embedded {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
@media (max-width: 900px) {
  .ac-host--embedded { flex: none; min-height: 0; overflow: visible; display: block; }
}

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

/* ---------- 「添加模型」弹窗里的连接段（2026-11-05 用户「连接设置和添加模型合并到一起吧」） ----------
   原来这一整块是独立弹层的正文。搬进弹窗后它排在模型清单之前：
   地址与密钥先填、再往下挑模型，就是用户做这件事的自然顺序。 */
.ac-conn-form { display: grid; gap: 12px; }
/* 收起态：一行摘要（地址 + 策略），高度 ≈ 20px，把纵向空间让给下面的清单 */
.ac-conn-summary {
  display: flex;
  align-items: baseline;
  gap: 12px;
  flex-wrap: wrap;
  margin: 0;
  min-width: 0;
}
.ac-conn-summary__addr {
  min-width: 0;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--mk-ink);
  font-size: var(--mk-fs-micro);
}
.ac-conn-summary__policy { color: var(--mk-muted); font-size: var(--mk-fs-micro); white-space: nowrap; }
/* 地址与密钥并排：竖着排是 242px 里最费的两行 */
.ac-conn-pair { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.ac-conn-policy {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}
/* 三列等宽时两个错位同源于 .mk-field（display:grid 未写 align-content，默认 stretch
   会把自动行拉高填满容器）：
   ① 没有提示行的那一列，多出来的高度全灌进输入框（实测 53px vs 另有提示的 39px）；
   ② 「重试间隔（毫秒）」比另两个标签长，在 163px 栏里折成两行，把输入框顶下 14px。
   所以既要把行钉在顶部，也要让标签不折行——单加 align-items:start 治不了②（2026-11-03 实测）。 */
.ac-conn-policy .mk-field { align-content: start; }
.ac-conn-policy .mk-field__label { white-space: nowrap; }
@media (max-width: 640px) {
  .ac-conn-policy, .ac-conn-pair { grid-template-columns: minmax(0, 1fr); }
}
/* 「重置此通道」在连接段标题右侧：危险动作跟着它作用的那一段走，不混进弹窗统一底栏 */
.ac-conn__danger { white-space: nowrap; }

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


/* ========== 大屏/4K 适配（全站 mk 体系档位：≥2000px 字号放大；zoom 档 ≥2800px→1.15、≥3600px→1.3） ========== */
@media (min-width: 2000px) {
  .mk-field__label { font-size: var(--mk-fs-micro); }
}
@media (min-width: 2800px) {
  /* zoom 1.15 档：字号继续放大 */
  .mk-field__label { font-size: var(--mk-fs-micro); }
}
@media (min-width: 3600px) {
  /* 4K（zoom 1.3 档）：字号继续放大，与页面基线对齐 */
  .mk-field__label { font-size: var(--mk-fs-body); }
}

/* ================= 暗色模式（D1 补完）：模型与接入 ================= */
html[data-theme='dark'] {
  .ac-key-toggle:hover { background: color-mix(in srgb, var(--wf-color-primary) 14%, transparent); }
  /* 补漏：密钥切换钮浅底（模型胶囊随清单胶囊退役，2026-10-16） */
  .ac-key-toggle { background: #232325; color: var(--mk-muted); }
}
</style>
