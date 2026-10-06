<template>
  <div :class="embedded ? 'oa-embedded' : 'mk-page'">
    <div v-if="!embedded" class="mk-status mk-status--ok">
      <span class="mk-status__dot"></span>
      <strong class="mk-status__title">成就管理</strong>
      <span class="mk-status__sep"></span>
      <span class="mk-status__meta">成就定义 {{ defs.length }}</span>
      <span class="mk-status__meta">解锁 {{ totalUnlocked }}</span>
    </div>

    <!-- 主视图切换（原型 .tabs 下划线页签：12px/600、激活蓝字+2px 蓝下划线、通栏底线；
         2026-10-01 由 mk-pills 胶囊迁入——胶囊只做筛选 chips，视图/分区切换归页签；
         写法与宿主 OpsHub 页签、Users.vue 卡内页签同款） -->
    <!-- 键盘契约（审核 #167）：roving tabindex + 左右方向键循环切换，页签 aria-controls 到
         对应 role=tabpanel 容器（判例 HealthCenter.vue:104-119） -->
    <div class="tabs" role="tablist" aria-label="成就视图切换" @keydown="onAchTabKeydown">
      <button type="button" role="tab" id="oa-tab-defs" :ref="(el) => setAchTabRef(el, 0)" :tabindex="achTab === 'defs' ? 0 : -1" aria-controls="oa-panel-defs" class="tab" :aria-selected="achTab === 'defs'" @click="switchAchTab('defs')">成就定义</button>
      <button type="button" role="tab" id="oa-tab-records" :ref="(el) => setAchTabRef(el, 1)" :tabindex="achTab === 'records' ? 0 : -1" aria-controls="oa-panel-records" class="tab" :aria-selected="achTab === 'records'" @click="switchAchTab('records')">解锁记录</button>
    </div>

    <!-- 成就定义（原型 1890-1893 卡片栅格：每卡 名 strong + grow + 状态 badge；
         副行 描述 sub；底行 已解锁 b mono N 人 + grow）。原型底行右侧为「解锁率」，
         但 /admin/achievements/definitions 只回 unlockCount（全量含虚拟），
         缺「总学习者」分母——按无数据不硬造，右侧改显真实奖励 +XP；「手动发放」能力保留。 -->
    <div v-if="achTab === 'defs'" id="oa-panel-defs" role="tabpanel" aria-labelledby="oa-tab-defs" class="mk-card">
      <MockSkeletonTable v-if="defsLoading && !defs.length" :cols="3" />
      <div v-else-if="defs.length" class="ac-grid">
        <div v-for="d in defs" :key="d.id" class="ac-card">
          <div class="ac-card__head">
            <strong class="ac-card__name"><AchIcon :type="d.type" /> {{ d.name }}</strong>
            <span class="mk-badge" :class="typeBadge(d.type)">{{ typeText(d.type) }}</span>
          </div>
          <span class="ac-card__desc">{{ d.description }}</span>
          <span class="ac-card__cond" :title="reqTitle(d.requirement)">条件：{{ reqText(d.requirement) }}</span>
          <div class="ac-card__foot">
            <span class="ac-card__unlocked">已解锁 <b class="mono">{{ d.unlockCount }}</b> 人</span>
            <span class="oa-xp" :title="`解锁可得 ${d.xpReward} XP`">+{{ d.xpReward }} XP</span>
            <button type="button" class="mk-link ac-card__grant" @click="openGrant(d)">手动发放</button>
          </div>
        </div>
      </div>
      <MkEmptyState
        v-else-if="defsFailed"
        icon="!"
        title="成就定义加载失败"
        action-text="重试"
        @action="loadDefs"
      />
      <!-- 原先缺 v-else 兜底：后端返回空数组时卡内什么都不渲染（审计 附 A #10） -->
      <MkEmptyState v-else icon="◌" title="暂无成就定义" action-text="刷新" @action="loadDefs" />
    </div>

    <!-- 解锁记录 -->
    <div v-else id="oa-panel-records" role="tabpanel" aria-labelledby="oa-tab-records" class="mk-card mk-card--fill">
      <div class="mk-card__head">
        <div class="ac-filter">
          <MkFilterSearch v-model="recordSearch" placeholder="搜索用户姓名 / 邮箱…" @keydown.enter="reloadRecordsFromFirstPage" />
          <button type="button" class="mk-btn mk-btn--sm" @click="reloadRecordsFromFirstPage">查询</button>
        </div>
        <DataScopeToggle :model-value="achIncludeTest" @update:model-value="onAchRescope" />
      </div>
      <MockSkeletonTable v-if="recordsLoading && !records.length" :cols="6" />
      <div v-else-if="records.length" class="mk-table-scroll ac-list">
        <!-- 原型 .tbl：width:100% 自动布局（无 colgroup/无 fixed），单元格 nowrap；
             成就/用户双行单元格由 mk-cell-main 全局 max-width 截断兜底 -->
        <table class="mk-table mk-table--nowrap">
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
        :title="isRecordsFiltered ? '没有符合筛选条件的解锁记录' : '还没有解锁记录'"
        :description="isRecordsFiltered
          ? '当前搜索/筛选条件下无匹配记录，可清除筛选查看全部。'
          : '用户完成任务、连续学习、达成里程碑后自动解锁，也可在「成就定义」手动发放。'"
        min
        :action-text="isRecordsFiltered ? '清除筛选' : ''"
        @action="clearRecordsFilters"
      />
      <Pagination
        v-if="totalRecords > pageSize"
        v-model:page="recordPage"
        v-model:pageSize="pageSize"
        :total="totalRecords"
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
            <button type="button" class="mk-modal__close" aria-label="关闭" @click="closeGrant">✕</button>
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
            <div v-if="grantError" class="mk-alert" role="alert">{{ grantError }}</div>
          </div>
          <div class="mk-modal__foot">
            <!-- 统一关闭路径：发放中禁关（与 Esc/遮罩/✕ 同守卫） -->
            <button type="button" class="mk-btn" @click="closeGrant">取消</button>
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
import { computed, nextTick, onMounted, ref, watch } from 'vue'
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

/* 页签键盘契约（审核 #167）：roving tabindex + 左右方向键循环切换并移动焦点 */
const ACH_TABS = ['defs', 'records'] as const
const achTabEls = ref<(HTMLButtonElement | null)[]>([])
function setAchTabRef(el: unknown, i: number) {
  achTabEls.value[i] = (el as HTMLButtonElement) || null
}
function onAchTabKeydown(e: KeyboardEvent) {
  const keys = ['ArrowRight', 'ArrowLeft', 'Home', 'End']
  if (!keys.includes(e.key)) return
  const n = ACH_TABS.length
  const cur = ACH_TABS.indexOf(achTab.value)
  const from = cur >= 0 ? cur : 0
  let next = from
  if (e.key === 'ArrowRight') next = (from + 1) % n
  else if (e.key === 'ArrowLeft') next = (from - 1 + n) % n
  else if (e.key === 'Home') next = 0
  else next = n - 1
  e.preventDefault()
  switchAchTab(ACH_TABS[next])
  void nextTick(() => achTabEls.value[next]?.focus())
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
  reloadRecordsFromFirstPage()
}

/* 排序变更：回第 1 页重查（与筛选同义） */
watch([achSortKey, achSortDir], () => {
  recordPage.value = 1
  void reloadRecords()
})

/** 输入是否形如用户 id：user_/virtual_ 前缀 + uuid 体（auth.service 注册生成）。
    命中时仍走 userId 精确匹配兼容分支；普通姓名/邮箱走 q 模糊。 */
const USER_ID_LIKE = /^(?:user|virtual)_[0-9a-f-]{8,}$/i

async function reloadRecords() {
  recordsLoading.value = true
  recordsFailed.value = false
  try {
    // 搜索语义对齐占位符「按姓名/邮箱」：常规输入作为 q 模糊传给后端（原先误作 userId
    // 精确匹配，搜索恒为空）。q 不在 adminApi 的 params 类型里（该文件本次只读未改），此处收窄一次。
    const term = recordSearch.value.trim()
    const search: { userId?: string; q?: string } = term
      ? (USER_ID_LIKE.test(term) ? { userId: term } : { q: term })
      : {}
    const res = await adminAchievementsApi.getRecords({
      page: recordPage.value,
      limit: pageSize.value,
      ...search,
      includeTest: achIncludeTest.value || undefined,
      sort: (achSortKey.value || undefined) as 'earnedAt' | 'xpReward',
      order: achSortDir.value,
    } as Parameters<typeof adminAchievementsApi.getRecords>[0])
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

/** 记录页签是否处于筛选态（搜索词 / 含测试账号口径） */
const isRecordsFiltered = computed(() => !!recordSearch.value.trim() || achIncludeTest.value)
/** 筛选变化：回第 1 页重查（页码停在越界页会显示空列表） */
function reloadRecordsFromFirstPage() {
  recordPage.value = 1
  void reloadRecords()
}
/** 清除记录筛选（搜索 + 数据范围），回第 1 页重查 */
function clearRecordsFilters() {
  recordSearch.value = ''
  achIncludeTest.value = false
  reloadRecordsFromFirstPage()
}
/* 每页条数变化：回第 1 页重查（此前只传 :page-size 不监听 @update:pageSize，
   下拉可选但列表恒按 20 条渲染，是死控件） */
watch(pageSize, () => { reloadRecordsFromFirstPage() })

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
/** 弹窗统一关闭路径：发放中（granting）禁止 Esc/遮罩/✕/取消 误关——请求仍在跑却失去上下文 */
function closeGrant() {
  if (!granting.value) grantOpen.value = false
}
useEscape(() => grantOpen.value, closeGrant)
const panelRef = ref<HTMLElement | null>(null)
const maskRef = ref<HTMLElement | null>(null)
useOverlay(computed(() => grantOpen.value), panelRef)
useMaskClose(maskRef, closeGrant)

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
/* 记录行图标：后端填了 iconUrl 时用真图；补尺寸约束（与 AchIcon 20×20 同档），
   避免未来 iconUrl 有值时无约束 <img> 把行高撑坏（审核 #165，原类零定义） */
.ac-icon-img {
  width: 20px;
  height: 20px;
  border-radius: var(--mk-radius-sm);
  object-fit: cover;
  vertical-align: -4px;
}

/* 成就定义卡片栅格（原型 1890-1893：grid minmax(260px,1fr) + card） */
.ac-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: 12px;
  padding: 16px;
}
.ac-card {
  display: grid;
  gap: 8px;
  padding: 12px;
  border: 1px solid var(--mk-line);
  border-radius: var(--mk-radius-xl);
  background: var(--mk-surface);
}
.ac-card__head { display: flex; align-items: center; gap: 8px; }
.ac-card__name {
  flex: 1 1 auto;
  min-width: 0;
  font-size: var(--mk-fs-body);
  font-weight: 700;
  color: var(--mk-ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ac-card__desc { font-size: var(--mk-fs-micro); color: var(--mk-muted); line-height: 1.5; }
.ac-card__cond {
  font-size: var(--mk-fs-micro);
  color: var(--mk-faint);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ac-card__foot { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.ac-card__unlocked { margin-right: auto; font-size: var(--mk-fs-micro); color: var(--mk-muted); }
.ac-card__unlocked b {
  font-size: var(--mk-fs-body);
  font-weight: 800;
  color: var(--mk-ink);
  font-variant-numeric: tabular-nums;
}
.ac-card__grant { font-size: var(--mk-fs-micro); }

/* ================= 视图切换（原型 .tabs 下划线页签） =================
   样式 2026-10-05 CM1 收敛到全局 .tabs/.tab（mk-primitives.css），本页不再私持拷贝。 */
/* 嵌入模式：宿主页签与本页签之间补 .mk-page 同款 12px 节奏（嵌入根是 block 无 grid gap） */
.oa-embedded > .tabs { margin-bottom: var(--mk-space-3, 12px); }

/* 原型 .tbl td：nowrap（长内容由 mk-cell-main/mk-cell-text 全局 max-width 截断兜底）。
   2026-10-05 CM6：收敛为全局修饰类 .mk-table--nowrap（表元素已挂该 class）。 */


.ac-filter { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.ac-filter .mk-filter__input { min-width: 240px; }

.ac-grant-target {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border: 1px solid var(--mk-line);
  border-radius: var(--mk-radius-xl);
  background: var(--mk-surface);
}
.ac-grant-target > div { flex: 1; display: grid; gap: 1px; min-width: 0; }
.ac-grant-target strong { font-size: var(--mk-fs-body); }

.ac-candidates { display: grid; gap: 6px; max-height: 220px; overflow-y: auto; }
.ac-candidate {
  display: grid;
  gap: 1px;
  padding: 8px 10px;
  border: 1px solid var(--mk-line);
  border-radius: var(--mk-radius-sm);
  background: var(--mk-surface);
  font: inherit;
  text-align: left;
  cursor: pointer;
  width: 100%;
}
.ac-candidate:hover { border-color: color-mix(in srgb, var(--mk-blue) 40%, transparent); }
.ac-candidate--on { border-color: var(--mk-blue); box-shadow: 0 0 0 2px color-mix(in srgb, var(--mk-blue) 12%, transparent); }
.ac-candidate strong { font-size: var(--mk-fs-micro); }
.ac-none { color: var(--mk-faint); font-size: var(--mk-fs-micro); text-align: center; padding: 10px 0; }

/* 4K：弹窗内容跟随全站节奏 */
@media (min-width: 2000px) {
  .ac-candidate strong { font-size: var(--mk-fs-body); }
  .ac-candidate { padding: 10px 12px; }
  .ac-none { font-size: var(--mk-fs-body); }
}
@media (min-width: 2800px) {
  .ac-candidate strong { font-size: var(--mk-fs-body); }
  .ac-candidate { padding: 12px 14px; }
  .ac-none { font-size: var(--mk-fs-body); }
}
@media (min-width: 3600px) {
  .ac-candidate strong { font-size: var(--mk-fs-emphasis); }
  .ac-candidate { padding: 14px 16px; }
  .ac-none { font-size: var(--mk-fs-emphasis); }
}

/* XP 列 chip（批E）：沿用 Users 等级色阶语义（奖励值蓝调胶囊） */
.oa-xp {
  display: inline-block;
  padding: 1px 8px;
  border-radius: var(--mk-radius-pill);
  font-variant-numeric: tabular-nums;
  font-weight: 700;
  font-size: var(--mk-fs-micro);
  background: color-mix(in srgb, var(--mk-blue) 12%, transparent);
  color: var(--mk-accent-deep);
}
</style>
