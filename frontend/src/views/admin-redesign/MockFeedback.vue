<template>
  <div class="mk-page">
    <!-- 状态条 -->
    <div class="mk-status" :class="pendingCount > 0 ? 'mk-status--warn' : 'mk-status--ok'">
      <span class="mk-status__dot"></span>
      <strong class="mk-status__title">反馈中心</strong>
      <span class="mk-status__sep"></span>
      <template v-if="isLive">
        <span class="mk-status__meta">总数 {{ total }}</span>
        <span class="mk-status__meta">待处理 {{ pendingCount }}</span>
        <span v-if="recent30 != null" class="mk-status__meta">近 30 天 {{ recent30 }}</span>
      </template>
      <span v-else class="mk-status__meta">前台教学反馈的收集与处理</span>
      <button type="button" class="mk-status__action" :disabled="loading" @click="load">
        {{ loading ? '刷新中…' : '刷新' }}
      </button>
    </div>

    <div v-if="toast" class="mk-toast" :class="toastCls">{{ toast }}</div>

    <div v-if="!isLive" class="mk-empty">
      <strong>演示模式暂无反馈数据</strong>
      <span>通过顶栏刷新或命令面板切换到真实数据查看。</span>
    </div>

    <template v-else>
      <!-- 筛选 -->
      <div class="mk-filter">
        <input v-model="keyword" class="mk-filter__input" placeholder="搜索用户 / 评论 / 任务" />
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
        <button
          type="button"
          class="mk-pill"
          :class="{ 'mk-pill--active': lowOnly }"
          @click="lowOnly = !lowOnly"
        >
          仅低分 ≤2
        </button>
      </div>

      <!-- 列表 -->
      <div class="mk-card">
        <table v-if="filtered.length" class="mk-table">
          <thead>
            <tr>
              <th>用户</th>
              <th>评分</th>
              <th>评论</th>
              <th>Agent</th>
              <th>策略</th>
              <th>状态</th>
              <th>时间</th>
              <th style="text-align: right">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in filtered" :key="r.id" class="fb-row" @click="openDetail(r)">
              <td>
                <div class="mk-cell-main">
                  <strong>{{ r.userName }}</strong>
                  <span class="mk-cell-sub">{{ r.userEmail }}</span>
                </div>
              </td>
              <td>
                <span class="fb-rating" :class="{ 'fb-rating--low': r.rating <= 2 }">
                  <b class="mono">{{ r.rating }}</b>★
                </span>
              </td>
              <td><span class="fb-comment" :title="r.comment">{{ r.comment || '—' }}</span></td>
              <td><span class="mono fb-agent">{{ r.agentId || '—' }}</span></td>
              <td><span class="fb-strategy">{{ r.strategy || '—' }}</span></td>
              <td><span class="mk-badge" :class="statusBadge(r.status)">{{ statusLabel(r.status) }}</span></td>
              <td><span class="mk-cell-sub">{{ r.createdAt }}</span></td>
              <td>
                <div class="mk-actions">
                  <button type="button" class="mk-link" @click.stop="openDetail(r)">处理</button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
        <div v-else class="mk-empty">
          <strong>{{ loading ? '加载中…' : '没有匹配的反馈' }}</strong>
          <span>{{ keyword || statusFilter || lowOnly ? '调整筛选条件试试。' : '还没有收到用户反馈。' }}</span>
        </div>
      </div>
    </template>

    <!-- 处理面板 -->
    <Teleport to="body">
      <div v-if="detail" class="fb-mask" @mousedown.self="detail = null">
        <aside class="fb-panel" role="dialog" aria-label="反馈详情">
          <header class="fb-panel__head">
            <div class="fb-panel__title">
              <span class="mk-badge" :class="statusBadge(detail.status)">{{ statusLabel(detail.status) }}</span>
              <h3>{{ detail.userName }} 的反馈</h3>
              <span class="fb-panel__id mono">{{ detail.id }}</span>
            </div>
            <button type="button" class="fb-panel__close" aria-label="关闭" @click="detail = null">✕</button>
          </header>
          <div class="fb-panel__body">
            <div class="fb-facts">
              <div><span>评分</span><strong class="mono">{{ detail.rating }}★</strong></div>
              <div><span>有用度</span><strong class="mono">{{ detail.helpfulness ?? '—' }}</strong></div>
              <div><span>清晰度</span><strong class="mono">{{ detail.clarity ?? '—' }}</strong></div>
              <div><span>难度</span><strong class="mono">{{ detail.difficulty ?? '—' }}</strong></div>
              <div><span>难度适配</span><strong>{{ detail.difficultyFit || '—' }}</strong></div>
              <div><span>轮次</span><strong class="mono">{{ detail.roundNumber ?? '—' }}</strong></div>
              <div><span>Agent</span><strong class="mono">{{ detail.agentId || '—' }}</strong></div>
              <div><span>策略</span><strong>{{ detail.strategy || '—' }}</strong></div>
              <div><span>UI 类型</span><strong>{{ detail.uiType || '—' }}</strong></div>
            </div>

            <section v-if="detail.comment" class="fb-section">
              <h4>评论</h4>
              <p class="fb-text">{{ detail.comment }}</p>
            </section>
            <section v-if="detail.suggestions" class="fb-section">
              <h4>建议</h4>
              <p class="fb-text">{{ detail.suggestions }}</p>
            </section>
            <section v-if="detail.confusionPoint" class="fb-section">
              <h4>困惑点</h4>
              <p class="fb-text">{{ detail.confusionPoint }}</p>
            </section>
            <section v-if="detail.reasonCodes.length" class="fb-section">
              <h4>原因标签</h4>
              <div class="fb-codes">
                <span v-for="c in detail.reasonCodes" :key="c" class="fb-code mono">{{ c }}</span>
              </div>
            </section>

            <section class="fb-section">
              <h4>内部备注</h4>
              <textarea v-model="noteDraft" class="fb-note" rows="3" placeholder="处理记录、归因、跟进结论…"></textarea>
            </section>

            <div class="fb-actions">
              <button type="button" class="fb-btn-primary" :disabled="saving" @click="save('triaged')">
                {{ saving ? '保存中…' : '标记已分流' }}
              </button>
              <button type="button" class="fb-btn-primary fb-btn--green" :disabled="saving" @click="save('resolved')">
                标记已解决
              </button>
              <button type="button" class="fb-btn-muted" :disabled="saving" @click="save('dismissed')">忽略</button>
            </div>

            <p class="fb-meta mono">task={{ detail.taskId || '—' }} · session={{ detail.sessionId || '—' }}</p>
          </div>
        </aside>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { dataSource } from './mockStore'
import { errMsg, timeAgo } from './mockLive'
import { adminFeedbackApi } from '@/api/adminApi'
import { useEscape } from './useEscape'

defineProps<{ state: string }>()

type Status = 'new' | 'triaged' | 'resolved' | 'dismissed'

interface Row {
  id: string
  userName: string
  userEmail: string
  rating: number
  comment: string
  agentId: string
  strategy: string
  uiType: string
  taskId: string
  sessionId: string
  status: Status
  createdAt: string
}

interface Detail extends Row {
  helpfulness: number | null
  clarity: number | null
  difficulty: number | null
  difficultyFit: string
  roundNumber: number | null
  suggestions: string
  confusionPoint: string
  reasonCodes: string[]
  internalNote: string
}

const isLive = computed(() => dataSource.value === 'live')
const loading = ref(false)
const saving = ref(false)
const rows = ref<Row[]>([])
const total = ref(0)
const pendingCount = ref(0)
const recent30 = ref<number | null>(null)
const keyword = ref('')
const statusFilter = ref('')
const lowOnly = ref(false)
const detail = ref<Detail | null>(null)
const noteDraft = ref('')
useEscape(() => !!detail.value, () => { detail.value = null })

const toast = ref('')
const toastCls = ref('mk-toast--ok')
let toastTimer: ReturnType<typeof setTimeout> | null = null
function showToast(msg: string, cls = 'mk-toast--ok') {
  toast.value = msg
  toastCls.value = cls
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => (toast.value = ''), 3200)
}

const statusPills = [
  { id: 'new', label: '待处理' },
  { id: 'triaged', label: '已分流' },
  { id: 'resolved', label: '已解决' },
  { id: 'dismissed', label: '已忽略' }
]

const statusLabel = (s: string) =>
  ({ new: '待处理', triaged: '已分流', resolved: '已解决', dismissed: '已忽略' })[s] || s || '—'
const statusBadge = (s: string) =>
  s === 'resolved' ? 'mk-badge--ok' : s === 'new' ? 'mk-badge--warn' : s === 'triaged' ? 'mk-badge--info' : 'mk-badge--muted'

function mapRow(f: Record<string, unknown>): Row {
  const u = (f.user as Record<string, unknown>) || {}
  return {
    id: String(f.id),
    userName: String(u.name || f.userId || '—'),
    userEmail: String(u.email || ''),
    rating: Number(f.rating || 0),
    comment: String(f.comment || ''),
    agentId: String(f.agentId || ''),
    strategy: String(f.strategy || ''),
    uiType: String(f.uiType || ''),
    taskId: String(f.taskId || ''),
    sessionId: String(f.sessionId || ''),
    status: (f.status as Status) || 'new',
    createdAt: timeAgo(String(f.createdAt || ''))
  }
}

const filtered = computed(() => {
  const k = keyword.value.trim().toLowerCase()
  return rows.value.filter((r) => {
    if (statusFilter.value && r.status !== statusFilter.value) return false
    if (lowOnly.value && r.rating > 2) return false
    if (!k) return true
    return `${r.userName} ${r.userEmail} ${r.comment} ${r.taskId}`.toLowerCase().includes(k)
  })
})

async function load() {
  if (!isLive.value || loading.value) return
  loading.value = true
  try {
    const [listRes, newRes, trendRes] = await Promise.all([
      adminFeedbackApi.list({ limit: 100 }),
      adminFeedbackApi.list({ limit: 1, status: 'new' }).catch(() => null),
      adminFeedbackApi.getTrend(30).catch(() => null)
    ])
    const body = listRes.data?.data ?? listRes.data ?? []
    rows.value = (Array.isArray(body) ? body : body.items || []).map(mapRow)
    total.value = Number(listRes.data?.pagination?.total ?? rows.value.length)
    pendingCount.value = Number(newRes?.data?.pagination?.total ?? rows.value.filter((r) => r.status === 'new').length)
    const trend = trendRes?.data?.data ?? trendRes?.data
    recent30.value = Array.isArray(trend) ? trend.reduce((s: number, d: Record<string, unknown>) => s + Number(d.count || d.total || 0), 0) : null
  } catch (e) {
    showToast(`加载失败：${errMsg(e)}`, 'mk-toast--bad')
  } finally {
    loading.value = false
  }
}

async function openDetail(r: Row) {
  detail.value = {
    ...r,
    helpfulness: null,
    clarity: null,
    difficulty: null,
    difficultyFit: '',
    roundNumber: null,
    suggestions: '',
    confusionPoint: '',
    reasonCodes: [],
    internalNote: ''
  }
  noteDraft.value = ''
  try {
    const res = await adminFeedbackApi.getDetail(r.id)
    const f = (res.data?.data ?? res.data ?? {}) as Record<string, unknown>
    detail.value = {
      ...detail.value!,
      helpfulness: f.helpfulness != null ? Number(f.helpfulness) : null,
      clarity: f.clarity != null ? Number(f.clarity) : null,
      difficulty: f.difficulty != null ? Number(f.difficulty) : null,
      difficultyFit: String(f.difficultyFit || ''),
      roundNumber: f.roundNumber != null ? Number(f.roundNumber) : null,
      suggestions: String(f.suggestions || ''),
      confusionPoint: String(f.confusionPoint || ''),
      reasonCodes: Array.isArray(f.reasonCodes) ? (f.reasonCodes as string[]) : [],
      internalNote: String(f.internalNote || '')
    }
    noteDraft.value = detail.value.internalNote
  } catch (e) {
    showToast(`详情加载失败：${errMsg(e)}`, 'mk-toast--bad')
  }
}

async function save(status: Status) {
  const d = detail.value
  if (!d || saving.value) return
  saving.value = true
  try {
    await adminFeedbackApi.update(d.id, { status, internalNote: noteDraft.value.trim() || null })
    d.status = status
    d.internalNote = noteDraft.value.trim()
    const row = rows.value.find((x) => x.id === d.id)
    if (row) row.status = status
    if (status === 'resolved' || status === 'dismissed') detail.value = null
    pendingCount.value = rows.value.filter((x) => x.status === 'new').length
    showToast(`已标记为${statusLabel(status)}`)
  } catch (e) {
    showToast(`保存失败：${errMsg(e)}`, 'mk-toast--bad')
  } finally {
    saving.value = false
  }
}

watch(isLive, (v) => {
  if (v) void load()
})
onMounted(() => {
  if (isLive.value) void load()
})
</script>

<style scoped>
.fb-row { cursor: pointer; }
.fb-rating { font-size: 12px; color: var(--mk-muted); }
.fb-rating b { font-size: 12.5px; color: var(--mk-ink); }
.fb-rating--low, .fb-rating--low b { color: var(--mk-red); }
.fb-comment {
  display: inline-block;
  max-width: 260px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  vertical-align: bottom;
  color: var(--mk-muted);
}
.fb-agent { font-size: 11px; color: var(--mk-muted); }
.fb-strategy { font-size: 11.5px; color: var(--mk-muted); }

/* 处理面板 */
.fb-mask {
  position: fixed;
  inset: 0;
  z-index: 200;
  background: rgba(15, 23, 42, 0.36);
  display: flex;
  justify-content: flex-end;
}
.fb-panel {
  width: min(540px, 100vw);
  height: 100%;
  background: #fff;
  box-shadow: -16px 0 48px rgba(15, 23, 42, 0.18);
  display: grid;
  grid-template-rows: auto 1fr;
  animation: fb-in 0.2s ease;
}
@keyframes fb-in { from { transform: translateX(30px); opacity: 0; } }
.fb-panel__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
  padding: 16px 18px;
  border-bottom: 1px solid var(--mk-line);
}
.fb-panel__title { display: grid; gap: 6px; justify-items: start; }
.fb-panel__title h3 { margin: 0; font-size: 16px; }
.fb-panel__id { font-size: 10.5px; color: var(--mk-faint); word-break: break-all; }
.fb-panel__close {
  border: 0;
  background: #f0f2f5;
  width: 30px;
  height: 30px;
  border-radius: 8px;
  cursor: pointer;
  color: var(--mk-muted);
}
.fb-panel__body { padding: 16px 18px; display: grid; gap: 16px; align-content: start; overflow-y: auto; }

.fb-facts {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
}
.fb-facts > div { display: grid; gap: 2px; min-width: 0; }
.fb-facts span { font-size: 11px; color: var(--mk-faint); font-weight: 600; }
.fb-facts strong { font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.fb-section { display: grid; gap: 8px; }
.fb-section h4 {
  margin: 0;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--mk-faint);
}
.fb-text { margin: 0; font-size: 12.5px; color: var(--mk-ink); line-height: 1.7; white-space: pre-wrap; }
.fb-codes { display: flex; gap: 6px; flex-wrap: wrap; }
.fb-code {
  padding: 2px 8px;
  border-radius: 999px;
  background: #eef2fa;
  color: var(--mk-muted);
  font-size: 10.5px;
}
.fb-note {
  width: 100%;
  padding: 8px 10px;
  border: 1px solid #dbe3ef;
  border-radius: 9px;
  font: inherit;
  font-size: 12px;
  resize: vertical;
  line-height: 1.6;
}
.fb-note:focus { outline: none; border-color: var(--mk-blue); }

.fb-actions { display: flex; gap: 8px; flex-wrap: wrap; }
.fb-btn-primary {
  padding: 8px 14px;
  border-radius: 8px;
  border: 0;
  background: var(--mk-blue);
  color: #fff;
  font: inherit;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
}
.fb-btn--green { background: var(--mk-green); }
.fb-btn-primary:disabled { opacity: 0.6; cursor: not-allowed; }
.fb-btn-muted {
  padding: 8px 12px;
  border-radius: 8px;
  border: 1px solid var(--mk-line);
  background: transparent;
  color: var(--mk-muted);
  font: inherit;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
}
.fb-meta { margin: 0; font-size: 10px; color: var(--mk-faint); word-break: break-all; }
</style>
