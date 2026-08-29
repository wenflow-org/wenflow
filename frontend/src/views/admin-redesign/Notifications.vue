<template>
  <div class="mk-page">
    <div class="mk-status" :class="statusTone">
      <span class="mk-status__dot"></span>
      <strong class="mk-status__title">站内通知</strong>
      <span class="mk-status__sep"></span>
      <span class="mk-status__meta">共 {{ total }}</span>
      <span class="mk-status__meta">未读 {{ unreadTotal }}</span>
      <button type="button" class="mk-status__action mk-status__action--primary" @click="openSend">发送通知</button>
    </div>

    <div class="mk-card mk-card--fill">
      <div class="mk-card__head">
        <div class="nt-filter">
          <select v-model="kindFilter" class="mk-filter__select" @change="reload">
            <option value="">全部类型</option>
            <option value="system">系统</option>
            <option value="announcement">公告提醒</option>
            <option value="achievement">成就</option>
          </select>
          <label class="mk-field--switch">
            <input v-model="unreadOnly" type="checkbox" @change="reload" />
            <span class="mk-field__label" style="margin:0">仅未读</span>
          </label>
          <span class="nt-boundary" title="全站横幅公告请到「公告」页管理">横幅公告 → 公告页</span>
        </div>
      </div>

      <MockSkeletonTable v-if="loading && !items.length" :cols="5" />
      <div v-else-if="items.length" class="mk-table-scroll nt-list">
        <table class="mk-table">
          <thead>
            <tr>
              <th>通知</th>
              <th>接收用户</th>
              <th>类型</th>
              <th>状态</th>
              <th class="mk-col--time-full">发送时间</th>
              <th class="mk-col--actions">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="n in items" :key="n.id" :class="{ 'nt-row--unread': !n.isRead }">
              <td>
                <div class="mk-cell-main">
                  <strong>{{ n.title }}</strong>
                  <span class="mk-cell-sub" :title="n.body || ''">{{ n.body || '—' }}</span>
                </div>
              </td>
              <td>
                <div class="mk-cell-main">
                  <strong>{{ n.user?.name || '—' }}</strong>
                  <span class="mk-cell-sub">{{ n.user?.email || n.userId }}</span>
                </div>
              </td>
              <td><span class="mk-badge" :class="kindBadge(n.kind)">{{ kindText(n.kind) }}</span></td>
              <td>
                <span class="mk-badge" :class="n.isRead ? 'mk-badge--muted' : 'mk-badge--info'">{{ n.isRead ? '已读' : '未读' }}</span>
              </td>
              <td :title="fmtDate(n.createdAt)">{{ timeAgo(n.createdAt) }}</td>
              <td>
                <div class="mk-actions">
                  <button type="button" class="mk-link mk-link--danger" :disabled="n.busy" @click="remove(n)">删除</button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div v-else-if="failed" class="mk-empty">
        <span class="mk-empty__icon" aria-hidden="true">!</span>
        <strong>通知加载失败</strong>
        <button type="button" class="mk-empty__action" @click="reload">重试</button>
      </div>
      <div v-else class="mk-empty mk-empty--min">
        <strong>还没有通知</strong>
        <span>发送全员或定向通知后，用户端会收到站内信。</span>
        <button type="button" class="mk-empty__action" @click="openSend">发送第一条通知</button>
      </div>
      <Pagination
        v-if="total > pageSize"
        v-model:page="page"
        :total="total"
        :page-size="pageSize"
        :loading="loading"
        show-total
        @update:page="reload"
      />
    </div>

    <!-- 发送通知弹窗 -->
    <Teleport to="body">
      <div v-if="sendOpen" ref="maskRef" class="mk-modal">
        <div ref="panelRef" class="mk-modal__panel" role="dialog" aria-label="发送通知">
          <div class="mk-modal__head">
            <h3 class="mk-modal__title">发送通知</h3>
            <button type="button" class="mk-modal__close" aria-label="关闭" @click="sendOpen = false">✕</button>
          </div>
          <div class="mk-modal__body">
            <label class="mk-field" :class="{ 'mk-field--error': errors.title }">
              <span class="mk-field__label">标题 <em class="mk-field__req">*</em></span>
              <input v-model="form.title" class="mk-field__input" placeholder="通知标题" />
              <span v-if="errors.title" class="mk-field__err">{{ errors.title }}</span>
            </label>
            <label class="mk-field">
              <span class="mk-field__label">正文（可选）</span>
              <textarea v-model="form.body" class="mk-field__textarea" rows="3" placeholder="通知正文…" />
            </label>
            <label class="mk-field">
              <span class="mk-field__label">类型</span>
              <select v-model="form.kind" class="mk-field__select">
                <option value="system">系统通知</option>
                <option value="announcement">公告提醒（站内信）</option>
                <option value="achievement">成就</option>
              </select>
              <span class="mk-field__hint">全站横幅公告请在「公告」页管理；此处「公告提醒」是站内信形态的公告类通知</span>
            </label>
            <div class="mk-field">
              <span class="mk-field__label">发送范围</span>
              <div class="nt-scope">
                <button
                  type="button"
                  class="mk-pill"
                  :class="{ 'mk-pill--active': form.scope === 'all' }"
                  @click="form.scope = 'all'"
                >全员（真实用户）</button>
                <button
                  type="button"
                  class="mk-pill"
                  :class="{ 'mk-pill--active': form.scope === 'user' }"
                  @click="form.scope = 'user'"
                >定向用户</button>
              </div>
            </div>
            <div v-if="form.scope === 'user'" class="mk-field">
              <span class="mk-field__label">选择用户</span>
              <input v-model="targetSearch" class="mk-field__input" placeholder="搜索姓名 / 邮箱（至少 2 字符）…" @input="searchTarget" />
              <div v-if="targetResults.length" class="nt-candidates">
                <button
                  v-for="u in targetResults"
                  :key="u.id"
                  type="button"
                  class="nt-candidate"
                  :class="{ 'nt-candidate--on': targetId === u.id }"
                  @click="targetId = u.id"
                >
                  <strong>{{ u.name || u.email }}</strong>
                  <span class="mk-cell-sub">{{ u.email }}</span>
                </button>
              </div>
              <p v-else-if="targetSearched" class="nt-none">没有匹配用户</p>
            </div>
            <div v-if="sendError" class="errorbar">{{ sendError }}</div>
          </div>
          <div class="mk-modal__foot">
            <button type="button" class="mk-btn" @click="sendOpen = false">取消</button>
            <button type="button" class="mk-btn mk-btn--primary" :disabled="sending" @click="confirmSend">
              {{ sending ? '发送中…' : '发送' }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { timeAgo, errMsg } from './live'
import { adminNotificationsApi, adminUsersApi } from '@/api/adminApi'
import { useEscape } from './useEscape'
import { useOverlay, useMaskClose } from './useOverlay'
import { askConfirm } from './useConfirm'
import { toast } from '@/utils/toast'
import MockSkeletonTable from './SkeletonTable.vue'
import Pagination from './Pagination.vue'

interface NotifRow {
  id: string
  userId: string
  title: string
  body: string | null
  kind: string
  link: string | null
  isRead: boolean
  createdAt: string
  user: { id: string; name: string; email: string } | null
  busy?: boolean
}

const items = ref<NotifRow[]>([])
const total = ref(0)
const unreadTotal = ref(0)
const page = ref(1)
const pageSize = ref(20)
const loading = ref(false)
const failed = ref(false)
const kindFilter = ref('')
const unreadOnly = ref(false)

/* mk-status 只有 ok/warn/bad/muted 四档（shared.css）：有未读用 warn 提示，无未读为 ok */
const statusTone = computed(() => (unreadTotal.value > 0 ? 'mk-status--warn' : 'mk-status--ok'))

const kindText = (k: string) => ({ system: '系统', announcement: '公告', achievement: '成就' }[k] || k)
const kindBadge = (k: string) =>
  k === 'announcement' ? 'mk-badge--warn' : k === 'achievement' ? 'mk-badge--ok' : 'mk-badge--info'

function fmtDate(iso?: string): string {
  if (!iso) return '—'
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

async function reload() {
  loading.value = true
  failed.value = false
  try {
    const res = await adminNotificationsApi.list({
      page: page.value,
      limit: pageSize.value,
      kind: kindFilter.value || undefined,
      unreadOnly: unreadOnly.value || undefined,
    })
    const body = res.data?.data ?? {}
    items.value = (body.items || []).map((n: NotifRow) => ({ ...n, busy: false }))
    total.value = body.pagination?.total ?? items.value.length
    unreadTotal.value = body.unreadTotal ?? 0
  } catch (e) {
    failed.value = true
    toast.error(`加载失败：${errMsg(e)}`)
  } finally {
    loading.value = false
  }
}

async function remove(n: NotifRow) {
  const ok = await askConfirm({
    title: '删除通知',
    message: `确认删除「${n.title}」？`,
    confirmText: '删除',
  })
  if (!ok) return
  n.busy = true
  try {
    await adminNotificationsApi.remove(n.id)
    items.value = items.value.filter((x) => x.id !== n.id)
    total.value = Math.max(0, total.value - 1)
    if (!n.isRead) unreadTotal.value = Math.max(0, unreadTotal.value - 1)
    toast.success('通知已删除')
  } catch (e) {
    toast.error(`删除失败：${errMsg(e)}`)
  } finally {
    n.busy = false
  }
}

/* 发送 */
const sendOpen = ref(false)
useEscape(() => sendOpen.value, () => { sendOpen.value = false })
const panelRef = ref<HTMLElement | null>(null)
const maskRef = ref<HTMLElement | null>(null)
useOverlay(computed(() => sendOpen.value), panelRef)
useMaskClose(maskRef, () => { sendOpen.value = false })

const form = ref({ title: '', body: '', kind: 'system', scope: 'all' as 'all' | 'user' })
const errors = ref<{ title?: string }>({})
const sending = ref(false)
const sendError = ref('')
const targetSearch = ref('')
const targetResults = ref<Array<{ id: string; name: string; email: string }>>([])
const targetSearched = ref(false)
const targetId = ref('')

function openSend() {
  form.value = { title: '', body: '', kind: 'system', scope: 'all' }
  errors.value = {}
  sendError.value = ''
  targetSearch.value = ''
  targetResults.value = []
  targetSearched.value = false
  targetId.value = ''
  sendOpen.value = true
}

let targetTimer: ReturnType<typeof setTimeout> | undefined
function searchTarget() {
  clearTimeout(targetTimer)
  const q = targetSearch.value.trim()
  if (q.length < 2) {
    targetResults.value = []
    targetSearched.value = false
    return
  }
  targetTimer = setTimeout(async () => {
    try {
      const res = await adminUsersApi.getUsers({ page: 1, limit: 8, search: q })
      const body = res.data?.data ?? res.data ?? {}
      const users = body.users || body.items || []
      targetResults.value = users.map((u: Record<string, unknown>) => ({
        id: String(u.id),
        name: String(u.name || ''),
        email: String(u.email || ''),
      }))
      targetSearched.value = true
    } catch {
      targetResults.value = []
      targetSearched.value = true
    }
  }, 300)
}

async function confirmSend() {
  errors.value = {}
  sendError.value = ''
  if (!form.value.title.trim()) { errors.value.title = '请输入标题'; return }
  if (form.value.scope === 'user' && !targetId.value) { sendError.value = '定向发送请选择用户'; return }
  sending.value = true
  try {
    const res = await adminNotificationsApi.send({
      title: form.value.title.trim(),
      body: form.value.body.trim() || undefined,
      kind: form.value.kind,
      scope: form.value.scope,
      userId: form.value.scope === 'user' ? targetId.value : undefined,
    })
    const data = res.data?.data ?? {}
    sendOpen.value = false
    toast.success(`已发送给 ${data.sent ?? 0} 名用户`)
    void reload()
  } catch (e) {
    sendError.value = errMsg(e)
  } finally {
    sending.value = false
  }
}

void reload()
</script>

<style scoped>
.nt-filter { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.nt-boundary {
  margin-left: auto;
  font-size: 11px;
  color: var(--mk-faint);
  background: #f5f7fb;
  border: 1px dashed var(--mk-line);
  padding: 2px 8px;
  border-radius: 999px;
  cursor: help;
}
.nt-list { flex: 1; min-height: 0; overflow-y: auto; }
.nt-row--unread { background: #f6f9ff; }
.nt-row--unread .mk-cell-main strong { color: var(--mk-blue); }

.nt-scope { display: flex; gap: 8px; }
.nt-candidates { display: grid; gap: 6px; max-height: 200px; overflow-y: auto; margin-top: 8px; }
.nt-candidate {
  display: grid;
  gap: 1px;
  padding: 8px 10px;
  border: 1px solid var(--mk-line);
  border-radius: 8px;
  background: var(--mk-surface);
  font: inherit;
  text-align: left;
  cursor: pointer;
  width: 100%;
}
.nt-candidate:hover { border-color: rgba(44, 99, 208, 0.4); }
.nt-candidate--on { border-color: var(--mk-blue); box-shadow: 0 0 0 2px rgba(44, 99, 208, 0.12); }
.nt-candidate strong { font-size: 12.5px; }
.nt-none { color: var(--mk-faint); font-size: 12.5px; text-align: center; padding: 10px 0; }

.errorbar {
  padding: 8px 12px;
  border-radius: 8px;
  background: var(--mk-red-bg, #fef2f2);
  color: var(--mk-red, #dc2626);
  font-size: 12.5px;
  font-weight: 600;
}
</style>
