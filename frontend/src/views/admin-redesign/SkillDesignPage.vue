<template>
  <div class="mk-page sdp">
    <!-- 顶部：返回 + 状态条（与 console 统一的运维简报语言） -->
    <header class="sdp-head">
      <button type="button" class="sdp-back" @click="goConsole">← 控制台</button>
      <div v-if="overview" class="mk-status" :class="statusToneCls">
        <span class="mk-status__dot"></span>
        <strong class="mk-status__title">{{ overview.displayName || skillId }}</strong>
        <span class="mk-badge" :class="healthBadgeCls">{{ healthLabel }}</span>
        <span v-if="workbenchMeta?.parentAgent" class="sdp-parent" :style="{ color: tone.hue }">
          ↑ {{ workbenchMeta.parentAgent.name }}
        </span>
        <span class="mk-status__sep"></span>
        <span
          class="mk-status__meta mono sdp-ellipsis"
          :title="`${overview.agentId}${overview.file ? ' · ' + overview.file.path : ''}`"
        >{{ overview.agentId }}<template v-if="overview.file"> · {{ shortFilePath(overview.file.path) }}</template></span>
        <span v-if="overview.db?.version" class="mk-status__meta">DB ACTIVE <b class="mono">v{{ overview.db.version }}</b></span>
        <span v-if="workbenchMeta?.stats" class="mk-status__meta">
          调用 <b class="mono">{{ workbenchMeta.stats.totalCalls }}</b>
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
        <strong class="mk-status__title">{{ loading ? '加载中…' : loadFailed ? '概览加载失败' : skillId }}</strong>
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

    <div v-if="notFound" class="mk-empty">
      <strong>未找到 Skill「{{ skillId }}」</strong>
      <span>它可能未注册或 ID 有误。</span>
    </div>

    <template v-if="overview">
      <!-- Tabs（单层 6 tab：协议 / 试跑 / 版本 / 运行时 / 工程 / 字段路由） -->
      <nav class="mk-pills">
        <button
          v-for="t in tabs"
          :key="t.key"
          type="button"
          class="mk-pill"
          :class="{ 'mk-pill--active': tab === t.key }"
          @click="tab = t.key"
        >
          {{ t.label }}
        </button>
      </nav>

      <!-- 协议：core YAML（SSOT）编辑与发布（发布链 3 步：保存并编译 → 发布 → 强制发布） -->
      <div v-show="tab === 'protocol'" class="sdp-pane">
        <ProtocolTab :skill-id="skillId" :reload-tick="coreReloadTick" @published="onPublished" />
      </div>

      <!-- 试跑：试跑 + ACTIVE 参照 + 最近调用（验证闭环） -->
      <div v-show="tab === 'trial'" class="sdp-pane">
        <TrialTab :skill-id="skillId" :file-path="overview.file?.path" :refresh-tick="refreshTick" @failures="onFailures" />
      </div>

      <!-- 版本（单一入口）：核心文件版本（协议发布）+ Prompt 版本 -->
      <div v-show="tab === 'versions'" class="sdp-pane">
        <VersionsTab :skill-id="skillId" :refresh-tick="refreshTick" @core-rolled-back="onCoreRolledBack" />
      </div>

      <!-- 运行时：路由与可靠性 -->
      <div v-show="tab === 'runtime'" class="sdp-pane">
        <RuntimeTab :skill-id="skillId" :refresh-tick="refreshTick" />
      </div>

      <!-- 工程：低频只读区块 -->
      <div v-show="tab === 'engineering'" class="sdp-pane">
        <EngineeringTab :skill-id="skillId" :overview="overview" />
      </div>

      <!-- 字段路由（skill 维度 · 加字段向导闭环 + 字段血缘） -->
      <div v-show="tab === 'routing'" class="sdp-pane">
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
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
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
import './shared.css'
import { TERMS } from './terms'
import { toast } from '@/utils/toast'

/* ---------- 路由与基础 ---------- */
const route = useRoute()
const router = useRouter()

const agentIdParam = computed(() => {
  const v = route.params.agentId
  return typeof v === 'string' ? v : Array.isArray(v) ? v[0] : ''
})
const skillId = computed(() => agentIdParam.value.replace(/^skill:/, ''))

async function goConsole() {
  void router.push('/admin/console')
}

/** Dry Run → 试跑页签 */
function goDryRun() {
  tab.value = 'trial'
}

/* ---------- 阶段色（与拓扑/抽屉同套，单源 store.AGENT_TONES） ---------- */
const tone = computed(() => {
  const pid = workbenchMeta.value?.parentAgent?.id || ''
  return AGENT_TONES[pid] || { hue: '#2c63d0', soft: 'rgba(44, 99, 208, 0.1)' }
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
  stats?: { totalCalls: number; successRate: number | null; avgDuration: number }
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
// ?tab= 直达 + 旧链接兼容（workbench 已拆入试跑）
function applyQTab() {
  const qTab = typeof route.query.tab === 'string' ? route.query.tab : ''
  if (['protocol', 'trial', 'versions', 'runtime', 'engineering', 'routing'].includes(qTab)) tab.value = qTab as TabKey
  if (qTab === 'workbench' || qTab === 'inspect' || qTab === 'preview' || qTab === 'trial') tab.value = 'trial'
  if (qTab === 'edit') tab.value = 'protocol'
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
  // 刷新会丢弃未保存的 core 修改，先确认
  if (coreEditorState.dirty) {
    const ok = await askConfirm({
      title: '刷新设计页',
      message: '当前 Skill 有未保存的修改，刷新后将丢失，确定刷新？',
      confirmText: '刷新并放弃修改'
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

/* 脏态离开保护：切 Skill / 关闭页面 / 刷新前确认，避免静默丢编辑内容 */
let lastAgentId = ''
watch(agentIdParam, async (id) => {
  // router.replace 回弹（取消切换）会以原 id 再触发一次：直接跳过，避免误重置
  if (id === lastAgentId) return
  if (coreEditorState.dirty && id && id !== lastAgentId) {
    const ok = await askConfirm({
      title: '切换 Skill',
      message: '当前 Skill 有未保存的修改，切换后将丢失，确定离开？',
      confirmText: '离开并放弃修改'
    })
    if (!ok) {
      // 取消：回滚 URL，不执行任何重置（回弹再进 watcher 时因 id === lastAgentId 直接跳过）
      void router.replace({ path: `/admin/skills/${lastAgentId}`, query: route.query })
      return
    }
  }
  // 确认离开：通知子组件按新 skill 重拉（协议编辑器由 coreReloadTick 驱动复位）
  lastAgentId = id
  coreReloadTick.value++
  refreshTick.value++
  if (agentIdParam.value) void loadAll()
})

/* SPA 内导航离开（返回控制台 / 跳其他路由）有未保存修改必须确认；刷新/关闭由 beforeunload 兜底 */
onBeforeRouteLeave(async () => {
  if (!coreEditorState.dirty) return true
  const ok = await askConfirm({
    title: '离开设计页',
    message: '当前 Skill 有未保存的修改，离开后将丢失，确定离开？',
    confirmText: '离开并放弃修改'
  })
  return ok === true
})

function onPageBeforeUnload(e: BeforeUnloadEvent) {
  if (coreEditorState.dirty) {
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
.sdp-back {
  border: 0;
  background: transparent;
  color: var(--mk-blue);
  font: inherit;
  font-size: 12.5px;
  font-weight: 700;
  cursor: pointer;
  padding: 0;
  white-space: nowrap;
  width: fit-content;
}
.sdp-back:hover { text-decoration: underline; }
.sdp-parent { font-size: 12px; font-weight: 600; white-space: nowrap; }
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
  border-radius: 10px;
  background: var(--mk-amber-bg);
  border: 1px solid rgba(180, 83, 9, 0.3);
  color: var(--mk-amber);
  font-size: 12px;
}
.sdp-drift code { font-size: 11px; }

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
  .sdp-back { font-size: 19px; }
  .sdp-parent { font-size: 18px; }
  .sdp-drift { font-size: 18px; padding: 14px 18px; }
  .sdp-drift code { font-size: 17px; }
  .sdp .mk-pills { padding: 6px; }
  .sdp .mk-pill { font-size: 19px; padding: 10px 24px; }
  .sdp .mk-pills { border-radius: 10px; }
  .sdp .mk-pill { font-size: 18px; padding: 7px 18px; }
}
</style>
