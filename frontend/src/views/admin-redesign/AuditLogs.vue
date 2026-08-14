<template>
  <div class="mk-page">
    <!-- 状态条：● 审计日志 · N 条 · 失败 M 条 + tab 切换 + 筛选 -->
    <div class="log-status" :class="`log-status--${statusTone}`">
      <span class="log-status__dot"></span>
      <strong>{{ statusTitle }}</strong>
      <span class="log-status__sep"></span>
      <span class="log-status__meta mono">{{ total }} 条</span>
      <span v-if="total" class="log-status__meta mono">失败 {{ failed }}</span>

      <div class="log-status__filters">
        <div class="mk-pills">
          <button
            v-for="t in tabs"
            :key="t.id"
            type="button"
            class="mk-pill"
            :class="{ 'mk-pill--active': tab === t.id }"
            @click="switchTab(t.id)"
          >
            {{ t.label }}
          </button>
        </div>
        <input
          v-model="keyword"
          class="log-keyword"
          :placeholder="tab === 'login' ? '用户名 / IP，回车查询' : '关键词，回车查询'"
          @keydown.enter="applyFilters"
        />
        <select v-model="timeRange" class="log-agent" @change="applyFilters">
          <option value="today">今天</option>
          <option value="yesterday">昨天</option>
          <option value="week">近 7 天</option>
          <option value="month">近 30 天</option>
          <option value="all">全部</option>
        </select>
      </div>
    </div>

    <!-- 加载失败错误态 + 重试 -->
    <div v-if="loadError" class="audit-error">
      <div class="audit-error__card">
        <strong>审计日志加载失败</strong>
        <span>{{ loadError }}</span>
        <button type="button" class="mk-btn mk-btn--primary mk-btn--sm" @click="applyFilters">重试</button>
      </div>
    </div>

    <!-- 加载中骨架 -->
    <MockSkeletonTable v-else-if="loading && !rows.length" :cols="tab === 'login' ? 5 : 7" :rows="6" />

    <!-- 操作审计列表 -->
    <div v-else-if="tab === 'operation' && logs.length" class="log-body">
      <div class="tline-head" :class="{ 'tline-head--no-tt': noTargetTypes }" aria-hidden="true">
        <span class="tline-head__time">时间</span>
        <span class="tline-head__admin">操作者</span>
        <span class="tline-head__action">动作</span>
        <span v-if="!noTargetTypes" class="tline-head__target-type" title="操作对象类别（如 用户 / 公告 / 会话）">目标类型</span>
        <span class="tline-head__target">目标</span>
        <span class="tline-head__badge">结果</span>
        <span class="tline-head__ip">IP</span>
        <span class="tline-head__arrow" aria-hidden="true"></span>
      </div>
      <div
        v-for="log in logs"
        :key="log.id"
        class="tline"
        :class="[log.success ? 'tline--ok' : 'tline--err', { 'tline--open': openId === log.id }]"
      >
        <button
          type="button"
          class="tline__main"
          :class="{ 'tline__main--no-tt': noTargetTypes }"
          :aria-expanded="openId === log.id"
          @click="openId = openId === log.id ? '' : log.id"
        >
          <span class="tline__time mono" :title="fmtFull(log.createdAt)">{{ fmtTime(log.createdAt) }}</span>
          <span class="tline__admin" :title="log.adminName || log.adminId || ''">
            {{ log.adminName || (log.adminId ? shortId(log.adminId) : '—') }}
          </span>
          <span class="tline__action" :title="log.action">{{ actionText(log.action) }}</span>
          <span v-if="!noTargetTypes" class="tline__target-type" :title="log.targetType || '当前记录未写入目标类型'">{{ targetTypeText(log.targetType) }}</span>
          <span class="tline__target mono" :title="log.targetId || ''">{{ log.targetId ? shortId(log.targetId) : '—' }}</span>
          <span class="tline__badge" :class="log.success ? 'tline__badge--ok' : 'tline__badge--err'">
            {{ log.success ? '成功' : '失败' }}
          </span>
          <span class="tline__ip mono" :title="log.ip || ''">{{ log.ip || '—' }}</span>
          <span class="tline__arrow" aria-hidden="true">▸</span>
        </button>
        <div v-if="openId === log.id" class="tline__payload">
          <div class="tline__payload-meta">
            <span>{{ log.method }} {{ log.path }} · HTTP {{ log.statusCode }}<template v-if="log.durationMs != null"> · {{ fmtMs(log.durationMs) }}</template></span>
            <span v-if="log.userAgent" class="tline__ua" :title="log.userAgent">{{ log.userAgent }}</span>
          </div>
          <div v-if="log.requestJson" class="tline__section">
            <span class="tline__label">请求</span>
            <pre>{{ log.requestJson }}</pre>
          </div>
          <div v-if="log.beforeJson" class="tline__section">
            <span class="tline__label">变更前</span>
            <pre>{{ log.beforeJson }}</pre>
          </div>
          <div v-if="log.afterJson" class="tline__section">
            <span class="tline__label">变更后</span>
            <pre>{{ log.afterJson }}</pre>
          </div>
          <p v-if="!log.requestJson && !log.beforeJson && !log.afterJson" class="tline__none">无 payload 记录</p>
        </div>
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
      <div class="tline-head tline-head--login" aria-hidden="true">
        <span class="tline-head__time">时间</span>
        <span class="tline-head__admin">用户名</span>
        <span class="tline-head__ip">IP</span>
        <span class="tline-head__badge">结果</span>
        <span class="tline-head__reason">原因</span>
      </div>
      <div
        v-for="a in attempts"
        :key="a.id"
        class="tline tline--login"
        :class="a.success ? 'tline--ok' : 'tline--err'"
      >
        <div class="tline__main tline__main--static">
          <span class="tline__time mono" :title="fmtFull(a.createdAt)">{{ fmtLoginTime(a.createdAt) }}</span>
          <span class="tline__admin" :title="a.username">{{ a.username || '—' }}</span>
          <span class="tline__ip mono" :title="a.ip || ''">{{ a.ip || '—' }}</span>
          <span class="tline__badge" :class="a.success ? 'tline__badge--ok' : 'tline__badge--err'">
            {{ a.success ? '成功' : '失败' }}
          </span>
          <span class="tline__reason" :title="a.reason || ''">{{ reasonText(a.reason) }}</span>
        </div>
      </div>
      <!-- 传统分页（方案 A）：与执行日志同一分页器形态 -->
      <Pagination
        v-model:page="currentPage"
        v-model:pageSize="currentPageSize"
        :total="total"
        :loading="loading"
      />
    </div>

    <!-- 空态 -->
    <div v-else class="mk-empty">
      <div class="mk-empty__icon" aria-hidden="true">{{ tab === 'login' ? '🔑' : '🕵️' }}</div>
      <strong>{{ isFiltered ? '当前筛选无审计记录' : tab === 'login' ? '暂无登录审计' : '暂无审计记录' }}</strong>
      <span>{{ tab === 'login' ? '管理员登录成功/失败都会在此留痕' : '管理员的增删改操作会自动记录留痕' }}</span>
      <button v-if="isFiltered" type="button" class="mk-empty__action" @click="clearFilters">清除筛选</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { adminAuditApi, type AuditLogQuery } from '@/api/adminApi'
import { errMsg, shortId } from './live'
import Pagination from './Pagination.vue'
import MockSkeletonTable from './SkeletonTable.vue'
import { actionText, targetTypeText } from './statusText'

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

const tabs = [
  { id: 'operation', label: '操作审计' },
  { id: 'login', label: '登录审计' },
] as const
type TabId = (typeof tabs)[number]['id']

const tab = ref<TabId>('operation')
const keyword = ref('')
const timeRange = ref<'today' | 'yesterday' | 'week' | 'month' | 'all'>('week')

const logs = ref<AuditLogRow[]>([])
const attempts = ref<LoginAttemptRow[]>([])
const total = ref(0)
const failed = ref(0)
/** 当前页（1 基）；筛选/tab/每页条数变化回第 1 页 */
const page = ref(1)
/** 每页条数（与执行日志同一分页器形态：15/30/50/100，默认 30） */
const pageSize = ref(30)
const loading = ref(false)
const loadError = ref('')
const openId = ref('')
let fetching = false

const rows = computed(() => (tab.value === 'operation' ? logs.value : attempts.value))

/** 目标类型列语义（P3）：当前页全部记录未写入 targetType 时隐藏该列（表头/行/网格同步），
    后端补录该字段后自动恢复显示；title 悬停说明列含义 */
const noTargetTypes = computed(() => logs.value.length > 0 && logs.value.every((l) => !l.targetType))

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

function buildParams(nextPage: number): AuditLogQuery {
  return {
    page: nextPage,
    limit: pageSize.value,
    scope: tab.value,
    keyword: keyword.value.trim() || undefined,
    timeRange: timeRange.value === 'all' ? undefined : timeRange.value,
  }
}

/** 拉取指定页并整体替换列表（total 来自后端 pagination.total，驱动页码器） */
async function fetchPage(nextPage: number) {
  if (fetching) return
  fetching = true
  try {
    const res = await adminAuditApi.getAuditLogs(buildParams(nextPage))
    const data = res.data?.data ?? {}
    const list = (tab.value === 'operation' ? data.logs : data.attempts) ?? []
    if (tab.value === 'operation') {
      logs.value = list
    } else {
      attempts.value = list
    }
    const pagination = data.pagination
    if (pagination && typeof pagination.total === 'number') total.value = pagination.total
    page.value = nextPage
    loadError.value = ''
  } catch (e) {
    loadError.value = errMsg(e)
  } finally {
    fetching = false
  }
}

async function goPage(p: number) {
  if (p < 1 || p === page.value) return
  await fetchPage(p)
  /* 翻页替换列表后滚动回顶部 */
  window.scrollTo(0, 0)
}

async function fetchStats() {
  try {
    const res = await adminAuditApi.getAuditStats(buildParams(1))
    const stats = res.data?.data?.stats
    if (stats) {
      total.value = typeof stats.total === 'number' ? stats.total : total.value
      failed.value = typeof stats.failed === 'number' ? stats.failed : 0
    }
  } catch {
    // 统计接口不可用时回退到已加载样本计算（与执行日志页同策略）
    failed.value = rows.value.filter((r) => !r.success).length
  }
}

async function applyFilters() {
  loadError.value = ''
  loading.value = true
  page.value = 1
  logs.value = []
  attempts.value = []
  openId.value = ''
  await fetchPage(1)
  await fetchStats()
  loading.value = false
}

function switchTab(id: TabId) {
  if (tab.value === id) return
  tab.value = id
  void applyFilters()
}

const isFiltered = computed(() => !!keyword.value.trim() || timeRange.value !== 'week')
function clearFilters() {
  keyword.value = ''
  timeRange.value = 'week'
  void applyFilters()
}

const statusTone = computed(() => {
  if (loadError.value) return 'bad'
  if (!rows.value.length) return 'muted'
  return failed.value ? 'bad' : 'ok'
})
const statusTitle = computed(() => {
  if (loadError.value) return '审计日志加载失败'
  if (!rows.value.length) return tab.value === 'login' ? '暂无登录审计' : '暂无审计记录'
  return tab.value === 'login' ? '登录审计' : '审计日志'
})

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
/* 绝对时间：今天内 HH:MM:SS，跨天 MM-DD HH:MM */
function fmtTime(iso?: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const now = new Date()
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  if (d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()) return hm
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${hm.slice(0, 5)}`
}
function fmtFull(iso?: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}
/* 登录审计时间（P3）：始终带日期（MM-DD HH:MM:SS），避免当天记录只有时刻、无日期可溯 */
function fmtLoginTime(iso?: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

onMounted(() => {
  void applyFilters()
})
</script>

<style scoped>
.log-status {
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
.log-status__dot { width: 9px; height: 9px; border-radius: 50%; }
.log-status--ok .log-status__dot { background: var(--mk-green); }
.log-status--bad .log-status__dot { background: var(--mk-red); }
.log-status--muted .log-status__dot { background: var(--mk-faint); }
.log-status strong { font-size: 14px; }
.log-status__sep { width: 1px; height: 14px; background: var(--mk-line); }
.log-status__meta { color: var(--mk-muted); font-size: 12px; }

.log-status__filters {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  justify-content: flex-end;
  min-width: 0;
}
@media (max-width: 1000px) {
  .log-status__filters {
    margin-left: 0;
    width: 100%;
    justify-content: flex-start;
  }
  .log-keyword { flex: 1 1 140px; min-width: 0; }
}
.log-agent {
  padding: 6px 10px;
  border: 1px solid var(--mk-line);
  border-radius: 8px;
  background: var(--mk-surface);
  font-size: 11.5px;
  color: var(--mk-ink);
}
.log-keyword {
  padding: 6px 10px;
  border: 1px solid var(--mk-line);
  border-radius: 8px;
  background: var(--mk-surface);
  font: inherit;
  font-size: 11.5px;
  color: var(--mk-ink);
  width: 150px;
}

/* 加载失败错误态 */
.audit-error { padding: 40px 20px; }
.audit-error__card {
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
.audit-error__card strong { font-size: 14px; color: var(--mk-ink); }
.audit-error__card span { font-size: 12.5px; color: var(--mk-muted); word-break: break-all; }

.log-body {
  border: 1px solid var(--mk-line);
  border-radius: 12px;
  background: var(--mk-surface);
  overflow-x: auto;
}

/* 表头：与全站表格页同规范（sticky 顶部、uppercase 小号标签）。
   8 列模板（时间/操作者/动作/目标类型/目标/结果/IP/箭头）：
   动作列 180→240px（P2：长端点路径如「POST /api/admin/system/config」~30 字符仍被省略，
   加宽后 ~34 字符可读；比 --mk-col--actions-wide(120px 按钮列) 更宽，列内保留 title 全值）；
   目标列由弹性 minmax(100px,1fr)（28/30 行是"—"、459px 白区）改固定窄列 --mk-col-id；
   末列箭头改 minmax(18px,1fr) 吸收剩余宽度（text-align:right 保持贴右缘，消灭断尾） */
.tline-head {
  position: sticky;
  top: 0;
  z-index: 2;
  display: grid;
  min-width: max-content;
  grid-template-columns: var(--mk-col-time) 130px 240px 80px var(--mk-col-id) var(--mk-col-badge) 110px minmax(18px, 1fr);
  gap: 10px;
  align-items: baseline;
  padding: 9px 14px;
  background: #fafbfc;
  border-bottom: 1px solid var(--mk-line);
  border-radius: 12px 12px 0 0;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--mk-faint);
  white-space: nowrap;
}
.tline-head--login {
  grid-template-columns: var(--mk-col-time) 160px 110px var(--mk-col-badge) 200px minmax(18px, 1fr);
}
/* 目标类型列缺失（P3）：隐藏该列时去掉 80px 槽位，其余列宽不变 */
.tline-head--no-tt {
  grid-template-columns: var(--mk-col-time) 130px 180px var(--mk-col-id) var(--mk-col-badge) 110px minmax(18px, 1fr);
}
.tline-more {
  display: flex;
  justify-content: center;
  padding: 10px 0 12px;
  border-top: 1px dashed var(--mk-line);
}

.tline { border-bottom: 1px solid #f0f2f5; box-shadow: inset 3px 0 0 0 transparent; }
.tline:last-child { border-bottom: none; }
.tline--ok { box-shadow: inset 3px 0 0 0 var(--mk-green); }
.tline--err { box-shadow: inset 3px 0 0 0 var(--mk-red); background: rgba(220, 38, 38, 0.04); }

.tline__main {
  display: grid;
  min-width: max-content;
  grid-template-columns: var(--mk-col-time) 130px 240px 80px var(--mk-col-id) var(--mk-col-badge) 110px minmax(18px, 1fr);
  gap: 10px;
  align-items: baseline;
  width: 100%;
  padding: 9px 14px;
  border: 0;
  background: transparent;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.tline__main:hover { background: #f6f9ff; }
.tline__main--static { cursor: default; }
.tline__main--static:hover { background: transparent; }
.tline--login .tline__main {
  grid-template-columns: var(--mk-col-time) 160px 110px var(--mk-col-badge) 200px minmax(18px, 1fr);
}
.tline__main--no-tt {
  grid-template-columns: var(--mk-col-time) 130px 180px var(--mk-col-id) var(--mk-col-badge) 110px minmax(18px, 1fr);
}

.tline__time {
  font-size: 11px;
  color: var(--mk-faint);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.tline__admin {
  font-size: 12px;
  color: var(--mk-ink);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.tline__action {
  /* inline-block（非 inline-flex）：text-overflow:ellipsis 只对块容器生效，
     原 inline-flex 下省略号被浏览器忽略 → 文本直接裁切，补上 ellipsis 语义 */
  display: inline-block;
  font-size: 11px;
  font-weight: 700;
  border-radius: 5px;
  padding: 1px 7px;
  background: #eff6ff;
  color: var(--mk-blue);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
}
.tline__target-type {
  font-size: 11.5px;
  color: var(--mk-muted);
  white-space: nowrap;
}
.tline__target {
  font-size: 11px;
  color: var(--mk-faint);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.tline__ip {
  font-size: 11px;
  color: var(--mk-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
/* 展开指示：行按钮末列箭头，展开时旋转 90° */
.tline__arrow {
  font-size: 11px;
  color: var(--mk-faint);
  text-align: right;
  transition: transform 0.15s ease;
}
.tline--open .tline__arrow { transform: rotate(90deg); }
.tline__reason {
  font-size: 11.5px;
  color: var(--mk-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.tline__badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 10.5px;
  font-weight: 700;
  border-radius: 999px;
  padding: 1px 8px;
  white-space: nowrap;
}
.tline__badge--ok { background: var(--mk-green-bg); color: var(--mk-green); }
.tline__badge--err { background: var(--mk-red-bg); color: var(--mk-red); }

.tline__payload { padding: 2px 14px 12px 66px; display: grid; gap: 8px; }
.tline__payload-meta {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  font-size: 11px;
  color: var(--mk-faint);
  font-family: var(--mk-mono);
}
.tline__ua {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 45%;
}
.tline__payload pre {
  margin: 0;
  padding: 10px 12px;
  border-radius: 8px;
  background: #0d1420;
  color: #8ba3c7;
  font: 11px/1.6 var(--mk-mono);
  overflow: auto;
  max-height: 240px;
  white-space: pre-wrap;
  word-break: break-all;
}
.tline__none { margin: 0; font-size: 11.5px; color: var(--mk-faint); }
.tline__section { display: grid; gap: 4px; }
.tline__label { font-size: 10.5px; font-weight: 700; letter-spacing: 0.06em; color: var(--mk-faint); }

/* 大屏/4K 适配（全站 mk 体系档位） */
@media (min-width: 2000px) {
  .log-status { padding: 10px 16px; }
  .log-status strong { font-size: 15.5px; }
  .log-status__meta { font-size: 13px; }
  .log-keyword { font-size: 13px; padding: 8px 12px; border-radius: 10px; width: 180px; }
  .log-agent { font-size: 13px; padding: 8px 12px; border-radius: 10px; width: 100px; }
  .tline-head,
  .tline__main { gap: 12px; padding: 11px 18px; }
  .tline-head { font-size: 12.5px; }
  .tline__time,
  .tline__target,
  .tline__ip { font-size: 13px; }
  .tline__admin { font-size: 14px; }
  .tline__action { font-size: 13px; }
  .tline__target-type,
  .tline__reason,
  .tline__none { font-size: 13px; }
  .tline__payload-meta,
  .tline__ua { font-size: 13px; }
  .tline__label { font-size: 13px; }
  .tline__badge { font-size: 12px; }
  .tline__arrow { font-size: 13px; }
  .tline__payload { padding-left: 84px; }
  .tline__payload pre { font-size: 13px; }
}
@media (min-width: 2800px) {
  .log-status { padding: 12px 18px; border-radius: 14px; }
}
@media (min-width: 3600px) {
  .log-status { padding: 14px 22px; }
  .log-status strong { font-size: 18px; }
  .log-status__meta { font-size: 15px; }
  .log-keyword { font-size: 15.5px; padding: 9px 14px; width: 215px; }
  .log-agent { font-size: 15.5px; padding: 9px 14px; width: 115px; }
  .tline-head,
  .tline__main { gap: 14px; padding: 13px 22px; }
  .tline-head { font-size: 14.5px; }
  .tline__time,
  .tline__target,
  .tline__ip { font-size: 15.5px; }
  .tline__admin { font-size: 16.5px; }
  .tline__action { font-size: 15.5px; }
  .tline__target-type,
  .tline__reason,
  .tline__none { font-size: 15.5px; }
  .tline__payload-meta,
  .tline__ua { font-size: 15.5px; }
  .tline__label { font-size: 15.5px; }
  .tline__badge { font-size: 14px; }
  .tline__arrow { font-size: 15.5px; }
  .tline__payload { padding-left: 100px; }
  .tline__payload pre { font-size: 15.5px; }
}
</style>
