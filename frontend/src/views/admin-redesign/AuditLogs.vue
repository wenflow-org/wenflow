<template>
  <div class="mk-page mk-page--fill">
    <!-- 页头（newui/admin pagehead）：页名随 tab（审计日志/登录审计）+ 导出/刷新上移。
         无统计带（2026-10-02 用户拍板「新UI没有kpi条」：原型 renderAudit = pageTitle +
         card(tabs+table)，页头之下直接是列表卡；总数在分页 foot「共 N 条」单源可见） -->
    <MkPageHead :title="statusTitle" sub="管理员操作与登录行为的完整审计追踪">
      <template #actions>
        <!-- 导出的是服务端分页返回的当前页（非全量筛选结果），文案如实标注；无数据时禁用 -->
        <button type="button" class="mk-btn mk-btn--sm" :disabled="!rows.length" @click="exportCurrentPage">导出本页</button>
        <button type="button" class="mk-btn mk-btn--sm" :disabled="loading" @click="applyFilters">
          {{ loading ? '刷新中…' : '刷新' }}
        </button>
      </template>
    </MkPageHead>

    <!-- 单卡容器（原型 renderAudit：card > .tabs 页签 + 页签体，对齐 Users.vue 卡内页签判例）：
         操作审计 / 登录审计两个页签体与页签共用一张卡。页签为原型 .tabs 下划线页签：
         12px/600、激活蓝字+2px 蓝下划线、通栏底线（2026-10-01 由 mk-pills 胶囊迁入——
         胶囊只做筛选 chips，视图/分区切换归页签） -->
    <div class="mk-card mk-card--fill">
      <div class="tabs" role="tablist" aria-label="审计视图切换">
        <button
          v-for="t in tabs"
          :key="t.id"
          type="button"
          role="tab"
          class="tab"
          :aria-selected="tab === t.id"
          @click="switchTab(t.id)"
        >
          {{ t.label }}
        </button>
      </div>

      <!-- 筛选卡片头（关键词 / 时间范围 / 列） -->
      <div class="mk-card__head">
        <div class="mk-filter">
          <MkFilterSearch
            v-model="keyword"
            :placeholder="tab === 'login' ? '用户名 / IP，回车查询' : '关键词，回车查询'"
            @keydown.enter="applyFilters"
          />
          <select v-model="timeRange" class="mk-filter__select" aria-label="时间范围" @change="applyFilters">
            <option value="today">今天</option>
            <option value="yesterday">昨天</option>
            <option value="week">近 7 天</option>
            <option value="month">近 30 天</option>
            <option value="all">全部</option>
          </select>
          <button v-if="isFiltered" type="button" class="mk-link" @click="clearFilters">清除筛选</button>
          <!-- 保存视图：筛选组合命名存档（localStorage），pill 一键恢复 -->
          <SavedViewsBar
            :views="savedViews"
            :active-name="activeSavedViewName"
            :can-save="isFiltered"
            :suggest-name="filterLabel"
            :title-of="savedViewTitle"
            @apply="applySavedView"
            @remove="removeView"
            @save="onSaveView"
          />
        </div>
        <div class="mk-card__head-right">
          <span v-if="failureByAction.length" class="al-fails">
            <span class="al-fails__label" title="失败最多的动作（近 2000 条失败内聚合），点击 chip 下钻只看失败">失败 TOP</span>
            <!-- P2：span→button。后端 /admin/audit-logs 支持 success=true/false 白名单参数（parseSuccess），
                 点击 = 只看失败 + path 首段关键词；再点已激活的 chip 退出下钻 -->
            <button
              v-for="f in failureByAction"
              :key="f.action"
              type="button"
              class="al-fails__chip"
              :class="{ 'al-fails__chip--on': failedOnly && failedAction === f.action }"
              :title="f.action"
              :aria-pressed="failedOnly && failedAction === f.action"
              @click="filterByFailure(f.action)"
            >{{ failureLabel(f.action) }} <b>{{ f.count }}</b></button>
          </span>
          <MkCols :col-defs="alColDefs" :storage-key="AL_COLS_KEY" v-model:hidden="hiddenCols" />
        </div>
      </div>

    <!-- 加载失败错误态 + 重试 -->
    <MkEmptyState
      v-if="loadError"
      tone="error"
      title="审计日志加载失败"
      :description="loadError"
      action-text="重试"
      compact
      @action="applyFilters"
    />

    <!-- 加载中骨架 -->
    <!-- 登录表 6 列（时间/用户名/IP/结果/原因/操作），骨架列数与真实表头对齐 -->
    <MockSkeletonTable v-else-if="loading && !rows.length" :cols="tab === 'login' ? 6 : 7" :rows="6" />

    <!-- 操作审计列表 -->
    <div v-else-if="tab === 'operation' && logs.length" class="log-body">
      <div class="mk-table-scroll">
        <!-- 原型 .tbl：width:100% 自动布局（无 colgroup/无 fixed），列随 colVisible 增删、
             按内容自然分宽；操作者/路径/IP 等长值由局部 max-width 截断兜底 -->
        <table class="mk-table mk-table--click">
          <thead>
            <tr>
              <th
                v-if="colVisible('time')"
                scope="col"
                class="mk-th--sortable"
                :aria-sort="alSortState('createdAt')"
                @click="toggleAlSort('createdAt')"
              ><button type="button" class="mk-th__btn" @click.stop="toggleAlSort('createdAt')">时间<span class="mk-th__caret" aria-hidden="true"></span></button></th>
              <th v-if="colVisible('admin')">操作者</th>
              <th v-if="colVisible('action')">动作</th>
              <th v-if="!noTargetTypes && colVisible('tt')" title="操作对象类别（如 用户 / 公告 / 会话）">目标类型</th>
              <th v-if="colVisible('target')">目标</th>
              <th
                v-if="colVisible('result')"
                scope="col"
                class="mk-th--sortable"
                :aria-sort="alSortState('success')"
                @click="toggleAlSort('success')"
              ><button type="button" class="mk-th__btn" @click.stop="toggleAlSort('success')">结果<span class="mk-th__caret" aria-hidden="true"></span></button></th>
              <th v-if="colVisible('ip')">IP</th>
              <th class="mk-th--right" aria-hidden="true"></th>
            </tr>
          </thead>
          <tbody>
            <template v-for="log in logs" :key="log.id">
              <tr
                class="log-tr"
                :class="[log.success ? 'log-tr--ok' : 'log-tr--err', { 'log-tr--open': openId === log.id }]"
                :aria-expanded="openId === log.id"
                :aria-controls="`audit-payload-${log.id}`"
                tabindex="0"
                @click="openId = openId === log.id ? '' : log.id"
                @keydown.enter.prevent="openId = openId === log.id ? '' : log.id"
                @keydown.space.prevent="openId = openId === log.id ? '' : log.id"
              >
                <td v-if="colVisible('time')" class="log-time mono" :title="fmtFull(log.createdAt)">{{ fmtTime(log.createdAt) }}</td>
                <td v-if="colVisible('admin')" class="log-admin" :title="log.adminName || log.adminId || ''">
                  {{ log.adminName || (log.adminId ? shortId(log.adminId) : '—') }}
                </td>
                <td v-if="colVisible('action')" :title="log.action">
                  <template v-if="methodOf(log)">
                    <span class="log-path mono" :title="`${methodOf(log)} ${log.path || ''}`">{{ actionLabelOf(log) }}</span>
                    <span class="log-action-sep" aria-hidden="true">·</span>
                    <span class="log-method" :class="`log-method--${methodOf(log).toLowerCase()}`">{{ methodOf(log) }}</span>
                  </template>
                  <span v-else class="log-action">{{ actionText(log.action) }}</span>
                </td>
                <td v-if="!noTargetTypes && colVisible('tt')" class="log-tt" :title="log.targetType || '当前记录未写入目标类型'">{{ targetTypeText(log.targetType) }}</td>
                <td v-if="colVisible('target')" class="log-target mono" :title="log.targetId || ''">{{ log.targetId ? shortId(log.targetId) : '—' }}</td>
                <td v-if="colVisible('result')"><span class="mk-badge" :class="log.success ? 'mk-badge--ok' : 'mk-badge--bad'">{{ log.success ? '成功' : '失败' }}</span></td>
                <td v-if="colVisible('ip')" class="log-ip mono" :title="log.ip || ''">{{ ipText(log.ip) }}</td>
                <td class="mk-th--right log-arrow" aria-hidden="true">▸</td>
              </tr>
              <tr v-if="openId === log.id" class="log-payload-row">
                <td :colspan="visibleAlCols">
                  <div :id="`audit-payload-${log.id}`" class="log-payload">
                    <div class="log-payload-meta">
                      <span>{{ log.method }} {{ log.path }} · HTTP {{ log.statusCode }}<template v-if="log.durationMs != null"> · {{ fmtMs(log.durationMs) }}</template></span>
                      <span v-if="log.userAgent" class="log-ua" :title="log.userAgent">{{ log.userAgent }}</span>
                    </div>
                    <div v-if="log.requestJson" class="log-section">
                      <span class="log-label">请求</span>
                      <pre>{{ log.requestJson }}</pre>
                    </div>
                    <div v-if="log.beforeJson" class="log-section">
                      <span class="log-label">变更前</span>
                      <pre>{{ log.beforeJson }}</pre>
                    </div>
                    <div v-if="log.afterJson" class="log-section">
                      <span class="log-label">变更后</span>
                      <pre>{{ log.afterJson }}</pre>
                    </div>
                    <p v-if="!log.requestJson && !log.beforeJson && !log.afterJson" class="log-none">无请求内容记录</p>
                  </div>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>
      <!-- 传统分页（方案 A）：与执行日志同一分页器形态 -->
      <Pagination
        v-model:page="currentPage"
        v-model:pageSize="currentPageSize"
        :total="total"
        :loading="loading"
      />
    </div>

    <!-- 登录审计列表 -->
    <div v-else-if="tab === 'login' && attempts.length" class="log-body">
      <div class="mk-table-scroll">
        <!-- 原型 .tbl：width:100% 自动布局（无 colgroup/无 fixed），单元格 nowrap -->
        <table class="mk-table">
          <thead>
            <tr>
              <th
                scope="col"
                class="mk-th--sortable"
                :aria-sort="alSortState('createdAt')"
                @click="toggleAlSort('createdAt')"
              ><button type="button" class="mk-th__btn" @click.stop="toggleAlSort('createdAt')">时间<span class="mk-th__caret" aria-hidden="true"></span></button></th>
              <th>用户名</th>
              <th>IP</th>
              <th
                scope="col"
                class="mk-th--sortable"
                :aria-sort="alSortState('success')"
                @click="toggleAlSort('success')"
              ><button type="button" class="mk-th__btn" @click.stop="toggleAlSort('success')">结果<span class="mk-th__caret" aria-hidden="true"></span></button></th>
              <th>原因</th>
              <th class="mk-th--right al-act">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="a in attempts"
              :key="a.id"
              class="log-tr"
              :class="a.success ? 'log-tr--ok' : 'log-tr--err'"
            >
              <td class="log-time mono" :title="fmtFull(a.createdAt)">{{ fmtTime(a.createdAt) }}</td>
              <td class="log-admin" :title="a.username">{{ a.username || '—' }}</td>
              <td class="log-ip mono" :title="a.ip || ''">{{ ipText(a.ip) }}</td>
              <td><span class="mk-badge" :class="a.success ? 'mk-badge--ok' : 'mk-badge--bad'">{{ a.success ? '成功' : '失败' }}</span></td>
              <td class="log-reason" :title="a.reason || ''">{{ reasonText(a.reason) }}</td>
              <td class="mk-th--right al-act">
                <button
                  v-if="a.success && a.username"
                  type="button"
                  class="mk-link"
                  title="在「会话安全」页查看该用户当前的登录会话（设备/状态/强制下线）"
                  @click="goSessions(a.username)"
                >查看会话 →</button>
                <span v-else class="mk-na">—</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <!-- 传统分页（方案 A）：与执行日志同一分页器形态 -->
      <Pagination
        v-model:page="currentPage"
        v-model:pageSize="currentPageSize"
        :total="total"
        :loading="loading"
      />
    </div>

    <!-- 空态（P1-1/P2-8，2026-09-27 走查）：
         min：本页是 .mk-card--fill 应用式布局，未传 :min 时空态贴卡片头、下方 60-70% 视口空白；
         文案按 tab 分流，筛选无结果时登录 tab 也说「无登录记录」而非统一的「无审计记录」 -->
    <MkEmptyState
      v-else
      min
      :title="isFiltered ? (tab === 'login' ? '当前筛选无登录记录' : '当前筛选无审计记录') : tab === 'login' ? '暂无登录审计' : '暂无审计记录'"
      :description="tab === 'login' ? '管理员登录成功/失败都会在此留痕' : '管理员的增删改操作会自动记录留痕'"
      :action-text="isFiltered ? '清除筛选' : ''"
      @action="clearFilters"
    >
      <template #icon>
        <KeyRound v-if="tab === 'login'" :size="26" :stroke-width="1.75" style="opacity:.85" />
        <Lock v-else :size="26" :stroke-width="1.75" style="opacity:.85" />
      </template>
    </MkEmptyState>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { KeyRound, Lock } from 'lucide-vue-next'
import { useRoute, useRouter } from 'vue-router'
import { adminAuditApi, type AuditLogQuery } from '@/api/adminApi'
import { errMsg, shortId } from './live'
import MkPageHead from '@/components/mk/MkPageHead.vue'
import Pagination from './Pagination.vue'
import MkFilterSearch from '@/components/mk/MkFilterSearch.vue'
import MkEmptyState from '@/components/mk/MkEmptyState.vue'
import MockSkeletonTable from './SkeletonTable.vue'
import { useIsNarrow } from './useIsNarrow'
import MkCols from '@/components/mk/MkCols.vue'
import { actionText, targetTypeText, ipText, pathActionText } from './statusText'
import { useTableSort } from './useTableSort'
import SavedViewsBar from './SavedViewsBar.vue'
import { useSavedViews, sameViewQuery, type SavedView } from './useSavedViews'

/** admin_audit_logs 行（与后端 Prisma 模型一致） */
interface AuditLogRow {
  id: string
  adminId?: string | null
  adminName?: string | null
  action: string
  targetType?: string | null
  targetId?: string | null
  beforeJson?: string | null
  afterJson?: string | null
  requestJson?: string | null
  method: string
  path: string
  statusCode: number
  success: boolean
  ip?: string | null
  userAgent?: string | null
  durationMs?: number | null
  createdAt: string
}

/** login_attempts 行（与后端 Prisma 模型一致） */
interface LoginAttemptRow {
  id: string
  scope: string
  username: string
  ip?: string | null
  success: boolean
  reason?: string | null
  createdAt: string
}

/** HTTP 方法（API 类动作显示彩色方法徽标）；非 API 动作（如「删除虚拟学习者」）返回空串 */
function methodOf(log: AuditLogRow): string {
  const m = (log.method || '').trim().toUpperCase()
  return /^(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)$/.test(m) ? m : ''
}

/** 动作列展示（P2-16）：语义名优先；老数据（action 存原始串）按 path 兜底映射；都没有才回退原始 path */
function actionLabelOf(log: AuditLogRow): string {
  const mapped = actionText(log.action)
  if (mapped !== log.action) return mapped
  return pathActionText(log.path, log.method) || log.path || mapped
}

const tabs = [
  { id: 'operation', label: '操作审计' },
  { id: 'login', label: '登录审计' },
] as const
type TabId = (typeof tabs)[number]['id']

const tab = ref<TabId>('operation')
const keyword = ref('')
const timeRange = ref<'today' | 'yesterday' | 'week' | 'month' | 'all'>('today')

/* 深链：?tab=login 直达登录审计（会话安全页「审计日志 · 登录审计 →」跳入） */
const route = useRoute()
const router = useRouter()
if (route.query.tab === 'login') tab.value = 'login'

const logs = ref<AuditLogRow[]>([])
const attempts = ref<LoginAttemptRow[]>([])
const total = ref(0)
/** 失败 TOP chip 下钻态：success=false（后端白名单参数）+ path 首段做 keyword contains */
const failedOnly = ref(false)
const failedAction = ref('')
/** P2-16：失败按动作聚合 TOP（后端 /stats 返回），作为「失败 N」的下钻入口 */
const failureByAction = ref<Array<{ action: string; count: number }>>([])
/** 当前页（1 基）；筛选/tab/每页条数变化回第 1 页 */
const page = ref(1)
/** 每页条数（与执行日志同一分页器形态：15/30/50/100，默认 30） */
const pageSize = ref(30)
const loading = ref(false)
const loadError = ref('')
const openId = ref('')

/* 服务端排序：白名单 createdAt / success（operation / login 两个 tab 共用），默认时间倒序。
   排序在后端执行（不使用 sortRows）；变更回第 1 页重查，状态 localStorage 记忆。 */
const {
  sortKey: alSortKey,
  sortDir: alSortDir,
  toggle: toggleAlSort,
  sortState: alSortState
} = useTableSort({
  keys: ['createdAt', 'success'],
  defaultKey: 'createdAt',
  defaultDir: 'desc',
  storageKey: 'wf_audit_logs_sort'
})

const rows = computed(() => (tab.value === 'operation' ? logs.value : attempts.value))

/** 目标类型列语义（P3）：当前页全部记录未写入 targetType 时隐藏该列（表头/行/网格同步），
    后端补录该字段后自动恢复显示；title 悬停说明列含义 */
const noTargetTypes = computed(() => logs.value.length > 0 && logs.value.every((l) => !l.targetType))

/* D3 表格增强：列显隐（持久化 / 点击外部与 Esc 关闭由共享 MkCols 组件承担） */
const AL_COLS_KEY = 'wf_audit_hidden_cols'
const alColDefs = [
  { key: 'time', label: '时间', title: '操作时间' },
  { key: 'admin', label: '操作者', title: '管理员账号' },
  { key: 'action', label: '动作', title: 'HTTP 方法与路径' },
  { key: 'tt', label: '目标类型', title: '操作对象类别' },
  { key: 'target', label: '目标', title: '操作对象 ID' },
  { key: 'result', label: '结果', title: '成功 / 失败' },
  { key: 'ip', label: 'IP', title: '来源 IP' },
] as const
const hiddenCols = ref<Set<string>>(new Set())
/* 窄屏（≤720）：目标类型/目标/IP 次要列随 useIsNarrow 隐藏（th/td 统一走 colVisible），
   时间/操作者/动作/结果可完整放下，免 8 列横向滚动；行详情信息不丢 */
const isNarrow = useIsNarrow()
const MOBILE_HIDDEN_AL = new Set(['tt', 'target', 'ip'])
const colVisible = (key: string) => !hiddenCols.value.has(key) && !(isNarrow.value && MOBILE_HIDDEN_AL.has(key))
const visibleAlCols = computed(() => {
  let n = alColDefs.filter((c) => colVisible(c.key)).length
  if (noTargetTypes.value) n -= 1 // 目标类型列自动隐藏
  return n + 1 // + 箭头列
})

/* 传统分页（方案 A）：页码器 v-model 桥接；翻页 = 整页替换（replace） */
const currentPage = computed({
  get: () => page.value,
  set: (p: number) => {
    void goPage(p)
  }
})
const currentPageSize = computed({
  get: () => pageSize.value,
  set: (s: number) => {
    if (s === pageSize.value) return
    pageSize.value = s
    /* 每页条数变更：回第 1 页 + 按新 pageSize 重查 */
    void applyFilters()
  }
})

function buildParams(nextPage: number, scopeOverride?: typeof tab.value): AuditLogQuery {
  return {
    page: nextPage,
    limit: pageSize.value,
    scope: scopeOverride ?? tab.value,
    keyword: keyword.value.trim() || undefined,
    timeRange: timeRange.value === 'all' ? undefined : timeRange.value,
    sort: (alSortKey.value || undefined) as AuditLogQuery['sort'],
    order: alSortDir.value,
    /* 只看失败（失败 TOP chip 下钻）：后端 parseSuccess 白名单 true/false */
    success: failedOnly.value ? false : undefined,
  }
}

/** 拉取指定页并整体替换列表（total 来自后端 pagination.total，驱动页码器）。
    竞态守卫：seq 代际号 last-wins 丢弃过期响应；写入目标按「发起时」的 tab 固定，
    防止快速切 tab 后旧响应把操作审计写进登录审计（或反之） */
let fetchSeq = 0
async function fetchPage(nextPage: number) {
  const seq = ++fetchSeq
  const scope = tab.value
  try {
    const res = await adminAuditApi.getAuditLogs(buildParams(nextPage, scope))
    const data = res.data?.data ?? {}
    const list = (scope === 'operation' ? data.logs : data.attempts) ?? []
    if (seq !== fetchSeq) return // 已有更新的请求在途/完成：丢弃本次过期响应
    if (scope === 'operation') {
      logs.value = list
    } else {
      attempts.value = list
    }
    const pagination = data.pagination
    if (pagination && typeof pagination.total === 'number') total.value = pagination.total
    page.value = nextPage
    loadError.value = ''
  } catch (e) {
    if (seq === fetchSeq) loadError.value = errMsg(e)
  }
}

async function goPage(p: number) {
  if (p < 1 || p === page.value) return
  await fetchPage(p)
  /* 翻页替换列表后滚动回顶部 */
  window.scrollTo(0, 0)
}

/* stats 独立代际号：applyFilters 并行发起列表与统计，慢的旧 stats 响应
   不得覆盖新筛选的结果（与 fetchPage 同款 last-wins 守卫） */
let statsSeq = 0
async function fetchStats() {
  const seq = ++statsSeq
  try {
    const res = await adminAuditApi.getAuditStats(buildParams(1))
    if (seq !== statsSeq) return // 已有更新的统计请求在途/完成：丢弃过期响应
    const stats = res.data?.data?.stats
    if (stats) {
      total.value = typeof stats.total === 'number' ? stats.total : total.value
    }
    const byAction = res.data?.data?.failureByAction
    failureByAction.value = Array.isArray(byAction)
      ? byAction.filter((f: { action?: unknown; count?: unknown }) => typeof f?.action === 'string' && Number(f?.count) > 0)
      : []
  } catch {
    if (seq !== statsSeq) return
    failureByAction.value = []
  }
}

/** 失败聚合项展示名：语义名优先；老数据 action 为 `METHOD /path` → 取 path 兜底映射（已归一化动态 id） */
function failureLabel(action: string): string {
  const mapped = actionText(action)
  if (mapped !== action) return mapped
  const methodMatch = action.match(/^([A-Z]+)\s/)
  const method = methodMatch ? methodMatch[1] : ''
  const path = action.replace(/^[A-Z]+ /, '')
  return pathActionText(path, method) || action
}

/** 下钻关键词：老数据 action 是 `METHOD /path`（含真实 id，统计侧已归一化为 :id），
    精确 action 过滤命中不了 → 取 path 首段做 contains（path 列在 keyword 搜索白名单内）；
    语义键（非 API 动作）原样搜 action 列 */
function failureKeyword(action: string): string {
  const m = action.match(/^[A-Z]+\s+(\/[^/]+)/)
  return m ? m[1] : action
}

/** 失败 TOP chip 下钻：只看失败 + 该动作关键词；再点已激活的 chip = 退出下钻（关键词一并还原） */
function filterByFailure(action: string) {
  if (failedOnly.value && failedAction.value === action) {
    failedOnly.value = false
    failedAction.value = ''
    keyword.value = ''
  } else {
    failedOnly.value = true
    failedAction.value = action
    keyword.value = failureKeyword(action)
  }
  void applyFilters()
}

async function applyFilters() {
  loadError.value = ''
  loading.value = true
  page.value = 1
  logs.value = []
  attempts.value = []
  openId.value = ''
  /* stats 与列表并行发起：列表返回即渲染（loading 只跟列表走），stats 晚到异步补——
     原串行 await 会让慢 stats 拖住首屏列表 */
  const pageTask = fetchPage(1)
  void fetchStats()
  await pageTask
  loading.value = false
}

/** tab 回写 URL query：与 ?tab=login 深链闭环（切回默认 operation 时清掉参数） */
function syncTabQuery(id: TabId) {
  const next = { ...route.query }
  if (id === 'login') next.tab = 'login'
  else delete next.tab
  void router.replace({ query: next })
}

function switchTab(id: TabId) {
  if (tab.value === id) return
  tab.value = id
  syncTabQuery(id)
  void applyFilters()
}

/* 排序变更：与筛选同义，回第 1 页重查 */
watch([alSortKey, alSortDir], () => {
  void applyFilters()
})

const isFiltered = computed(() => !!keyword.value.trim() || timeRange.value !== 'today' || failedOnly.value)
function clearFilters() {
  keyword.value = ''
  timeRange.value = 'today'
  failedOnly.value = false
  failedAction.value = ''
  void applyFilters()
}

/* —— 保存视图：筛选组合命名存档（localStorage），pill 一键恢复 ——
   本页筛选未入 URL（仅 ?tab= 深链），保存视图即「可命名的筛选快捷方式」，价值比执行日志页更高 */
const { views: savedViews, save: saveViewToStore, remove: removeView } = useSavedViews('wf_audit_saved_views')

const TIME_RANGES = ['today', 'yesterday', 'week', 'month', 'all'] as const
const timeRangeLabels = { today: '今天', yesterday: '昨天', week: '近 7 天', month: '近 30 天', all: '全部' } as const

/** 当前筛选快照（仅含非默认值；tab 默认「操作审计」不存） */
function filterSnapshot(): Record<string, string> {
  const snap: Record<string, string> = {}
  if (tab.value !== 'operation') snap.tab = tab.value
  if (keyword.value.trim()) snap.q = keyword.value.trim()
  if (timeRange.value !== 'today') snap.range = timeRange.value
  return snap
}

/** 快照可读摘要（pill 悬停说明 / 命名建议） */
const filterLabel = computed(() => {
  const parts: string[] = []
  if (timeRange.value !== 'today') parts.push(timeRangeLabels[timeRange.value])
  if (keyword.value.trim()) parts.push(`关键词「${keyword.value.trim()}」`)
  if (tab.value === 'login') parts.push('登录审计')
  return parts.join(' · ') || ''
})
function describeQuery(q: Record<string, string>): string {
  const parts: string[] = []
  if (q.range) parts.push(timeRangeLabels[q.range as keyof typeof timeRangeLabels] || q.range)
  if (q.q) parts.push(`关键词「${q.q}」`)
  if (q.tab === 'login') parts.push('登录审计')
  return parts.join(' · ') || '默认筛选'
}
function savedViewTitle(v: SavedView): string {
  return `${describeQuery(v.query)}（点击应用 · × 删除）`
}

/** 应用保存视图：整体重写筛选后重查（tab 相同也走 applyFilters——keyword/range 无 watch） */
function applySavedView(v: SavedView) {
  const q = v.query || {}
  tab.value = q.tab === 'login' ? 'login' : 'operation'
  syncTabQuery(tab.value)
  /* 下钻态不在保存视图快照内：应用视图时一并还原，避免残留「只看失败」 */
  failedOnly.value = false
  failedAction.value = ''
  keyword.value = q.q || ''
  timeRange.value = (TIME_RANGES as readonly string[]).includes(q.range)
    ? (q.range as typeof timeRange.value)
    : 'today'
  void applyFilters()
}

/** 当前筛选恰好命中的保存视图名（高亮该 pill；默认视图不高亮） */
const activeSavedViewName = computed(() => {
  const snap = filterSnapshot()
  if (!Object.keys(snap).length) return ''
  return savedViews.value.find((v) => sameViewQuery(v.query, snap))?.name || ''
})

function onSaveView(name: string) {
  saveViewToStore(name, filterSnapshot())
}

const statusTitle = computed(() => (tab.value === 'login' ? '登录审计' : '审计日志'))

const REASON_TEXT: Record<string, string> = {
  account_locked: '账户已锁定',
  invalid_credentials: '用户名或密码错误',
  ok: '登录成功',
}
function reasonText(reason: string | null | undefined): string {
  const key = String(reason || '').toLowerCase()
  if (!key) return '—'
  return REASON_TEXT[key] || String(reason)
}

function fmtMs(ms: number) {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`
}
const pad = (n: number) => String(n).padStart(2, '0')
/* 绝对时间：与执行日志统一 MM-DD HH:MM:SS（完整时间见 tooltip fmtFull） */
function fmtTime(iso?: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}
function fmtFull(iso?: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}
/* 登录审计时间与操作审计同用 fmtTime（两者实现逐字符相同，P3 合并；均始终带日期） */

onMounted(() => {
  void applyFilters()
})

/** 会话安全深链：?user=用户名 → 只看该用户当前会话（系统工具宿主「会话安全」tab） */
function goSessions(username: string) {
  void router.push({ path: '/admin/ops-center', query: { tab: 'security', user: username } })
}

/** 导出当前筛选页为 JSON（与 ExecLogs.exportJson 同款：仅当前页 rows，非全量筛选结果）。
    操作审计 / 登录审计两个 tab 共用——rows 随 tab 取对应列表，文件名带 scope 区分 */
function exportCurrentPage() {
  const blob = new Blob([JSON.stringify(rows.value, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `audit-logs-${tab.value}-${Date.now()}.json`
  a.click()
  URL.revokeObjectURL(url)
}
</script>

<style scoped>
/* 本页无统计带（原型 renderAudit 页头下直接是列表卡，2026-10-02 撤） */

/* ================= 视图切换（原型 .tabs 下划线页签，页面本地复刻） =================
   2026-10-01 由 mk-pills 胶囊迁入；与 OpsHub 宿主页签、Users.vue 卡内页签同款：
   12px/600、激活蓝字+2px 蓝下划线、通栏底线 */
.tabs { display: flex; gap: 2px; border-bottom: 1px solid var(--mk-line); }
.tab {
  border: 0;
  background: transparent;
  color: var(--mk-muted);
  padding: 9px 12px;
  cursor: pointer;
  font: inherit;
  font-weight: 600;
  font-size: var(--mk-fs-micro);
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
  white-space: nowrap;
  transition: color 0.14s ease, border-color 0.14s ease;
}
.tab:hover { color: var(--mk-ink); }
.tab[aria-selected='true'] { color: var(--mk-blue); border-bottom-color: var(--mk-blue); }

/* 加载失败错误态 */

.log-body {
  overflow-x: auto;
}

/* 表格容器：全站 mk-table 标准表格（4K 由 shared.css 档位覆盖；窄屏表内横向滚动）。
   卡内内容区（原 .log-body 自绘边框随 mk-card 统一收敛，不再重复描边）。 */
.log-body .mk-table th { white-space: nowrap; }

/* 行状态：左侧 3px 色条（成功绿 / 失败红）+ 失败行淡红底 + 展开行高亮 */
.log-tr { cursor: pointer; }
.log-tr td:first-child { border-left: 3px solid transparent; }
.log-tr--ok td:first-child { border-left-color: var(--mk-green, #16a34a); }
.log-tr--err { background: rgba(220, 38, 38, 0.04); }
.log-tr--err td:first-child { border-left-color: var(--mk-red, #dc2626); }
.log-tr--open td { background: var(--mk-blue-bg); }
.log-tr--open .log-arrow { transform: rotate(90deg); }

/* 展开的 payload 行：整行铺开，不参与行点击 */
.log-payload-row { cursor: default; }
.log-payload-row td {
  padding: 4px 14px 14px 62px !important;
  /* 变量化后暗色自动适配，无需再写 dark 覆盖 */
  background: var(--mk-surface-2);
  border-bottom: 1px solid var(--mk-line);
}
.log-payload-row:hover td { background: var(--mk-surface-2); }

/* 单元格 */
.log-time {
  font-size: var(--mk-fs-micro);
  color: var(--mk-faint);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.log-admin {
  font-size: var(--mk-fs-micro);
  color: var(--mk-ink);
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 220px;
}
/* HTTP 方法徽标：按方法着色（颜色仅作识别辅助） */
.log-method {
  display: inline-block;
  font-family: var(--mk-mono);
  font-size: var(--mk-fs-micro);
  font-weight: 800;
  border-radius: var(--mk-radius-sm);
  padding: 1px 7px;
  margin-right: 7px;
  vertical-align: middle;
}
.log-method--get { background: #eff6ff; color: #1d4ed8; }
.log-method--post { background: #ecfdf5; color: #047857; }
.log-method--put { background: #fffbeb; color: #b45309; }
.log-method--patch { background: #f5f3ff; color: #6d28d9; }
.log-method--delete { background: #fef2f2; color: #b91c1c; }
.log-method--options,
.log-method--head { background: #f1f5f9; color: #475569; }
/* 动作名与方法之间的分隔符：避免「POST探测模型能力」这类无分隔粘连（复制文本也不再黏在一起） */
.log-action-sep {
  display: inline-block;
  margin: 0 6px;
  color: var(--mk-faint);
  font-weight: 700;
  vertical-align: middle;
}
/* API 路径：mono 省略号 + title 全值。
   max-width 用固定值（非 100%）：表格 auto 布局按单元格 max-content 定列宽，
   百分比 max-width 在列宽计算时视为 auto → 长路径会把整列撑宽（1440 下 654px、4K 下 1543px），
   固定上限让列宽有界（与 .mk-cell-main strong 的 --mk-cell-main-max 同一机制），4K 档由媒体查询放大 */
.log-path {
  /* inline-block（非 inline）：max-width/text-overflow 只对块级盒生效 */
  display: inline-block;
  font-size: var(--mk-fs-micro);
  color: var(--mk-ink);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  /* 200px（原 240px）：路径 + 分隔符 + 方法徽章同行内联排布，241+18+55 = 314px 超过
     动作列 1440 下的内容盒（≈301px），方法徽章被挤到第二行、行高翻倍。200px 留出余量
     后三者同行；完整路径仍在 title 与展开行里。 */
  max-width: 200px;
  vertical-align: middle;
}
/* 非 API 动作（中文标签）：中性蓝 chip */
/* UI 复查 #11：操作列是末列，贴表格右缘过紧，补右留白 */
.al-act { padding-right: 16px; }
/* 窄屏（≤720，次要列已随 useIsNarrow 隐藏）：操作者/动作列收为弹性宽 + 单行截断
   （全文在 title），长值不撑列 → 免横向滚动。
   （原 colgroup 固定列宽的 .al-col-* width:auto 覆盖随 fixed 布局一并退役） */
@media (max-width: 720px) {
  td.log-admin { max-width: 140px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  td .log-path { display: inline-block; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; vertical-align: bottom; }
}

.log-action {
  display: inline-block;
  font-size: var(--mk-fs-micro);
  font-weight: 700;
  border-radius: var(--mk-radius-sm);
  padding: 1px 8px;
  background: var(--mk-blue-bg);
  color: var(--mk-blue);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 240px;
}
/* P2-16：失败 TOP 聚合 chip（点击下钻到该动作的失败记录） */
.al-fails { display: inline-flex; align-items: center; gap: 6px; flex-wrap: wrap; max-width: 48%; }
.al-fails__label { font-size: var(--mk-fs-micro); font-weight: 800; color: var(--mk-faint); }
.al-fails__chip {
  border: 1px solid var(--mk-line);
  border-radius: 999px;
  background: transparent;
  color: var(--mk-muted);
  font-size: var(--mk-fs-micro);
  font-weight: 700;
  padding: 2px 8px;
  /* span→button：重置按钮默认字体并补手型 */
  cursor: pointer;
  font-family: inherit;
}
.al-fails__chip--on { border-color: var(--mk-red, #dc2626); color: var(--mk-red, #dc2626); }
.al-fails__chip b { color: #b91c1c; font-variant-numeric: tabular-nums; }
.log-tt {
  font-size: var(--mk-fs-micro);
  color: var(--mk-muted);
  white-space: nowrap;
}
.log-target {
  font-size: var(--mk-fs-micro);
  color: var(--mk-faint);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.log-ip {
  font-size: var(--mk-fs-micro);
  color: var(--mk-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.log-reason {
  font-size: var(--mk-fs-micro);
  color: var(--mk-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 320px;
}
/* 展开指示：行末箭头，展开时旋转 90°。
   箭头列显式定宽 + 居中 + overflow hidden：auto 布局下表头空列宽度随内容抖动，
   大字号/旋转动画下字符可能溢出列边界压到相邻列（用户反馈展开后箭头与邻列视觉重叠） */
.log-body table th:last-child { width: 36px; }
.log-arrow {
  display: block;
  width: 36px;
  max-width: 36px;
  min-width: 36px;
  margin-left: auto;
  text-align: center;
  overflow: hidden;
  font-size: var(--mk-fs-micro);
  color: var(--mk-faint);
  transition: transform 0.15s ease;
}

.log-payload { display: grid; gap: 8px; }
.log-payload-meta {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  font-size: var(--mk-fs-micro);
  color: var(--mk-faint);
  font-family: var(--mk-mono);
}
.log-ua {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 45%;
}
.log-payload pre {
  margin: 0;
  padding: 10px 12px;
  border-radius: var(--mk-radius-sm);
  background: #0d1420;
  color: #8ba3c7;
  font: 11px/1.6 var(--mk-mono);
  overflow: auto;
  max-height: 240px;
  white-space: pre-wrap;
  word-break: break-all;
}
.log-none { margin: 0; font-size: var(--mk-fs-micro); color: var(--mk-faint); }
.log-section { display: grid; gap: 4px; }
.log-label { font-size: var(--mk-fs-micro); font-weight: 700; letter-spacing: 0.06em; color: var(--mk-faint); }

/* 大屏/4K 适配（全站 mk 体系档位；表格由 shared.css 档位覆盖） */
@media (min-width: 2000px) {
  .log-time,
  .log-target,
  .log-ip { font-size: var(--mk-fs-micro); }
  .log-admin { font-size: var(--mk-fs-body); }
  .log-method { font-size: var(--mk-fs-micro); padding: 2px 9px; }
  .log-path { font-size: var(--mk-fs-micro); max-width: 520px; }
  .log-action { font-size: var(--mk-fs-micro); max-width: 520px; }
  .log-admin { max-width: 300px; }
  .log-tt,
  .log-reason,
  .log-none { font-size: var(--mk-fs-micro); }
  .log-payload-meta,
  .log-ua { font-size: var(--mk-fs-micro); }
  .log-label { font-size: var(--mk-fs-micro); }
  .log-payload pre { font-size: var(--mk-fs-micro); }
  .log-payload-row td { padding-left: 84px !important; }
  .log-arrow { font-size: var(--mk-fs-body); }
}
@media (min-width: 2800px) {
  .log-time,
  .log-target,
  .log-ip { font-size: var(--mk-fs-micro); }
  .log-admin { font-size: var(--mk-fs-body); }
  .log-method { font-size: var(--mk-fs-micro); }
  .log-path { font-size: var(--mk-fs-micro); max-width: 640px; }
  .log-action { font-size: var(--mk-fs-micro); max-width: 640px; }
  .log-admin { max-width: 360px; }
  .log-tt,
  .log-reason,
  .log-none { font-size: var(--mk-fs-micro); }
  .log-payload-meta,
  .log-ua { font-size: var(--mk-fs-micro); }
  .log-label { font-size: var(--mk-fs-micro); }
  .log-payload pre { font-size: var(--mk-fs-micro); }
  .log-arrow { font-size: var(--mk-fs-body); }
}
@media (min-width: 3600px) {
  .log-time,
  .log-target,
  .log-ip { font-size: var(--mk-fs-body); }
  .log-admin { font-size: var(--mk-fs-emphasis); }
  .log-method { font-size: var(--mk-fs-micro); padding: 3px 11px; }
  .log-path { font-size: var(--mk-fs-body); max-width: 760px; }
  .log-action { font-size: var(--mk-fs-body); max-width: 760px; }
  .log-admin { max-width: 420px; }
  .log-tt,
  .log-reason,
  .log-none { font-size: var(--mk-fs-body); }
  .log-payload-meta,
  .log-ua { font-size: var(--mk-fs-body); }
  .log-label { font-size: var(--mk-fs-body); }
  .log-payload pre { font-size: var(--mk-fs-body); }
  .log-payload-row td { padding-left: 100px !important; }
  .log-arrow { font-size: var(--mk-fs-body); }
}

/* ================= 暗色模式：仅方法徽标需单独配色。行底/嵌套面已随
   --mk-blue-bg / --mk-surface-2 / --mk-line 变量自动适配，
   原嵌套块与扁平规则两组重复覆盖一并删除 ================= */
html[data-theme='dark'] .log-method--get { background: rgba(91, 141, 239, 0.16); color: #93b4f5; }
html[data-theme='dark'] .log-method--post { background: rgba(74, 222, 128, 0.14); color: #6ee7a0; }
html[data-theme='dark'] .log-method--put { background: rgba(251, 191, 36, 0.14); color: #fcd34d; }
html[data-theme='dark'] .log-method--patch { background: rgba(167, 139, 250, 0.16); color: #c4b5fd; }
html[data-theme='dark'] .log-method--delete { background: rgba(248, 113, 113, 0.14); color: #fca5a5; }
html[data-theme='dark'] .log-method--options,
html[data-theme='dark'] .log-method--head { background: #2d2d2f; color: #afb1b6; }

/* ================= 空态撑满主区剩余高度（P1-1，2026-09-27 走查「空态利用」）=================
   本页是 .mk-page--fill + .mk-card--fill 应用式布局：空态带 mk-empty--min 后若不按本页壳层
   覆写 --mk-empty-min-h，会用全局默认口径（100dvh - 230px）——本页卡内还有页签
   切换行与筛选头两层，默认值会把空态撑出卡片导致底部裁切。走 BatchExperiments.vue
   同款页面覆写口（mk-primitives.css 预留），按本页壳层实测逐项推导（1920×1080、无 zoom；
   本页挂在 AdminConsole 壳层 .mshell__content 内滚动；2026-10-02 撤状态条后重算）：
     面包屑 .mshell__crumb         ~32（上下 7px 内边距 + 12px 微字号行高 ~18 + 1px 下边框）
     页面 padding-top               16（.mk-page--fill 的 --mk-space-4）
     页签切换行（.tabs，卡内顶部）    ~36（tab 上下 padding 9px×2 + 微字号行高 ~18）
     卡片头 .mk-card__head          ~54（12px 内边距×2 + 32px 筛选控件；失败 TOP chips 换行的
                                       场景必有数据，不会落到空态分支，不参与推导）
     卡片上下边框                    2
     页面 padding-bottom            20（.mk-page 的 --mk-space-5）
   合计 ≈160，留 ~8px 余量取整 168（宁少勿溢：多留余量只是空态盒底部差一点撑满，
   少留则 min-height 顶破 flex 高度被 .mk-page--fill 的 overflow:hidden 裁掉）。
   上限用 min(..., 1200px) 而非 max-height：CSS 里 min-height 优先于 max-height，
   超长竖屏下直接写 max-height 会被 min 顶掉不生效，min() 才能真正收口。
   骨架/错误态/列表分支不带 mk-empty--min，不受影响。 */
.mk-card--fill > .mk-empty--min {
  --mk-empty-min-h: min(calc(100dvh - 168px), 1200px);
}
</style>
