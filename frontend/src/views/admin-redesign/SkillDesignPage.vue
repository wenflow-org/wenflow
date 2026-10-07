<template>
  <div class="mk-page sdp">
    <!-- 顶部：返回 + 状态条（与 console 统一的运维简报语言） -->
    <header class="sdp-head">
      <button type="button" class="mk-back" @click="goConsole">← 控制台</button>
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
        <span v-if="overview.db?.version" class="mk-status__meta">DB ACTIVE <b class="mono">v{{ overview.db.version }}</b></span>
        <!-- B19-F7-3：调用/成功率/均耗来自 workbench-meta 的调用日志聚合（range 默认 all）。
             窗口词必须随数字一起出现，否则与工程页签「本版本累计调用」（agent_prompts.useCount）
             同一屏两个数会被读成同一事实。 -->
        <span
          v-if="workbenchMeta?.stats"
          class="mk-status__meta"
          :title="`调用日志聚合统计 · 窗口：${statsRangeLabel}；与工程页签「本版本累计调用」口径不同`"
        >
          {{ statsRangeLabel }}调用 <b class="mono">{{ workbenchMeta.stats.totalCalls }}</b>
          · 成功率 <b class="mono">{{ workbenchMeta.stats.successRate ?? '—' }}%</b>
          · 均耗 <b class="mono">{{ fmtMs(workbenchMeta.stats.avgDuration || 0) }}</b>
        </span>
        <span v-if="recentFailures > 0" class="mk-status__meta sdp-bad-text">近 8 条 {{ recentFailures }} 失败</span>
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
      <span>DB ACTIVE v{{ overview.db?.version || '?' }}</span>
      <span>请修改文件并通过部署同步处理</span>
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
 * SkillDesignPage（Prompt 二级设计页 · 调试闭环重设计）
 * 路由：/admin/skills/:agentId
 * 拆分后主文件只负责：顶栏状态 / 单层 tab 导航 / 概览加载 / 脏态守卫；
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
import { AGENT_TONES } from './store'
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

/* ---------- 路由与基础 ---------- */
const route = useRoute()
const router = useRouter()

const agentIdParam = computed(() => {
  const v = route.params.agentId
  return typeof v === 'string' ? v : Array.isArray(v) ? v[0] : ''
})
const skillId = computed(() => agentIdParam.value.replace(/^skill:/, ''))

/** 返回控制台：优先回 SPA 来源页（设计页通常从 Skill 列表/抽屉进入，旧实现固定回
    /admin/console → 经重定向永远落在总览，丢失来源上下文）；直接深链进来（无站内
    上一页）时回 Skill 列表兜底。onBeforeRouteLeave 的未保存确认对 back 同样生效 */
function goConsole() {
  const back = (window.history.state as { back?: string } | null)?.back
  if (back && back.startsWith('/admin/')) router.back()
  else void router.push('/admin/skills')
}

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
/** MkSubTabs 回传 string：收敛回 TabKey（非法键忽略）。
    #143：切换同时写回 ?tab=，与 applyQTab（唯一读取入口）形成双向同步——
    此前只写内存，切到「版本」后刷新/分享/复制链接会回到旧页签。
    默认档 protocol 从 URL 摘除（与 SkillDetail 缺省不占 URL 同约定），保持链接干净。 */
function onTabSelect(key: string) {
  if (!(TAB_KEYS as string[]).includes(key)) return
  visited.add(key as TabKey)
  tab.value = key as TabKey
  const nextTab = key === 'protocol' ? undefined : key
  const curTab = typeof route.query.tab === 'string' ? route.query.tab : undefined
  if (curTab !== nextTab) {
    const query = { ...route.query }
    if (nextTab) query.tab = nextTab
    else delete query.tab
    void router.replace({ query })
  }
}
// ?tab= 直达 + 旧链接兼容（workbench 已拆入试跑）
function applyQTab() {
  const qTab = typeof route.query.tab === 'string' ? route.query.tab : ''
  if (['protocol', 'trial', 'versions', 'runtime', 'engineering', 'routing'].includes(qTab)) tab.value = qTab as TabKey
  if (qTab === 'workbench' || qTab === 'inspect' || qTab === 'preview' || qTab === 'trial') tab.value = 'trial'
  if (qTab === 'edit') tab.value = 'protocol'
  // 深链直达的页签同样标记为已激活，否则 v-if 会把它挡住
  visited.add(tab.value)
}
applyQTab()
watch(() => route.query.tab, applyQTab)

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

/* 脏态离开保护：切 Skill / 关闭页面 / 刷新前确认，避免静默丢编辑内容。
   #119：lastAgentId 初始化为挂载时的真实 agentId——此前恒为空串，组件挂载后首次参数变化前
   取消切换会 replace 到 `/admin/skills/`（空 id，落 Skill 目录页），等于「点了取消却离开当前 Skill」 */
let lastAgentId = agentIdParam.value
/** 已确认停留的完整路径（含 query）：取消切换时原样回滚，不丢 ?tab= 等定位参数 */
let lastFullPath = route.fullPath
/* #118：脏态多源登记——运行时/试跑/版本等页签的未保存改动经 @dirty 上报（sdp-shared 的
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
watch(agentIdParam, async (id) => {
  // router.replace 回弹（取消切换）会以原 id 再触发一次：直接跳过，避免误重置
  if (id === lastAgentId) return
  if (anyDirty() && id && id !== lastAgentId) {
    const ok = await askConfirm({
      title: '切换 Skill',
      message: `当前 Skill 有未保存的修改（${dirtySummary()}），切换后将丢失，确定离开？`,
      confirmText: '离开并放弃修改',
      danger: false
    })
    if (!ok) {
      // 取消：回滚到已确认的完整 URL（不执行任何重置；回弹再进 watcher 时因 id === lastAgentId 直接跳过）
      void router.replace(lastFullPath)
      return
    }
  }
  // 确认离开：通知子组件按新 skill 重拉（协议编辑器由 coreReloadTick 驱动复位）
  lastAgentId = id
  lastFullPath = route.fullPath
  coreReloadTick.value++
  refreshTick.value++
  if (agentIdParam.value) void loadAll()
})

/* SPA 内导航离开（返回控制台 / 跳其他路由）有未保存修改必须确认；刷新/关闭由 beforeunload 兜底 */
onBeforeRouteLeave(async () => {
  if (!anyDirty()) return true
  const ok = await askConfirm({
    title: '离开设计页',
    message: `当前 Skill 有未保存的修改（${dirtySummary()}），离开后将丢失，确定离开？`,
    confirmText: '离开并放弃修改',
    danger: false
  })
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
onBeforeUnmount(() => window.removeEventListener('beforeunload', onPageBeforeUnload))
</script>

<style scoped>
.sdp {
  /* #app 是 flex 列容器：margin auto 会让本页收缩到内容宽，必须显式 width:100% */
  width: 100%;
  /* 全页签统一宽度：避免协议/工作台等页签切换时页面宽度跳动 */
  max-width: 1440px;
  margin: 0 auto;
  min-height: 100vh;
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

/* 4K：设计页放宽 + 字号跟随壳层放大 */
@media (min-width: 2000px) {
  .sdp { max-width: 2000px; }
}
@media (min-width: 2800px) {
  .sdp { max-width: 2600px; }
}
@media (min-width: 3600px) {
  /* 4K：设计页独立渲染（无全局 zoom），字号大幅放大以对齐管理台基线 */
  .sdp { max-width: 3000px; }
  .mk-back { font-size: var(--mk-fs-emphasis); }
  .sdp-parent { font-size: var(--mk-fs-body); }
  .sdp-drift { font-size: var(--mk-fs-body); padding: 14px 18px; }
  .sdp-drift code { font-size: var(--mk-fs-body); }
  /* MkSubTabs 是子组件：4K 档位需 :deep 命中其内部按钮（父 scoped 属性不落到子组件内部节点） */
  :deep(.mk-subtab) { font-size: var(--mk-fs-body); padding: 12px 20px; }
}
</style>
