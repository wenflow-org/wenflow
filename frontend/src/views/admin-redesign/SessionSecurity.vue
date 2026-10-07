<template>
  <div :class="embedded ? 'mk-page--fill ss-embedded' : 'mk-page'">
    <!-- 状态条：全量会话统计 + 刷新（embedded 时由系统工具宿主承载域计数，不再渲染） -->
    <div v-if="!embedded" class="mk-status" :class="`mk-status--${statusTone}`">
      <span class="mk-status__dot"></span>
      <strong class="mk-status__title">会话安全</strong>
      <span class="mk-status__sep"></span>
      <span class="mk-status__meta mono">{{ totalCount }} 个会话</span>
      <span v-if="totalCount" class="mk-status__meta mono">活跃 {{ activeCount }}</span>
      <span v-if="expiredCount" class="mk-status__meta mono">已过期 {{ expiredCount }}</span>
      <span v-if="revokedCount" class="mk-status__meta mono">已撤销 {{ revokedCount }}</span>
      <button type="button" class="mk-status__action" :disabled="loading" @click="applyFilters">
        {{ loading ? '刷新中…' : '刷新' }}
      </button>
    </div>

    <!-- 审计日志深链横幅（?user=用户名 → 只看该管理员的会话；含分工说明 + 反向跳转）：
         走全局 .mk-alert--info（原型 .alert--info 词汇），本地只补行内布局 -->
    <div v-if="deepLinkUser" class="mk-alert mk-alert--info ss-deeplink">
      <strong>来自审计日志 · 查看「{{ deepLinkUser }}」的登录会话</strong>
      <span>这里展示登录成功产生的会话（可强制下线）；登录事件完整历史（含失败尝试）见</span>
      <button type="button" class="mk-link" @click="goAuditLogs">审计日志 · 登录审计 →</button>
      <button type="button" class="mk-link ss-deeplink__clear" @click="clearDeepLink">× 清除筛选</button>
    </div>
    <!-- 常驻分工说明（无深链时） -->
    <div v-else class="ss-note">
      <span>展示登录成功产生的会话（可管理/强制下线）；登录事件的完整历史（含失败尝试）见</span>
      <button type="button" class="mk-link" @click="goAuditLogs">审计日志 · 登录审计 →</button>
    </div>

    <!-- 加载失败错误态：仅「整页无数据可显示」时走整页错误（审核 #179：原判据只有 loadError，
         刷新失败会把已渲染的会话表整个顶掉——用户只是想更新数据却丢掉整屏。有旧行时改走
         下方卡内行内 alert 并保留表格，与同单元 DayTimeline「操作失败不顶掉已渲染内容」同口径） -->
    <MkEmptyState
      v-if="loadError && !sessions.length"
      icon="◌"
      tone="error"
      title="会话列表加载失败"
      :description="loadError"
      action-text="重试"
      @action="applyFilters"
    />

    <!-- 加载中骨架 -->
    <div v-else class="mk-card mk-card--fill">
      <!-- 有旧行时刷新失败：行内 alert + 保留表格（重试入口就地在案） -->
      <div v-if="loadError" class="mk-alert mk-alert--row ss-stale-alert" role="alert">
        <div class="mk-alert__msg">{{ loadError }}</div>
        <div class="mk-alert__act">
          <button type="button" class="mk-btn mk-btn--sm" :disabled="loading" @click="applyFilters">重试</button>
        </div>
      </div>
      <div class="mk-card__head">
        <div class="mk-filter">
          <div class="mk-pills">
            <button
              v-for="p in statusPills"
              :key="p.id"
              type="button"
              class="mk-pill"
              :class="{ 'mk-pill--active': statusFilter === p.id }"
              :aria-pressed="statusFilter === p.id"
              :title="`只看${p.label}会话（计数为后端全量；筛选只作用于已加载的最近 ${sessions.length} 条行）`"
              @click="statusFilter = statusFilter === p.id ? '' : p.id"
            >
              {{ p.label }}<span v-if="countOf(p.id) > 0" class="mk-pill__count">{{ countOf(p.id) }}</span>
            </button>
          </div>
          <button v-if="statusFilter" type="button" class="mk-link" @click="statusFilter = ''">清除筛选</button>
        </div>
        <div class="mk-card__head-right">
          <span class="mk-card__meta" :title="countsTitle">{{ totalCount }} 个会话<template v-if="activeCount"> · 活跃 {{ activeCount }}</template><template v-if="truncated"> · 行列表仅含最近 {{ sessions.length }} 条</template></span>
        </div>
      </div>

    <MockSkeletonTable v-if="loading && !sessions.length" :cols="7" :rows="6" />

    <!-- 按管理员分组的标准表格 -->
    <div v-else-if="groups.length" class="ss-body">
      <div v-for="{ g, active } in visibleGroups" :key="g.adminId" class="mk-card ss-group">
        <div class="mk-card__head">
          <div class="ss-group__who">
            <strong>{{ g.adminName }}</strong>
            <span v-if="g.adminEmail" class="ss-group__email mono">{{ g.adminEmail }}</span>
            <span class="ss-group__count">{{ groupCounts(g).total }} 个会话<template v-if="groupCounts(g).active"> · {{ groupCounts(g).active }} 个活跃</template></span>
          </div>
          <button
            v-if="revokeCount(g)"
            type="button"
            class="mk-btn mk-btn--danger-ghost mk-btn--sm"
            :title="`吊销「${g.adminName}」全部未吊销会话（后端按管理员全量作用域，含行窗口外的会话）`"
            @click="revokeAll(g)"
          >
            下线全部<template v-if="revokeCount(g) > 1">（{{ revokeCount(g) }}）</template>
          </button>
        </div>

        <!-- 活跃会话表（分页：每批 12 行） -->
        <div class="mk-table-scroll">
          <table class="mk-table mk-table--fixed">
            <colgroup>
              <col style="width:var(--mk-col-text)">
              <col style="width:var(--mk-col-id)">
              <col class="ss-col--time">
              <col class="ss-col--time">
              <col class="ss-col--time">
              <col style="width:var(--mk-col-badge)">
              <col style="width:var(--mk-col-actions-wide)">
            </colgroup>
            <thead>
              <tr>
                <th>设备</th>
                <th>IP</th>
                <th>登录时间</th>
                <th>最后活跃</th>
                <th>过期时间</th>
                <th>状态</th>
                <th class="mk-th--right">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="!active.length" class="ss-tr--empty">
                <td colspan="7">该管理员当前无活跃会话</td>
              </tr>
              <tr
                v-for="s in active"
                :key="s.id"
                class="ss-tr"
                :class="{ 'ss-tr--current': s.id === currentId }"
              >
                <td :title="uaFull(s)">
                  <div class="mk-cell-main">
                    <strong class="ss-device">
                      <span class="ss-dot" :class="`ss-dot--${deviceOf(s).kind}`" aria-hidden="true"></span>
                      <span class="ss-browser">{{ deviceOf(s).browser }}</span>
                    </strong>
                    <span class="mk-cell-sub">{{ deviceOf(s).os || '未知系统' }}<template v-if="s.remember"> · 记住我</template></span>
                  </div>
                </td>
                <td class="ss-ip mono" :title="s.ip || ''">{{ ipText(s.ip) }}</td>
                <td class="ss-time mono" :title="fmtFull(s.issuedAt)">{{ fmtDateTime(s.issuedAt) }}</td>
                <td class="ss-time mono" :title="s.lastSeenAt ? fmtFull(s.lastSeenAt) : ''">
                  <!-- 批C：新鲜度点做活跃度视觉锚；绝对时间保留（安全审计回溯刚需，不藏 title） -->
                  <span class="mk-fresh" :class="lastSeenFreshTone(s)" style="justify-content: flex-end">
                    <template v-if="s.lastSeenAt">{{ fmtDateTime(s.lastSeenAt) }}</template>
                    <template v-else>—</template>
                  </span>
                </td>
                <td class="ss-time mono" :class="{ 'ss-time--soon': expiringSoon(s) }" :title="expiryTitle(s)">
                  <div class="mk-cell-main">
                    <span>{{ fmtDateTime(s.expiresAt) }}</span>
                    <!-- F6-5：24h 内过期行给出可读剩余时长（颜色只是辅助，文字才是信号） -->
                    <span v-if="expiringSoon(s)" class="ss-expiry-soon">剩 {{ remainText(s) }}</span>
                  </div>
                </td>
                <td><span class="mk-badge" :class="statusClass(s)">{{ statusTextOf(s) }}</span></td>
                <td class="mk-th--right">
                  <div class="mk-actions">
                    <span v-if="s.id === currentId" class="ss-current" title="当前登录标签页的会话，不可下线">当前</span>
                    <button
                      v-else-if="statusOf(s) === 'active'"
                      type="button"
                      class="mk-btn mk-btn--danger-ghost mk-btn--sm"
                      @click="revoke(s)"
                    >强制下线</button>
                    <span v-else class="ss-na">—</span>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- 过期/已撤销历史（默认收起；「已撤销」筛选时自动展开）：折叠头走全局 .mk-section__summary -->
        <details v-if="g.historical.length" class="ss-hist" :open="statusFilter !== ''">
          <summary class="mk-section__summary ss-hist__summary">
            <span class="ss-hist__title">已过期 · 已撤销（{{ g.historical.length }}<template v-if="fullHistorical(g) > g.historical.length"> / 全量 {{ fullHistorical(g) }}</template>）</span>
            <span class="ss-hist__meta">过期 {{ groupCounts(g).expired }} · 已撤销 {{ groupCounts(g).revoked }}</span>
          </summary>
          <div class="mk-table-scroll">
            <table class="mk-table mk-table--fixed">
              <colgroup>
                <col style="width:var(--mk-col-text)">
                <col style="width:var(--mk-col-id)">
                <col class="ss-col--time">
                <col class="ss-col--time">
                <col class="ss-col--time">
                <col style="width:var(--mk-col-badge)">
                <col style="width:var(--mk-col-actions-wide)">
              </colgroup>
              <thead>
                <tr>
                  <th>设备</th>
                  <th>IP</th>
                  <th>登录时间</th>
                  <th>最后活跃</th>
                  <th>过期时间</th>
                  <th>状态</th>
                  <th class="mk-th--right">操作</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="s in g.historical" :key="s.id" class="ss-tr">
                  <td :title="uaFull(s)">
                    <div class="mk-cell-main">
                      <strong class="ss-device">
                        <span class="ss-dot" :class="`ss-dot--${deviceOf(s).kind}`" aria-hidden="true"></span>
                        <span class="ss-browser">{{ deviceOf(s).browser }}</span>
                      </strong>
                      <span class="mk-cell-sub">{{ deviceOf(s).os || '未知系统' }}<template v-if="s.remember"> · 记住我</template></span>
                    </div>
                  </td>
                  <td class="ss-ip mono" :title="s.ip || ''">{{ ipText(s.ip) }}</td>
                  <td class="ss-time mono" :title="fmtFull(s.issuedAt)">{{ fmtDateTime(s.issuedAt) }}</td>
                  <td class="ss-time mono" :title="s.lastSeenAt ? fmtFull(s.lastSeenAt) : ''">
                    {{ s.lastSeenAt ? fmtDateTime(s.lastSeenAt) : '—' }}
                  </td>
                  <td class="ss-time mono" :class="{ 'ss-time--soon': expiringSoon(s) }" :title="fmtFull(s.expiresAt)">
                    {{ fmtDateTime(s.expiresAt) }}
                  </td>
                  <td><span class="mk-badge" :class="statusClass(s)">{{ statusTextOf(s) }}</span></td>
                  <td class="mk-th--right">
                    <div class="mk-actions">
                      <span v-if="s.id === currentId" class="ss-current" title="当前登录标签页的会话，不可下线">当前</span>
                      <button
                        v-else-if="statusOf(s) === 'active'"
                        type="button"
                        class="mk-btn mk-btn--danger-ghost mk-btn--sm"
                        @click="revoke(s)"
                      >强制下线</button>
                      <span v-else class="ss-na">—</span>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </details>
      </div>

      <!-- 分页：活跃会话每批 12 行（首屏可见） -->
      <div v-if="canMoreActive" class="mk-list-more">
        <button type="button" class="mk-link" @click="loadMoreActive">加载更多（已显示 {{ shownActive.length }} / {{ activeFlat.length }} 个活跃会话<template v-if="truncated">，仅已加载窗口，后端全量活跃 {{ activeCount }}</template>）</button>
      </div>
    </div>

    <!-- 空态 -->
    <MkEmptyState
      v-else
      icon="🔐"
      :title="statusFilter ? '当前筛选无会话' : '暂无会话记录'"
      description="管理员登录后会话会显示在这里，可随时强制下线"
      :action-text="statusFilter ? '清除筛选' : ''"
      @action="statusFilter = ''"
    />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { adminAuthApi, adminSessionsApi } from '@/api/adminApi'
import { errMsg } from './live'
import { useLoadMore } from './useLoadMore'
import { useIsNarrow } from './useIsNarrow'
import { ipText } from './statusText'
import { askConfirm, doneConfirm, failConfirm } from './useConfirm'
import { toast } from '@/utils/toast'
import MockSkeletonTable from './SkeletonTable.vue'
import MkEmptyState from '@/components/mk/MkEmptyState.vue'

/** 嵌入模式：作为「系统工具」页「会话安全」tab 渲染（仅去掉外层状态条；宿主承载域计数与刷新）。
    count 事件：会话总数上报（宿主「会话 N」徽章） */
withDefaults(defineProps<{ embedded?: boolean }>(), { embedded: false })
const emit = defineEmits<{ (e: 'count', total: number): void }>()

/** admin_sessions 行（与后端 Prisma 模型一致 + adminName/adminEmail 联查字段） */
interface AdminSessionRow {
  id: string
  adminId: string
  jti: string
  ip?: string | null
  userAgent?: string | null
  remember: boolean
  issuedAt: string
  expiresAt: string
  lastSeenAt?: string | null
  revokedAt?: string | null
  createdAt: string
  adminName?: string | null
  adminEmail?: string | null
}

type SessionStatus = 'active' | 'expired' | 'revoked'

/** UA 解析：浏览器 / 系统 / 平台色点分类（原始 UA 完整值保留在单元格 title） */
interface DeviceInfo {
  browser: string
  os: string
  kind: 'windows' | 'mac' | 'linux' | 'android' | 'ios' | 'other'
}
/** 版本号规整：去掉尾部 `.0` 段（Headless Chrome 上报 152.0.0.0 这类），保留有意义的段 */
const fmtVer = (v: string) => v.replace(/(?:\.0)+$/, '') || v
function deviceOf(s: AdminSessionRow): DeviceInfo {
  const ua = s.userAgent || ''
  const out: DeviceInfo = { browser: '未知', os: '', kind: 'other' }
  if (!ua) return out
  let m: RegExpMatchArray | null
  if ((m = ua.match(/Edg(?:e|A)?\/([\d.]+)/))) out.browser = `Edge ${fmtVer(m[1])}`
  else if ((m = ua.match(/OPR\/([\d.]+)/))) out.browser = `Opera ${fmtVer(m[1])}`
  else if ((m = ua.match(/HeadlessChrome\/([\d.]+)/))) out.browser = `Headless Chrome ${fmtVer(m[1])}`
  else if ((m = ua.match(/Chrome\/([\d.]+)/))) out.browser = `Chrome ${fmtVer(m[1])}`
  else if ((m = ua.match(/Firefox\/([\d.]+)/))) out.browser = `Firefox ${fmtVer(m[1])}`
  else if ((m = ua.match(/Version\/([\d.]+).*Safari/))) out.browser = `Safari ${fmtVer(m[1])}`
  else if (/WindowsPowerShell/i.test(ua)) out.browser = 'PowerShell'
  else if (/curl\//.test(ua)) out.browser = 'curl'
  else if (/PostmanRuntime/.test(ua)) out.browser = 'Postman'
  else if (/python-requests/.test(ua)) out.browser = 'Python requests'
  else if (/Python-urllib/.test(ua)) out.browser = 'Python urllib'
  else if (/axios/.test(ua)) out.browser = 'axios'
  else if (/Playwright/.test(ua)) out.browser = 'Playwright'
  else if (/Go-http-client/.test(ua)) out.browser = 'Go http client'
  else if (/okhttp/.test(ua)) out.browser = 'OkHttp'
  else if (/Java\//.test(ua)) out.browser = 'Java'
  else if (/node/i.test(ua)) out.browser = 'Node.js'
  // 解析失败：降级展示原始 UA 片段（去 Mozilla 前缀），而不是对判断无信息的「未知」
  if (out.browser === '未知') {
    const snippet = ua.replace(/^Mozilla\/5\.0\s*/i, '').slice(0, 48)
    if (snippet) out.browser = snippet
  }
  if (/Windows NT 10\.0/.test(ua)) { out.os = 'Windows 10/11'; out.kind = 'windows' }
  else if (/Windows NT 6\.[13]/.test(ua)) { out.os = 'Windows 7/8'; out.kind = 'windows' }
  else if (/Mac OS X/.test(ua)) { out.os = 'macOS'; out.kind = 'mac' }
  else if (/Android/.test(ua)) { out.os = 'Android'; out.kind = 'android' }
  else if (/iPhone|iPad|iPod/.test(ua)) { out.os = 'iOS'; out.kind = 'ios' }
  else if (/CrOS/.test(ua)) { out.os = 'ChromeOS'; out.kind = 'linux' }
  else if (/Linux/.test(ua)) { out.os = 'Linux'; out.kind = 'linux' }
  return out
}

const sessions = ref<AdminSessionRow[]>([])
/** 后端全量口径计数（非行窗口）：GET /admin/sessions 的 data.counts。
    行窗口（limit 默认 100）只约束列表行，页面统计/组头/批量下线一律以本组值为准
    （运营走查 B13 F6-1：原实现把 100 行窗口读成全量）。 */
const counts = ref<{ total: number; active: number; expired: number; revoked: number } | null>(null)
/** 每管理员全量计数：adminId → { total, active, expired, revoked } */
const adminCounts = ref(new Map<string, { total: number; active: number; expired: number; revoked: number }>())
/** 行窗口是否被后端 limit 截断（全量总数 > 已加载行数）→ 显式披露「仅显示最近 N 条」 */
const truncated = computed(() => !!counts.value && counts.value.total > sessions.value.length)
/** 是否至少成功加载过一次（宿主计数的就绪门：未就绪上报 -1，宿主渲染「待访问」而非 0） */
const loaded = ref(false)
const loading = ref(false)
const loadError = ref('')
const statusFilter = ref<'' | SessionStatus>('')
const myId = ref('')
let fetching = false

const route = useRoute()
const router = useRouter()
/** 审计日志深链：?user=用户名 → 仅展示该管理员的会话组 */
const deepLinkUser = computed(() => String(route.query.user || '').trim())
function clearDeepLink() {
  // 仅移除 user 筛选，保留宿主 tab 查询（嵌入「系统工具」页时 ?tab=security 不可被清掉）
  const q = { ...route.query }
  delete q.user
  void router.replace({ query: q })
}
/** 反向跳转：审计日志 · 登录审计 tab */
function goAuditLogs() {
  void router.push('/admin/audit-logs?tab=login')
}

const statusPills: Array<{ id: SessionStatus; label: string }> = [
  { id: 'active', label: '活跃' },
  { id: 'expired', label: '已过期' },
  { id: 'revoked', label: '已撤销' },
]

function statusOf(s: AdminSessionRow): SessionStatus {
  if (s.revokedAt) return 'revoked'
  if (new Date(s.expiresAt).getTime() <= Date.now()) return 'expired'
  return 'active'
}
const statusTextOf = (s: AdminSessionRow) => (statusOf(s) === 'active' ? '活跃' : statusOf(s) === 'expired' ? '已过期' : '已撤销')
function statusClass(s: AdminSessionRow): string {
  if (statusOf(s) === 'active') return 'mk-badge--ok'
  if (statusOf(s) === 'expired') return 'mk-badge--muted'
  return 'mk-badge--bad'
}

/** 当前会话：本管理员中最新创建的活跃会话（登录即新建，同 adminId 下 createdAt 最新者即当前标签页） */
const currentId = computed(() => {
  const mine = sessions.value.filter((s) => s.adminId === myId.value && statusOf(s) === 'active')
  if (!mine.length) return ''
  return [...mine].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0].id
})

/** 分组统计读全量口径（后端 adminCounts），缺失时回落窗口内计数。
    行窗口只决定列表渲染哪些行，组头/折叠头/批量下线按钮的条数一律走这里，
    否则「100 行窗口」会被读成该管理员的真实会话量（运营走查 B13 F6-1）。 */
function groupCounts(g: SessionGroup): { total: number; active: number; expired: number; revoked: number } {
  const full = adminCounts.value.get(g.adminId)
  if (full) return full
  return { total: g.sessions.length, active: g.active.length, expired: g.expiredCount, revoked: g.revokedCount }
}

/** 分组全量历史数（过期 + 已撤销）：行窗口截断时折叠头披露「N / 全量 M」 */
function fullHistorical(g: SessionGroup): number {
  const c = groupCounts(g)
  return c.expired + c.revoked
}

/** 「下线全部」实际会下线的会话数：后端 revoke-all 的作用域是 `revokedAt: null`（全量、无 limit），
    即「活跃 + 未撤销但已过期」两类；excludeCurrent 再剔除请求者当前 jti（活跃会话）。
    按钮与确认文案同源，且与后端真实作用域一致（B13 F6-1：原实现只数活跃行，低估作用域）。 */
function revokeCount(g: SessionGroup): number {
  const c = groupCounts(g)
  const n = c.active + c.expired
  if (g.adminId === myId.value && currentId.value) return Math.max(0, n - 1)
  return n
}

/** 卡头口径 title：窗口截断时说明行列表只含最近 N 条，统计仍为全量 */
const countsTitle = computed(() =>
  truncated.value
    ? `统计为后端全量口径；行列表仅含最近 ${sessions.value.length} 条（接口行窗口上限）`
    : '统计与行列表均为后端全量口径'
)

/** 全量统计四口径：后端 counts 缺失（旧响应/mock）时回落窗口内计数。
    有值时统计条 / pills / 组头 / 批量下线按钮都读它，保证「全量」自称成立。 */
const activeCount = computed(() => (counts.value ? counts.value.active : sessions.value.filter((s) => statusOf(s) === 'active').length))
const expiredCount = computed(() => (counts.value ? counts.value.expired : sessions.value.filter((s) => statusOf(s) === 'expired').length))
const revokedCount = computed(() => (counts.value ? counts.value.revoked : sessions.value.filter((s) => statusOf(s) === 'revoked').length))
const totalCount = computed(() => (counts.value ? counts.value.total : sessions.value.length))
const statusTone = computed(() => {
  if (loadError.value) return 'bad'
  if (!totalCount.value) return 'muted'
  return activeCount.value ? 'ok' : 'warn'
})
function countOf(id: SessionStatus): number {
  return id === 'active' ? activeCount.value : id === 'expired' ? expiredCount.value : revokedCount.value
}

/** 宿主域计数徽章（embedded 才消费）：会话总数就绪/变化即上报。
    审核 #175：0 是「确认无会话」的假信号——就绪门：仅加载成功上报真实条数，
    未就绪/失败上报 -1，宿主把 <0 渲染成「待访问」。
    B13 F6-1：上报值由窗口行数改全量 totalCount（页签角标不再把 limit=100 的窗口读成全量）。 */
watch([sessions, counts, loaded, loadError], ([, , ok, err]) => {
  emit('count', err || !ok ? -1 : totalCount.value)
}, { immediate: true })

const filtered = computed(() =>
  sessions.value.filter((s) => !statusFilter.value || statusOf(s) === statusFilter.value)
)

interface SessionGroup {
  adminId: string
  adminName: string
  adminEmail: string
  sessions: AdminSessionRow[]
  active: AdminSessionRow[]
  historical: AdminSessionRow[]
  expiredCount: number
  revokedCount: number
}
const groups = computed<SessionGroup[]>(() => {
  const map = new Map<string, AdminSessionRow[]>()
  for (const s of filtered.value) {
    if (deepLinkUser.value && (s.adminName || s.adminEmail || '') !== deepLinkUser.value) continue
    const list = map.get(s.adminId) ?? []
    list.push(s)
    map.set(s.adminId, list)
  }
  return [...map.entries()].map(([adminId, list]) => {
    const first = list[0]
    return {
      adminId,
      adminName: first.adminName || first.adminEmail || adminId,
      adminEmail: first.adminEmail || '',
      sessions: list,
      active: list.filter((s) => statusOf(s) === 'active'),
      historical: list.filter((s) => statusOf(s) !== 'active'),
      expiredCount: list.filter((s) => statusOf(s) === 'expired').length,
      revokedCount: list.filter((s) => statusOf(s) === 'revoked').length,
    }
  })
})

/* 分页（审计 L1）：活跃会话全量平铺 → 每批 12 行；
   历史组保持 details 折叠不受分页影响 */
const activeFlat = computed(() => groups.value.flatMap((g) => g.active))
const { shown: shownActive, canMore: canMoreActive, loadMore: loadMoreActive } = useLoadMore(activeFlat, 12)

/** 分页后的可见分组：表头统计 / 下线全部保持全量口径（g 为完整分组），行渲染只取当批活跃会话 */
const visibleGroups = computed(() => {
  const shown = new Set(shownActive.value.map((s) => s.id))
  return groups.value
    .map((g) => ({ g, active: g.active.filter((s) => shown.has(s.id)) }))
    .filter((x) => x.active.length || x.g.historical.length)
})

/** 拉取会话：行（窗口）+ 后端全量统计（counts/adminCounts）。
    行用于列表渲染与客户端状态筛选；统计用于状态条/组头/批量下线条数——两者口径分离，
    统计恒为全量（B13 F6-1），行窗口截断时由 truncated 显式披露。 */
async function applyFilters() {
  if (fetching) return
  fetching = true
  loadError.value = ''
  loading.value = true
  try {
    const res = await adminSessionsApi.getAdminSessions()
    const payload = res.data?.data ?? {}
    sessions.value = payload.sessions ?? []
    const serverCounts = payload.counts
    counts.value = serverCounts && typeof serverCounts.total === 'number' ? serverCounts : null
    const list: Array<{ adminId: string } & { total: number; active: number; expired: number; revoked: number }> =
      Array.isArray(payload.adminCounts) ? payload.adminCounts : []
    adminCounts.value = new Map(list.map((c) => [c.adminId, c]))
    loaded.value = true
  } catch (e) {
    loadError.value = errMsg(e)
  } finally {
    loading.value = false
    fetching = false
  }
}

/** 设备完整 UA（单元格 title / 下线确认弹窗用，不截断） */
function uaFull(s: AdminSessionRow): string {
  return s.userAgent || '未知设备'
}

/** 24 小时内过期的活跃会话高亮提示 */
function expiringSoon(s: AdminSessionRow): boolean {
  if (statusOf(s) !== 'active') return false
  return new Date(s.expiresAt).getTime() - Date.now() <= 24 * 60 * 60 * 1000
}
/** 剩余时长（F6-5）：安全运维关心「还有多久过期」，给可读文字而非仅颜色差。
    24h 内按小时、<1h 按分钟（向上取整，最小 1 分钟），避免出现「剩 0 小时」。 */
function remainText(s: AdminSessionRow): string {
  const ms = new Date(s.expiresAt).getTime() - Date.now()
  if (ms <= 0) return '已到期'
  const mins = Math.ceil(ms / 60_000)
  if (mins < 60) return `${mins} 分钟`
  return `${Math.ceil(mins / 60)} 小时`
}
/** 过期时间列 title：完整时间 + （即将过期时）剩余时长与高亮原因 */
function expiryTitle(s: AdminSessionRow): string {
  const full = fmtFull(s.expiresAt)
  return expiringSoon(s) ? `${full}（${remainText(s)}后过期）` : full
}
/* 批C：最后活跃新鲜度三档（mk-fresh 原语；24h 内=新鲜） */
function lastSeenFreshTone(s: AdminSessionRow): string {
  if (!s.lastSeenAt) return 'mk-fresh--never'
  return Date.now() - new Date(s.lastSeenAt).getTime() < 24 * 60 * 60 * 1000 ? 'mk-fresh--fresh' : ''
}

async function revoke(s: AdminSessionRow) {
  const confirmed = await askConfirm({
    title: '强制下线该会话',
    message: `确定强制下线此会话吗？\n设备：${uaFull(s)}\n登录时间：${fmtDateTime(s.issuedAt)}`,
    confirmText: '强制下线',
    busy: true,
  })
  if (!confirmed) return
  try {
    await adminSessionsApi.revokeAdminSession(s.id)
    s.revokedAt = new Date().toISOString()
    toast.success('会话已强制下线')
    doneConfirm()
  } catch (e) {
    toast.error(`下线失败：${errMsg(e)}`)
    failConfirm()
  }
}

async function revokeAll(g: SessionGroup) {
  const confirmed = await askConfirm({
    title: '下线该管理员全部会话',
    message: `将强制下线「${g.adminName}」的全部未吊销会话（后端按管理员全量作用域，含未在列表中显示的会话，共 ${revokeCount(g)} 个，当前登录标签页除外），确定吗？`,
    confirmText: '全部下线',
    busy: true,
  })
  if (!confirmed) return
  try {
    const res = await adminSessionsApi.revokeAllAdminSessions({ adminId: g.adminId, excludeCurrent: true })
    const count = res.data?.data?.count ?? revokeCount(g)
    toast.success(`已下线 ${count} 个会话`)
    await applyFilters()
    doneConfirm()
  } catch (e) {
    toast.error(`下线失败：${errMsg(e)}`)
    failConfirm()
  }
}

const pad = (n: number) => String(n).padStart(2, '0')
/* LY6（2026-10-05 布局方案 §4）：≤1599 档三列 datetime 收 176→112，可见时刻改紧凑口径
   MM-DD HH:mm（省年，会话有效期以天计）；完整时间仍在 title（fmtFull）与下线确认弹窗。 */
const isMid = useIsNarrow(1600)
function fmtDateTime(iso?: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  if (isMid.value) return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}
function fmtFull(iso?: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

/** 宿主刷新联动（系统工具宿主「刷新」按钮 → 重拉会话列表） */
defineExpose({ refresh: () => { void applyFilters() } })

onMounted(async () => {
  // 取当前管理员 id，用于标记「当前会话」
  try {
    const res = await adminAuthApi.getMe()
    myId.value = res.data?.data?.id ?? ''
  } catch {
    // getMe 失败不阻塞会话列表
  }
  await applyFilters()
})
</script>

<style scoped>
/* 嵌入模式（系统工具宿主 flex 列内）：占满剩余高度，卡片内滚（对齐 nt-embedded 先例） */
.ss-embedded { flex: 1; min-height: 0; overflow: hidden; }
/* 状态条走全局 mk-status 体系（shared.css）；此处不再 scoped 覆盖，
   避免遮蔽全局升级（此前重定义导致 mk-status__actions 等新类不生效） */

/* 审计日志分工说明 / 深链横幅 */
/* 常驻分工说明（原型 .note：次级表面底 + muted 字，无描边） */
.ss-note {
  display: flex;
  align-items: baseline;
  gap: 8px;
  flex-wrap: wrap;
  padding: 8px 14px;
  border-radius: var(--mk-radius-xl);
  background: var(--mk-surface-2);
  font-size: var(--mk-fs-micro);
  color: var(--mk-muted);
}
/* 链接在 --mk-surface-2 底上仅 4.39:1（<4.5 AA）：加深到 --mk-accent-deep（亮色 #1f57cc，
   对 #eef2fa 实测 5.68:1；暗色自动翻转），与 .mk-badge--self 同款 */
.ss-note .mk-link { color: var(--mk-accent-deep, #1f57cc); }
/* 深链横幅：底色/字色/圆角由 .mk-alert--info 承担，这里只补行内布局 */
.ss-deeplink {
  display: flex;
  align-items: baseline;
  gap: 8px;
  flex-wrap: wrap;
  border-radius: var(--mk-radius-xl);
  font-size: var(--mk-fs-micro);
}
.ss-deeplink strong { font-weight: 700; color: var(--mk-ink); }
.ss-deeplink__clear { color: var(--mk-muted); }

/* 加载失败错误态走 MkEmptyState（模板内），此处不再自建错误卡 */

/* 有旧行时刷新失败的行内 alert（审核 #179）：贴卡头下方，保留表格可读 */
.ss-stale-alert { margin: 10px 14px 0; }

.ss-body { display: grid; gap: var(--mk-space-4); }

/* 分组卡走全局 .mk-card / .mk-card__head（原型 card 词汇），页面只保留组头内的身份排版 */
.ss-group__who { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; min-width: 0; }
.ss-group__who strong { font-size: var(--mk-fs-emphasis); color: var(--mk-ink); }
.ss-group__email { font-size: var(--mk-fs-micro); color: var(--mk-faint); }
.ss-group__count { font-size: var(--mk-fs-micro); color: var(--mk-muted); }

/* 表格内自定义单元格 */
.ss-tr--current td { background: var(--mk-blue-bg); }
.ss-tr--current:hover td { background: color-mix(in srgb, var(--mk-blue-bg) 75%, var(--mk-line)); }
/* 当前行次要文字用 muted 而非 faint：暗色下 faint 叠 16% 蓝行底仅 4.22:1（<4.5 AA） */
.ss-tr--current .mk-cell-sub { color: var(--mk-muted); }
.ss-tr--empty td {
  padding: 26px 14px;
  text-align: center;
  color: var(--mk-faint);
  font-size: var(--mk-fs-micro);
}
.ss-device { display: flex; align-items: center; gap: 6px; min-width: 0; }
.ss-browser {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
/* 平台色点：一眼区分设备平台（颜色仅作辅助，不传达状态语义）。
   2026-10-06 审核 #184：原 6 色为 scoped 硬编码 hex，其中 android 绿 #22c55e 与 linux 琥珀
   #f59e0b 借用了规范「绿/琥珀/红 = 语义，禁止当装饰」的色，且全部 hex 不随暗色主题翻转。
   现全部改用语义中立的现有 token（蓝 / 紫 / 青 / 灰蓝 / 中性灰），每枚都在 main.css 有亮暗两档
   → 暗色自动归队，本文件硬编码 hex 由 6 降至 0。平台识别不靠颜色单通道：浏览器/系统名文字为准。
   映射：windows=蓝、mac=灰蓝、linux=青、android=紫、ios=中性灰、other=浅灰（未知平台弱化）。 */
.ss-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.ss-dot--windows { background: var(--mk-blue); }
.ss-dot--mac { background: var(--mk-faint); }
.ss-dot--linux { background: var(--mk-teal); }
.ss-dot--android { background: var(--mk-purple); }
.ss-dot--ios { background: var(--mk-muted); }
.ss-dot--other { background: var(--mk-badge-virtual-line); }
.ss-ip { color: var(--mk-muted); font-size: var(--mk-fs-micro); }
.ss-time {
  color: var(--mk-muted);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.ss-time--soon { color: var(--mk-amber, #b45309); font-weight: 700; }
/* F6-5：24h 内过期行的可读剩余时长副行（主行仍是绝对时间；颜色 + 文字双通道，
   不再要求运维对着两个日期心算）。行高与设备列的两行结构同档，不新增撑高。 */
.ss-expiry-soon {
  font-size: var(--mk-fs-micro);
  font-weight: 600;
  color: var(--mk-amber, #b45309);
  white-space: nowrap;
}
/* LY6（2026-10-05 布局方案 §4）：三列时刻在 ≤1599 档收 176→112（MM-DD HH:mm 预算），
   七列合计 968px，在 1280 内容区 992 内不再横向滚动；≥1600 恢复 token 原值。 */
.ss-col--time { width: var(--mk-col-datetime); }
@media (max-width: 1599px) {
  .ss-col--time { width: 112px; }
}
.ss-current {
  display: inline-flex;
  align-items: center;
  font-size: var(--mk-fs-micro);
  font-weight: 700;
  border-radius: 999px;
  padding: 2px 9px;
  /* 实底 surface（而非与当前行底同色 16% 蓝）：胶囊形状与行底分层；文字 accent-deep
     对 surface 复算 ~6.5:1（原同色叠同色在暗色下胶囊消失、文字仅 4.11:1） */
  background: var(--mk-surface);
  color: var(--mk-accent-deep, #1f57cc);
  white-space: nowrap;
}
.ss-na { color: var(--mk-faint); font-size: var(--mk-fs-micro); }

/* 过期/已撤销折叠组（默认收起，summary 行可点击展开）
   折叠头形态走全局 .mk-section__summary（▸ 指示 + open 旋转 + hover），此处只覆配色/内衬 */
.ss-hist { border-top: 1px solid var(--mk-line); }
.ss-hist__summary {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 14px;
  background: var(--mk-surface-2);
  font-size: var(--mk-fs-micro);
  color: var(--mk-muted);
}
.ss-hist__summary:hover { background: var(--mk-hover-surface); }
.ss-hist__meta { color: var(--mk-faint); font-weight: 600; font-size: var(--mk-fs-micro); }

/* 大屏/4K 适配（全站 mk 体系档位；表格与状态条由 shared.css 档位覆盖）。
   分组名走 --mk-fs-emphasis，随档位自动放大，故不在档位内重复声明。 */
@media (min-width: 2000px) {
  .ss-group__email { font-size: var(--mk-fs-micro); }
  .ss-group__count { font-size: var(--mk-fs-micro); }
  .ss-current { font-size: var(--mk-fs-micro); }
  .ss-na { font-size: var(--mk-fs-micro); }
  .ss-time--soon { font-size: var(--mk-fs-micro); }
  .ss-ip { font-size: var(--mk-fs-micro); }
}
@media (min-width: 2800px) {
  .ss-group__email { font-size: var(--mk-fs-micro); }
  .ss-group__count { font-size: var(--mk-fs-micro); }
  .ss-current { font-size: var(--mk-fs-micro); }
  .ss-na { font-size: var(--mk-fs-micro); }
  .ss-time,
  .ss-time--soon { font-size: var(--mk-fs-micro); }
  .ss-ip { font-size: var(--mk-fs-micro); }
}
@media (min-width: 3600px) {
  .ss-group__email { font-size: var(--mk-fs-micro); }
  .ss-group__count { font-size: var(--mk-fs-body); }
  .ss-current { font-size: var(--mk-fs-micro); }
  .ss-na { font-size: var(--mk-fs-body); }
  .ss-time--soon { font-size: var(--mk-fs-micro); }
  .ss-ip { font-size: var(--mk-fs-body); }
}
</style>
