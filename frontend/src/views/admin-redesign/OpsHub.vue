<template>
  <div class="mk-page">
    <div class="mk-status" :class="statusTone">
      <span class="mk-status__dot"></span>
      <strong class="mk-status__title">运营中心</strong>
      <span class="mk-status__sep"></span>
      <span v-if="tab === 'content'" class="mk-status__meta">路径 {{ stats?.total ?? '—' }}</span>
      <span v-if="tab === 'content'" class="mk-status__meta">里程碑 {{ stats?.totalMilestones ?? '—' }}</span>
      <span v-if="tab === 'content'" class="mk-status__meta">任务 {{ stats?.totalTasks ?? '—' }}</span>
      <span v-else class="mk-status__meta">成就定义 {{ defs.length }} · 解锁 {{ totalRecords }}</span>
      <span class="mk-status__actions">
        <span class="mk-pills">
          <button type="button" class="mk-pill" :class="{ 'mk-pill--active': tab === 'content' }" @click="switchTab('content')">内容管理</button>
          <button type="button" class="mk-pill" :class="{ 'mk-pill--active': tab === 'achievements' }" @click="switchTab('achievements')">成就管理</button>
        </span>
        <button v-if="tab === 'content'" type="button" class="mk-status__action" :disabled="loading" @click="reload">刷新</button>
      </span>
    </div>

    <!-- ===== Tab1: 内容管理 ===== -->
    <template v-if="tab === 'content'">
    <!-- 状态统计（MkKpi 统一形态） -->
    <div class="ct-cards">
      <MkKpi v-for="(s, label) in statusCards" :key="label" :label="label" :value="s" />
    </div>

    <!-- 筛选 + 列表 -->
    <div class="mk-card mk-card--fill">
      <div class="mk-card__head">
        <div class="ct-filter">
          <input v-model="keyword" class="mk-filter__input" placeholder="搜索标题 / 描述 / 用户…" @keydown.enter="reload" />
          <select v-model="statusFilter" class="mk-filter__select" @change="reload">
            <option value="">全部状态</option>
            <option value="active">学习中</option>
            <option value="completed">已完成</option>
            <option value="failed">生成失败</option>
            <option value="archived">已下线</option>
          </select>
          <select v-model="subjectFilter" class="mk-filter__select" @change="reload">
            <option value="">全部学科</option>
            <option v-for="s in subjectOptions" :key="s" :value="s">{{ s }}</option>
          </select>
          <button type="button" class="mk-btn mk-btn--sm" @click="reload">查询</button>
        </div>
        <label class="mk-field--switch ct-test">
          <input v-model="includeTest" type="checkbox" @change="reload" />
          <span class="mk-field__label" style="margin:0">含虚拟/测试</span>
        </label>
      </div>

      <MockSkeletonTable v-if="loading && !rows.length" :cols="7" />
      <div v-else-if="rows.length" class="mk-table-scroll ct-list">
        <table class="mk-table">
          <thead>
            <tr>
              <th>路径</th>
              <th>用户</th>
              <th>学科</th>
              <th>状态</th>
              <th>进度</th>
              <th class="mk-col--time-full">更新</th>
              <th class="mk-col--actions-wide">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="p in rows" :key="p.id">
              <td>
                <div class="mk-cell-main">
                  <strong class="mk-cell-text">{{ p.title }}</strong>
                  <span class="mk-cell-sub" :title="p.id">{{ shortId(p.id, 10, 4) }} · {{ p.difficulty }} · {{ p.estimatedHours ? '~' + p.estimatedHours + 'h' : '—' }}</span>
                </div>
              </td>
              <td>
                <div class="mk-cell-main">
                  <strong>{{ p.user?.name || '—' }}</strong>
                  <span class="mk-cell-sub">{{ p.user?.email || '' }}</span>
                </div>
              </td>
              <td><span class="mk-badge mk-badge--muted">{{ p.subject || '—' }}</span></td>
              <td><span class="mk-badge" :class="statusBadge(p.status)">{{ statusText(p.status) }}</span></td>
              <td>
                <div class="ct-progress" :title="`${p.completedMilestones}/${p.totalMilestones} 里程碑`">
                  <span class="mk-minibar"><span class="mk-minibar__fill" :data-tone="progressTone(p)" :style="{ width: progressPct(p) + '%' }"></span></span>
                  <span class="ct-progress__num">{{ progressPct(p) }}%</span>
                </div>
              </td>
              <td :title="fmtDate(p.updatedAt)">{{ timeAgo(p.updatedAt) }}</td>
              <td>
                <div class="mk-actions">
                  <button type="button" class="mk-link" @click="openDetail(p)">详情</button>
                  <button v-if="p.status !== 'archived'" type="button" class="mk-link mk-link--danger" :disabled="p.busy" @click="archive(p)">下线</button>
                  <button v-else type="button" class="mk-link" :disabled="p.busy" @click="restore(p)">恢复</button>
                  <div class="mk-menu">
                    <button type="button" class="mk-menu__btn" aria-label="更多操作" aria-haspopup="menu" :aria-expanded="openMenu === p.id" @click.stop="toggleMenu(p.id)">⋯</button>
                    <div v-if="openMenu === p.id" class="mk-menu__pop" :style="popStyle" @click.stop>
                      <button type="button" class="mk-menu__item" @click="menuDetail(p)">查看结构</button>
                      <button type="button" class="mk-menu__item mk-menu__item--danger" @click="menuDelete(p)">删除路径</button>
                    </div>
                  </div>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div v-else-if="failed" class="mk-empty">
        <span class="mk-empty__icon" aria-hidden="true">!</span>
        <strong>内容加载失败</strong>
        <button type="button" class="mk-empty__action" @click="reload">重试</button>
      </div>
      <div v-else class="mk-empty mk-empty--min">
        <strong>没有学习路径</strong>
        <span>用户的目标对话生成路径后，会出现在这里。</span>
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

    <!-- 路径结构详情抽屉 -->
    <Teleport to="body">
      <div v-if="detailOpen" class="mk-drawer">
        <div class="mk-drawer__mask" @click="detailOpen = false"></div>
        <div class="mk-drawer__panel mk-drawer__panel--wide" role="dialog" aria-label="路径结构">
          <div class="mk-drawer__head">
            <div>
              <h3 class="mk-drawer__title">{{ detail?.title }}</h3>
              <span class="mk-drawer__sub">{{ detail?.subject }} · {{ detail?.user?.name || '—' }} · {{ detail?.milestones?.length || 0 }} 个里程碑</span>
            </div>
            <button type="button" class="mk-drawer__close" aria-label="关闭" @click="detailOpen = false">✕</button>
          </div>
          <div class="mk-drawer__body">
            <div v-if="detailLoading" class="ct-loading"><span class="mk-spinner"></span> 加载中…</div>
            <template v-else-if="detail">
              <p v-if="detail.description" class="ct-desc">{{ detail.description }}</p>
              <div v-for="m in detail.milestones" :key="m.id" class="ct-milestone">
                <div class="ct-milestone__head">
                  <strong>{{ m.stageNumber }}. {{ m.title }}</strong>
                  <span class="mk-badge" :class="msBadge(m.status)">{{ msText(m.status) }}</span>
                  <span class="ct-milestone__meta mono">~{{ m.estimatedHours ?? '—' }}h</span>
                </div>
                <div v-if="m.subtasks.length" class="ct-subtasks">
                  <div v-for="t in m.subtasks" :key="t.id" class="ct-subtask">
                    <span class="ct-subtask__dot" :class="`ct-subtask__dot--${t.status}`"></span>
                    <span class="ct-subtask__title">{{ t.title }}</span>
                    <span class="mk-badge mk-badge--sm mk-badge--muted">{{ taskTypeText(t.taskType) }}</span>
                    <span class="ct-subtask__meta mono">{{ t.estimatedMinutes }}min</span>
                  </div>
                </div>
                <p v-else class="mk-na ct-milestone__empty">无子任务</p>
              </div>
            </template>
          </div>
        </div>
      </div>
    </Teleport>
    </template>

    <!-- ===== Tab2: 成就管理 ===== -->
    <template v-else>
      <!-- 二级切换：成就定义 / 解锁记录 -->
      <div class="mk-card ach-tabs">
        <div class="ach-tabs__bar">
          <span class="mk-pills">
            <button type="button" class="mk-pill" :class="{ 'mk-pill--active': achTab === 'defs' }" @click="switchAchTab('defs')">成就定义</button>
            <button type="button" class="mk-pill" :class="{ 'mk-pill--active': achTab === 'records' }" @click="switchAchTab('records')">解锁记录</button>
          </span>
        </div>
      </div>

      <!-- 成就定义 -->
      <div v-if="achTab === 'defs'" class="mk-card">
        <MockSkeletonTable v-if="defsLoading && !defs.length" :cols="5" />
        <div v-else-if="defs.length" class="mk-table-scroll ac-list">
          <table class="mk-table">
            <thead>
              <tr>
                <th>成就</th>
                <th>类型</th>
                <th>条件</th>
                <th class="mk-col--num">XP</th>
                <th class="mk-col--num">已解锁</th>
                <th class="mk-col--actions">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="d in defs" :key="d.id">
                <td>
                  <div class="mk-cell-main">
                    <strong><span class="ac-icon">{{ d.icon }}</span> {{ d.name }}</strong>
                    <span class="mk-cell-sub">{{ d.description }}</span>
                  </div>
                </td>
                <td><span class="mk-badge" :class="typeBadge(d.type)">{{ typeText(d.type) }}</span></td>
                <td class="mk-cell-text">{{ reqText(d.requirement) }}</td>
                <td class="mk-num">+{{ d.xpReward }}</td>
                <td class="mk-num">{{ d.unlockCount }}</td>
                <td>
                  <div class="mk-actions">
                    <button type="button" class="mk-link" @click="openGrant(d)">手动发放</button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-else-if="defsFailed" class="mk-empty">
          <span class="mk-empty__icon" aria-hidden="true">!</span>
          <strong>成就定义加载失败</strong>
          <button type="button" class="mk-empty__action" @click="loadDefs">重试</button>
        </div>
      </div>

      <!-- 解锁记录 -->
      <div v-else class="mk-card mk-card--fill">
        <div class="mk-card__head">
          <div class="ac-filter">
            <input v-model="recordSearch" class="mk-filter__input" placeholder="搜索用户姓名 / 邮箱…" @keydown.enter="reloadRecords" />
            <button type="button" class="mk-btn mk-btn--sm" @click="reloadRecords">查询</button>
          </div>
          <label class="mk-field--switch">
            <input v-model="achIncludeTest" type="checkbox" @change="reloadRecords" />
            <span class="mk-field__label" style="margin:0">含虚拟/测试</span>
          </label>
        </div>
        <MockSkeletonTable v-if="recordsLoading && !records.length" :cols="6" />
        <div v-else-if="records.length" class="mk-table-scroll ac-list">
          <table class="mk-table">
            <thead>
              <tr>
                <th>成就</th>
                <th>用户</th>
                <th>类型</th>
                <th class="mk-col--num">XP</th>
                <th class="mk-col--time-full">解锁时间</th>
                <th class="mk-col--actions">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="r in records" :key="r.id">
                <td>
                  <div class="mk-cell-main">
                    <strong><span class="ac-icon">{{ r.iconUrl || '🏆' }}</span> {{ r.title }}</strong>
                    <span class="mk-cell-sub" :title="r.description || ''">{{ r.description || '' }}</span>
                  </div>
                </td>
                <td>
                  <div class="mk-cell-main">
                    <strong>
                      {{ r.user?.name || '—' }}
                      <span v-if="r.user?.isVirtualLearner" class="mk-badge mk-badge--virtual">虚拟</span>
                    </strong>
                    <span class="mk-cell-sub">{{ r.user?.email || r.userId }}</span>
                  </div>
                </td>
                <td><span class="mk-badge" :class="typeBadge(r.type)">{{ typeText(r.type) }}</span></td>
                <td class="mk-num">+{{ r.xpReward }}</td>
                <td :title="fmtDate(r.earnedAt)">{{ timeAgo(r.earnedAt) }}</td>
                <td>
                  <div class="mk-actions">
                    <button type="button" class="mk-link mk-link--danger" :disabled="r.busy" @click="revoke(r)">撤回</button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-else-if="recordsFailed" class="mk-empty">
          <span class="mk-empty__icon" aria-hidden="true">!</span>
          <strong>解锁记录加载失败</strong>
          <button type="button" class="mk-empty__action" @click="reloadRecords">重试</button>
        </div>
        <div v-else class="mk-empty mk-empty--min">
          <strong>还没有解锁记录</strong>
          <span>用户完成任务、连续学习、达成里程碑后自动解锁，也可在「成就定义」手动发放。</span>
        </div>
        <Pagination
          v-if="totalRecords > pageSize"
          v-model:page="recordPage"
          :total="totalRecords"
          :page-size="pageSize"
          :loading="recordsLoading"
          show-total
          @update:page="reloadRecords"
        />
      </div>

      <!-- 手动发放弹窗 -->
      <Teleport to="body">
        <div v-if="grantOpen" ref="maskRef" class="mk-modal">
          <div ref="panelRef" class="mk-modal__panel" role="dialog" aria-label="手动发放成就">
            <div class="mk-modal__head">
              <h3 class="mk-modal__title">手动发放成就</h3>
              <button type="button" class="mk-modal__close" aria-label="关闭" @click="grantOpen = false">✕</button>
            </div>
            <div class="mk-modal__body">
              <div class="mk-field">
                <span class="mk-field__label">成就</span>
                <div class="ac-grant-target">
                  <span class="ac-icon ac-icon--lg">{{ grantTarget?.icon }}</span>
                  <div>
                    <strong>{{ grantTarget?.name }}</strong>
                    <span class="mk-cell-sub">{{ grantTarget?.description }}</span>
                  </div>
                  <span class="mk-badge mk-badge--ok">+{{ grantTarget?.xpReward }} XP</span>
                </div>
              </div>
              <label class="mk-field" :class="{ 'mk-field--error': errors.user }">
                <span class="mk-field__label">用户</span>
                <input v-model="grantSearch" class="mk-field__input" placeholder="搜索姓名 / 邮箱（至少 2 字符）…" @input="searchGrantUser" />
                <span v-if="errors.user" class="mk-field__err">{{ errors.user }}</span>
              </label>
              <div v-if="grantResults.length" class="ac-candidates">
                <button
                  v-for="u in grantResults"
                  :key="u.id"
                  type="button"
                  class="ac-candidate"
                  :class="{ 'ac-candidate--on': grantUserId === u.id }"
                  @click="grantUserId = u.id"
                >
                  <strong>{{ u.name || u.email }}</strong>
                  <span class="mk-cell-sub">{{ u.email }}</span>
                </button>
              </div>
              <p v-else-if="grantSearched" class="ac-none">没有匹配用户</p>
              <div v-if="grantError" class="mk-alert">{{ grantError }}</div>
            </div>
            <div class="mk-modal__foot">
              <button type="button" class="mk-btn" @click="grantOpen = false">取消</button>
              <button type="button" class="mk-btn mk-btn--primary" :disabled="!grantUserId || granting" @click="confirmGrant">
                {{ granting ? '发放中…' : '确认发放（+XP）' }}
              </button>
            </div>
          </div>
        </div>
      </Teleport>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { timeAgo, errMsg, shortId } from './live'
import { adminLearningContentApi, adminAchievementsApi, adminUsersApi, type LearningContentStats, type LearningPathRow, type AchievementDef, type AchievementRecord } from '@/api/adminApi'
import { useRowMenu } from './useRowMenu'
import { useEscape } from './useEscape'
import { useOverlay, useMaskClose } from './useOverlay'
import { askConfirm } from './useConfirm'
import { toast } from '@/utils/toast'
import MockSkeletonTable from './SkeletonTable.vue'
import Pagination from './Pagination.vue'
import MkKpi from './MkKpi.vue'

/* ===== 一级 Tab：内容管理 / 成就管理 ===== */
const tab = ref<'content' | 'achievements'>('content')
function switchTab(t: 'content' | 'achievements') {
  tab.value = t
  if (t === 'content' && !contentLoaded.value) { void reload(); void loadStats() }
  if (t === 'achievements' && !defs.value.length && !defsLoading.value) void loadDefs()
}
const contentLoaded = ref(false)

type PathRow = LearningPathRow & { busy?: boolean }

const rows = ref<PathRow[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(20)
const loading = ref(false)
const failed = ref(false)
const keyword = ref('')
const statusFilter = ref('')
const subjectFilter = ref('')
const includeTest = ref(false)
const stats = ref<LearningContentStats | null>(null)

const statusTone = computed(() => 'mk-status--ok')
const statusCards = computed(() => ({
  '学习中': String(stats.value?.byStatus?.active || 0),
  '已完成': String(stats.value?.byStatus?.completed || 0),
  '生成失败': String(stats.value?.byStatus?.failed || 0),
  '已下线': String(stats.value?.byStatus?.archived || 0),
}))
const subjectOptions = computed(() => (stats.value?.bySubject || []).map((s) => s.subject))

const statusText = (s: string) => ({ active: '学习中', completed: '已完成', failed: '生成失败', archived: '已下线' }[s] || s)
const statusBadge = (s: string) =>
  s === 'active' ? 'mk-badge--ok' : s === 'completed' ? 'mk-badge--info' : s === 'failed' ? 'mk-badge--bad' : 'mk-badge--muted'

const progressPct = (p: PathRow) => {
  if (!p.totalMilestones) return 0
  return Math.min(100, Math.round((p.completedMilestones / p.totalMilestones) * 100))
}
const progressTone = (p: PathRow) => {
  const pct = progressPct(p)
  return pct >= 100 ? 'ok' : p.status === 'failed' ? 'bad' : 'warn'
}

function fmtDate(iso?: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

async function reload() {
  loading.value = true
  failed.value = false
  try {
    const res = await adminLearningContentApi.listPaths({
      page: page.value,
      limit: pageSize.value,
      status: statusFilter.value || undefined,
      subject: subjectFilter.value || undefined,
      keyword: keyword.value.trim() || undefined,
      includeTest: includeTest.value || undefined,
    })
    const body = res.data?.data ?? res.data ?? {}
    rows.value = (body.paths || []).map((p: PathRow) => ({ ...p, busy: false }))
    total.value = body.pagination?.total ?? rows.value.length
    contentLoaded.value = true
  } catch (e) {
    failed.value = true
    toast.error(`加载失败：${errMsg(e)}`)
  } finally {
    loading.value = false
  }
}

async function loadStats() {
  try {
    const res = await adminLearningContentApi.getStats()
    stats.value = res.data?.data ?? res.data
  } catch {
    stats.value = null
  }
}

async function archive(p: PathRow) {
  const ok = await askConfirm({
    title: '下线路径',
    message: `确认下线「${p.title}」？\n用户端将无法继续学习该路径。`,
    confirmText: '下线',
  })
  if (!ok) return
  p.busy = true
  try {
    await adminLearningContentApi.archivePath(p.id)
    p.status = 'archived'
    toast.success('路径已下线')
    void loadStats()
  } catch (e) {
    toast.error(`下线失败：${errMsg(e)}`)
  } finally {
    p.busy = false
  }
}

async function restore(p: PathRow) {
  // 恢复会让路径立即回到用户端可见/可学，与下线对称需要确认
  const ok = await askConfirm({
    title: '恢复路径',
    message: `确认恢复「${p.title}」？恢复后用户端立即可见并继续学习该路径。`,
    confirmText: '恢复',
  })
  if (!ok) return
  p.busy = true
  try {
    await adminLearningContentApi.restorePath(p.id)
    p.status = 'active'
    toast.success('路径已恢复')
    void loadStats()
  } catch (e) {
    toast.error(`恢复失败：${errMsg(e)}`)
  } finally {
    p.busy = false
  }
}

async function remove(p: PathRow) {
  const ok = await askConfirm({
    title: '删除路径',
    message: `确认删除「${p.title}」？\n将级联删除其全部里程碑与子任务，不可撤销。`,
    confirmText: '删除',
  })
  if (!ok) return
  p.busy = true
  try {
    await adminLearningContentApi.deletePath(p.id)
    rows.value = rows.value.filter((x) => x.id !== p.id)
    toast.success('路径已删除')
    void loadStats()
  } catch (e) {
    toast.error(`删除失败：${errMsg(e)}`)
  } finally {
    p.busy = false
  }
}

/* 详情 */
const detailOpen = ref(false)
const detailLoading = ref(false)
const detail = ref<any>(null)

async function openDetail(p: PathRow) {
  detailOpen.value = true
  detailLoading.value = true
  detail.value = null
  try {
    const res = await adminLearningContentApi.getPathDetail(p.id)
    detail.value = res.data?.data ?? res.data
  } catch (e) {
    toast.error(`加载详情失败：${errMsg(e)}`)
  } finally {
    detailLoading.value = false
  }
}

const { openMenu, toggleMenu, closeMenu, popStyle } = useRowMenu()
function menuDetail(p: PathRow) { closeMenu(); openDetail(p) }
function menuDelete(p: PathRow) { closeMenu(); void remove(p) }

const msText = (s: string) => ({ locked: '未解锁', in_progress: '进行中', completed: '已完成' }[s] || s)
const msBadge = (s: string) =>
  s === 'completed' ? 'mk-badge--ok' : s === 'in_progress' ? 'mk-badge--info' : 'mk-badge--muted'
const taskTypeText = (t: string) => ({ practice: '练习', acquire: '习得', reflection: '反思', assessment: '评估' }[t] || t)

/* ===== Tab2: 成就管理 ===== */
const achTab = ref<'defs' | 'records'>('defs')
function switchAchTab(t: 'defs' | 'records') {
  achTab.value = t
  if (t === 'records' && !records.value.length && !recordsLoading.value) void reloadRecords()
}

/* 定义 */
const defs = ref<AchievementDef[]>([])
const defsLoading = ref(false)
const defsFailed = ref(false)

const typeText = (t: string) => ({ milestone: '里程碑', streak: '连续', completion: '完成度', mastery: '掌握', social: '社交' }[t] || t)
const typeBadge = (t: string) =>
  t === 'milestone' ? 'mk-badge--info' : t === 'streak' ? 'mk-badge--warn' : t === 'completion' ? 'mk-badge--ok' : t === 'mastery' ? 'mk-badge--bad' : 'mk-badge--muted'
const reqText = (r: AchievementDef['requirement']) => {
  const t = r.type
  if (t === 'task_count') return `完成 ${r.value} 个任务`
  if (t === 'streak_days') return `连续学习 ${r.value} 天`
  if (t === 'path_completion') return `完成 ${r.value} 条路径`
  if (t === 'ktl_level') return `KTL 达到 ${r.value}`
  return `自定义条件`
}

async function loadDefs() {
  defsLoading.value = true
  defsFailed.value = false
  try {
    const res = await adminAchievementsApi.getDefinitions()
    defs.value = (res.data?.data ?? res.data) || []
  } catch (e) {
    defsFailed.value = true
    toast.error(`加载失败：${errMsg(e)}`)
  } finally {
    defsLoading.value = false
  }
}

/* 记录 */
const records = ref<Array<AchievementRecord & { busy?: boolean }>>([])
const totalRecords = ref(0)
const recordPage = ref(1)
const recordsLoading = ref(false)
const recordsFailed = ref(false)
const recordSearch = ref('')
const achIncludeTest = ref(false)

async function reloadRecords() {
  recordsLoading.value = true
  recordsFailed.value = false
  try {
    const res = await adminAchievementsApi.getRecords({
      page: recordPage.value,
      limit: pageSize.value,
      userId: recordSearch.value.trim() || undefined,
      includeTest: achIncludeTest.value || undefined,
    })
    const body = res.data?.data ?? res.data ?? {}
    records.value = (body.records || []).map((r) => ({ ...r, busy: false }))
    totalRecords.value = body.pagination?.total ?? records.value.length
  } catch (e) {
    recordsFailed.value = true
    toast.error(`加载失败：${errMsg(e)}`)
  } finally {
    recordsLoading.value = false
  }
}

/* 撤回 */
async function revoke(r: AchievementRecord & { busy?: boolean }) {
  const ok = await askConfirm({
    title: '撤回成就',
    message: `确认撤回「${r.title}」（${r.user?.name || '未知用户'}）？\n将扣回 ${r.xpReward} XP。`,
    confirmText: '撤回',
  })
  if (!ok) return
  r.busy = true
  try {
    await adminAchievementsApi.revoke(r.id)
    records.value = records.value.filter((x) => x.id !== r.id)
    totalRecords.value = Math.max(0, totalRecords.value - 1)
    toast.success('成就已撤回')
  } catch (e) {
    toast.error(`撤回失败：${errMsg(e)}`)
  } finally {
    r.busy = false
  }
}

/* 发放 */
const grantOpen = ref(false)
useEscape(() => grantOpen.value, () => { grantOpen.value = false })
const panelRef = ref<HTMLElement | null>(null)
const maskRef = ref<HTMLElement | null>(null)
useOverlay(computed(() => grantOpen.value), panelRef)
useMaskClose(maskRef, () => { grantOpen.value = false })

const grantTarget = ref<AchievementDef | null>(null)
const grantSearch = ref('')
const grantResults = ref<Array<{ id: string; name: string; email: string }>>([])
const grantSearched = ref(false)
const grantUserId = ref('')
const granting = ref(false)
const grantError = ref('')
const errors = ref<{ user?: string }>({})

function openGrant(d: AchievementDef) {
  grantTarget.value = d
  grantSearch.value = ''
  grantResults.value = []
  grantSearched.value = false
  grantUserId.value = ''
  grantError.value = ''
  errors.value = {}
  grantOpen.value = true
}

let grantTimer: ReturnType<typeof setTimeout> | undefined
function searchGrantUser() {
  clearTimeout(grantTimer)
  const q = grantSearch.value.trim()
  if (q.length < 2) {
    grantResults.value = []
    grantSearched.value = false
    return
  }
  grantTimer = setTimeout(async () => {
    try {
      const res = await adminUsersApi.getUsers({ page: 1, limit: 8, search: q })
      const body = res.data?.data ?? res.data ?? {}
      const users = body.users || body.items || []
      grantResults.value = users.map((u: Record<string, unknown>) => ({
        id: String(u.id),
        name: String(u.name || ''),
        email: String(u.email || ''),
      }))
      grantSearched.value = true
    } catch {
      grantResults.value = []
      grantSearched.value = true
    }
  }, 300)
}

async function confirmGrant() {
  if (!grantUserId.value || !grantTarget.value) { errors.value.user = '请选择用户'; return }
  granting.value = true
  grantError.value = ''
  try {
    await adminAchievementsApi.grant(grantUserId.value, grantTarget.value.id)
    grantOpen.value = false
    toast.success(`已向用户发放「${grantTarget.value.name}」（+${grantTarget.value.xpReward} XP）`)
    void loadDefs()
    if (achTab.value === 'records') void reloadRecords()
  } catch (e) {
    grantError.value = errMsg(e)
  } finally {
    granting.value = false
  }
}

void loadDefs()

void reload()
void loadStats()
</script>

<style scoped>
.ct-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 10px; }

.ct-filter { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.ct-filter .mk-filter__input { min-width: 220px; }
.ct-test { margin-left: auto; }
.ct-list { flex: 1; min-height: 0; overflow-y: auto; }
.ct-progress { display: flex; align-items: center; gap: 8px; min-width: 120px; }
.ct-progress .mk-minibar { flex: 1; }
.ct-progress__num { font-family: var(--mk-mono); font-size: 11.5px; color: var(--mk-muted); }

.ct-loading { display: flex; align-items: center; gap: 10px; justify-content: center; padding: 40px 0; color: var(--mk-muted); font-size: 13px; }
.ct-desc { color: var(--mk-muted); font-size: 12.5px; margin: 0 0 12px; }
.ct-milestone {
  border: 1px solid var(--mk-line);
  border-radius: 10px;
  padding: 10px 12px;
  margin-bottom: 10px;
}
.ct-milestone__head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.ct-milestone__head strong { font-size: 13px; }
.ct-milestone__meta { margin-left: auto; color: var(--mk-faint); font-size: 11px; }
.ct-milestone__empty { font-size: 12px; margin: 8px 0 0; }
.ct-subtasks { display: grid; gap: 4px; margin-top: 8px; padding-top: 8px; border-top: 1px dashed var(--mk-line); }
.ct-subtask { display: flex; align-items: center; gap: 8px; font-size: 12px; }
.ct-subtask__dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }
.ct-subtask__dot--completed { background: var(--mk-green); }
.ct-subtask__dot--in_progress { background: var(--mk-blue); }
.ct-subtask__dot--todo { background: var(--mk-faint); }
.ct-subtask__title { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ct-subtask__meta { color: var(--mk-faint); font-size: 11px; }

.mk-drawer__panel--wide { width: min(720px, 100%); }

/* ===== Tab2: 成就管理 ===== */
.ach-tabs__bar { padding: 8px 14px; }
.ac-list { min-height: var(--mk-empty-min-h, calc(100dvh - 230px)); }
.ac-icon { margin-right: 4px; }
.ac-icon--lg { font-size: 22px; margin-right: 10px; }

.ac-filter { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.ac-filter .mk-filter__input { min-width: 240px; }

.ac-grant-target {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border: 1px solid var(--mk-line);
  border-radius: 10px;
  background: var(--mk-surface);
}
.ac-grant-target > div { flex: 1; display: grid; gap: 1px; min-width: 0; }
.ac-grant-target strong { font-size: 13px; }

.ac-candidates { display: grid; gap: 6px; max-height: 220px; overflow-y: auto; }
.ac-candidate {
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
.ac-candidate:hover { border-color: rgba(44, 99, 208, 0.4); }
.ac-candidate--on { border-color: var(--mk-blue); box-shadow: 0 0 0 2px rgba(44, 99, 208, 0.12); }
.ac-candidate strong { font-size: 12.5px; }
.ac-none { color: var(--mk-faint); font-size: 12.5px; text-align: center; padding: 10px 0; }

/* 4K：抽屉/弹窗内容跟随全站节奏（MkKpi/表格/状态条由全局档接管） */
@media (min-width: 2000px) {
  .ct-progress__num { font-size: 13px; }
  .ct-milestone__head strong { font-size: 14.5px; }
  .ct-milestone__meta { font-size: 12.5px; }
  .ct-subtask { font-size: 13.5px; }
  .ac-candidate strong { font-size: 14px; }
  .ac-candidate { padding: 10px 12px; }
  .ac-none { font-size: 14px; }
}
@media (min-width: 2800px) {
  .ct-progress__num { font-size: 15.5px; }
  .ct-milestone__head strong { font-size: 17px; }
  .ct-milestone__meta { font-size: 14.5px; }
  .ct-subtask { font-size: 16px; }
  .ac-candidate strong { font-size: 16.5px; }
  .ac-candidate { padding: 12px 14px; }
  .ac-none { font-size: 16.5px; }
}
@media (min-width: 3600px) {
  .ct-progress__num { font-size: 18px; }
  .ct-milestone__head strong { font-size: 20px; }
  .ct-milestone__meta { font-size: 17px; }
  .ct-subtask { font-size: 18.5px; }
  .ac-candidate strong { font-size: 19.5px; }
  .ac-candidate { padding: 14px 16px; }
  .ac-none { font-size: 19.5px; }
}

/* ================= 暗色模式（D1 补完）：运营中心 ================= */
html[data-theme='dark'] {
  /* ac-grant-target/ac-candidate 已走 var(--mk-*) token，无需页面补丁 */
}
</style>
