<template>
  <div class="mk-page">
    <!-- 状态条 -->
    <div class="ss-status" :class="`ss-status--${statusTone}`">
      <span class="ss-status__dot"></span>
      <strong>会话安全</strong>
      <span class="ss-status__sep"></span>
      <span class="ss-status__meta mono">{{ sessions.length }} 个会话</span>
      <span v-if="sessions.length" class="ss-status__meta mono">活跃 {{ activeCount }}</span>

      <div class="ss-status__filters">
        <div class="mk-pills">
          <button
            v-for="p in statusPills"
            :key="p.id"
            type="button"
            class="mk-pill"
            :class="{ 'mk-pill--active': statusFilter === p.id }"
            @click="statusFilter = statusFilter === p.id ? '' : p.id"
          >
            {{ p.label }}
          </button>
        </div>
        <button type="button" class="ss-refresh" :disabled="loading" @click="applyFilters">刷新</button>
      </div>
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
    <MockSkeletonTable v-else-if="loading && !sessions.length" :cols="6" :rows="6" />

    <!-- 按管理员分组 -->
    <div v-else-if="groups.length" class="ss-body">
      <div v-for="g in groups" :key="g.adminId" class="ss-group">
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
        <div class="ss-table">
          <div class="ss-head" aria-hidden="true">
            <span class="ss-head__device">设备</span>
            <span class="ss-head__time">登录时间</span>
            <span class="ss-head__time">最后活跃</span>
            <span class="ss-head__time">过期时间</span>
            <span class="ss-head__status">状态</span>
            <span class="ss-head__ops">操作</span>
          </div>
          <div
            v-for="s in g.active"
            :key="s.id"
            class="ss-row"
            :class="{ 'ss-row--current': s.id === currentId }"
          >
            <span class="ss-device" :title="uaOf(s)">{{ uaOf(s) }}</span>
            <span class="ss-time mono" :title="fmtFull(s.issuedAt)">{{ fmtDateTime(s.issuedAt) }}</span>
            <span class="ss-time mono" :title="s.lastSeenAt ? fmtFull(s.lastSeenAt) : ''">
              {{ s.lastSeenAt ? fmtDateTime(s.lastSeenAt) : '—' }}
            </span>
            <span class="ss-time mono" :class="{ 'ss-time--soon': expiringSoon(s) }" :title="fmtFull(s.expiresAt)">
              {{ fmtDateTime(s.expiresAt) }}
            </span>
            <span class="mk-badge" :class="statusClass(s)">{{ statusTextOf(s) }}</span>
            <span class="ss-ops">
              <span v-if="s.id === currentId" class="ss-current" title="当前登录标签页的会话，不可下线">当前</span>
              <button
                v-else-if="statusOf(s) === 'active'"
                type="button"
                class="mk-btn mk-btn--danger mk-btn--sm"
                @click="revoke(s)"
              >强制下线</button>
              <span v-else class="ss-na">—</span>
            </span>
          </div>
          <!-- 滚动修复 #3：过期/已撤销历史收进折叠组（默认收起；「已撤销」筛选时自动展开） -->
          <details v-if="g.historical.length" class="ss-hist" :open="statusFilter === 'revoked'">
            <summary class="ss-hist__summary">
              <span class="ss-hist__title">已过期 / 已撤销（{{ g.historical.length }}）</span>
              <span class="ss-hist__meta">过期 {{ g.expiredCount }} · 已撤销 {{ g.revokedCount }}</span>
            </summary>
            <div
              v-for="s in g.historical"
              :key="s.id"
              class="ss-row"
              :class="{ 'ss-row--current': s.id === currentId }"
            >
              <span class="ss-device" :title="uaOf(s)">{{ uaOf(s) }}</span>
              <span class="ss-time mono" :title="fmtFull(s.issuedAt)">{{ fmtDateTime(s.issuedAt) }}</span>
              <span class="ss-time mono" :title="s.lastSeenAt ? fmtFull(s.lastSeenAt) : ''">
                {{ s.lastSeenAt ? fmtDateTime(s.lastSeenAt) : '—' }}
              </span>
              <span class="ss-time mono" :class="{ 'ss-time--soon': expiringSoon(s) }" :title="fmtFull(s.expiresAt)">
                {{ fmtDateTime(s.expiresAt) }}
              </span>
              <span class="mk-badge" :class="statusClass(s)">{{ statusTextOf(s) }}</span>
              <span class="ss-ops">
                <span v-if="s.id === currentId" class="ss-current" title="当前登录标签页的会话，不可下线">当前</span>
                <button
                  v-else-if="statusOf(s) === 'active'"
                  type="button"
                  class="mk-btn mk-btn--danger mk-btn--sm"
                  @click="revoke(s)"
                >强制下线</button>
                <span v-else class="ss-na">—</span>
              </span>
            </div>
          </details>
        </div>
      </div>
    </div>

    <!-- 空态 -->
    <div v-else class="mk-empty">
      <div class="mk-empty__icon" aria-hidden="true">🔐</div>
      <strong>{{ statusFilter ? '当前筛选无会话' : '暂无会话记录' }}</strong>
      <span>管理员登录后会话会显示在这里，可随时强制下线</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { adminAuthApi, adminSessionsApi } from '@/api/adminApi'
import { errMsg } from './live'
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

const sessions = ref<AdminSessionRow[]>([])
const loading = ref(false)
const loadError = ref('')
const statusFilter = ref<'' | 'active' | 'revoked'>('')
const myId = ref('')
let fetching = false

const statusPills: Array<{ id: '' | 'active' | 'revoked'; label: string }> = [
  { id: 'active', label: '活跃' },
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
const statusTone = computed(() => {
  if (loadError.value) return 'bad'
  if (!sessions.value.length) return 'muted'
  return activeCount.value ? 'ok' : 'warn'
})

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

async function applyFilters() {
  if (fetching) return
  fetching = true
  loadError.value = ''
  loading.value = true
  try {
    const res = await adminSessionsApi.getAdminSessions({ status: statusFilter.value || undefined })
    sessions.value = res.data?.data?.sessions ?? []
  } catch (e) {
    loadError.value = errMsg(e)
  } finally {
    loading.value = false
    fetching = false
  }
}

function uaOf(s: AdminSessionRow): string {
  const ua = s.userAgent || ''
  return ua ? (ua.length > 48 ? `${ua.slice(0, 48)}…` : ua) : '未知设备'
}

/** 24 小时内过期的活跃会话高亮提示 */
function expiringSoon(s: AdminSessionRow): boolean {
  if (statusOf(s) !== 'active') return false
  return new Date(s.expiresAt).getTime() - Date.now() <= 24 * 60 * 60 * 1000
}

async function revoke(s: AdminSessionRow) {
  const confirmed = await askConfirm({
    title: '强制下线该会话',
    message: `确定强制下线此会话吗？\n设备：${uaOf(s)}\n登录时间：${fmtDateTime(s.issuedAt)}`,
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
.ss-status {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 14px;
  border-radius: 10px;
  border: 1px solid var(--mk-line);
  background: var(--mk-surface);
  box-shadow: var(--mk-shadow-sm);
  flex-wrap: wrap;
}
.ss-status__dot { width: 9px; height: 9px; border-radius: 50%; }
.ss-status--ok .ss-status__dot { background: var(--mk-green); }
.ss-status--warn .ss-status__dot { background: var(--mk-amber); }
.ss-status--bad .ss-status__dot { background: var(--mk-red); }
.ss-status--muted .ss-status__dot { background: var(--mk-faint); }
.ss-status strong { font-size: 14px; }
.ss-status__sep { width: 1px; height: 14px; background: var(--mk-line); }
.ss-status__meta { color: var(--mk-muted); font-size: 12px; }

.ss-status__filters {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  justify-content: flex-end;
  min-width: 0;
}
@media (max-width: 1000px) {
  .ss-status__filters {
    margin-left: 0;
    width: 100%;
    justify-content: flex-start;
  }
}
.ss-refresh {
  padding: 6px 10px;
  border: 1px solid var(--mk-line);
  border-radius: 8px;
  background: var(--mk-surface);
  color: var(--mk-muted);
  font: inherit;
  font-size: 11.5px;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
}
.ss-refresh:hover { border-color: rgba(44, 99, 208, 0.4); color: var(--mk-ink); }
.ss-refresh:disabled { opacity: 0.65; cursor: not-allowed; }

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
  background: #fafbfc;
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

/* 表头：与全站表格页同规范 */
.ss-head {
  position: sticky;
  top: 0;
  z-index: 2;
  display: grid;
  grid-template-columns: minmax(180px, 1fr) 120px 120px 120px 64px 96px;
  gap: 10px;
  align-items: baseline;
  padding: 8px 14px;
  background: #fff;
  border-bottom: 1px solid #f0f2f5;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--mk-faint);
  white-space: nowrap;
}
.ss-head__ops { text-align: right; }

.ss-row {
  display: grid;
  grid-template-columns: minmax(180px, 1fr) 120px 120px 120px 64px 96px;
  gap: 10px;
  align-items: center;
  padding: 9px 14px;
  border-bottom: 1px solid #f0f2f5;
}
.ss-row:last-child { border-bottom: none; }
.ss-row--current { background: #f0f7ff; }

/* 滚动修复 #3：过期/已撤销折叠组（默认收起，summary 行可点击展开） */
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

.ss-device {
  font-size: 12px;
  color: var(--mk-ink);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}
.ss-time {
  font-size: 11px;
  color: var(--mk-muted);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.ss-time--soon { color: var(--mk-amber, #b45309); font-weight: 700; }
.ss-ops { text-align: right; white-space: nowrap; }
.ss-current {
  display: inline-flex;
  align-items: center;
  font-size: 10.5px;
  font-weight: 700;
  border-radius: 999px;
  padding: 2px 9px;
  background: #eff6ff;
  color: var(--mk-accent-deep, #1f57cc);
}
.ss-na { color: var(--mk-faint); font-size: 12px; }

/* 大屏/4K 适配（全站 mk 体系档位） */
@media (min-width: 2000px) {
  .ss-status { padding: 10px 16px; }
  .ss-status strong { font-size: 15.5px; }
  .ss-status__meta { font-size: 13px; }
  .ss-head,
  .ss-row { grid-template-columns: minmax(220px, 1fr) 140px 140px 140px 76px 110px; gap: 12px; padding: 11px 18px; }
  .ss-head { font-size: 12.5px; }
  .ss-group__head { padding: 12px 18px; }
  .ss-device { font-size: 14px; }
  .ss-time { font-size: 13px; }
  .ss-refresh { font-size: 13.5px; }
  .ss-group__who strong { font-size: 14.5px; }
  .ss-group__email { font-size: 12.5px; }
  .ss-group__count { font-size: 13px; }
  .ss-group__revokeall { font-size: 13px; }
  .ss-current { font-size: 12px; }
  .ss-na { font-size: 13.5px; }
  .ss-time--soon { font-size: 13px; }
}
@media (min-width: 2800px) {
  .ss-status { padding: 12px 18px; border-radius: 14px; }
  .ss-refresh { font-size: 16px; }
  .ss-group__who strong { font-size: 16.5px; }
  .ss-group__email { font-size: 14px; }
  .ss-group__count { font-size: 15px; }
  .ss-group__revokeall { font-size: 15px; }
  .ss-current { font-size: 13.5px; }
  .ss-na { font-size: 15.5px; }
  .ss-time,
  .ss-time--soon { font-size: 15px; }
}
@media (min-width: 3600px) {
  .ss-status { padding: 14px 22px; }
  .ss-status strong { font-size: 18px; }
  .ss-status__meta { font-size: 15px; }
  .ss-head,
  .ss-row { grid-template-columns: minmax(260px, 1fr) 165px 165px 165px 90px 130px; gap: 14px; padding: 13px 22px; }
  .ss-head { font-size: 14.5px; }
  .ss-device { font-size: 16.5px; }
  .ss-time { font-size: 15.5px; }
  .ss-refresh { font-size: 18.5px; }
  .ss-group__who strong { font-size: 18.5px; }
  .ss-group__email { font-size: 16px; }
  .ss-group__count { font-size: 17px; }
  .ss-group__revokeall { font-size: 17px; }
  .ss-current { font-size: 15.5px; }
  .ss-na { font-size: 18px; }
  .ss-time--soon { font-size: 15.5px; }
}
</style>
