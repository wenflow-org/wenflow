<template>
  <div class="mk-page sdp">
    <!-- 状态条（与 console 统一的运维简报语言）。
         2026-10-15 迁入外壳：撤页内「← Skill 与提示词」返回钮——返回由壳层面包屑/Esc/
         浏览器后退承担（判例 LearnerDetail「返回入口在壳层顶栏，页内不重复」）。 -->
    <header class="sdp-head">
      <div v-if="overview" class="mk-status" :class="statusToneCls">
        <span class="mk-status__dot"></span>
        <strong class="mk-status__title">{{ overview.displayName || skillId }}</strong>
        <span class="mk-badge" :class="healthBadgeCls">{{ healthLabel }}</span>
        <!-- 阶段色只做色点、不上文字（2026-10-06 审核 / 暗色探针：AGENT_TONES.hue 是拓扑图用的
             原始色（teaching=#2f6ae0），直接当文字色压状态条底合成后只有 2.8:1；色相留在点里，
             文字回到状态条自己的 meta 档，明暗两态都可读 -->
        <span v-if="workbenchMeta?.parentAgent" class="sdp-parent">
          <i class="sdp-parent__dot" :style="{ background: tone.hue }" aria-hidden="true"></i>
          ↑ {{ workbenchMeta.parentAgent.name }}
        </span>
        <span class="mk-status__sep"></span>
        <span
          class="mk-status__meta mono sdp-ellipsis"
          :title="`${overview.agentId}${overview.file ? ' · ' + overview.file.path : ''}`"
        >{{ overview.agentId }}<template v-if="overview.file"> · {{ shortFilePath(overview.file.path) }}</template></span>
        <span v-if="overview.db?.version" class="mk-status__meta">已发布 <b class="mono">v{{ overview.db.version }}</b></span>
        <!-- B19-F7-3：调用/成功率/均耗来自 workbench-meta 的调用日志聚合（range 默认 all）。
             窗口词必须随数字一起出现，否则与工程页签「本版本累计调用」（agent_prompts.useCount）
             同一屏两个数会被读成同一事实。 -->
        <span
          v-if="workbenchMeta?.stats"
          class="mk-status__meta"
          :title="`调用日志聚合统计，窗口：${statsRangeLabel}（工程页签「本版本累计调用」是另一种统计，数值不同）`"
        >
          {{ statsRangeLabel }}调用 <b class="mono">{{ workbenchMeta.stats.totalCalls }}</b>
          · 成功率 <b class="mono">{{ workbenchMeta.stats.successRate ?? '—' }}%</b>
          · 均耗 <b class="mono">{{ fmtMs(workbenchMeta.stats.avgDuration || 0) }}</b>
        </span>
        <span v-if="recentFailures > 0" class="mk-status__meta sdp-bad-text">近 8 条调用 {{ recentFailures }} 条失败</span>
        <span v-if="overview.drift === 'file-vs-db-mismatch'" class="mk-badge mk-badge--warn">{{ TERMS.driftContract }}</span>
        <span class="mk-status__actions">
          <button type="button" class="mk-status__action" :disabled="loading" @click="loadAll">
            {{ loading ? '刷新中…' : '刷新' }}
          </button>
          <button type="button" class="mk-status__action mk-status__action--primary sdp-action-fix" @click="goDryRun">
            试跑
          </button>
        </span>
      </div>
      <div v-else class="mk-status mk-status--muted">
        <span class="mk-status__dot"></span>
        <strong class="mk-status__title">{{ skillId }}</strong>
        <MkLoading v-if="loading" inline />
        <span v-else-if="loadFailed" class="mk-status__meta mk-status__meta--bad">概览加载失败</span>
        <span class="mk-status__actions">
          <button v-if="loadFailed && !loading" type="button" class="mk-status__action" @click="loadAll">重试</button>
        </span>
      </div>
    </header>

    <!-- 漂移警告 -->
    <div v-if="overview?.drift === 'file-vs-db-mismatch'" class="sdp-drift">
      <strong>{{ TERMS.driftContractQualified }}</strong>
      <span>源文件与运行中的 Prompt 不一致</span>
      <code class="mono" :title="overview.file?.path || 'prompts/skill.*.md'">{{ overview.file?.path || 'prompts/skill.*.md' }}</code>
      <span>已发布 v{{ overview.db?.version || '?' }}</span>
      <span>请修改源文件后重新发布</span>
    </div>

    <MkEmptyState
      v-if="notFound"
      :title="`未找到 Skill「${skillId}」`"
      description="它可能未注册或 ID 有误。"
    />

    <template v-if="overview">
      <!-- Tabs（单层 6 tab：协议 / 试跑 / 版本 / 运行时 / 工程 / 字段路由）
           原型 renderSkillDetail 2398-2399 用 .subtabs/.subtab（role=tablist + role=tab + aria-selected）；
           复用共享 MkSubTabs 原语（role=tablist/tab + aria-selected）替代旧 .mk-pills + aria-pressed。 -->
      <MkSubTabs :tabs="tabs" :model-value="tab" id-base="sdp" @update:model-value="onTabSelect" />

      <!-- #128：首次激活才挂载、之后 v-show 保状态——此前 6 页签首屏全挂载，各页 immediate watch
           立即发请求（只看协议也拉试跑/版本/变体/运行时/工程/字段路由，首屏 17 个唯一接口） -->
      <!-- 协议：core YAML（SSOT）编辑与发布（发布链 3 步：保存并编译 → 发布 → 强制发布） -->
      <div v-if="visited.has('protocol')" v-show="tab === 'protocol'" class="sdp-pane" id="sdp-panel-protocol" role="tabpanel" aria-labelledby="sdp-tab-protocol">
        <ProtocolTab :skill-id="skillId" :reload-tick="coreReloadTick" @published="onPublished" />
      </div>

      <!-- 试跑：试跑 + ACTIVE 参照 + 最近调用（验证闭环） -->
      <div v-if="visited.has('trial')" v-show="tab === 'trial'" class="sdp-pane" id="sdp-panel-trial" role="tabpanel" aria-labelledby="sdp-tab-trial">
        <TrialTab :skill-id="skillId" :file-path="overview.file?.path" :refresh-tick="refreshTick" @failures="onFailures" @dirty="(d) => onTabDirty('trial', d)" />
      </div>

      <!-- 版本（单一入口）：核心文件版本（协议发布）+ Prompt 版本 -->
      <div v-if="visited.has('versions')" v-show="tab === 'versions'" class="sdp-pane" id="sdp-panel-versions" role="tabpanel" aria-labelledby="sdp-tab-versions">
        <VersionsTab :skill-id="skillId" :refresh-tick="refreshTick" @core-rolled-back="onCoreRolledBack" @dirty="(d) => onTabDirty('versions', d)" />
      </div>

      <!-- 运行时：路由与可靠性 -->
      <div v-if="visited.has('runtime')" v-show="tab === 'runtime'" class="sdp-pane" id="sdp-panel-runtime" role="tabpanel" aria-labelledby="sdp-tab-runtime">
        <RuntimeTab :skill-id="skillId" :refresh-tick="refreshTick" @dirty="(d) => onTabDirty('runtime', d)" />
      </div>

      <!-- 工程：低频只读区块 -->
      <div v-if="visited.has('engineering')" v-show="tab === 'engineering'" class="sdp-pane" id="sdp-panel-engineering" role="tabpanel" aria-labelledby="sdp-tab-engineering">
        <EngineeringTab :skill-id="skillId" :overview="overview" />
      </div>

      <!-- 字段路由（skill 维度 · 加字段向导闭环 + 字段血缘） -->
      <div v-if="visited.has('routing')" v-show="tab === 'routing'" class="sdp-pane" id="sdp-panel-routing" role="tabpanel" aria-labelledby="sdp-tab-routing">
        <RoutingTab :skill-id="skillId" />
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
/**
 * SkillDesignPage（Skill 设计页 · 调试闭环重设计）
 * 落点：AdminConsole 二级页 ?view=skill-design&id=<skill>（2026-10-15 由独立整页
 *   /admin/skills/:agentId 迁入外壳——此前是全站唯一不套管理外壳的整页，与学习者/会话/
 *   路径 / 卡库详情的呈现语言不一致）。返回走外壳面包屑/Esc/浏览器后退（closeSubPage），
 *   页内不再自带返回钮。id 取自 store.subPage，与其它二级页同源。
 * 拆分后主文件只负责：顶部状态条 / 单层 tab 导航 / 概览加载 / 脏态守卫；
 * 各 tab 内容在 skill-design/ 下独立组件（protocol/trial/versions/runtime/engineering/routing）。
 * 设计主线：复现问题 / 安全变更 / 性能排障 三条工作流
 */
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter, onBeforeRouteLeave } from 'vue-router'
import {
  adminPromptOpsApi,
  adminSkillWorkbenchApi
} from '@/api/adminApi'
import { askConfirm } from './useConfirm'
import { AGENT_TONES, subPage, closeSubPage, setSubPageLabel } from './store'
import { coreEditorState, fmtMs, errText } from './skill-design/sdp-shared'
import ProtocolTab from './skill-design/protocol-tab.vue'
import TrialTab from './skill-design/trial-tab.vue'
import VersionsTab from './skill-design/versions-tab.vue'
import RuntimeTab from './skill-design/runtime-tab.vue'
import EngineeringTab from './skill-design/engineering-tab.vue'
import RoutingTab from './skill-design/routing-tab.vue'
import '@/styles/mk-primitives.css'
import { TERMS } from './terms'
import { toast } from '@/utils/toast'
import MkEmptyState from '@/components/mk/MkEmptyState.vue'
import MkLoading from '@/components/mk/MkLoading.vue'
import MkSubTabs from '@/components/mk/MkSubTabs.vue'

/* ---------- 基础 ---------- */
const route = useRoute()
const router = useRouter()

/** 目标 Skill：取自二级页 store（与 SessionCockpit/LearnerDetail 同源），
    不再读 route.params.agentId——本页现挂在 /admin/skills 的 ?view=skill-design&id=… 上，
    路径里没有 agentId 段。id 可能带 skill: 前缀，去掉后为裸 skill id。 */
const skillId = computed(() => String(subPage.value?.id || '').replace(/^skill:/, ''))

/** Dry Run → 试跑页签 */
function goDryRun() {
  onTabSelect('trial')
}

/* ---------- 阶段色（与拓扑/抽屉同套，单源 store.AGENT_TONES） ---------- */
const tone = computed(() => {
  const pid = workbenchMeta.value?.parentAgent?.id || ''
  return AGENT_TONES[pid] || { hue: '#2f6ae0', soft: 'rgba(47, 106, 224, 0.1)' }
})

/* ---------- 总览与元数据 ---------- */
interface OverviewItem {
  agentId: string
  kind: string
  displayName: string
  health: 'good' | 'warn' | 'risk'
  file: { path?: string; hash?: string } | null
  db: { id?: string; version?: number | string; hash?: string; useCount?: number; model?: string; publishedAt?: string } | null
  drift: 'in-sync' | 'file-vs-db-mismatch' | null
  runtimeContract?: {
    version?: string
    contextMode?: string
    businessState?: { domain?: string; phases?: string[]; defaultPhase?: string; terminalPhases?: string[] } | null
    contextUpdate?: { mode?: string } | null
    outputEnvelope?: string
  } | null
  runtimeContractSource?: 'manifest' | 'default' | null
}

interface WorkbenchMeta {
  skill?: { id: string; name: string; description: string }
  parentAgent?: { id: string; name: string } | null
  modelConfig?: { temperature?: number } | null
  /** range：后端 workbench-meta 回显的统计窗口（'24h' | '7d' | '30d' | 'all'，缺省 all） */
  stats?: { totalCalls: number; successRate: number | null; avgDuration: number; range?: string }
}

const loading = ref(false)
const notFound = ref(false)
const overview = ref<OverviewItem | null>(null)
const workbenchMeta = ref<WorkbenchMeta | null>(null)

const healthLabel = computed(() => ({ good: '健康', warn: '需关注', risk: '风险' })[overview.value?.health || 'warn'])
const healthBadgeCls = computed(() =>
  overview.value?.health === 'good' ? 'mk-badge--ok' : overview.value?.health === 'warn' ? 'mk-badge--warn' : 'mk-badge--bad'
)
/** 状态条圆点色调（与 console mk-status 语言一致） */
const statusToneCls = computed(() =>
  overview.value?.health === 'good' ? 'mk-status--ok' : overview.value?.health === 'warn' ? 'mk-status--warn' : 'mk-status--bad'
)

/** B19-F7-3：统计窗口词（workbench-meta stats.range 回显；本页固定 all，与 Skills/SkillDetail 同套词表）。
    状态条「调用」是窗口内的调用日志聚合，工程页签「本版本累计调用」是 agent_prompts.useCount——
    两者口径不同，数字前必须带窗口词，读者才判得出 Skill 有没有在被调用。 */
const STATS_RANGE_LABELS: Record<string, string> = { '24h': '近 24 小时', '7d': '近 7 天', '30d': '近 30 天', all: '全量' }
const statsRangeLabel = computed(() => STATS_RANGE_LABELS[workbenchMeta.value?.stats?.range || 'all'] || '全量')

/* ---------- Tabs ---------- */
type TabKey = 'protocol' | 'trial' | 'versions' | 'runtime' | 'engineering' | 'routing'
/* 页签按任务流：协议(改) → 试跑(验) → 版本(看线上) → 运行时(调) → 工程(查)；默认落协议 */
const tab = ref<TabKey>('protocol')
const tabs: Array<{ key: TabKey; label: string }> = [
  { key: 'protocol', label: '协议' },
  { key: 'trial', label: '试跑' },
  { key: 'versions', label: '版本' },
  { key: 'runtime', label: '运行时' },
  { key: 'engineering', label: '工程' },
  { key: 'routing', label: '字段路由' }
]
const TAB_KEYS = tabs.map((t) => t.key)
/** #128 已激活过的页签（首次激活才挂载，之后 v-show 保状态）：协议页签是默认入口，预置 */
const visited = reactive(new Set<TabKey>(['protocol']))
/** 本页页签 URL 键（2026-10-15 迁入外壳时由 ?tab= 改为独立键 ?sdTab=）：
    本页现与 Skill 列表页共路径 /admin/skills，若沿用 ?tab= 会与列表的 run/model-routing/
    prompt-eval 串键（切页签把列表键写成 versions，closeSubPage 保留非 view/id query →
    返回列表时 Skills 的 watcher 见非法值静默重置为 run）。判例：SkillDetail 用 ?skdTab=、
    PromptEvalPanel 用 ?peTab=。 */
const TAB_QUERY_KEY = 'sdTab'
/** MkSubTabs 回传 string：收敛回 TabKey（非法键忽略）。
    #143：切换同时写回 ?sdTab=，与 applyQTab（唯一读取入口）形成双向同步——
    此前只写内存，切到「版本」后刷新/分享/复制链接会回到旧页签。
    默认档 protocol 从 URL 摘除（与 SkillDetail 缺省不占 URL 同约定），保持链接干净。 */
function onTabSelect(key: string) {
  if (!(TAB_KEYS as string[]).includes(key)) return
  visited.add(key as TabKey)
  tab.value = key as TabKey
  const nextTab = key === 'protocol' ? undefined : key
  const curTab = typeof route.query[TAB_QUERY_KEY] === 'string' ? route.query[TAB_QUERY_KEY] as string : undefined
  if (curTab !== nextTab) {
    const query = { ...route.query }
    if (nextTab) query[TAB_QUERY_KEY] = nextTab
    else delete query[TAB_QUERY_KEY]
    void router.replace({ query })
  }
}
// ?sdTab= 直达 + 旧链接兼容（workbench 已拆入试跑；旧 ?tab= 键在路由 redirect 里映射进 ?sdTab=）
function applyQTab() {
  const qTab = typeof route.query[TAB_QUERY_KEY] === 'string' ? route.query[TAB_QUERY_KEY] as string : ''
  if (['protocol', 'trial', 'versions', 'runtime', 'engineering', 'routing'].includes(qTab)) tab.value = qTab as TabKey
  if (qTab === 'workbench' || qTab === 'inspect' || qTab === 'preview' || qTab === 'trial') tab.value = 'trial'
  if (qTab === 'edit') tab.value = 'protocol'
  // 深链直达的页签同样标记为已激活，否则 v-if 会把它挡住
  visited.add(tab.value)
}
applyQTab()
watch(() => route.query[TAB_QUERY_KEY], applyQTab)

/* ---------- 子组件刷新协议（发布/回滚/切换 skill 后触发各 tab 重拉） ---------- */
const refreshTick = ref(0)
const coreReloadTick = ref(0)

/** 顶栏「近 8 条失败」计数（试跑 tab 上报） */
const recentFailures = ref(0)
function onFailures(n: number) {
  recentFailures.value = n
}

/** 发布成功：轻量刷新 overview + 通知各 tab 重拉（inspect / 版本 / 运行时 / 日志） */
function onPublished() {
  void loadOverviewLite()
  refreshTick.value++
}

/** core 回滚：编辑器从磁盘重拉 + 版本/试跑/overview 刷新 */
function onCoreRolledBack() {
  coreReloadTick.value++
  refreshTick.value++
  void loadOverviewLite()
}

/** 发布/回滚后只刷新 overview 芯片（不重跑全量 loadAll） */
async function loadOverviewLite() {
  const r = await adminPromptOpsApi.getAgentOverview().catch(() => null)
  const items = (r?.data?.data?.items || []) as OverviewItem[]
  const found = items.find((x) => x.agentId === `skill:${skillId.value}` || x.agentId === skillId.value) || null
  if (found) overview.value = found
}

/* ---------- 总加载 ---------- */
const loadFailed = ref(false)
async function loadAll() {
  const id = skillId.value
  if (!id) return
  // 刷新会丢弃未保存的修改，先确认
  if (anyDirty()) {
    const ok = await askConfirm({
      title: '刷新设计页',
      message: `当前 Skill 有未保存的修改（${dirtySummary()}），刷新后将丢失，确定刷新？`,
      confirmText: '刷新并放弃修改',
      danger: false
    })
    if (!ok) return
  }
  loading.value = true
  loadFailed.value = false
  notFound.value = false
  try {
    const r = await adminPromptOpsApi.getAgentOverview()
    if (id !== skillId.value) return
    const items = (r.data?.data?.items || []) as OverviewItem[]
    const found = items.find((x) => x.agentId === `skill:${id}` || x.agentId === id) || null
    if (!found) {
      overview.value = null
      notFound.value = true
      return
    }
    overview.value = found
    // 面包屑回填中文名（判例 SessionCockpit/LearnerDetail）：未取到则壳层回退显示 id 截断
    if (found.displayName) setSubPageLabel(found.displayName)
    const meta = await adminSkillWorkbenchApi.getMeta(found.agentId).catch(() => null)
    if (id !== skillId.value) return
    workbenchMeta.value = meta?.data?.data ?? meta?.data ?? null
    // 各 tab 数据由子组件在 refreshTick 变化时重拉（与编辑器内容无关，不清编辑器）
    refreshTick.value++
  } catch (e) {
    if (id !== skillId.value) return
    loadFailed.value = true
    toast.error(`加载失败：${errText(e)}`)
  } finally {
    if (id === skillId.value) loading.value = false
  }
}

/** 状态条文件路径短显：保留最后两段 */
function shortFilePath(p?: string) {
  if (!p) return ''
  const parts = p.split('/')
  return parts.length > 2 ? `…/${parts.slice(-2).join('/')}` : p
}

/* 脏态多源登记——运行时/试跑/版本等页签的未保存改动经 @dirty 上报（sdp-shared 的
   coreEditorState 只管协议编辑器，改共享模块不在本批范围），守卫按「任一处脏」拦截 */
const tabDirty = reactive<Record<string, { dirty: boolean; label: string }>>({})
function onTabDirty(key: string, payload: { dirty: boolean; label: string }) {
  tabDirty[key] = payload
}
/** 当前所有未保存改动的来源（人话标签），空数组 = 无脏 */
function dirtyParts(): string[] {
  const parts: string[] = []
  if (coreEditorState.dirty) parts.push('协议编辑器')
  for (const v of Object.values(tabDirty)) if (v.dirty) parts.push(v.label)
  return parts
}
const anyDirty = () => dirtyParts().length > 0
const dirtySummary = () => dirtyParts().join('、')

/* 脏态离开保护（2026-10-15 迁入外壳后重写）。
   独立整页时代「离开」= 路由切换，onBeforeRouteLeave 够用；迁入二级页后，
   「关闭本页」是同路由的 query 变化（closeSubPage 去掉 ?view/?id）+ 宿主 <component :key>
   立即卸载本页——异步确认根本来不及拦，脏改动会被静默丢弃。
   故用 flush:'sync' 的 watch：subPage 一变即**同步复原**（Vue 本轮渲染仍见到复原值，
   组件不卸载），再弹确认：
     - 取消：保持复原（留在页内），AdminConsole 的 subPage→URL watch 合并中间态，URL 无抖动；
     - 确认：置放行标记并真正关闭 / 切到目标 skill。
   真正的跨记录导航（登出、跳公开页）仍由下方 onBeforeRouteLeave 兜底；
   整页刷新/关窗由 beforeunload 兜底。 */
let allowLeave = false
watch(
  subPage,
  (sp, prev) => {
    if (allowLeave || !prev || prev.view !== 'skill-design') return
    const leaving = !sp || sp.view !== 'skill-design' || sp.id !== prev.id
    if (!leaving || !anyDirty()) return
    const target = sp // 想去哪：null=关闭；否则=新落点（切 skill 或跳别的二级页）
    subPage.value = prev // 同步复原，阻止卸载
    void (async () => {
      const ok = await askConfirm({
        title: target ? '切换 Skill' : '离开设计页',
        message: `当前 Skill 有未保存的修改（${dirtySummary()}），离开后将丢失，确定离开？`,
        confirmText: '离开并放弃修改',
        danger: false
      })
      if (!ok) return
      allowLeave = true
      if (target) subPage.value = target
      else closeSubPage()
    })()
  },
  { flush: 'sync' }
)

/* 跨记录路由离开（侧栏切场景 / 登出 / 跳公开页等真正换 route record）兜底确认；刷新/关闭由 beforeunload 兜底。
   确认放行时置 allowLeave：否则导航提交后 AdminConsole 的清页会把 subPage 置空，本页的
   subPage 同步守卫会再弹一次（切场景路径两守卫都命中 → 双确认）。 */
onBeforeRouteLeave(async () => {
  if (!anyDirty()) return true
  const ok = await askConfirm({
    title: '离开设计页',
    message: `当前 Skill 有未保存的修改（${dirtySummary()}），离开后将丢失，确定离开？`,
    confirmText: '离开并放弃修改',
    danger: false
  })
  if (ok) allowLeave = true
  return ok === true
})

function onPageBeforeUnload(e: BeforeUnloadEvent) {
  if (anyDirty()) {
    e.preventDefault()
    e.returnValue = ''
  }
}
onMounted(() => {
  void loadAll()
  window.addEventListener('beforeunload', onPageBeforeUnload)
})
onBeforeUnmount(() => {
  window.removeEventListener('beforeunload', onPageBeforeUnload)
  /* #F3：coreEditorState 是模块级单例——路由离开经确认后组件卸载，但单例的 dirty 不会被任何
     路径复位（[skillId, reloadTick] watcher 只在页内切换时跑），下次进入设计页会带出上一次的
     脏标记，产生幽灵「有未保存的修改」确认。离开即放弃：卸载时显式复位。
     tabDirty 随组件实例销毁，无需处理。 */
  coreEditorState.dirty = false
})
</script>

<style scoped>
.sdp {
  /* 2026-10-15 迁入外壳二级页：撤独立整页时代的 width:100%/max-width:1440px/margin:0 auto/
     min-height:100vh——外壳内容区（.mshell__content > *）是有界可滚容器，本页随 .mk-page
     填满（判例 LearnerDetail/SessionCockpit，仅覆写 gap）。宽度不再居中收窄。 */
  font-family: "PingFang SC", "Microsoft YaHei", "Hiragino Sans GB", Inter, sans-serif;
}

.sdp-pane { display: grid; gap: 14px; align-content: start; }

/* ---------- 顶部 ---------- */
.sdp-head {
  display: grid;
  gap: 8px;
  align-items: start;
  padding: 4px 0 2px;
}
.sdp-parent { display: inline-flex; align-items: center; gap: 5px; font-size: var(--mk-fs-micro); font-weight: 600; white-space: nowrap; color: var(--mk-muted); }
.sdp-parent__dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }
.sdp-ellipsis {
  max-width: 320px;
  overflow: hidden;
  text-overflow: ellipsis;
}
.sdp-bad-text { color: var(--mk-red); font-weight: 700; }
.sdp-action-fix { margin-left: 0; }

/* ---------- 漂移警告 ---------- */
.sdp-drift {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  padding: 9px 14px;
  border-radius: var(--mk-radius-xl);
  background: var(--mk-amber-bg);
  border: 1px solid rgba(180, 83, 9, 0.3);
  color: var(--mk-amber);
  font-size: var(--mk-fs-micro);
}
.sdp-drift code { font-size: var(--mk-fs-micro); }

/* ---------- Tabs（收敛为全局 mk-pills / mk-pill） ---------- */

/* 4K：撤 max-width 居中档（迁入外壳后与其它详情页同宽，不再单独收窄；判例 LearnerDetail）。
   字号档随壳层 token 走，仅保留局部放大以对齐管理台基线。 */
@media (min-width: 3600px) {
  .sdp-parent { font-size: var(--mk-fs-body); }
  .sdp-drift { font-size: var(--mk-fs-body); padding: 14px 18px; }
  .sdp-drift code { font-size: var(--mk-fs-body); }
  /* MkSubTabs 是子组件：4K 档位需 :deep 命中其内部按钮（父 scoped 属性不落到子组件内部节点） */
  :deep(.mk-subtab) { font-size: var(--mk-fs-body); padding: 12px 20px; }
}
</style>
