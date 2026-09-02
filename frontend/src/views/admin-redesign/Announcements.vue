<template>
  <div :class="embedded ? 'an-embedded' : 'mk-page'">
    <div v-if="!embedded" class="mk-status" :class="activeCount ? 'mk-status--ok' : 'mk-status--muted'">
      <span class="mk-status__dot"></span>
      <strong class="mk-status__title">公告中心</strong>
      <span class="mk-status__sep"></span>
      <span class="mk-status__meta">共 {{ rows.length }} 条</span>
      <span class="mk-status__meta">生效中 {{ activeCount }}</span>
      <span class="mk-status__meta">草稿 {{ draftCount }}</span>
      <span class="mk-status__meta">已下线 {{ archivedCount }}</span>
      <span class="mk-status__actions">
        <button type="button" class="mk-status__action mk-status__action--primary" @click="openCreate">新建公告</button>
      </span>
    </div>


    <div class="mk-card">
      <div class="mk-card__head">
        <div class="mk-filter">
          <input v-model="keyword" class="mk-filter__input" placeholder="搜索标题 / 正文" />
          <select v-model="severityFilter" class="mk-filter__select" aria-label="按级别筛选">
            <option value="">全部级别</option>
            <option value="info">通知</option>
            <option value="warning">提醒</option>
            <option value="critical">紧急</option>
          </select>
          <select v-model="statusFilter" class="mk-filter__select" aria-label="按状态筛选">
            <option value="">全部状态</option>
            <option value="published">生效中</option>
            <option value="draft">草稿</option>
            <option value="archived">已下线</option>
          </select>
          <button v-if="isFiltered" type="button" class="mk-link" @click="clearFilters">清除筛选</button>
        </div>
        <span class="mk-card__meta">{{ filtered.length }} / {{ rows.length }} 条</span>
      </div>

      <MockSkeletonTable v-if="liveLoading && !rows.length" :cols="6" />
      <div v-else-if="filtered.length" class="mk-table-scroll an-list">
      <table class="mk-table">
        <thead>
          <tr>
            <th>公告</th>
            <th>级别</th>
            <th>状态</th>
            <th class="mk-col--time-full">发布</th>
            <th class="mk-col--time-full">过期</th>
            <th class="mk-col--actions-wide">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in filtered" :key="r.id">
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
            <td :class="{ 'mk-na': !r.publishedAt }" :title="r.publishedAt ? fmtDate(r.publishedAt) : ''">{{ r.publishedAt ? timeAgo(r.publishedAt) : '—' }}</td>
            <td :class="{ 'mk-na': !r.expiresAt }" :title="r.expiresAt ? fmtDate(r.expiresAt) : ''">{{ r.expiresAt ? expiresLabel(r.expiresAt) : '不过期' }}</td>
            <td>
              <div class="mk-actions">
                <button v-if="r.status !== 'published'" type="button" class="mk-link" :disabled="r.busy" @click="publish(r)">发布</button>
                <button v-if="r.status === 'published'" type="button" class="mk-link" :disabled="r.busy" @click="archive(r)">下线</button>
                <button type="button" class="mk-link" :disabled="r.busy" @click="openEdit(r)">编辑</button>
                <div class="mk-menu">
                  <button type="button" class="mk-menu__btn" aria-label="更多操作" aria-haspopup="menu" :aria-expanded="menuOpen" @click.stop="toggleMenu(r.id)">⋯</button>
                  <div v-if="openMenu === r.id" class="mk-menu__pop" :style="popStyle" @click.stop>
                    <button type="button" class="mk-menu__item mk-menu__item--danger" :disabled="r.busy" @click="menuRemove(r)">删除</button>
                  </div>
                </div>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
      </div>

      <div v-else-if="liveFailed" class="mk-empty">
        <span class="mk-empty__icon" aria-hidden="true">!</span>
        <strong>公告加载失败</strong>
        <span>无法从服务读取公告列表。</span>
        <button type="button" class="mk-empty__action" :disabled="liveRetrying" @click="retryLive">{{ liveRetrying ? '重试中…' : '重试' }}</button>
      </div>

      <div v-else class="mk-empty mk-empty--min">
        <strong>{{ isFiltered ? '没有匹配的公告' : '还没有公告' }}</strong>
        <span>{{ isFiltered ? '放宽筛选条件试试。' : '维护通知、功能发布、政策变更都会在这里汇总。' }}</span>
        <button v-if="isFiltered" type="button" class="mk-empty__action" @click="clearFilters">清除筛选</button>
        <button v-else type="button" class="mk-empty__action" @click="openCreate">新建公告</button>
      </div>
    </div>

    <!-- 新建 / 编辑公告 -->
    <Teleport to="body">
    <div v-if="createOpen" ref="maskRef" class="mk-modal">
      <div ref="panelRef" class="mk-modal__panel" role="dialog" aria-label="新建公告">
        <div class="mk-modal__head">
          <h3 class="mk-modal__title">{{ editingId ? '编辑公告' : '新建公告' }}</h3>
          <button type="button" class="mk-modal__close" aria-label="关闭" @click="createOpen = false">✕</button>
        </div>
        <div class="mk-modal__body">
          <label class="mk-field" :class="{ 'mk-field--error': errors.title }">
            <span class="mk-field__label">标题 <em class="mk-field__req">*</em></span>
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
            <span class="mk-field__label">正文 <em class="mk-field__req">*</em></span>
            <textarea v-model="form.body" class="mk-field__textarea" rows="4" maxlength="3000" placeholder="给用户看的内容，说清楚时间、影响和建议动作。"></textarea>
            <span class="mk-field__hint">{{ form.body.length }} / 3000 字</span>
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
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { intent } from './store'
import {
  liveAnnouncements,
  liveCreateAnnouncement,
  liveUpdateAnnouncement,
  livePublishAnnouncement,
  liveArchiveAnnouncement,
  liveDeleteAnnouncement,
  liveFailures,
  liveLoading,
  timeAgo,
  errMsg
} from './live'
import { adminAnnouncementsApi } from '@/api/adminApi'
import { useEscape } from './useEscape'
import { useOverlay, useMaskClose } from './useOverlay'
import { useRowMenu } from './useRowMenu'
import { askConfirm } from './useConfirm'
import { toast } from '@/utils/toast'
import MockSkeletonTable from './SkeletonTable.vue'

/** 嵌入模式：作为运营中心「公告」tab 渲染（隐藏页面外壳/状态条） */
withDefaults(defineProps<{ embedded?: boolean }>(), { embedded: false })

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


const rows = computed<Row[]>(() => liveAnnouncements.value)

/* live 拉取失败态：liveFailures 由 store 的 loadLiveData 填充（announcements 域失败时置位） */
const liveFailed = ref(false)
const liveRetrying = ref(false)

/* 客户端筛选：关键词 + 级别 + 状态（与学习者域列表页同形态） */
const keyword = ref('')
const severityFilter = ref('')
const statusFilter = ref('')
const filtered = computed(() => {
  const q = keyword.value.trim().toLowerCase()
  return rows.value.filter((r) => {
    if (severityFilter.value && r.severity !== severityFilter.value) return false
    if (statusFilter.value && r.status !== statusFilter.value) return false
    if (q && !`${r.title} ${r.body}`.toLowerCase().includes(q)) return false
    return true
  })
})
const isFiltered = computed(() => !!keyword.value.trim() || !!severityFilter.value || !!statusFilter.value)
function clearFilters() {
  keyword.value = ''
  severityFilter.value = ''
  statusFilter.value = ''
}

watch(
  liveFailures,
  () => {
    liveFailed.value = !!liveFailures.value.announcements
  },
  { deep: true, immediate: true }
)

/** 重试公告拉取：页面内直连 API，成功后写回 store（同步侧栏徽章）并清除失败标记 */
async function retryLive() {
  if (liveRetrying.value) return
  liveRetrying.value = true
  try {
    const res = await adminAnnouncementsApi.list()
    const body = res.data?.data ?? res.data ?? {}
    const items = body.items || []
    liveAnnouncements.value = items.map((a: Record<string, unknown>) => ({
      id: String(a.id),
      title: String(a.title || ''),
      body: String(a.body || ''),
      severity: (a.severity as Row['severity']) || 'info',
      status: (a.status as Row['status']) || 'draft',
      publishedAt: (a.publishedAt as string) || null,
      expiresAt: (a.expiresAt as string) || null,
      createdBy: (a.createdBy as string) || null,
      createdAt: String(a.createdAt || '')
    }))
    const next = { ...liveFailures.value }
    delete next.announcements
    liveFailures.value = next
    liveFailed.value = false
    toast.success('公告列表已刷新')
  } catch (e) {
    liveFailed.value = true
    toast.error(`加载失败：${errMsg(e)}`)
  } finally {
    liveRetrying.value = false
  }
}

/* 统计 */
const activeCount = computed(
  () => rows.value.filter((r) => r.status === 'published' && (!r.expiresAt || new Date(r.expiresAt).getTime() > Date.now())).length
)
const draftCount = computed(() => rows.value.filter((r) => r.status === 'draft').length)
const archivedCount = computed(() => rows.value.filter((r) => r.status === 'archived').length)

/* 操作 */
const { openMenu, toggleMenu, closeMenu, menuOpen, popStyle } = useRowMenu()

/** 菜单项执行：先关菜单再执行（避免菜单残留） */
function menuRemove(r: Row) {
  closeMenu()
  void remove(r)
}

async function publish(r: Row) {
  r.busy = true
  try {
    await livePublishAnnouncement(r.id)
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
    await liveArchiveAnnouncement(r.id)
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
    await liveDeleteAnnouncement(r.id)
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

/** 嵌入模式（运营中心公告 tab）：暴露新建入口与计数给宿主 */
defineExpose({ openCreate, activeCount, draftCount, archivedCount })

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
    await liveUpdateAnnouncement(editingId.value, {
      title: form.value.title.trim(),
      body: form.value.body.trim(),
      severity: form.value.severity,
      expiresAt: toIso(form.value.expiresAt)
    })
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
    await liveCreateAnnouncement({
      title: form.value.title.trim(),
      body: form.value.body.trim(),
      severity: form.value.severity,
      expiresAt: toIso(form.value.expiresAt),
      publishNow: form.value.publishNow
    })
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

/** 过期列：未来显示「剩 X 天/小时」，已过显示「已过期」（timeAgo 对未来一律「刚刚」，误导） */
function expiresLabel(iso: string): string {
  const t = new Date(iso).getTime()
  if (!t || Number.isNaN(t)) return '不过期'
  const diff = t - Date.now()
  if (diff > 0) {
    const h = Math.floor(diff / 3600000)
    if (h < 1) return '即将过期'
    return h < 24 ? `剩 ${h} 小时` : `剩 ${Math.floor(h / 24)} 天`
  }
  return '已过期'
}
</script>

<style scoped>
/* 列表区兜底高度：行数少时卡片铺满页面，消除表格下方 760px 全宽灰区（复用空态 --mk-empty-min-h 同款口径） */
.an-list {
  min-height: var(--mk-empty-min-h, calc(100dvh - 230px));
}
.an-body {
  max-width: 380px;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.an-severity { display: flex; gap: 6px; }
.an-sev {
  padding: 6px 14px;
  border-radius: 8px;
  border: 1px solid var(--mk-line);
  background: var(--mk-surface);
  font: inherit;
  font-size: var(--mk-fs-12);
  font-weight: 700;
  color: var(--mk-muted);
  cursor: pointer;
}
.an-sev--on.an-sev--info { border-color: var(--mk-blue); color: var(--mk-blue); background: var(--mk-blue-bg, #eef5ff); }
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
