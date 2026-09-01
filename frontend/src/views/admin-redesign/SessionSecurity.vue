<template>
  <div class="mk-page">
    <!-- 状态条：全量会话统计 + 刷新（状态筛选在下方卡片头，全站统一） -->
    <div class="mk-status" :class="`mk-status--${statusTone}`">
      <span class="mk-status__dot"></span>
      <strong class="mk-status__title">会话安全</strong>
      <span class="mk-status__sep"></span>
      <span class="mk-status__meta mono">{{ sessions.length }} 个会话</span>
      <span v-if="sessions.length" class="mk-status__meta mono">活跃 {{ activeCount }}</span>
      <span v-if="expiredCount" class="mk-status__meta mono">已过期 {{ expiredCount }}</span>
      <span v-if="revokedCount" class="mk-status__meta mono">已撤销 {{ revokedCount }}</span>
      <button type="button" class="mk-status__action" :disabled="loading" @click="applyFilters">
        {{ loading ? '刷新中…' : '刷新' }}
      </button>
    </div>

    <!-- 审计日志深链横幅（?user=用户名 → 只看该管理员的会话；含分工说明 + 反向跳转） -->
    <div v-if="deepLinkUser" class="ss-deeplink">
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

    <!-- 加载失败错误态 + 重试 -->
    <div v-if="loadError" class="ss-error">
      <div class="ss-error__card">
        <strong>会话列表加载失败</strong>
        <span>{{ loadError }}</span>
        <button type="button" class="mk-btn mk-btn--primary mk-btn--sm" @click="applyFilters">重试</button>
      </div>
    </div>

    <!-- 加载中骨架 -->
    <div v-else class="mk-card mk-card--fill">
      <div class="mk-card__head">
        <div class="mk-filter">
          <div class="mk-pills">
            <button
              v-for="p in statusPills"
              :key="p.id"
              type="button"
              class="mk-pill"
              :class="{ 'mk-pill--active': statusFilter === p.id }"
              :title="`只看${p.label}会话`"
              @click="statusFilter = statusFilter === p.id ? '' : p.id"
            >
              {{ p.label }}<template v-if="countOf(p.id) > 0"> {{ countOf(p.id) }}</template>
            </button>
          </div>
        </div>
        <div class="mk-card__head-right">
          <span class="mk-card__meta">{{ sessions.length }} 个会话<template v-if="activeCount"> · 活跃 {{ activeCount }}</template></span>
        </div>
      </div>

    <MockSkeletonTable v-if="loading && !sessions.length" :cols="7" :rows="6" />

    <!-- 按管理员分组的标准表格 -->
    <div v-else-if="groups.length" class="ss-body">
      <div v-for="{ g, active } in visibleGroups" :key="g.adminId" class="ss-group">
        <div class="ss-group__head">
          <div class="ss-group__who">
            <strong>{{ g.adminName }}</strong>
            <span v-if="g.adminEmail" class="ss-group__email mono">{{ g.adminEmail }}</span>
            <span class="ss-group__count">{{ g.sessions.length }} 个会话<template v-if="g.active.length"> · {{ g.active.length }} 个活跃</template></span>
          </div>
          <button
            v-if="g.active.length"
            type="button"
            class="ss-group__revokeall"
            @click="revokeAll(g)"
          >
            下线全部<template v-if="g.active.length > 1">（{{ g.active.length }}）</template>
          </button>
        </div>

        <!-- 活跃会话表（分页：每批 12 行） -->
        <div class="mk-table-scroll">
          <table class="mk-table">
            <thead>
              <tr>
                <th>设备</th>
                <th class="mk-col--id">IP</th>
                <th class="mk-col--time-full">登录时间</th>
                <th class="mk-col--time-full">最后活跃</th>
                <th class="mk-col--time-full">过期时间</th>
                <th class="mk-col--badge">状态</th>
                <th class="mk-th--right mk-col--actions">操作</th>
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
                <td class="ss-ip mono" :title="s.ip || ''">{{ s.ip || '—' }}</td>
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
                      class="mk-btn mk-btn--danger mk-btn--sm"
                      @click="revoke(s)"
                    >强制下线</button>
                    <span v-else class="ss-na">—</span>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- 过期/已撤销历史（默认收起；「已撤销」筛选时自动展开） -->
        <details v-if="g.historical.length" class="ss-hist" :open="statusFilter !== ''">
          <summary class="ss-hist__summary">
            <span class="ss-hist__title">已过期 · 已撤销（{{ g.historical.length }}）</span>
            <span class="ss-hist__meta">过期 {{ g.expiredCount }} · 已撤销 {{ g.revokedCount }}</span>
          </summary>
          <div class="mk-table-scroll">
            <table class="mk-table">
              <thead>
                <tr>
                  <th>设备</th>
                  <th class="mk-col--id">IP</th>
                  <th class="mk-col--time-full">登录时间</th>
                  <th class="mk-col--time-full">最后活跃</th>
                  <th class="mk-col--time-full">过期时间</th>
                  <th class="mk-col--badge">状态</th>
                  <th class="mk-th--right mk-col--actions">操作</th>
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
                  <td class="ss-ip mono" :title="s.ip || ''">{{ s.ip || '—' }}</td>
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
                        class="mk-btn mk-btn--danger mk-btn--sm"
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
        <button type="button" class="mk-link" @click="loadMoreActive">加载更多（已显示 {{ shownActive.length }} / {{ activeFlat.length }} 个活跃会话）</button>
      </div>
    </div>

    <!-- 空态 -->
    <div v-else class="mk-empty">
      <div class="mk-empty__icon" aria-hidden="true">🔐</div>
      <strong>{{ statusFilter ? '当前筛选无会话' : '暂无会话记录' }}</strong>
      <span>管理员登录后会话会显示在这里，可随时强制下线</span>
    </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { adminAuthApi, adminSessionsApi } from '@/api/adminApi'
import { errMsg } from './live'
import { useLoadMore } from './useLoadMore'
import { askConfirm } from './useConfirm'
import { toast } from '@/utils/toast'
import MockSkeletonTable from './SkeletonTable.vue'

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
function deviceOf(s: AdminSessionRow): DeviceInfo {
  const ua = s.userAgent || ''
  const out: DeviceInfo = { browser: '未知', os: '', kind: 'other' }
  if (!ua) return out
  let m: RegExpMatchArray | null
  if ((m = ua.match(/Edg(?:e|A)?\/([\d.]+)/))) out.browser = `Edge ${m[1]}`
  else if ((m = ua.match(/HeadlessChrome\/([\d.]+)/))) out.browser = `Headless Chrome ${m[1]}`
  else if ((m = ua.match(/Chrome\/([\d.]+)/))) out.browser = `Chrome ${m[1]}`
  else if ((m = ua.match(/Firefox\/([\d.]+)/))) out.browser = `Firefox ${m[1]}`
  else if ((m = ua.match(/Version\/([\d.]+).*Safari/))) out.browser = `Safari ${m[1]}`
  else if (/curl\//.test(ua)) out.browser = 'curl'
  else if (/PostmanRuntime/.test(ua)) out.browser = 'Postman'
  else if (/python-requests/.test(ua)) out.browser = 'Python requests'
  else if (/axios/.test(ua)) out.browser = 'axios'
  else if (/Playwright/.test(ua)) out.browser = 'Playwright'
  else if (/node/i.test(ua)) out.browser = 'Node.js'
  if (/Windows NT 10\.0/.test(ua)) { out.os = 'Windows 10/11'; out.kind = 'windows' }
  else if (/Windows NT 6\.[13]/.test(ua)) { out.os = 'Windows 7/8'; out.kind = 'windows' }
  else if (/Mac OS X/.test(ua)) { out.os = 'macOS'; out.kind = 'mac' }
  else if (/Android/.test(ua)) { out.os = 'Android'; out.kind = 'android' }
  else if (/iPhone|iPad|iPod/.test(ua)) { out.os = 'iOS'; out.kind = 'ios' }
  else if (/Linux/.test(ua)) { out.os = 'Linux'; out.kind = 'linux' }
  return out
}

const sessions = ref<AdminSessionRow[]>([])
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
  void router.replace({ query: {} })
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

const activeCount = computed(() => sessions.value.filter((s) => statusOf(s) === 'active').length)
const expiredCount = computed(() => sessions.value.filter((s) => statusOf(s) === 'expired').length)
const revokedCount = computed(() => sessions.value.filter((s) => statusOf(s) === 'revoked').length)
const statusTone = computed(() => {
  if (loadError.value) return 'bad'
  if (!sessions.value.length) return 'muted'
  return activeCount.value ? 'ok' : 'warn'
})
function countOf(id: SessionStatus): number {
  return id === 'active' ? activeCount.value : id === 'expired' ? expiredCount.value : revokedCount.value
}

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

/** 拉取全量会话（客户端做状态筛选，保证状态条统计恒为全量口径） */
async function applyFilters() {
  if (fetching) return
  fetching = true
  loadError.value = ''
  loading.value = true
  try {
    const res = await adminSessionsApi.getAdminSessions()
    sessions.value = res.data?.data?.sessions ?? []
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

async function revoke(s: AdminSessionRow) {
  const confirmed = await askConfirm({
    title: '强制下线该会话',
    message: `确定强制下线此会话吗？\n设备：${uaFull(s)}\n登录时间：${fmtDateTime(s.issuedAt)}`,
    confirmText: '强制下线',
  })
  if (!confirmed) return
  try {
    await adminSessionsApi.revokeAdminSession(s.id)
    s.revokedAt = new Date().toISOString()
    toast.success('会话已强制下线')
  } catch (e) {
    toast.error(`下线失败：${errMsg(e)}`)
  }
}

async function revokeAll(g: SessionGroup) {
  const confirmed = await askConfirm({
    title: '下线该管理员全部会话',
    message: `将强制下线「${g.adminName}」除当前登录标签页外的全部 ${g.active.length} 个活跃会话，确定吗？`,
    confirmText: '全部下线',
  })
  if (!confirmed) return
  try {
    const res = await adminSessionsApi.revokeAllAdminSessions({ adminId: g.adminId, excludeCurrent: true })
    const count = res.data?.data?.count ?? g.active.length
    toast.success(`已下线 ${count} 个会话`)
    await applyFilters()
  } catch (e) {
    toast.error(`下线失败：${errMsg(e)}`)
  }
}

const pad = (n: number) => String(n).padStart(2, '0')
function fmtDateTime(iso?: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}
function fmtFull(iso?: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

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
/* 状态条走全局 mk-status 体系（shared.css）；此处不再 scoped 覆盖，
   避免遮蔽全局升级（此前重定义导致 mk-status__actions 等新类不生效） */

/* 审计日志分工说明 / 深链横幅 */
.ss-note {
  display: flex;
  align-items: baseline;
  gap: 8px;
  flex-wrap: wrap;
  padding: 8px 14px;
  border: 1px dashed var(--mk-line);
  border-radius: 10px;
  background: var(--mk-surface);
  font-size: 11.5px;
  color: var(--mk-muted);
}
.ss-deeplink {
  display: flex;
  align-items: baseline;
  gap: 8px;
  flex-wrap: wrap;
  padding: 8px 14px;
  border: 1px solid rgba(44, 99, 208, 0.3);
  border-radius: 10px;
  background: var(--mk-blue-bg);
  font-size: 12px;
  color: var(--mk-ink);
}
.ss-deeplink strong { font-weight: 700; }
.ss-deeplink__clear { color: var(--mk-active-muted, #64748b); }

/* 加载失败错误态 */
.ss-error { padding: 40px 20px; }
.ss-error__card {
  max-width: 460px;
  margin: 0 auto;
  display: grid;
  gap: 10px;
  justify-items: center;
  padding: 28px 32px;
  border: 1px solid var(--mk-line);
  border-radius: 14px;
  background: var(--mk-surface);
  box-shadow: var(--mk-shadow-modal);
  text-align: center;
}
.ss-error__card strong { font-size: 14px; color: var(--mk-ink); }
.ss-error__card span { font-size: 12.5px; color: var(--mk-muted); word-break: break-all; }

.ss-body { display: grid; gap: 14px; }

.ss-group {
  border: 1px solid var(--mk-line);
  border-radius: 12px;
  background: var(--mk-surface);
  overflow-x: auto;
}
.ss-group__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  padding: 10px 14px;
  background: var(--mk-surface);
  border-bottom: 1px solid var(--mk-line);
}
.ss-group__who { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; min-width: 0; }
.ss-group__who strong { font-size: 13px; color: var(--mk-ink); }
.ss-group__email { font-size: 11px; color: var(--mk-faint); }
.ss-group__count { font-size: 11.5px; color: var(--mk-muted); }
.ss-group__revokeall {
  border: 0;
  background: transparent;
  color: var(--mk-red, #dc2626);
  font: inherit;
  font-size: 11.5px;
  font-weight: 700;
  cursor: pointer;
  white-space: nowrap;
  padding: 4px 8px;
  border-radius: 7px;
}
.ss-group__revokeall:hover { background: var(--mk-red-bg, #fef2f2); text-decoration: underline; }

/* 表格内自定义单元格 */
.ss-tr--current td { background: var(--mk-blue-bg); }
.ss-tr--current:hover td { background: color-mix(in srgb, var(--mk-blue-bg) 75%, var(--mk-line)); }
.ss-tr--empty td {
  padding: 26px 14px;
  text-align: center;
  color: var(--mk-faint);
  font-size: 12.5px;
}
.ss-device { display: flex; align-items: center; gap: 6px; min-width: 0; }
.ss-browser {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
/* 平台色点：一眼区分设备平台（颜色仅作辅助，不传达状态语义） */
.ss-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.ss-dot--windows { background: #3b82f6; }
.ss-dot--mac { background: #94a3b8; }
.ss-dot--linux { background: #f59e0b; }
.ss-dot--android { background: #22c55e; }
.ss-dot--ios { background: #64748b; }
.ss-dot--other { background: #cbd5e1; }
.ss-ip { color: var(--mk-muted); font-size: 12px; }
.ss-time {
  color: var(--mk-muted);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.ss-time--soon { color: var(--mk-amber, #b45309); font-weight: 700; }
.ss-current {
  display: inline-flex;
  align-items: center;
  font-size: 10.5px;
  font-weight: 700;
  border-radius: 999px;
  padding: 2px 9px;
  background: #eff6ff;
  color: var(--mk-accent-deep, #1f57cc);
  white-space: nowrap;
}
.ss-na { color: var(--mk-faint); font-size: 12px; }

/* 过期/已撤销折叠组（默认收起，summary 行可点击展开） */
.ss-hist { border-top: 1px solid #f0f2f5; }
.ss-hist__summary {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 14px;
  background: #f8fafc;
  cursor: pointer;
  user-select: none;
  list-style: none;
  font-size: 11.5px;
  font-weight: 700;
  color: var(--mk-muted);
}
.ss-hist__summary::-webkit-details-marker { display: none; }
.ss-hist__summary::before {
  content: '▸';
  display: inline-block;
  margin-right: 2px;
  color: var(--mk-blue);
  transition: transform 0.14s ease;
}
.ss-hist[open] .ss-hist__summary::before { transform: rotate(90deg); }
.ss-hist__summary:hover { background: #f4f7fc; }
.ss-hist__meta { color: var(--mk-faint); font-weight: 600; font-size: 11px; }

/* 大屏/4K 适配（全站 mk 体系档位；表格与状态条由 shared.css 档位覆盖） */
@media (min-width: 2000px) {
  .ss-group__head { padding: 12px 18px; }
  .ss-group__who strong { font-size: 14.5px; }
  .ss-group__email { font-size: 12.5px; }
  .ss-group__count { font-size: 13px; }
  .ss-group__revokeall { font-size: 13px; }
  .ss-current { font-size: 12px; }
  .ss-na { font-size: 13.5px; }
  .ss-time--soon { font-size: 13px; }
  .ss-ip { font-size: 13.5px; }
}
@media (min-width: 2800px) {
  .ss-group__who strong { font-size: 16.5px; }
  .ss-group__email { font-size: 14px; }
  .ss-group__count { font-size: 15px; }
  .ss-group__revokeall { font-size: 15px; }
  .ss-current { font-size: 13.5px; }
  .ss-na { font-size: 15.5px; }
  .ss-time,
  .ss-time--soon { font-size: 15px; }
  .ss-ip { font-size: 15.5px; }
}
@media (min-width: 3600px) {
  .ss-group__head { padding: 14px 22px; }
  .ss-group__who strong { font-size: 18.5px; }
  .ss-group__email { font-size: 16px; }
  .ss-group__count { font-size: 17px; }
  .ss-group__revokeall { font-size: 17px; }
  .ss-current { font-size: 15.5px; }
  .ss-na { font-size: 18px; }
  .ss-time--soon { font-size: 15.5px; }
  .ss-ip { font-size: 18px; }
}

/* ================= 暗色模式（D1 补完）：会话安全 ================= */
html[data-theme='dark'] {
  .ss-tr--current td { background: rgba(91, 141, 239, 0.1); }
  .ss-tr--current:hover td { background: rgba(91, 141, 239, 0.16); }
  .ss-hist__summary:hover { background: #1b2740; }
  .ss-dot--linux { background: #f59e0b; }
  .ss-hist { background: #141c2b; border-color: #232f45; }
  /* 补漏：当前会话徽章/折叠组头浅底 */
  .ss-current { background: rgba(91, 141, 239, 0.16); color: #9db8f5; }
  .ss-hist__summary { background: #1b2537; }
}
</style>
