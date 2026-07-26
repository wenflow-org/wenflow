<template>
  <div class="mk-page">
    <!-- 状态条 -->
    <div class="mk-status" :class="stats && stats.active > 0 ? 'mk-status--ok' : 'mk-status--muted'">
      <span class="mk-status__dot"></span>
      <strong class="mk-status__title">Goal 会话</strong>
      <span class="mk-status__sep"></span>
      <template v-if="isLive && stats">
        <span class="mk-status__meta">总数 {{ stats.total }}</span>
        <span class="mk-status__meta">进行中 {{ stats.active }}</span>
        <span class="mk-status__meta">已完成 {{ stats.completed }}</span>
        <span class="mk-status__meta">完成率 {{ stats.completionRate }}%</span>
      </template>
      <span v-else class="mk-status__meta">目标对话是路径生成的源头</span>
      <button type="button" class="mk-status__action" :disabled="loading" @click="load">
        {{ loading ? '刷新中…' : '刷新' }}
      </button>
    </div>

    <div v-if="toast" class="mk-toast" :class="toastCls">{{ toast }}</div>

    <!-- 非 live：无演示数据 -->
    <div v-if="!isLive" class="mk-empty">
      <strong>演示模式暂无 Goal 会话数据</strong>
      <span>通过顶栏刷新或命令面板切换到真实数据查看。</span>
    </div>

    <template v-else>
      <!-- 筛选 -->
      <div class="mk-filter">
        <input v-model="keyword" class="mk-filter__input" placeholder="搜索用户 / 邮箱 / 目标摘要" />
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
      </div>

      <!-- 列表 -->
      <div class="mk-card">
        <table v-if="filtered.length" class="mk-table">
          <thead>
            <tr>
              <th>用户</th>
              <th>目标摘要</th>
              <th>状态</th>
              <th>阶段</th>
              <th>路径</th>
              <th>创建时间</th>
              <th style="text-align: right">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in filtered" :key="r.id" class="gc-row" @click="openDetail(r)">
              <td>
                <div class="mk-cell-main">
                  <strong>{{ r.userName }}</strong>
                  <span class="mk-cell-sub">{{ r.userEmail }}</span>
                </div>
              </td>
              <td><span class="gc-summary" :title="r.summary">{{ r.summary }}</span></td>
              <td><span class="mk-badge" :class="statusBadge(r.status)">{{ statusLabel(r.status) }}</span></td>
              <td><span class="mono gc-stage">{{ r.stage || '—' }}</span></td>
              <td>
                <span v-if="r.hasPath" class="mk-badge mk-badge--info">已生成</span>
                <span v-else class="mk-na">—</span>
              </td>
              <td><span class="mk-cell-sub">{{ r.createdAt }}</span></td>
              <td>
                <div class="mk-actions">
                  <button type="button" class="mk-link" @click.stop="regenerate(r)">
                    {{ r.regenerating ? '生成中…' : '重建路径' }}
                  </button>
                  <button type="button" class="mk-link mk-link--danger" @click.stop="remove(r)">删除</button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
        <div v-else class="mk-empty">
          <strong>{{ loading ? '加载中…' : '没有匹配的会话' }}</strong>
          <span>{{ keyword || statusFilter ? '调整筛选条件试试。' : '还没有 Goal 会话记录。' }}</span>
        </div>
      </div>
    </template>

    <!-- 详情面板 -->
    <Teleport to="body">
      <div v-if="detail" class="gc-mask" @mousedown.self="detail = null">
        <aside class="gc-panel" role="dialog" aria-label="会话详情">
          <header class="gc-panel__head">
            <div class="gc-panel__title">
              <span class="mk-badge" :class="statusBadge(detail.status)">{{ statusLabel(detail.status) }}</span>
              <h3>{{ detail.userName }} 的目标对话</h3>
              <span class="gc-panel__id mono">{{ detail.id }}</span>
            </div>
            <button type="button" class="gc-panel__close" aria-label="关闭" @click="detail = null">✕</button>
          </header>
          <div class="gc-panel__body">
            <div class="gc-facts">
              <div><span>邮箱</span><strong>{{ detail.userEmail || '—' }}</strong></div>
              <div><span>阶段</span><strong class="mono">{{ detail.stage || '—' }}</strong></div>
              <div><span>关联路径</span><strong>{{ detail.hasPath ? '已生成' : '未生成' }}</strong></div>
              <div><span>创建</span><strong>{{ detail.createdAt }}</strong></div>
              <div><span>更新</span><strong>{{ detail.updatedAt }}</strong></div>
              <div><span>完成</span><strong>{{ detail.completedAt || '—' }}</strong></div>
            </div>

            <section v-if="detail.description" class="gc-section">
              <h4>目标描述</h4>
              <p class="gc-desc">{{ detail.description }}</p>
            </section>

            <section v-if="detail.messages.length" class="gc-section">
              <h4>对话轮次 <span class="mono">{{ detail.messages.length }}</span></h4>
              <div class="gc-msgs">
                <div v-for="(m, i) in detail.messages" :key="i" class="gc-msg" :class="`gc-msg--${m.role}`">
                  <span class="gc-msg__role">{{ m.role === 'user' ? '用户' : m.role === 'assistant' ? 'AI' : m.role }}</span>
                  <p>{{ m.text }}</p>
                </div>
              </div>
            </section>
            <p v-else class="gc-none">无对话消息记录。</p>

            <details v-if="detail.collectedData" class="gc-raw">
              <summary>采集数据 JSON</summary>
              <pre class="gc-json mono">{{ detail.collectedData }}</pre>
            </details>

            <div class="gc-actions">
              <button type="button" class="gc-btn-primary" :disabled="detail.regenerating" @click="regenerate(detail)">
                {{ detail.regenerating ? '生成中…' : '重新生成学习路径' }}
              </button>
              <button type="button" class="gc-btn-danger" :disabled="detail.regenerating" @click="remove(detail)">
                删除会话
              </button>
            </div>
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
import { adminGoalConversationsApi } from '@/api/adminApi'
import { useEscape } from './useEscape'

defineProps<{ state: string }>()

interface Row {
  id: string
  userName: string
  userEmail: string
  status: string
  stage: string
  summary: string
  hasPath: boolean
  createdAt: string
  regenerating?: boolean
}

interface Detail extends Row {
  description: string
  updatedAt: string
  completedAt: string
  collectedData: string
  messages: Array<{ role: string; text: string }>
}

const isLive = computed(() => dataSource.value === 'live')
const loading = ref(false)
const rows = ref<Row[]>([])
const stats = ref<{ total: number; active: number; completed: number; completionRate: string } | null>(null)
const keyword = ref('')
const statusFilter = ref('')
const detail = ref<Detail | null>(null)
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
  { id: 'active', label: '进行中' },
  { id: 'completed', label: '已完成' },
  { id: 'cancelled', label: '已取消' }
]

const statusLabel = (s: string) => ({ active: '进行中', completed: '已完成', cancelled: '已取消' })[s] || s || '—'
const statusBadge = (s: string) =>
  s === 'completed' ? 'mk-badge--ok' : s === 'active' ? 'mk-badge--info' : 'mk-badge--muted'

/** 目标摘要：description 优先，其次 collectedData 里的 goal 字段 */
function summaryOf(c: Record<string, unknown>): string {
  if (c.description) return String(c.description)
  try {
    const cd = JSON.parse(String(c.collectedData || '{}'))
    return String(cd.goal || cd.learningGoal || cd.objective || cd.target || '—')
  } catch {
    return '—'
  }
}

function mapRow(c: Record<string, unknown>): Row {
  const u = (c.users as Record<string, unknown>) || {}
  return {
    id: String(c.id),
    userName: String(u.name || c.userId || '—'),
    userEmail: String(u.email || ''),
    status: String(c.status || ''),
    stage: String(c.stage || ''),
    summary: summaryOf(c),
    hasPath: !!c.learningPathId,
    createdAt: timeAgo(String(c.createdAt || ''))
  }
}

const filtered = computed(() => {
  const k = keyword.value.trim().toLowerCase()
  return rows.value.filter((r) => {
    if (statusFilter.value && r.status !== statusFilter.value) return false
    if (!k) return true
    return `${r.userName} ${r.userEmail} ${r.summary}`.toLowerCase().includes(k)
  })
})

async function load() {
  if (!isLive.value || loading.value) return
  loading.value = true
  try {
    const [listRes, statsRes] = await Promise.all([
      adminGoalConversationsApi.list({ limit: 100 }),
      adminGoalConversationsApi.getStats().catch(() => null)
    ])
    const body = listRes.data?.data ?? listRes.data ?? {}
    rows.value = ((body.conversations as Record<string, unknown>[]) || []).map(mapRow)
    const s = statsRes?.data?.data ?? statsRes?.data
    stats.value = s
      ? {
          total: Number(s.total || 0),
          active: Number(s.active || 0),
          completed: Number(s.completed || 0),
          completionRate: String(s.completionRate || '0')
        }
      : null
  } catch (e) {
    showToast(`加载失败：${errMsg(e)}`, 'mk-toast--bad')
  } finally {
    loading.value = false
  }
}

function parseMessages(raw: unknown): Array<{ role: string; text: string }> {
  try {
    const arr = JSON.parse(String(raw || '[]'))
    if (!Array.isArray(arr)) return []
    return arr.slice(0, 60).map((m: Record<string, unknown>) => ({
      role: String(m.role || 'unknown'),
      text: String(m.content ?? m.text ?? m.message ?? '')
    }))
  } catch {
    return []
  }
}

async function openDetail(r: Row) {
  detail.value = {
    ...r,
    description: '',
    updatedAt: '—',
    completedAt: '',
    collectedData: '',
    messages: []
  }
  try {
    const res = await adminGoalConversationsApi.getDetail(r.id)
    const c = (res.data?.data ?? res.data ?? {}) as Record<string, unknown>
    detail.value = {
      ...detail.value!,
      description: String(c.description || ''),
      updatedAt: timeAgo(String(c.updatedAt || '')),
      completedAt: c.completedAt ? timeAgo(String(c.completedAt)) : '',
      collectedData: c.collectedData ? JSON.stringify(JSON.parse(String(c.collectedData)), null, 2) : '',
      messages: parseMessages(c.messages)
    }
  } catch (e) {
    showToast(`详情加载失败：${errMsg(e)}`, 'mk-toast--bad')
  }
}

async function regenerate(r: Row) {
  if (r.regenerating) return
  if (!window.confirm(`确认为「${r.userName}」重新生成学习路径？将基于该会话产出新版本路径。`)) return
  r.regenerating = true
  try {
    const res = await adminGoalConversationsApi.regeneratePath(r.id)
    const d = res.data?.data ?? res.data ?? {}
    showToast(`已生成路径「${d.learningPathName || '未命名'}」（v${d.version ?? '—'}）`)
    r.hasPath = true
    if (detail.value?.id === r.id) detail.value.hasPath = true
  } catch (e) {
    showToast(`重建失败：${errMsg(e)}`, 'mk-toast--bad')
  } finally {
    r.regenerating = false
  }
}

async function remove(r: Row) {
  if (!window.confirm(`确认删除「${r.userName}」的这条 Goal 会话？该操作不可撤销。`)) return
  try {
    await adminGoalConversationsApi.remove(r.id)
    rows.value = rows.value.filter((x) => x.id !== r.id)
    if (detail.value?.id === r.id) detail.value = null
    showToast('会话已删除')
  } catch (e) {
    showToast(`删除失败：${errMsg(e)}`, 'mk-toast--bad')
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
.gc-row { cursor: pointer; }
.gc-summary {
  display: inline-block;
  max-width: 320px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  vertical-align: bottom;
}
.gc-stage { font-size: 11px; color: var(--mk-muted); }

/* 详情面板（与 ts/pcl 面板同构） */
.gc-mask {
  position: fixed;
  inset: 0;
  z-index: 200;
  background: rgba(15, 23, 42, 0.36);
  display: flex;
  justify-content: flex-end;
}
.gc-panel {
  width: min(560px, 100vw);
  height: 100%;
  background: #fff;
  box-shadow: -16px 0 48px rgba(15, 23, 42, 0.18);
  display: grid;
  grid-template-rows: auto 1fr;
  animation: gc-in 0.2s ease;
}
@keyframes gc-in { from { transform: translateX(30px); opacity: 0; } }
.gc-panel__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
  padding: 16px 18px;
  border-bottom: 1px solid var(--mk-line);
}
.gc-panel__title { display: grid; gap: 6px; justify-items: start; }
.gc-panel__title h3 { margin: 0; font-size: 16px; }
.gc-panel__id { font-size: 10.5px; color: var(--mk-faint); word-break: break-all; }
.gc-panel__close {
  border: 0;
  background: #f0f2f5;
  width: 30px;
  height: 30px;
  border-radius: 8px;
  cursor: pointer;
  color: var(--mk-muted);
}
.gc-panel__body { padding: 16px 18px; display: grid; gap: 16px; align-content: start; overflow-y: auto; }

.gc-facts {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
}
.gc-facts > div { display: grid; gap: 2px; }
.gc-facts span { font-size: 11px; color: var(--mk-faint); font-weight: 600; }
.gc-facts strong { font-size: 12.5px; }

.gc-section { display: grid; gap: 8px; }
.gc-section h4 {
  margin: 0;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--mk-faint);
}
.gc-section h4 .mono { margin-left: 4px; }
.gc-desc { margin: 0; font-size: 12.5px; color: var(--mk-muted); line-height: 1.7; }

.gc-msgs { display: grid; gap: 6px; }
.gc-msg {
  display: grid;
  grid-template-columns: 38px 1fr;
  gap: 8px;
  padding: 8px 10px;
  border: 1px solid #e6ecf6;
  border-radius: 9px;
  font-size: 12px;
}
.gc-msg__role { font-size: 10.5px; font-weight: 700; color: var(--mk-faint); padding-top: 1px; }
.gc-msg--user .gc-msg__role { color: var(--mk-blue); }
.gc-msg p { margin: 0; line-height: 1.6; color: var(--mk-ink); white-space: pre-wrap; word-break: break-word; }
.gc-none { margin: 0; color: var(--mk-faint); font-size: 12px; }

.gc-raw summary {
  cursor: pointer;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--mk-faint);
  padding: 2px 0;
}
.gc-json {
  margin: 6px 0 0;
  padding: 10px 12px;
  border-radius: 8px;
  background: #101826;
  border: 1px solid #1c2a40;
  color: #9db8dc;
  font-size: 10.5px;
  line-height: 1.6;
  max-height: 220px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-all;
}

.gc-actions { display: flex; gap: 8px; }
.gc-btn-primary {
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
.gc-btn-primary:disabled { opacity: 0.6; cursor: not-allowed; }
.gc-btn-danger {
  padding: 8px 12px;
  border-radius: 8px;
  border: 1px solid rgba(220, 38, 38, 0.35);
  background: transparent;
  color: var(--mk-red);
  font: inherit;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
}
</style>
