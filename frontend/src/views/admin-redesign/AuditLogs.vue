<template>
  <div class="mk-page mk-page--fill">
    <!-- 状态条：标题 + 概览统计 + 刷新（筛选控件在下方卡片头，全站统一） -->
    <div class="mk-status" :class="`mk-status--${statusTone}`">
      <span class="mk-status__dot"></span>
      <strong class="mk-status__title">{{ statusTitle }}</strong>
      <span class="mk-status__sep"></span>
      <span class="mk-status__meta mono">{{ total }} 条</span>
      <span v-if="total" class="mk-status__meta mono">失败 {{ failed }}</span>
      <button type="button" class="mk-status__action" :disabled="loading" @click="applyFilters">
        {{ loading ? '刷新中…' : '刷新' }}
      </button>
    </div>

    <!-- 筛选卡片头（对齐 Users 模式：tabs/搜索/时间范围从状态条移入） -->
    <div class="mk-card mk-card--fill">
      <div class="mk-card__head">
        <div class="mk-filter">
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
            class="mk-filter__input"
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
        </div>
        <div class="mk-card__head-right">
          <span class="mk-card__meta">共 {{ total }} 条<template v-if="failed"> · 失败 {{ failed }}</template></span>
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
      <div class="mk-table-scroll">
        <table class="mk-table mk-table--click">
          <thead>
            <tr>
              <th>时间</th>
              <th>操作者</th>
              <th>动作</th>
              <th v-if="!noTargetTypes" title="操作对象类别（如 用户 / 公告 / 会话）">目标类型</th>
              <th>目标</th>
              <th>结果</th>
              <th>IP</th>
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
                @click="openId = openId === log.id ? '' : log.id"
              >
                <td class="log-time mono" :title="fmtFull(log.createdAt)">{{ fmtTime(log.createdAt) }}</td>
                <td class="log-admin" :title="log.adminName || log.adminId || ''">
                  {{ log.adminName || (log.adminId ? shortId(log.adminId) : '—') }}
                </td>
                <td :title="log.action">
                  <template v-if="methodOf(log)">
                    <span class="log-method" :class="`log-method--${methodOf(log).toLowerCase()}`">{{ methodOf(log) }}</span>
                    <span class="log-path mono">{{ log.path || actionText(log.action) }}</span>
                  </template>
                  <span v-else class="log-action">{{ actionText(log.action) }}</span>
                </td>
                <td v-if="!noTargetTypes" class="log-tt" :title="log.targetType || '当前记录未写入目标类型'">{{ targetTypeText(log.targetType) }}</td>
                <td class="log-target mono" :title="log.targetId || ''">{{ log.targetId ? shortId(log.targetId) : '—' }}</td>
                <td><span class="mk-badge" :class="log.success ? 'mk-badge--ok' : 'mk-badge--bad'">{{ log.success ? '成功' : '失败' }}</span></td>
                <td class="log-ip mono" :title="log.ip || ''">{{ log.ip || '—' }}</td>
                <td class="mk-th--right log-arrow" aria-hidden="true">▸</td>
              </tr>
              <tr v-if="openId === log.id" class="log-payload-row">
                <td :colspan="noTargetTypes ? 7 : 8">
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
                    <p v-if="!log.requestJson && !log.beforeJson && !log.afterJson" class="log-none">无 payload 记录</p>
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
        <table class="mk-table">
          <thead>
            <tr>
              <th>时间</th>
              <th>用户名</th>
              <th>IP</th>
              <th>结果</th>
              <th>原因</th>
              <th class="mk-th--right">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="a in attempts"
              :key="a.id"
              class="log-tr"
              :class="a.success ? 'log-tr--ok' : 'log-tr--err'"
            >
              <td class="log-time mono" :title="fmtFull(a.createdAt)">{{ fmtLoginTime(a.createdAt) }}</td>
              <td class="log-admin" :title="a.username">{{ a.username || '—' }}</td>
              <td class="log-ip mono" :title="a.ip || ''">{{ a.ip || '—' }}</td>
              <td><span class="mk-badge" :class="a.success ? 'mk-badge--ok' : 'mk-badge--bad'">{{ a.success ? '成功' : '失败' }}</span></td>
              <td class="log-reason" :title="a.reason || ''">{{ reasonText(a.reason) }}</td>
              <td class="mk-th--right">
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

    <!-- 空态 -->
    <div v-else class="mk-empty">
      <div class="mk-empty__icon" aria-hidden="true">{{ tab === 'login' ? '🔑' : '🕵️' }}</div>
      <strong>{{ isFiltered ? '当前筛选无审计记录' : tab === 'login' ? '暂无登录审计' : '暂无审计记录' }}</strong>
      <span>{{ tab === 'login' ? '管理员登录成功/失败都会在此留痕' : '管理员的增删改操作会自动记录留痕' }}</span>
      <button v-if="isFiltered" type="button" class="mk-empty__action" @click="clearFilters">清除筛选</button>
    </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
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

/** HTTP 方法（API 类动作显示彩色方法徽标）；非 API 动作（如「删除虚拟学习者」）返回空串 */
function methodOf(log: AuditLogRow): string {
  const m = (log.method || '').trim().toUpperCase()
  return /^(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)$/.test(m) ? m : ''
}

const tabs = [
  { id: 'operation', label: '操作审计' },
  { id: 'login', label: '登录审计' },
] as const
type TabId = (typeof tabs)[number]['id']

const tab = ref<TabId>('operation')
const keyword = ref('')
const timeRange = ref<'today' | 'yesterday' | 'week' | 'month' | 'all'>('week')

/* 深链：?tab=login 直达登录审计（会话安全页「审计日志 · 登录审计 →」跳入） */
const route = useRoute()
const router = useRouter()
if (route.query.tab === 'login') tab.value = 'login'

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

function buildParams(nextPage: number, scopeOverride?: typeof tab.value): AuditLogQuery {
  return {
    page: nextPage,
    limit: pageSize.value,
    scope: scopeOverride ?? tab.value,
    keyword: keyword.value.trim() || undefined,
    timeRange: timeRange.value === 'all' ? undefined : timeRange.value,
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
/* 绝对时间（统一 YYYY-MM-DD HH:MM:SS，跨年可辨） */
function fmtTime(iso?: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return fmtFull(iso)
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

/** 会话安全深链：?user=用户名 → 只看该用户当前会话 */
function goSessions(username: string) {
  void router.push({ path: '/admin/session-security', query: { user: username } })
}
</script>

<style scoped>
.mk-status {
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
.mk-status__dot { width: 9px; height: 9px; border-radius: 50%; }
.mk-status--ok .mk-status__dot { background: var(--mk-green); }
.mk-status--bad .mk-status__dot { background: var(--mk-red); }
.mk-status--muted .mk-status__dot { background: var(--mk-faint); }
.mk-status strong { font-size: 14px; }
.mk-status__sep { width: 1px; height: 14px; background: var(--mk-line); }
.mk-status__meta { color: var(--mk-muted); font-size: 12px; }

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
.log-tr--open td { background: #fafbff; }
.log-tr--open .log-arrow { transform: rotate(90deg); }

/* 展开的 payload 行：整行铺开，不参与行点击 */
.log-payload-row { cursor: default; }
.log-payload-row td {
  padding: 4px 14px 14px 62px !important;
  background: #fafbfc;
  border-bottom: 1px solid #eef1f6;
}
.log-payload-row:hover td { background: #fafbfc; }

/* 单元格 */
.log-time {
  font-size: 12px;
  color: var(--mk-faint);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.log-admin {
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
  font-size: 10.5px;
  font-weight: 800;
  border-radius: 5px;
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
/* API 路径：mono 省略号 + title 全值。
   max-width 用固定值（非 100%）：表格 auto 布局按单元格 max-content 定列宽，
   百分比 max-width 在列宽计算时视为 auto → 长路径会把整列撑宽（1440 下 654px、4K 下 1543px），
   固定上限让列宽有界（与 .mk-cell-main strong 的 --mk-cell-main-max 同一机制），4K 档由媒体查询放大 */
.log-path {
  /* inline-block（非 inline）：max-width/text-overflow 只对块级盒生效 */
  display: inline-block;
  font-size: 12px;
  color: var(--mk-ink);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 240px;
  vertical-align: middle;
}
/* 非 API 动作（中文标签）：中性蓝 chip */
.log-action {
  display: inline-block;
  font-size: 11.5px;
  font-weight: 700;
  border-radius: 5px;
  padding: 1px 8px;
  background: #eff6ff;
  color: var(--mk-blue);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 240px;
}
.log-tt {
  font-size: 12px;
  color: var(--mk-muted);
  white-space: nowrap;
}
.log-target {
  font-size: 11.5px;
  color: var(--mk-faint);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.log-ip {
  font-size: 12px;
  color: var(--mk-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.log-reason {
  font-size: 12px;
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
  font-size: 12px;
  color: var(--mk-faint);
  transition: transform 0.15s ease;
}

.log-payload { display: grid; gap: 8px; }
.log-payload-meta {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  font-size: 11px;
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
  border-radius: 8px;
  background: #0d1420;
  color: #8ba3c7;
  font: 11px/1.6 var(--mk-mono);
  overflow: auto;
  max-height: 240px;
  white-space: pre-wrap;
  word-break: break-all;
}
.log-none { margin: 0; font-size: 11.5px; color: var(--mk-faint); }
.log-section { display: grid; gap: 4px; }
.log-label { font-size: 10.5px; font-weight: 700; letter-spacing: 0.06em; color: var(--mk-faint); }

/* 大屏/4K 适配（全站 mk 体系档位；表格自身由 shared.css 档位覆盖） */
@media (min-width: 2000px) {
  .mk-status { padding: 10px 16px; }
  .mk-status strong { font-size: 15.5px; }
  .mk-status__meta { font-size: 13px; }
  .log-time,
  .log-target,
  .log-ip { font-size: 13.5px; }
  .log-admin { font-size: 14px; }
  .log-method { font-size: 12px; padding: 2px 9px; }
  .log-path { font-size: 13.5px; max-width: 520px; }
  .log-action { font-size: 13px; max-width: 520px; }
  .log-admin { max-width: 300px; }
  .log-tt,
  .log-reason,
  .log-none { font-size: 13px; }
  .log-payload-meta,
  .log-ua { font-size: 13px; }
  .log-label { font-size: 13px; }
  .log-payload pre { font-size: 13px; }
  .log-payload-row td { padding-left: 84px !important; }
  .log-arrow { font-size: 14px; }
}
@media (min-width: 2800px) {
  .mk-status { padding: 12px 18px; border-radius: 14px; }
  .log-time,
  .log-target,
  .log-ip { font-size: 16px; }
  .log-admin { font-size: 16.5px; }
  .log-method { font-size: 14px; }
  .log-path { font-size: 16px; max-width: 640px; }
  .log-action { font-size: 15.5px; max-width: 640px; }
  .log-admin { max-width: 360px; }
  .log-tt,
  .log-reason,
  .log-none { font-size: 15.5px; }
  .log-payload-meta,
  .log-ua { font-size: 15.5px; }
  .log-label { font-size: 15.5px; }
  .log-payload pre { font-size: 15.5px; }
  .log-arrow { font-size: 16.5px; }
}
@media (min-width: 3600px) {
  .mk-status { padding: 14px 22px; }
  .mk-status strong { font-size: 18px; }
  .mk-status__meta { font-size: 15px; }
  .log-time,
  .log-target,
  .log-ip { font-size: 18px; }
  .log-admin { font-size: 18.5px; }
  .log-method { font-size: 16px; padding: 3px 11px; }
  .log-path { font-size: 18px; max-width: 760px; }
  .log-action { font-size: 17.5px; max-width: 760px; }
  .log-admin { max-width: 420px; }
  .log-tt,
  .log-reason,
  .log-none { font-size: 17.5px; }
  .log-payload-meta,
  .log-ua { font-size: 17.5px; }
  .log-label { font-size: 17.5px; }
  .log-payload pre { font-size: 17.5px; }
  .log-payload-row td { padding-left: 100px !important; }
  .log-arrow { font-size: 18px; }
}

/* ================= 暗色模式（D1 补完）：审计日志 ================= */
html[data-theme='dark'] {
  .log-tr--open td { background: #1b2740; }
  .log-payload-row:hover td { background: #1b2740; }
  .log-method--get { background: rgba(91, 141, 239, 0.16); color: #93b4f5; }
  .log-method--post { background: rgba(74, 222, 128, 0.14); color: #6ee7a0; }
  .log-method--put { background: rgba(251, 191, 36, 0.14); color: #fcd34d; }
  .log-method--patch { background: rgba(167, 139, 250, 0.16); color: #c4b5fd; }
  .log-method--delete { background: rgba(248, 113, 113, 0.14); color: #fca5a5; }
  .log-method--head { background: #253049; color: #9fb0c8; }
}
</style>
