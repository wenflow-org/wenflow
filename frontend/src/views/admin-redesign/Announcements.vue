<template>
  <div class="mk-page">
    <div class="mk-status" :class="activeCount ? 'mk-status--ok' : 'mk-status--muted'">
      <span class="mk-status__dot"></span>
      <strong class="mk-status__title">{{ activeCount ? `${activeCount} 条公告生效中` : '当前没有生效公告' }}</strong>
      <span class="mk-status__sep"></span>
      <span class="mk-status__meta">共 {{ rows.length }} 条</span>
      <span class="mk-status__meta">草稿 {{ draftCount }}</span>
      <span class="mk-status__meta">已下线 {{ archivedCount }}</span>
      <button type="button" class="mk-status__action mk-status__action--primary" @click="openCreate">新建公告</button>
    </div>


    <div class="mk-card">
      <div v-if="rows.length" class="mk-table-scroll">
      <table class="mk-table">
        <thead>
          <tr>
            <th>公告</th>
            <th>级别</th>
            <th>状态</th>
            <th>发布</th>
            <th>过期</th>
            <th style="text-align:right">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in rows" :key="r.id">
            <td>
              <div class="mk-cell-main">
                <strong>{{ r.title }}</strong>
                <span class="mk-cell-sub an-body" :title="r.body">{{ r.body }}</span>
              </div>
            </td>
            <td><span class="mk-badge" :class="severityBadge(r.severity)">{{ severityText(r.severity) }}</span></td>
            <td>
              <span class="mk-badge" :class="statusBadge(r)">{{ statusText(r) }}</span>
            </td>
            <td class="mono" :class="{ 'mk-na': !r.publishedAt }" :title="r.publishedAt ? timeAgo(r.publishedAt) : ''">{{ r.publishedAt ? fmtDate(r.publishedAt) : '—' }}</td>
            <td class="mono" :class="{ 'mk-na': !r.expiresAt }" :title="r.expiresAt ? timeAgo(r.expiresAt) : ''">{{ r.expiresAt ? fmtDate(r.expiresAt) : '不过期' }}</td>
            <td>
              <div class="mk-actions">
                <button v-if="r.status !== 'published'" type="button" class="mk-link" :disabled="r.busy" @click="publish(r)">发布</button>
                <button v-if="r.status === 'published'" type="button" class="mk-link" :disabled="r.busy" @click="archive(r)">下线</button>
                <button type="button" class="mk-link" :disabled="r.busy" @click="openEdit(r)">编辑</button>
                <button type="button" class="mk-link mk-link--danger" :disabled="r.busy" @click="remove(r)">删除</button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
      </div>

      <div v-else class="mk-empty">
        <strong>还没有公告</strong>
        <span>维护通知、功能发布、政策变更——第一条公告从「新建公告」开始。</span>
      </div>
    </div>

    <!-- 新建 / 编辑公告 -->
    <div v-if="createOpen" ref="maskRef" class="mk-modal">
      <div ref="panelRef" class="mk-modal__panel" role="dialog" aria-label="新建公告">
        <div class="mk-modal__head">
          <h3 class="mk-modal__title">{{ editingId ? '编辑公告' : '新建公告' }}</h3>
          <button type="button" class="mk-modal__close" aria-label="关闭" @click="createOpen = false">✕</button>
        </div>
        <div class="mk-modal__body">
          <label class="mk-field" :class="{ 'mk-field--error': errors.title }">
            <span class="mk-field__label">标题</span>
            <input v-model="form.title" class="mk-field__input" placeholder="例如：系统维护通知" />
            <span v-if="errors.title" class="mk-field__err">{{ errors.title }}</span>
          </label>
          <label class="mk-field">
            <span class="mk-field__label">级别</span>
            <div class="an-severity">
              <button
                v-for="s in severities"
                :key="s.id"
                type="button"
                class="an-sev"
                :class="[`an-sev--${s.id}`, { 'an-sev--on': form.severity === s.id }]"
                @click="form.severity = s.id"
              >
                {{ s.label }}
              </button>
            </div>
            <span class="mk-field__hint">{{ severityHint(form.severity) }}</span>
          </label>
          <label class="mk-field" :class="{ 'mk-field--error': errors.body }">
            <span class="mk-field__label">正文</span>
            <textarea v-model="form.body" class="mk-field__textarea" rows="4" placeholder="给用户看的内容，说清楚时间、影响和建议动作。"></textarea>
            <span v-if="errors.body" class="mk-field__err">{{ errors.body }}</span>
          </label>
          <label class="mk-field">
            <span class="mk-field__label">过期时间（可选）</span>
            <input v-model="form.expiresAt" type="datetime-local" class="mk-field__input" />
            <span class="mk-field__hint">留空 = 不过期，直到手动下线</span>
          </label>
          <label class="mk-field an-publish-now">
            <input v-model="form.publishNow" type="checkbox" />
            <span class="mk-field__label" style="margin:0">创建后立即发布</span>
          </label>
        </div>
        <div class="mk-modal__foot">
          <button type="button" class="mk-btn" @click="createOpen = false">取消</button>
          <button type="button" class="mk-btn mk-btn--primary" :disabled="creating" @click="editingId ? saveEdit() : create()">
            {{ creating ? '保存中…' : editingId ? '保存修改' : form.publishNow ? '创建并发布' : '创建草稿' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { dataSource, intent, isLive } from './store'
import {
  liveAnnouncements,
  liveCreateAnnouncement,
  liveUpdateAnnouncement,
  livePublishAnnouncement,
  liveArchiveAnnouncement,
  liveDeleteAnnouncement,
  timeAgo,
  errMsg
} from './live'
import { useEscape } from './useEscape'
import { useOverlay, useMaskClose } from './useOverlay'
import { askConfirm } from './useConfirm'
import { toast } from '@/utils/toast'

interface Row {
  id: string
  title: string
  body: string
  severity: 'info' | 'warning' | 'critical'
  status: 'draft' | 'published' | 'archived'
  publishedAt: string | null
  expiresAt: string | null
  busy?: boolean
}


/* demo 数据 */
const demoRows: Row[] = [
  {
    id: 'an-1',
    title: '系统维护通知',
    body: '7 月 25 日 02:00-04:00 平台升级维护，期间学习会话可能短暂中断，请提前保存进度。',
    severity: 'warning',
    status: 'published',
    publishedAt: new Date(Date.now() - 2 * 3600000).toISOString(),
    expiresAt: null
  },
  {
    id: 'an-2',
    title: '新功能：路径回放上线',
    body: '学习者现在可以在详情页回看任意一节课的完整教学过程。',
    severity: 'info',
    status: 'published',
    publishedAt: new Date(Date.now() - 26 * 3600000).toISOString(),
    expiresAt: new Date(Date.now() + 5 * 24 * 3600000).toISOString()
  },
  {
    id: 'an-3',
    title: '模型供应商切换预案',
    body: '如主模型连续失败超过阈值，将临时切换到备用供应商，响应可能变慢。',
    severity: 'critical',
    status: 'draft',
    publishedAt: null,
    expiresAt: null
  }
]

const demoList = ref<Row[]>([])

const rows = computed<Row[]>(() => (isLive.value ? liveAnnouncements.value : demoList.value))

watch(
  () => dataSource.value,
  (src) => {
    if (src !== 'live') demoList.value = demoRows.map((r) => ({ ...r }))
  },
  { immediate: true }
)

/* 统计 */
const activeCount = computed(
  () => rows.value.filter((r) => r.status === 'published' && (!r.expiresAt || new Date(r.expiresAt).getTime() > Date.now())).length
)
const draftCount = computed(() => rows.value.filter((r) => r.status === 'draft').length)
const archivedCount = computed(() => rows.value.filter((r) => r.status === 'archived').length)

/* 操作 */

async function publish(r: Row) {
  r.busy = true
  try {
    if (isLive.value) await livePublishAnnouncement(r.id)
    else {
      r.status = 'published'
      r.publishedAt = new Date().toISOString()
    }
    toast.success(`「${r.title}」已发布，用户端立即可见`)
  } catch (e) {
    toast.error(`发布失败：${errMsg(e)}`)
  } finally {
    r.busy = false
  }
}

async function archive(r: Row) {
  r.busy = true
  try {
    if (isLive.value) await liveArchiveAnnouncement(r.id)
    else r.status = 'archived'
    toast.success(`「${r.title}」已下线`)
  } catch (e) {
    toast.error(`下线失败：${errMsg(e)}`)
  } finally {
    r.busy = false
  }
}

async function remove(r: Row) {
  const ok = await askConfirm({
    title: '删除公告',
    message: `确认删除公告「${r.title}」？\n该操作不可撤销。`,
    confirmText: '删除'
  })
  if (!ok) return
  r.busy = true
  try {
    if (isLive.value) await liveDeleteAnnouncement(r.id)
    else demoList.value = demoList.value.filter((x) => x.id !== r.id)
    toast.success('公告已删除')
  } catch (e) {
    toast.error(`删除失败：${errMsg(e)}`)
  } finally {
    r.busy = false
  }
}

/* 新建 */
const createOpen = ref(false)
useEscape(() => createOpen.value, () => { createOpen.value = false })
const panelRef = ref<HTMLElement | null>(null)
const maskRef = ref<HTMLElement | null>(null)
useOverlay(computed(() => createOpen.value), panelRef)
useMaskClose(maskRef, () => { createOpen.value = false })

/* 命令面板快捷动作：直达并打开新建弹窗 */
watch(
  () => intent.quickAction,
  (a) => {
    if (a === 'create-announcement') {
      intent.quickAction = ''
      createOpen.value = true
    }
  },
  { immediate: true }
)
const creating = ref(false)
const editingId = ref('')
const form = ref({ title: '', body: '', severity: 'info' as 'info' | 'warning' | 'critical', expiresAt: '', publishNow: true })
const errors = ref<{ title?: string; body?: string }>({})

const severities = [
  { id: 'info' as const, label: '通知' },
  { id: 'warning' as const, label: '提醒' },
  { id: 'critical' as const, label: '紧急' }
]

function openCreate() {
  editingId.value = ''
  form.value = { title: '', body: '', severity: 'info', expiresAt: '', publishNow: true }
  errors.value = {}
  createOpen.value = true
}

/** 编辑：预填表单（publishedAt 与发布状态保持不动） */
function openEdit(r: Row) {
  editingId.value = r.id
  form.value = {
    title: r.title,
    body: r.body,
    severity: r.severity,
    expiresAt: r.expiresAt ? toLocalInput(r.expiresAt) : '',
    publishNow: false
  }
  errors.value = {}
  createOpen.value = true
}

/** ISO → datetime-local 输入框值（本地时区） */
function toLocalInput(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** datetime-local 产生的是无时区本地值：提交前转 ISO 时间戳，避免时区漂移 */
function toIso(v: string): string | null {
  if (!v) return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

async function saveEdit() {
  errors.value = {}
  if (!form.value.title.trim()) errors.value.title = '请输入标题'
  if (!form.value.body.trim()) errors.value.body = '请输入正文'
  if (Object.keys(errors.value).length) return
  creating.value = true
  try {
    if (isLive.value) {
      await liveUpdateAnnouncement(editingId.value, {
        title: form.value.title.trim(),
        body: form.value.body.trim(),
        severity: form.value.severity,
        expiresAt: toIso(form.value.expiresAt)
      })
    } else {
      const r = demoList.value.find((x) => x.id === editingId.value)
      if (r) {
        r.title = form.value.title.trim()
        r.body = form.value.body.trim()
        r.severity = form.value.severity
        r.expiresAt = toIso(form.value.expiresAt)
      }
    }
    createOpen.value = false
    toast.success('公告已保存')
  } catch (e) {
    toast.error(`保存失败：${errMsg(e)}`)
  } finally {
    creating.value = false
  }
}

async function create() {
  errors.value = {}
  if (!form.value.title.trim()) errors.value.title = '请输入标题'
  if (!form.value.body.trim()) errors.value.body = '请输入正文'
  if (Object.keys(errors.value).length) return
  creating.value = true
  try {
    if (isLive.value) {
      await liveCreateAnnouncement({
        title: form.value.title.trim(),
        body: form.value.body.trim(),
        severity: form.value.severity,
        expiresAt: toIso(form.value.expiresAt),
        publishNow: form.value.publishNow
      })
    } else {
      demoList.value.unshift({
        id: `an-${Date.now() % 100000}`,
        title: form.value.title.trim(),
        body: form.value.body.trim(),
        severity: form.value.severity,
        status: form.value.publishNow ? 'published' : 'draft',
        publishedAt: form.value.publishNow ? new Date().toISOString() : null,
        expiresAt: toIso(form.value.expiresAt)
      })
    }
    createOpen.value = false
    toast.success(form.value.publishNow ? '公告已创建并发布' : '草稿已创建')
  } catch (e) {
    toast.error(`创建失败：${errMsg(e)}`)
  } finally {
    creating.value = false
  }
}

const severityText = (s: string) => ({ info: '通知', warning: '提醒', critical: '紧急' }[s] || s)
const severityBadge = (s: string) => (s === 'critical' ? 'mk-badge--bad' : s === 'warning' ? 'mk-badge--warn' : 'mk-badge--info')
const severityHint = (s: string) =>
  s === 'critical' ? '红色横幅，用于故障、安全事件' : s === 'warning' ? '黄色横幅，用于维护、变更预告' : '蓝色横幅，用于功能发布、常规通知'
const statusText = (r: Row) => (r.status === 'published' ? (r.expiresAt && new Date(r.expiresAt).getTime() <= Date.now() ? '已过期' : '生效中') : r.status === 'draft' ? '草稿' : '已下线')
const statusBadge = (r: Row) => (statusText(r) === '生效中' ? 'mk-badge--ok' : statusText(r) === '已过期' ? 'mk-badge--muted' : r.status === 'draft' ? 'mk-badge--info' : 'mk-badge--muted')
/** 绝对日期：2026-08-06 14:30（公告管理需要精确时间，相对时间入 tooltip） */
function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}
</script>

<style scoped>
.an-body {
  max-width: 380px;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.mk-link--danger { color: var(--mk-red, #dc2626); }
.an-severity { display: flex; gap: 6px; }
.an-sev {
  padding: 6px 14px;
  border-radius: 8px;
  border: 1px solid var(--mk-line);
  background: var(--mk-surface);
  font: inherit;
  font-size: 12px;
  font-weight: 700;
  color: var(--mk-muted);
  cursor: pointer;
}
.an-sev--on.an-sev--info { border-color: var(--mk-blue); color: var(--mk-blue); background: #eef5ff; }
.an-sev--on.an-sev--warning { border-color: var(--mk-amber); color: var(--mk-amber); background: var(--mk-amber-bg); }
.an-sev--on.an-sev--critical { border-color: var(--mk-red); color: var(--mk-red); background: var(--mk-red-bg); }
.an-publish-now { display: flex; align-items: center; gap: 8px; }

/* ========== 大屏/4K 适配（全站 mk 体系档位：≥2000px 字号放大；zoom 档 ≥2800px→1.15、≥3600px→1.3） ========== */
@media (min-width: 2000px) {
  .an-body { max-width: 480px; }
  .an-severity { gap: 8px; }
  .an-sev { padding: 8px 16px; font-size: 13.5px; }
}
@media (min-width: 2800px) {
  .an-body { max-width: 600px; }
  .an-severity { gap: 10px; }
  .an-sev { padding: 9px 18px; font-size: 15.5px; }
}
@media (min-width: 3600px) {
  /* 4K（zoom 1.3 档）：字号继续放大 */
  .an-body { max-width: 720px; }
  .an-severity { gap: 12px; }
  .an-sev { padding: 11px 22px; font-size: 18px; }
}
</style>
