<template>
  <div :class="embedded ? 'mk-page--fill oa-embedded' : 'mk-page'">
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
          <span class="ac-card__cond" :title="reqTitle(d.requirement)">
            条件：<template v-if="d.requirement.type === 'mastered_concepts'"><RouterLink class="ac-card__term" :to="glossaryTermLink('已掌握知识点')">已掌握知识点</RouterLink> {{ d.requirement.value }} 个</template><template v-else>{{ reqText(d.requirement) }}</template>
          </span>
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
        description="无法读取成就定义清单，读数可能不完整。"
        action-text="重试"
        @action="loadDefs"
      />
      <!-- 原先缺 v-else 兜底：后端返回空数组时卡内什么都不渲染（审计 附 A #10） -->
      <MkEmptyState
        v-else
        icon="◌"
        title="暂无成就定义"
        description="还没有配置任何成就。定义来自成就目录，配置后学习者达成时自动发放。"
        action-text="刷新"
        @action="loadDefs"
      />
    </div>

    <!-- 解锁记录 -->
    <div v-else id="oa-panel-records" role="tabpanel" aria-labelledby="oa-tab-records" class="mk-card mk-card--fill">
      <div class="mk-card__head">
        <!-- 搜索槽位统一（2026-10-15 用户拍板全站列表页）：搜索移到右组首位；
             「查询」钮随搜索框一起移（它是搜索的提交动作，贴着输入框才读得出从属） -->
        <div class="mk-card__head-right">
          <MkFilterSearch v-model="recordSearch" placeholder="搜索姓名 / 邮箱" @keydown.enter="reloadRecordsFromFirstPage" />
          <button type="button" class="mk-btn mk-btn--sm" @click="reloadRecordsFromFirstPage">查询</button>
        </div>
      </div>
      <MockSkeletonTable v-if="recordsLoading && !records.length" :cols="6" />
      <div v-else-if="records.length" class="mk-table-scroll ac-list">
        <!-- 固定列宽（2026-10-22 与教学组三表同判例）：成就/用户两列在 auto 布局下按当页最长
             名称分宽，翻页整表跳动；fixed 后按表头定死，余量按权重摊开。双行单元格由
             mk-cell-main 全局 max-width 截断兜底 -->
        <table class="mk-table mk-table--nowrap mk-table--fixed ach-table">
          <thead>
            <tr>
              <th scope="col" class="ach-c-title">成就</th>
              <th scope="col" class="ach-c-user">用户</th>
              <th scope="col" class="ach-c-type">类型</th>
              <th
                scope="col"
                class="mk-th--right mk-th--sortable ach-c-xp"
                :aria-sort="achSortState('xpReward')"
                @click="toggleAchSort('xpReward')"
              ><button type="button" class="mk-th__btn" @click.stop="toggleAchSort('xpReward')">XP<span class="mk-th__caret" aria-hidden="true"></span></button></th>
              <th
                scope="col"
                class="mk-th--sortable ach-c-earned"
                :aria-sort="achSortState('earnedAt')"
                @click="toggleAchSort('earnedAt')"
              ><button type="button" class="mk-th__btn" @click.stop="toggleAchSort('earnedAt')">解锁时间<span class="mk-th__caret" aria-hidden="true"></span></button></th>
              <th scope="col" class="mk-th--right mk-c-act">操作</th>
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
                  <strong v-if="r.user?.name">{{ r.user.name }}</strong>
                  <span v-else class="mk-na">—</span>
                  <span class="mk-cell-sub" :title="r.user?.email || r.userId">{{ r.user?.email || r.userId }}</span>
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
        min
        icon="!"
        title="解锁记录加载失败"
        description="无法读取解锁记录，读数可能不完整。"
        action-text="重试"
        @action="reloadRecords"
      />
      <MkEmptyState
        v-else
        icon="◌"
        :title="isRecordsFiltered ? '没有符合筛选条件的解锁记录' : '还没有解锁记录'"
        :description="isRecordsFiltered
          ? '当前搜索/筛选条件下无匹配记录，可清除筛选查看全部。'
          : ''"
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
              <input v-model="grantSearch" class="mk-field__input" placeholder="搜索姓名 / 邮箱" @input="searchGrantUser" />
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
                <span class="mk-cell-sub" :title="u.email">{{ u.email }}</span>
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
import { computed, getCurrentInstance, nextTick, onMounted, ref, watch } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { useTableSort } from './useTableSort'
import { timeAgo, errMsg } from './live'
import { adminAchievementsApi, adminUsersApi, type AchievementDef, type AchievementRecord } from '@/api/adminApi'
import { useEscape } from './useEscape'
import { useOverlay, useMaskClose } from './useOverlay'
import { askConfirm, doneConfirm, failConfirm } from './useConfirm'
import { toast } from '@/utils/toast'
import MockSkeletonTable from './SkeletonTable.vue'
import Pagination from './Pagination.vue'
import MkFilterSearch from '@/components/mk/MkFilterSearch.vue'
import AchIcon from './AchIcon.vue'
import MkEmptyState from '@/components/mk/MkEmptyState.vue'

/** 嵌入模式：作为运营中心「成就」tab 渲染（仅去掉外层状态条；宿主承载域计数与刷新）。
    count 事件：解锁总数上报（宿主「成就 N」徽章） */
withDefaults(defineProps<{ embedded?: boolean }>(), { embedded: false })
const emit = defineEmits<{ (e: 'count', total: number): void }>()

/** 页签可寻址（2026-10-24）：宿主已占 ?tab=，子视图用 ?sub=defs|records。
    「解锁记录」常被运维链接直指（如「谁拿了成就」），此前只能落到定义页再手点。
    无 router 上下文（单测/独立挂载）时降级为纯组件内状态。 */
const hasRouterCtx = !!getCurrentInstance()?.appContext.config.globalProperties.$router
const achRoute = hasRouterCtx ? useRoute() : null
const achRouter = hasRouterCtx ? useRouter() : null

const achTab = ref<'defs' | 'records'>(achRoute?.query.sub === 'records' ? 'records' : 'defs')
function applyAchTab(t: 'defs' | 'records') {
  if (achTab.value === t) return
  achTab.value = t
  if (t === 'records' && !records.value.length && !recordsLoading.value) void reloadRecords()
}
/** URL 与页签双向：点击写 ?sub=（defs 为默认值，删键保持地址干净）；浏览器后退由 watcher 回放 */
function switchAchTab(t: 'defs' | 'records') {
  applyAchTab(t)
  if (!achRoute || !achRouter) return
  const cur = typeof achRoute.query.sub === 'string' ? achRoute.query.sub : ''
  if (cur === (t === 'records' ? 'records' : '')) return
  const query = { ...achRoute.query }
  if (t === 'records') query.sub = 'records'
  else delete query.sub
  void achRouter.push({ query })
}
watch(() => achRoute?.query.sub, (v) => {
  applyAchTab(v === 'records' ? 'records' : 'defs')
})

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

const typeText = (t: string) => ({ milestone: '里程碑', streak: '连续学习', completion: '完成度', mastery: '掌握', social: '社交' }[t] || t)
const typeBadge = (t: string) =>
  t === 'milestone' ? 'mk-badge--info' : t === 'streak' ? 'mk-badge--warn' : t === 'completion' ? 'mk-badge--ok' : t === 'mastery' ? 'mk-badge--info' : 'mk-badge--muted'
const reqText = (r: AchievementDef['requirement']) => {
  const t = r.type
  if (t === 'task_count') return `完成 ${r.value} 个任务`
  if (t === 'streak_days') return `连续学习 ${r.value} 天`
  if (t === 'path_completion') return `完成 ${r.value} 条路径`
  if (t === 'mastered_concepts') return `掌握 ${r.value} 个知识点`
  return `自定义条件`
}
/** 术语 → 术语表深链：?q= 由 AdminGlossary 读取并预填搜索，让成就卡里的裸缩写可点可查
    （此前术语解释只塞在 title 悬停里，不可发现也不可点，走查 #32） */
function glossaryTermLink(term: string) {
  return { path: '/admin/glossary', query: { q: term } }
}
/** 条件列的补充说明：展开本行未显示的判定口径（掌握度阈值等） */
const reqTitle = (r: AchievementDef['requirement']) => {
  if (r.type === 'mastered_concepts') return `记忆痕迹中掌握度 ≥ 80% 且真实提取过的知识点达到 ${r.value} 个`
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
/* 已提交的搜索词：只有「查询」/回车才生效。
   为什么与输入框分开：翻页读的是当前生效的筛选，若直接读 recordSearch，用户在输入框里
   改词后点下一页，就会以「未查询过的新词 + 第 N 页」发请求——跳过了新结果的第一页，
   还可能落在越界页显示空列表（2026-10-08 走查确认）。 */
const committedSearch = ref('')
/* 服务端排序：白名单 earnedAt / xpReward，默认解锁时间倒序；变更回第 1 页重查。 */
const {
  sortKey: achSortKey,
  sortDir: achSortDir,
  toggle: toggleAchSort,
  sortState: achSortState,
} = useTableSort({
  keys: ['earnedAt', 'xpReward'],
  defaultKey: 'earnedAt',
  defaultDir: 'desc',
  storageKey: 'wf_achievements_records_sort'
})
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
    // 用已提交词而非输入框现值：翻页不改筛选条件（见 committedSearch 注释）。
    const term = committedSearch.value
    const search: { userId?: string; q?: string } = term
      ? (USER_ID_LIKE.test(term) ? { userId: term } : { q: term })
      : {}
    const res = await adminAchievementsApi.getRecords({
      page: recordPage.value,
      limit: pageSize.value,
      ...search,

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

/** 记录页签是否处于筛选态（搜索词 / 含测试账号口径）——按已生效的搜索词判断，
    输入框里未提交的草稿不算筛选态 */
const isRecordsFiltered = computed(() => !!committedSearch.value)
/** 筛选提交（回车 / 查询 / 清空 / 换页大小）：提交当前搜索词并回第 1 页重查
    （页码停在越界页会显示空列表） */
function reloadRecordsFromFirstPage() {
  committedSearch.value = recordSearch.value.trim()
  recordPage.value = 1
  void reloadRecords()
}
/** 清除记录筛选（搜索 + 数据范围），回第 1 页重查 */
function clearRecordsFilters() {
  recordSearch.value = ''
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
    // 行级乐观更新：记录行即刻消失、分页读数自减
    records.value = records.value.filter((x) => x.id !== r.id)
    totalRecords.value = Math.max(0, totalRecords.value - 1)
    toast.success('成就已撤回')
    // 写后重取（#12）：徽标「成就 N」读 totalUnlocked（= defs.unlockCount 求和），
    // 本地删行不会改 defs——须重拉定义让 unlockCount 归位并重新上报宿主计数。
    void loadDefs()
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
  if (achTab.value === 'records') void reloadRecords()
})
</script>

<style scoped>
/* 固定列宽（2026-10-22 与教学组三表同判例）：成就/用户两列在 auto 布局下按当页最长
   名称分宽，翻页跳动；fixed 后按表头定死，余量按权重摊开。 */
.ach-c-title { width: 170px; }
.ach-c-user { width: 240px; }
.ach-c-type { width: 120px; }
.ach-c-xp { width: 90px; }
.ach-c-earned { width: 140px; }

/* 嵌入模式（运营中心宿主 flex 列内）：根挂 .mk-page--fill（模板）与反馈/公告/通知三页签同形——
   记录卡 .mk-card--fill 由此拿到确定高度，「卡片内滚动区接管纵向滚动、Pagination 吸底」契约生效。
   overflow-y 保留 auto：成就定义页签是普通卡（非 fill），内容超出时仍需根级可滚（对齐宿主 .oh-body 判例）。 */
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
/* 条件格内可点术语：链接色 + 虚线下划线，区别于正文灰字（走查 #32） */
.ac-card__term { color: var(--mk-blue); text-decoration: underline dotted; cursor: pointer; }
.ac-card__term:hover { color: var(--mk-accent-deep); }
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
   样式 2026-10-05 CM1 收敛到全局 .tabs/.tab（mk-primitives.css），本页不再私持拷贝。
   嵌入根已改挂 .mk-page--fill（flex 列 + gap 12px），页签与卡片的节奏由 gap 承担——
   原 block 布局下补的 margin-bottom 不再需要（否则 12+12 双份间距）。 */

/* 原型 .tbl td：nowrap（长内容由 mk-cell-main/mk-cell-text 全局 max-width 截断兜底）。
   2026-10-05 CM6：收敛为全局修饰类 .mk-table--nowrap（表元素已挂该 class）。 */


/* 解锁记录的搜索框宽度：原挂在 .ac-filter 上，2026-10-15 搜索移进 .mk-card__head-right 后
   该类成死类（搜索随右组走），宽度随之丢失。改挂右组内的输入框本身——共享层没给
   .mk-filter__input 定宽，不补则搜索框退成内容宽、与「查询」钮挤成一小撮。 */
.mk-card__head-right .mk-filter__input { min-width: 240px; }

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
