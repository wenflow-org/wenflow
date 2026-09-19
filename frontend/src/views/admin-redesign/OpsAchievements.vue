<template>
  <div :class="embedded ? 'oa-embedded' : 'mk-page'">
    <div v-if="!embedded" class="mk-status mk-status--ok">
      <span class="mk-status__dot"></span>
      <strong class="mk-status__title">成就管理</strong>
      <span class="mk-status__sep"></span>
      <span class="mk-status__meta">成就定义 {{ defs.length }}</span>
      <span class="mk-status__meta">解锁 {{ totalUnlocked }}</span>
    </div>

    <!-- 主视图切换（统一样板：状态条正下方的独立一行，按内容宽度、左对齐） -->
    <div class="mk-pills" role="tablist" aria-label="成就视图切换">
      <button type="button" role="tab" class="mk-pill" :aria-selected="achTab === 'defs'" :class="{ 'mk-pill--active': achTab === 'defs' }" @click="switchAchTab('defs')">成就定义</button>
      <button type="button" role="tab" class="mk-pill" :aria-selected="achTab === 'records'" :class="{ 'mk-pill--active': achTab === 'records' }" @click="switchAchTab('records')">解锁记录</button>
    </div>

    <!-- 成就定义 -->
    <div v-if="achTab === 'defs'" class="mk-card">
      <MockSkeletonTable v-if="defsLoading && !defs.length" :cols="5" />
      <div v-else-if="defs.length" class="mk-table-scroll ac-list">
        <table class="mk-table mk-table--fixed">
          <colgroup>
            <col style="width:var(--mk-col-text)">
            <col style="width:var(--mk-col-badge)">
            <col style="width:var(--mk-col-text)">
            <col style="width:var(--mk-col-num)">
            <col style="width:var(--mk-col-num)">
            <col style="width:var(--mk-col-actions-wide)">
          </colgroup>
          <thead>
            <tr>
              <th>成就</th>
              <th>类型</th>
              <th>条件</th>
              <th class="mk-th--right">XP</th>
              <th class="mk-th--right">已解锁</th>
              <th class="mk-th--right">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="d in defs" :key="d.id">
              <td>
                <div class="mk-cell-main">
                  <strong><AchIcon :type="d.type" /> {{ d.name }}</strong>
                  <span class="mk-cell-sub">{{ d.description }}</span>
                </div>
              </td>
              <td><span class="mk-badge" :class="typeBadge(d.type)">{{ typeText(d.type) }}</span></td>
              <td class="mk-cell-text" :title="reqTitle(d.requirement)">{{ reqText(d.requirement) }}</td>
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
      <MkEmptyState
        v-else-if="defsFailed"
        icon="!"
        title="成就定义加载失败"
        action-text="重试"
        @action="loadDefs"
      />
      <!-- 原先缺 v-else 兜底：后端返回空数组时卡内什么都不渲染（审计 附 A #10） -->
      <MkEmptyState v-else icon="◌" title="暂无成就定义" />
    </div>

    <!-- 解锁记录 -->
    <div v-else class="mk-card mk-card--fill">
      <div class="mk-card__head">
        <div class="ac-filter">
          <MkFilterSearch v-model="recordSearch" placeholder="搜索用户姓名 / 邮箱…" @keydown.enter="reloadRecords" />
          <button type="button" class="mk-btn mk-btn--sm" @click="reloadRecords">查询</button>
        </div>
        <DataScopeToggle :model-value="achIncludeTest" @update:model-value="onAchRescope" />
      </div>
      <MockSkeletonTable v-if="recordsLoading && !records.length" :cols="6" />
      <div v-else-if="records.length" class="mk-table-scroll ac-list">
        <table class="mk-table mk-table--fixed">
          <colgroup>
            <col style="width:var(--mk-col-text)">
            <col style="width:var(--mk-col-text)">
            <col style="width:var(--mk-col-badge)">
            <col style="width:var(--mk-col-num)">
            <col style="width:var(--mk-col-time-full)">
            <col style="width:var(--mk-col-actions-wide)">
          </colgroup>
          <thead>
            <tr>
              <th>成就</th>
              <th>用户</th>
              <th>类型</th>
              <th
                scope="col"
                class="mk-th--right mk-th--sortable"
                :aria-sort="achSortState('xpReward')"
                @click="toggleAchSort('xpReward')"
              ><button type="button" class="mk-th__btn" @click.stop="toggleAchSort('xpReward')">XP<span class="mk-th__caret" aria-hidden="true"></span></button></th>
              <th
                scope="col"
                class="mk-th--sortable"
                :aria-sort="achSortState('earnedAt')"
                @click="toggleAchSort('earnedAt')"
              ><button type="button" class="mk-th__btn" @click.stop="toggleAchSort('earnedAt')">解锁时间<span class="mk-th__caret" aria-hidden="true"></span></button></th>
              <th class="mk-th--right">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in records" :key="r.id">
              <td>
                <div class="mk-cell-main">
                  <strong><span class="ac-icon">
                    <img v-if="r.iconUrl" :src="r.iconUrl" alt="" class="ac-icon-img" />
                    <AchIcon v-else :type="r.type" />
                  </span> {{ r.title }}</strong>
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
      <MkEmptyState
        v-else-if="recordsFailed"
        icon="!"
        title="解锁记录加载失败"
        action-text="重试"
        @action="reloadRecords"
      />
      <MkEmptyState
        v-else
        icon="◌"
        title="还没有解锁记录"
        description="用户完成任务、连续学习、达成里程碑后自动解锁，也可在「成就定义」手动发放。"
        min
      />
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
                <AchIcon :type="grantTarget?.type" size="lg" />
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
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useTableSort } from './useTableSort'
import { timeAgo, errMsg } from './live'
import { adminAchievementsApi, adminUsersApi, type AchievementDef, type AchievementRecord } from '@/api/adminApi'
import { useEscape } from './useEscape'
import { useOverlay, useMaskClose } from './useOverlay'
import { askConfirm, doneConfirm, failConfirm } from './useConfirm'
import { toast } from '@/utils/toast'
import MockSkeletonTable from './SkeletonTable.vue'
import DataScopeToggle from './DataScopeToggle.vue'
import Pagination from './Pagination.vue'
import MkFilterSearch from '@/components/mk/MkFilterSearch.vue'
import AchIcon from './AchIcon.vue'
import MkEmptyState from '@/components/mk/MkEmptyState.vue'

/** 嵌入模式：作为运营中心「成就」tab 渲染（仅去掉外层状态条；宿主承载域计数与刷新）。
    count 事件：解锁总数上报（宿主「成就 N」徽章） */
withDefaults(defineProps<{ embedded?: boolean }>(), { embedded: false })
const emit = defineEmits<{ (e: 'count', total: number): void }>()

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
  t === 'milestone' ? 'mk-badge--info' : t === 'streak' ? 'mk-badge--warn' : t === 'completion' ? 'mk-badge--ok' : t === 'mastery' ? 'mk-badge--info' : 'mk-badge--muted'
const reqText = (r: AchievementDef['requirement']) => {
  const t = r.type
  if (t === 'task_count') return `完成 ${r.value} 个任务`
  if (t === 'streak_days') return `连续学习 ${r.value} 天`
  if (t === 'path_completion') return `完成 ${r.value} 条路径`
  if (t === 'ktl_level') return `KTL 达到 ${r.value}`
  return `自定义条件`
}
/** 条件列的补充说明：展开未在本行显示的术语（KTL 等），避免裸缩写无处可查 */
const reqTitle = (r: AchievementDef['requirement']) => {
  if (r.type === 'ktl_level') return `KTL（Knowledge Tracing Level，知识掌握水平）达到 ${r.value}`
  if (r.type === 'task_count') return `累计完成 ${r.value} 个学习任务`
  if (r.type === 'streak_days') return `连续学习天数达到 ${r.value} 天`
  if (r.type === 'path_completion') return `完成 ${r.value} 条学习路径`
  return '由后台自定义条件判定'
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

/**
 * 头部「解锁」总览：默认在「成就定义」tab 时 records 尚未加载，totalRecords 恒为 0，
 * 与表格「已解锁」列（来自 defs.unlockCount）矛盾。改由定义侧 unlockCount 求和，
 * 保证头部与表格同源一致（记录 tab 加载后 totalRecords 应与之相等）。
 */
const totalUnlocked = computed(() => {
  const sum = defs.value.reduce((n, d) => n + (d.unlockCount || 0), 0)
  return sum > 0 ? sum : totalRecords.value
})

/** 宿主域计数徽章（embedded 才消费）：解锁总数就绪/变化即上报 */
watch(totalUnlocked, (n) => {
  emit('count', n)
}, { immediate: true })
const recordPage = ref(1)
const pageSize = ref(20)
const recordsLoading = ref(false)
const recordsFailed = ref(false)
const recordSearch = ref('')
const achIncludeTest = ref(false)

/* 服务端排序：白名单 earnedAt / xpReward，默认解锁时间倒序；变更回第 1 页重查。 */
const {
  sortKey: achSortKey,
  sortDir: achSortDir,
  toggle: toggleAchSort,
  sortState: achSortState
} = useTableSort({
  keys: ['earnedAt', 'xpReward'],
  defaultKey: 'earnedAt',
  defaultDir: 'desc',
  storageKey: 'wf_achievements_records_sort'
})
/** 数据范围切换（仅真实/含模拟）→ 立即按新范围重拉 */
function onAchRescope(v: boolean) {
  achIncludeTest.value = v
  void reloadRecords()
}

/* 排序变更：回第 1 页重查（与筛选同义） */
watch([achSortKey, achSortDir], () => {
  recordPage.value = 1
  void reloadRecords()
})

async function reloadRecords() {
  recordsLoading.value = true
  recordsFailed.value = false
  try {
    const res = await adminAchievementsApi.getRecords({
      page: recordPage.value,
      limit: pageSize.value,
      userId: recordSearch.value.trim() || undefined,
      includeTest: achIncludeTest.value || undefined,
      sort: (achSortKey.value || undefined) as 'earnedAt' | 'xpReward',
      order: achSortDir.value,
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

function fmtDate(iso?: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/* 撤回 */
async function revoke(r: AchievementRecord & { busy?: boolean }) {
  const ok = await askConfirm({
    title: '撤回成就',
    message: `确认撤回「${r.title}」（${r.user?.name || '未知用户'}）？\n将扣回 ${r.xpReward} XP。`,
    confirmText: '撤回',
    busy: true,
  })
  if (!ok) return
  r.busy = true
  try {
    await adminAchievementsApi.revoke(r.id)
    records.value = records.value.filter((x) => x.id !== r.id)
    totalRecords.value = Math.max(0, totalRecords.value - 1)
    toast.success('成就已撤回')
    doneConfirm()
  } catch (e) {
    toast.error(`撤回失败：${errMsg(e)}`)
    failConfirm()
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

/** 宿主刷新联动（运营中心宿主「刷新」按钮 → 重拉定义与记录） */
defineExpose({ refresh: () => { void loadDefs(); void reloadRecords() } })

onMounted(() => {
  void loadDefs()
})
</script>

<style scoped>
/* 嵌入模式（运营中心宿主 flex 列内）：占满剩余高度并内滚（对齐 oc-embedded 先例） */
.oa-embedded { flex: 1 1 auto; min-height: 0; overflow-y: auto; }
.ac-list { min-height: 120px; }
.ac-icon { margin-right: 4px; }


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
.ac-grant-target strong { font-size: var(--mk-fs-13); }

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
.ac-candidate strong { font-size: var(--mk-fs-12_5); }
.ac-none { color: var(--mk-faint); font-size: var(--mk-fs-12_5); text-align: center; padding: 10px 0; }

/* 4K：弹窗内容跟随全站节奏 */
@media (min-width: 2000px) {
  .ac-candidate strong { font-size: 14px; }
  .ac-candidate { padding: 10px 12px; }
  .ac-none { font-size: 14px; }
}
@media (min-width: 2800px) {
  .ac-candidate strong { font-size: 16.5px; }
  .ac-candidate { padding: 12px 14px; }
  .ac-none { font-size: 16.5px; }
}
@media (min-width: 3600px) {
  .ac-candidate strong { font-size: 19.5px; }
  .ac-candidate { padding: 14px 16px; }
  .ac-none { font-size: 19.5px; }
}
</style>
