<template>
  <div :class="embedded ? 'mk-page--fill nt-embedded' : 'mk-page'">
    <div v-if="!embedded" class="mk-status" :class="statusTone">
      <span class="mk-status__dot"></span>
      <strong class="mk-status__title">站内通知</strong>
      <span class="mk-status__sep"></span>
      <span class="mk-status__meta">共 {{ total }}</span>
      <span class="mk-status__meta">未读 {{ unreadTotal }}</span>
    </div>

    <div class="mk-card mk-card--fill">
      <div class="mk-card__head">
        <div class="mk-filter">
          <!-- 类型筛选：形态统一走胶囊内嵌下拉（2026-10-26）。
               「仅未读」是布尔开关不是维度，保持开关形态（下拉里放 true/false 会更难读）。 -->
          <MkPillSelect
            v-model="kindFilter"
            label="类型"
            aria-label="按类型筛选"
            :options="kindOptions"
            :active="!!kindFilter"
            @update:model-value="reloadFromFirstPage"
          />
          <label class="nt-unread">
            <input v-model="unreadOnly" type="checkbox" @change="reloadFromFirstPage" />
            <span class="mk-field__label">仅未读</span>
          </label>
          <!-- 定向核对（2026-10-26）：学习状态页「发提醒」带 ?userId= 落到这里，
               筛选行显式写出当前只看谁，否则「按用户筛过」与「全部通知」长得一样。 -->
          <span v-if="userIdFilter" class="nt-user-filter">
            <span>{{ userFilterLabel }}</span>
            <button type="button" class="mk-link" @click="clearUserFilter">清除</button>
          </span>
          <!-- 已读率（2026-11-02 改）：原先是表格上方一条独立聚合带，同一个数说了三遍
               （占比条 / 百分数 / 已读-送达），其中分数与页头「共 / 未读」重复；0% 时占比条
               只剩一条空槽，读起来像坏了。现收成筛选行尾的一枚读数——条与分数都去掉，
               口径（只反映类型/未读筛选，关键词只过滤本页明细、不参与此比例）移进 title。 -->
          <span
            v-if="!failed && total > 0"
            class="nt-rate-meta"
            :title="`服务端在「类型 / 仅未读」筛选范围内的已读比例（关键词搜索只过滤本页明细，不参与此比例）`"
          >已读率 {{ readRate }}%</span>
        </div>
        <!-- 搜索槽位统一（2026-10-15 用户拍板全站列表页）：搜索移到右组。
             关键词：后端列表接口无关键词参数（adminApi list 无 search），按当前页客户端过滤；
             口径在 title 里写明，不把「当前页内过滤」读成全量搜索 -->
        <div class="mk-card__head-right">
          <MkFilterSearch
            v-model="keyword"
            placeholder="搜索标题 / 姓名 / 邮箱"
            title="在当前页内搜索"
          />
          <!-- 主操作归位（2026-10-26 用户「重新设计一下」）：原先独占页签条下的一整行、
               悬浮在卡片之外；现在与全站列表页同语法——卡头右组 = 搜索 → 主操作。 -->
          <button type="button" class="mk-btn mk-btn--sm mk-btn--primary" @click="openSend">发送通知</button>
        </div>
      </div>

      <MockSkeletonTable v-if="loading && !items.length" :cols="5" />
      <!-- 失败优先于旧数据：刷新失败时不能继续把上一页的行当成本次结果 -->
      <MkEmptyState
        v-else-if="failed"
        min
        title="通知加载失败"
        tone="error"
        description="无法加载通知列表，请稍后重试。"
        action-text="重试"
        @action="reload"
      />
      <div v-else-if="visibleItems.length" class="mk-table-scroll nt-list">
        <!-- 原型 .tbl：width:100% 自动布局（无 colgroup/无 fixed），单元格 nowrap，
             列按内容自然分宽；通知/用户双行单元格由 mk-cell-main 全局 max-width 截断兜底 -->
        <table class="mk-table mk-table--nowrap">
          <thead>
            <tr>
              <th scope="col">通知</th>
              <th scope="col">接收用户</th>
              <th scope="col">类型</th>
              <th
                scope="col"
                class="mk-th--sortable"
                :aria-sort="ntSortState('isRead')"
                @click="toggleNtSort('isRead')"
              ><button type="button" class="mk-th__btn" @click.stop="toggleNtSort('isRead')">状态<span class="mk-th__caret" aria-hidden="true"></span></button></th>
              <th
                scope="col"
                class="mk-th--sortable"
                :aria-sort="ntSortState('createdAt')"
                @click="toggleNtSort('createdAt')"
              ><button type="button" class="mk-th__btn" @click.stop="toggleNtSort('createdAt')">发送时间<span class="mk-th__caret" aria-hidden="true"></span></button></th>
              <th class="mk-th--right mk-c-act" scope="col">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="n in visibleItems" :key="n.id">
              <td>
                <div class="mk-cell-main">
                  <strong :title="n.title">{{ n.title }}</strong>
                  <span class="mk-cell-sub" :title="n.body || ''">{{ n.body || '—' }}</span>
                </div>
              </td>
              <td>
                <div class="mk-cell-main">
                  <strong v-if="n.user?.name" :title="n.user.name">{{ n.user.name }}</strong>
                  <span v-else class="mk-na">—</span>
                  <span class="mk-cell-sub" :title="n.user?.email || n.userId">{{ n.user?.email || n.userId }}</span>
                </div>
              </td>
              <td><span class="mk-badge" :class="kindBadge(n.kind)">{{ kindText(n.kind) }}</span></td>
              <td>
                <!-- 批C：未读=蓝点+粗体（行底色冗余信号降为一枚点），已读=弱化点；徽章位让给语义。
                     已读态即 .nt-read 基础样式，不再挂零定义的 nt-read--yes（审核 #165） -->
                <span class="nt-read" :class="{ 'nt-read--no': !n.isRead }">
                  <i class="nt-read__dot" aria-hidden="true"></i>{{ n.isRead ? '已读' : '未读' }}
                </span>
              </td>
              <td :title="fmtDate(n.createdAt)">{{ notifTimeAgo(n.createdAt) }}</td>
              <td>
                <!-- 2026-10-26 用户「重新设计一下」：原先每行一颗红色「删除」，20 行连成一片红。
                     破坏性动作收进 ⋯（与公告/执行日志同判例：主操作平铺，删除进菜单）。 -->
                <div class="mk-actions">
                  <div class="mk-menu">
                    <button
                      type="button"
                      class="mk-menu__btn"
                      aria-label="更多操作"
                      aria-haspopup="menu"
                      :aria-expanded="openMenu === n.id"
                      @click.stop="toggleMenu(n.id)"
                    >⋯</button>
                    <div
                      v-if="openMenu === n.id"
                      class="mk-menu__pop"
                      role="menu"
                      aria-label="更多操作"
                      :style="popStyle"
                      @click.stop
                    >
                      <!-- 2026-11-11（困惑测试 #10）：未读通知原先行菜单只有「删除」一项，
                           管理员没有任何置已读的操作杆（repo 能力早就存在，只是没接线）。 -->
                      <button
                        v-if="!n.isRead"
                        type="button"
                        class="mk-menu__item"
                        role="menuitem"
                        :disabled="n.busy"
                        @click="menuMarkRead(n)"
                      >标记已读</button>
                      <button
                        type="button"
                        class="mk-menu__item mk-menu__item--danger"
                        role="menuitem"
                        :disabled="n.busy"
                        @click="menuRemove(n)"
                      >删除</button>
                    </div>
                  </div>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <MkEmptyState
        v-else-if="isFiltered"
        min
        title="当前筛选无匹配"
        description="当前类型 / 仅未读 / 关键词条件下没有通知，可清除筛选查看全部。"
        action-text="清除筛选"
        @action="clearFilter"
      />
      <MkEmptyState
        v-else
        min
        title="还没有通知"
        description="还没有发送过站内通知。通知会进入学员的消息中心；可用右上角「发送通知」发给全体或指定用户。"
        :action-text="embedded ? '' : '发送第一条通知'"
        @action="openSend"
      />
      <!-- 分页器常驻（2026-11-02 评审）：单页时也给出「共 N 条 / 每页条数」，
           与反馈、公告两表一致；此前个位数数据下整条编号器消失，表格直接贴住卡片底边 -->
      <Pagination
        v-if="total > 0"
        v-model:page="page"
        v-model:pageSize="pageSize"
        :total="total"
        :loading="loading"
        :note="keyword.trim() ? '在当前页内搜索' : ''"
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
            <button type="button" class="mk-modal__close" aria-label="关闭" @click="closeSend">✕</button>
          </div>
          <div class="mk-modal__body">
            <!-- 2026-11-01 外部评审（五轮 P2）：公告弹窗有字数计数、通知弹窗没有，
                 同一后台两套表单规范；端侧气泡/浮窗有长度限制，这里同口径给上限与计数。
                 计数与标签分属两行（公告弹窗同款）：塞进标签里会与必填星号同行挤在一起。 -->
            <label class="mk-field" :class="{ 'mk-field--error': errors.title }">
              <span class="mk-field__label">标题 <em class="mk-field__req">*</em></span>
              <input v-model="form.title" class="mk-field__input" :maxlength="TITLE_MAX" placeholder="通知标题" />
              <span class="mk-field__hint">{{ form.title.length }} / {{ TITLE_MAX }} 字</span>
              <span v-if="errors.title" class="mk-field__err">{{ errors.title }}</span>
            </label>
            <label class="mk-field">
              <!-- 标题带 * 已是唯一必填标记，非必填不再追加「（可选）」。
                   正文确实可以不填（发送时按空值处理）：把留空后果写出来，
                   与公告弹窗「正文必填」的差异才讲得清（2026-11-02 评审） -->
              <span class="mk-field__label">正文</span>
              <textarea v-model="form.body" class="mk-field__textarea" :maxlength="BODY_MAX" rows="3" placeholder="通知正文" />
              <span class="mk-field__hint">不填则只发送标题 · {{ form.body.length }} / {{ BODY_MAX }} 字</span>
            </label>
            <label class="mk-field">
              <span class="mk-field__label">类型</span>
              <MkSelect
                v-model="form.kind"
                :options="NOTIFICATION_KIND_OPTIONS"
                aria-label="类型"
                block
              />
            </label>
            <div class="mk-field">
              <span class="mk-field__label">发送范围</span>
              <div class="nt-scope">
                <button
                  type="button"
                  class="mk-pill"
                  :class="{ 'mk-pill--active': form.scope === 'all' }"
                  :aria-pressed="form.scope === 'all'"
                  @click="form.scope = 'all'"
                >全体学员（不含管理员）</button>
                <button
                  type="button"
                  class="mk-pill"
                  :class="{ 'mk-pill--active': form.scope === 'user' }"
                  :aria-pressed="form.scope === 'user'"
                  @click="form.scope = 'user'"
                >定向用户</button>
              </div>
            </div>
            <div v-if="form.scope === 'user'" class="mk-field">
              <span class="mk-field__label">选择用户</span>
              <input v-model="targetSearch" class="mk-field__input" placeholder="搜索姓名 / 邮箱" @input="searchTarget" />
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
                  <span class="mk-cell-sub" :title="u.email">{{ u.email }}</span>
                </button>
              </div>
              <p v-else-if="targetSearched" class="nt-none">没有匹配用户</p>
            </div>
            <div v-if="sendError" class="mk-alert" role="alert">{{ sendError }}</div>
          </div>
          <div class="mk-modal__foot">
            <!-- 统一关闭路径：发送中禁关（与 Esc/遮罩/✕ 同守卫） -->
            <button type="button" class="mk-btn" @click="closeSend">取消</button>
            <button type="button" class="mk-btn mk-btn--primary" :disabled="!canSend || sending" @click="confirmSend">
              {{ sending ? '发送中…' : '发送' }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { computed, getCurrentInstance, nextTick, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useTableSort } from './useTableSort'
import { timeAgo, errMsg } from './live'
import { adminNotificationsApi, adminUsersApi } from '@/api/adminApi'
import { useEscape } from './useEscape'
import { useOverlay, useMaskClose } from './useOverlay'
import { useRowMenu } from './useRowMenu'
import { askConfirm, doneConfirm, failConfirm } from './useConfirm'
import { toast } from '@/utils/toast'
import MockSkeletonTable from './SkeletonTable.vue'
import MkEmptyState from '@/components/mk/MkEmptyState.vue'
import MkFilterSearch from '@/components/mk/MkFilterSearch.vue'
import MkPillSelect from '@/components/mk/MkPillSelect.vue'
import MkSelect from '@/components/mk/MkSelect.vue'
import Pagination from './Pagination.vue'

/** 嵌入模式：作为「通知与公告」页「站内通知」tab 渲染（仅去掉外层壳，状态条/发送弹窗保留）。
    count 事件：通知总数上报（宿主「通知 N」徽章；embedded 才消费） */
withDefaults(defineProps<{ embedded?: boolean }>(), { embedded: false })
const emit = defineEmits<{ (e: 'count', total: number): void }>()

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
/** 类型维度选项（胶囊内嵌下拉）：空值 = 全部类型 */
const kindOptions = [
  { value: '', label: '全部类型' },
  { value: 'system', label: '系统' },
  { value: 'announcement', label: '公告提醒' },
  { value: 'achievement', label: '成就' },
]
/** 定向核对（2026-10-26）：学习状态页「发提醒」→ ?userId= 落到本页，后端 list 支持 userId。
    无 router 上下文（单测/独立挂载）时降级为不筛。 */
const hasRouterCtx = !!getCurrentInstance()?.appContext.config.globalProperties.$router
const notifRoute = hasRouterCtx ? useRoute() : null
const notifRouter = hasRouterCtx ? useRouter() : null
const userIdFilter = ref(typeof notifRoute?.query.userId === 'string' ? String(notifRoute.query.userId) : '')
/** 定向用户的显示名：先查账号名（邮箱次之），查不到才回落 id——筛选行不摆裸 ID */
const userFilterLabel = ref(userIdFilter.value)
watch(userIdFilter, async (id) => {
  userFilterLabel.value = id
  if (!id) return
  try {
    const res = await adminUsersApi.getUser(id)
    const u = (res.data?.data ?? res.data ?? {}) as { name?: string; email?: string }
    userFilterLabel.value = String(u.name || u.email || id)
  } catch {
    userFilterLabel.value = id
  }
}, { immediate: true })
watch(() => notifRoute?.query.userId, (v) => {
  userIdFilter.value = typeof v === 'string' ? v : ''
  page.value = 1
  void reload()
})
function clearUserFilter() {
  if (notifRouter && notifRoute) {
    const q = { ...notifRoute.query }
    delete q.userId
    void notifRouter.replace({ query: q })
    return
  }
  userIdFilter.value = ''
  reloadFromFirstPage()
}
/** 关键词：后端列表接口无 search 参数，仅对当前页做客户端过滤（口径在输入框 title 与分页 note 标注） */
const keyword = ref('')
/** 当前页可见行：关键词非空时按标题/正文/用户姓名/邮箱过滤当前页 */
const visibleItems = computed(() => {
  const k = keyword.value.trim().toLowerCase()
  if (!k) return items.value
  return items.value.filter((n) =>
    `${n.title} ${n.body || ''} ${n.user?.name || ''} ${n.user?.email || ''}`.toLowerCase().includes(k)
  )
})

/* 服务端排序：白名单 createdAt / isRead，默认时间倒序；变更回第 1 页重查。 */
const {
  sortKey: ntSortKey,
  sortDir: ntSortDir,
  toggle: toggleNtSort,
  sortState: ntSortState,
} = useTableSort({
  keys: ['createdAt', 'isRead'],
  defaultKey: 'createdAt',
  defaultDir: 'desc',
  storageKey: 'wf_notifications_sort'
})
/** 筛选变化：回第 1 页重查（页码停在越界页会显示空列表） */
function reloadFromFirstPage() {
  page.value = 1
  void reload()
}
/** 清除筛选并重新加载（回第 1 页）；关键词与定向用户一并清空 */
function clearFilter() {
  kindFilter.value = ''
  unreadOnly.value = false
  keyword.value = ''
  if (userIdFilter.value) { clearUserFilter(); return }
  reloadFromFirstPage()
}
/* 每页条数变化：回第 1 页重查（此前只传 :page-size 不监听 @update:pageSize，
   下拉可选但列表恒按 20 条渲染，是死控件） */
watch(pageSize, () => { reloadFromFirstPage() })
const isFiltered = computed(() => !!kindFilter.value || unreadOnly.value || !!keyword.value.trim() || !!userIdFilter.value)

/** 已读率聚合（原型 1900-1904 表内「已读率」列）：同筛选域内 已读 = 送达 − 未读 */
const readCount = computed(() => Math.max(0, total.value - unreadTotal.value))
const readRate = computed(() => (total.value > 0 ? Math.round((readCount.value / total.value) * 100) : 0))

/* R2 状态语义表：未读是「用户侧状态」，运营无法替用户读 → 不是可行动告警，不得着 warn。
   页头基调只在加载失败时降级为 bad（原实现按 unreadTotal>0 给 warn，属误报）。 */
const statusTone = computed(() => (failed.value ? 'mk-status--bad' : 'mk-status--ok'))

/* kind 词表：后端 deadline-notify.service 新增的 'deadline' 此前未映射，列表直出英文
   （2026-10-23 走查截图为证）→ 补「截止提醒」；未知 kind 仍回落原文。 */
const kindText = (k: string) => ({ system: '系统', announcement: '公告', achievement: '成就', deadline: '截止提醒' }[k] || k)
const kindBadge = (k: string) =>
  k === 'announcement' || k === 'deadline' ? 'mk-badge--warn' : k === 'achievement' ? 'mk-badge--ok' : 'mk-badge--info'

function fmtDate(iso?: string): string {
  if (!iso) return '—'
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** F5-5：时间列口径统一为相对时间。共享 live.timeAgo 对 ≥30 天回退 toLocaleDateString，
 *  同列出现「1 小时前 / 昨天 / 2026/8/30」混排；此处把 ≥30 天续接为相对语义
 *  （N 个月前 / N 年前），绝对时间仍走 title 悬停（fmtDate）。仅本页包装、不动共享
 *  timeAgo——它被 20+ 页面消费，且 live-utils.test.ts 已把「>30 天 → 本地化日期」钉为契约。 */
function notifTimeAgo(iso?: string | null): string {
  const raw = timeAgo(iso)
  const t = iso ? new Date(iso).getTime() : NaN
  // 空值/非法 → 沿用「从未」；未来时间 diff<0 → d<30 走共享口径「刚刚」，容错不变
  if (!t || Number.isNaN(t)) return raw
  const d = Math.floor((Date.now() - t) / 86400000)
  if (d < 30) return raw // 刚刚/分钟/小时/天 分级与共享口径一致
  const months = Math.floor(d / 30)
  if (months < 12) return `${months} 个月前`
  return `${Math.floor(months / 12)} 年前`
}

async function reload() {
  loading.value = true
  failed.value = false
  try {
    const res = await adminNotificationsApi.list({
      page: page.value,
      limit: pageSize.value,
      userId: userIdFilter.value || undefined,
      kind: kindFilter.value || undefined,
      unreadOnly: unreadOnly.value || undefined,
      sort: (ntSortKey.value || undefined) as 'createdAt' | 'isRead',
      order: ntSortDir.value,
    })
    const body = res.data?.data ?? {}
    items.value = (body.items || []).map((n: NotifRow) => ({ ...n, busy: false }))
    total.value = body.pagination?.total ?? items.value.length
    unreadTotal.value = body.unreadTotal ?? 0
    // 角标只报未读（待办量），总数在卡头/分页器自报
    emit('count', unreadTotal.value)
  } catch (e) {
    failed.value = true
  } finally {
    loading.value = false
  }
}
/* 宿主刷新联动（通知与公告合并宿主「刷新」按钮 → reload） */
defineExpose({ reload, openSend })

/* 排序变更：回第 1 页重查（与筛选同义） */
watch([ntSortKey, ntSortDir], () => {
  page.value = 1
  void reload()
})

const { openMenu, toggleMenu, closeMenu, popStyle } = useRowMenu()

/** ⋯ 菜单里的「标记已读」：非破坏动作，不走确认，直接提交并本地落状态 */
function menuMarkRead(n: NotifRow) {
  closeMenu()
  void markRead(n)
}

async function markRead(n: NotifRow) {
  if (n.busy) return
  n.busy = true
  try {
    await adminNotificationsApi.markRead(n.id)
    n.isRead = true
    unreadTotal.value = Math.max(0, unreadTotal.value - 1)
    toast.success('已标记为已读')
    // 写后重取：徽标计数由 reload() 内的 emit('count') 上报
    void reload()
  } catch (e) {
    toast.error(`标记已读失败：${errMsg(e)}`)
  } finally {
    n.busy = false
  }
}

/** ⋯ 菜单里的删除：先收菜单再走确认（菜单盖在确认弹窗上会读成「点了个寂寞」） */
function menuRemove(n: NotifRow) {
  closeMenu()
  void remove(n)
}

async function remove(n: NotifRow) {
  const ok = await askConfirm({
    title: '删除通知',
    message: `确认删除「${n.title}」？`,
    confirmText: '删除',
    busy: true,
  })
  if (!ok) return
  n.busy = true
  try {
    await adminNotificationsApi.remove(n.id)
    // 行级乐观更新：行即刻消失、卡头「共 N / 未读 N」自减
    items.value = items.value.filter((x) => x.id !== n.id)
    total.value = Math.max(0, total.value - 1)
    if (!n.isRead) unreadTotal.value = Math.max(0, unreadTotal.value - 1)
    toast.success('通知已删除')
    // 写后重取（#12）：徽标「站内通知 N」由 reload() 内的 emit('count') 上报，
    // 本地删行不发上报——重跑列表加载器让计数归位并重新上报宿主。
    void reload()
    doneConfirm()
  } catch (e) {
    toast.error(`删除失败：${errMsg(e)}`)
    failConfirm()
  } finally {
    n.busy = false
  }
}

/* 发送 */
const sendOpen = ref(false)
/** 弹窗统一关闭路径：发送中禁止 Esc/遮罩/✕/取消 误关；有未保存内容先确认。
    发送成功后由 confirmSend() 直接关窗，不经过这里，因此成功时不会反问。 */
function closeSend() {
  if (sending.value) return
  if (!sendDirty.value) { sendOpen.value = false; return }
  void (async () => {
    const ok = await askConfirm({
      title: '放弃未发送的通知',
      message: '标题 / 正文 / 类型 / 发送范围的改动尚未发送。',
      confirmText: '放弃内容',
      danger: true,
    })
    if (ok) sendOpen.value = false
  })()
}
useEscape(() => sendOpen.value, closeSend)
const panelRef = ref<HTMLElement | null>(null)
const maskRef = ref<HTMLElement | null>(null)
useOverlay(computed(() => sendOpen.value), panelRef)
useMaskClose(maskRef, closeSend)

/** 通知长度上限（与端侧气泡/浮窗的可显示长度对齐；公告弹窗同款计数形态） */
const TITLE_MAX = 50
const BODY_MAX = 500
const form = ref({ title: '', body: '', kind: 'system', scope: 'all' as 'all' | 'user' })
/** 打开时的表单快照（含定向用户）：关闭前据此判断有没有未发送内容 */
const initialSend = ref({ ...form.value, targetId: '' })
/** 发送弹窗的类型下拉（文案与旧原生 select 逐字一致） */
const NOTIFICATION_KIND_OPTIONS = [
  { value: 'system', label: '系统通知' },
  { value: 'announcement', label: '公告提醒（站内信）' },
  { value: 'achievement', label: '成就' }
]
const errors = ref<{ title?: string }>({})
const sending = ref(false)
const sendError = ref('')
const targetSearch = ref('')
const targetResults = ref<Array<{ id: string; name: string; email: string }>>([])
const targetSearched = ref(false)
const targetId = ref('')
const sendDirty = computed(() =>
  JSON.stringify({ ...form.value, targetId: targetId.value }) !== JSON.stringify(initialSend.value)
)

/** 前置未满足即置灰（与成就发放弹窗同判例）：标题为空、或定向发送还没选用户时，
    按钮就该是禁用的，不必等点下去才回一句「请输入标题」。提交时的校验保留作兜底。 */
const canSend = computed(() => !!form.value.title.trim() && (form.value.scope !== 'user' || !!targetId.value))

function openSend() {
  form.value = { title: '', body: '', kind: 'system', scope: 'all' }
  errors.value = {}
  sendError.value = ''
  targetSearch.value = ''
  targetResults.value = []
  targetSearched.value = false
  targetId.value = ''
  initialSend.value = { ...form.value, targetId: '' }
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
  if (sending.value) return
  errors.value = {}
  sendError.value = ''
  if (!form.value.title.trim()) {
    errors.value.title = '请输入标题'
    void nextTick(() => panelRef.value?.querySelector<HTMLElement>('.mk-field--error input')?.focus())
    return
  }
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
/* 嵌入模式（宿主通知与公告页 flex 列内）：占满剩余高度，表格区内滚 */
.nt-embedded { flex: 1; min-height: 0; overflow: hidden; }
/* 筛选行本体走共享 .mk-filter（2026-10-26：本页原私有的 .nt-filter 只差 gap 10 vs 8，
   两份 flex 声明没必要并存）；这里只保留本页特有的「定向用户」片段与已读率行。 */
/* 「仅未读」开关：布尔开关不是维度筛选，与胶囊并列但不套下拉。
   原实现用 .mk-field--switch + 内联 style="margin:0" 压掉字段标签的上下距——内联样式换成这里一行。 */
.nt-unread { display: inline-flex; align-items: center; gap: 6px; cursor: pointer; }
/* 定向用户筛选：筛选行里显式写出当前只看哪个账号，可一键清除 */
.nt-user-filter {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: var(--mk-fs-micro);
  color: var(--mk-muted);
}
.nt-list { flex: 1; min-height: 0; overflow-y: auto; }
/* 已读率读数（2026-11-02）：从表格上方的独立聚合带收成筛选行尾的一枚小灰字。
   与页头状态条的 .mk-status__meta 同级，但不借用那个类（它按父级 .mk-status 排版）。 */
.nt-rate-meta { font-size: var(--mk-fs-micro); color: var(--mk-muted); font-variant-numeric: tabular-nums; }
/* 未读信号（2026-10-26 重新设计）：整行蓝底撤除。
   原实现给每条未读行铺 --mk-blue-bg，而这批通知 90% 未读 → 整张表读成一块浅蓝、
   像全选态；规范里蓝只给交互与选中。未读现在只由「状态」列的蓝点 + 蓝字表达，
   行样式不再随已读态变化（批C 注释本就写着「行底色冗余信号降为一枚点」，此处补齐实现）。 */
.nt-read { display: inline-flex; align-items: center; gap: 6px; font-size: var(--mk-fs-micro); color: var(--mk-faint); white-space: nowrap; }
.nt-read__dot { width: 6px; height: 6px; border-radius: 50%; background: var(--mk-surface-3); flex: none; }
.nt-read--no { color: var(--mk-blue-text); font-weight: 700; }
.nt-read--no .nt-read__dot { background: var(--mk-blue); }

.nt-scope { display: flex; gap: 8px; }
.nt-candidates { display: grid; gap: 6px; max-height: 200px; overflow-y: auto; margin-top: 8px; }
.nt-candidate {
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
.nt-candidate:hover { border-color: color-mix(in srgb, var(--mk-blue) 40%, transparent); }
.nt-candidate--on { border-color: var(--mk-blue); box-shadow: 0 0 0 2px color-mix(in srgb, var(--mk-blue) 12%, transparent); }
.nt-candidate strong { font-size: var(--mk-fs-micro); }
.nt-none { color: var(--mk-faint); font-size: var(--mk-fs-micro); text-align: center; padding: 10px 0; }

/* 4K：弹窗内候选列表跟随全站节奏 */
@media (min-width: 2000px) {
  .nt-candidate strong { font-size: var(--mk-fs-body); }
  .nt-candidate { padding: 10px 12px; }
  .nt-none { font-size: var(--mk-fs-body); }
}
@media (min-width: 2800px) {
  .nt-candidate strong { font-size: var(--mk-fs-body); }
  .nt-candidate { padding: 12px 14px; }
  .nt-none { font-size: var(--mk-fs-body); }
}
@media (min-width: 3600px) {
  .nt-candidate strong { font-size: var(--mk-fs-emphasis); }
  .nt-candidate { padding: 14px 16px; }
  .nt-none { font-size: var(--mk-fs-emphasis); }
}

/* ================= 暗色模式（D1 补完）：站内通知 =================
   未读行底色已撤（见上），暗色档也不再需要补丁——未读只由状态列的蓝点表达 */
</style>
