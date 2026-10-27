<template>
  <div :class="embedded ? 'mk-page--fill u-embedded' : 'mk-page mk-page--fill'">
    <div v-if="!embedded" class="mk-status" :class="users.length ? 'mk-status--ok' : 'mk-status--muted'">
      <span class="mk-status__dot"></span>
      <strong class="mk-status__title">用户</strong>
      <span class="mk-status__sep"></span>
      <!-- 2026-10-10 走查修：可见文字此前直接打 users.length（已载行数）当「共 N 人」，
           后端钳制截断时（曾 200，后修至 1000）真总数只在 title 里，与学习状态页
           「学习者账号 N」可见口径打架（269 vs 200）。现按 LearnerCenter 同款句式：
           截断时显「共 TOTAL 人 · 已载 M」，未截断时维持单数。 -->
      <span class="mk-status__meta" :title="isLive ? (liveUsersTotal > users.length ? '共 ' + liveUsersTotal + ' 人，当前显示前 ' + users.length + ' 人' : '共 ' + liveUsersTotal + ' 人') : undefined">
        共 {{ isLive && liveUsersTotal > users.length ? liveUsersTotal + ' 人 · 当前显示 ' + users.length : users.length }} 人
      </span>
      <span v-if="isLive && pill !== 'deleted'" class="mk-status__meta" :title="`管理员 ${adminCount} · 近 7 天活跃 ${activeToday}${registrationEnabled !== null ? ' · 注册' + (registrationEnabled ? '开放' : '关闭') : ''}`">
        近 7 天活跃 {{ activeToday }}
      </span>
      <span class="mk-status__actions">
        <button type="button" class="mk-status__action mk-status__action--primary" @click="openCreate">新建用户</button>
      </span>
    </div>


    <div class="mk-card mk-card--fill">
      <div class="mk-card__head">
        <div class="mk-filter">
          <!-- 列表卡头统一语法（2026-10-05 教学组六页同一槽位序）：
               左 = 快筛 chips；右 = 搜索 → 页级动作 → 列 → 筛选(仅有次级筛选时) → 计数 meta(仅说独有事实时)。
               计数判例（2026-10-11 用户拍板全站统一）：筛选 pill 一律显命中数，唯「全部」不显
               （总数单源=分页器「共 N 条」）——取代旧「KPI 孪生 pill 不显数」判例，忽隐忽现的计数消失。
               本页无次级筛选（口径开关在页头），「筛选」弹层随之退役——搜索回到行内；
               「N / N 人」meta 维持不渲染（与分页器复读）。
               2026-10-17 用户走查「清除筛选没啥意义」：本页先不出；2026-10-27 用户
               「清除筛选我也不太想要」后全站退役——各维度自己复位（下拉选回「全部」、
               chip 再点取消、搜索框 ✕），空态里的「清除筛选 / 显示全部」CTA 保留。 -->
          <MkPillSelect
            v-model="pill"
            label="视图"
            aria-label="按用户视图筛选"
            :options="ulViewOptions"
            :active="pill !== 'all'"
          />
        </div>
        <div class="mk-card__head-right">
          <!-- 搜索槽位统一（2026-10-15 用户拍板全站列表页）：搜索移到右组首位 -->
          <MkFilterSearch v-model="keyword" placeholder="搜索昵称 / 邮箱 / ID" />
          <!-- 勾选列默认隐藏（2026-10-17 用户走查「这个多选，默认不出来吧」）：批量删除/导出属
               低频动作，常驻一整列勾选框会顶在身份列前面，也容易被读成每行都要勾。
               入口不再只藏在「列」菜单里：卡头明面给一枚「批量操作」，点开即显示勾选列并进入选择态，
               再点一次收起（并清空已选）。
               2026-10-19：注册时间本就存在，只是与勾选列一起被默认隐藏了——现在只默认隐藏勾选列。
               存储键 v5：v4 存下的隐藏集含 created，不升版新默认对已访问过的浏览器不生效。 -->
          <button
            v-if="isLive && !isNarrow"
            type="button"
            class="mk-link"
            :class="{ 'mk-link--active': checkVisible }"
            :aria-pressed="checkVisible"
            @click="toggleBatchMode"
          >批量操作</button>
          <MkCols
            :col-defs="ulColDefs"
            storage-key="wf_users_hidden_cols_v5"
            :default-hidden="['check']"
            v-model:hidden="hiddenCols"
          />
        </div>
      </div>

      <MockSkeletonTable v-if="liveLoading && !users.length || (deletedLoading && !users.length)" :cols="7" />
      <MkEmptyState
        v-else-if="loadFailed"
        min
        tone="error"
        icon="◌"
        title="数据加载失败"
        action-text="重试"
        @action="retryLoad"
      />
      <div v-else-if="filtered.length" class="mk-table-scroll">
        <!-- 固定列宽（2026-10-22 与教学组三表同判例）：自动布局下用户/邮箱两列按当页最长内容
             分宽，翻页整表跳动；改 fixed + 逐列表头宽度，余量按权重摊开。
             单元格 nowrap 不变，长邮箱/长昵称仍由 max-width 截断兜底 -->
        <table class="mk-table mk-table--click mk-table--nowrap mk-table--fixed ul-table">
          <thead>
            <tr>
              <th v-if="isLive && showCol('check')" scope="col" class="u-c-check">
                <input type="checkbox" aria-label="全选当前页" :indeterminate="headerIndeterminate" :checked="allChecked" @change="toggleAll" />
              </th>
              <th
                scope="col"
                class="mk-th--sortable u-c-user"
                :aria-sort="userSortState('user')"
                @click="toggleUserSort('user')"
              ><button type="button" class="mk-th__btn" @click.stop="toggleUserSort('user')">用户<span class="mk-th__caret" aria-hidden="true"></span></button></th>
              <th v-if="showCol('email')" scope="col" class="u-c-email">邮箱</th>
              <th v-if="showCol('role')" scope="col" class="u-c-role">角色</th>
              <th
                v-if="showCol('paths')"
                scope="col"
                class="mk-th--right mk-th--sortable u-c-paths"
                :aria-sort="userSortState('paths')"
                @click="toggleUserSort('paths')"
              ><button type="button" class="mk-th__btn" @click.stop="toggleUserSort('paths')">路径 / 课堂（条 / 节）<span class="mk-th__caret" aria-hidden="true"></span></button></th>
              <th
                v-if="showCol('created')"
                scope="col"
                class="mk-th--sortable u-c-created"
                :aria-sort="userSortState('created')"
                @click="toggleUserSort('created')"
              ><button type="button" class="mk-th__btn" @click.stop="toggleUserSort('created')">注册时间<span class="mk-th__caret" aria-hidden="true"></span></button></th>
              <th
                v-if="showCol('lastlogin')"
                scope="col"
                class="mk-th--sortable u-c-lastlogin"
                :aria-sort="userSortState('lastlogin')"
                @click="toggleUserSort('lastlogin')"
              ><button type="button" class="mk-th__btn" @click.stop="toggleUserSort('lastlogin')">最后登录<span class="mk-th__caret" aria-hidden="true"></span></button></th>
              <th scope="col" class="mk-th--right u-c-act">操作</th>
            </tr>
          </thead>
        <tbody>
          <!-- 行点击进用户详情；键盘等价：tabindex + Enter 触发（对齐 gc-row/oc-row 判例），
               行内控件已 stopPropagation，聚焦自身即可回车，不产生双份焦点停靠 -->
          <!-- 口径透传：测试视角下点虚拟/测试账号，详情接口需按全量口径查询，否则 404（与行点击/详情钮同参） -->
          <tr v-for="u in paged" :key="u.id" class="ul-row" :class="{ 'ul-row--deleted': u.deleted }" tabindex="0" @click="openSubPage('user', u.id)" @keydown.enter="($event.target === $event.currentTarget) && openSubPage('user', u.id)">
            <td v-if="isLive && showCol('check')" @click.stop><input v-model="selected" type="checkbox" :value="u.id" :disabled="u.deleted || isNonRealAccount(u)" :aria-label="`选择 ${userName(u)}`" @click.stop /></td>
            <td>
              <div class="ul-user">
                <MkCellAvatar :name="userName(u)" :tone="avaTone(u)" />
                <div class="mk-cell-main">
                  <strong :title="userName(u)">{{ userName(u) }}</strong>
                  <!-- 原型 celluser meta 模式：等级（XP 细节进悬停）。
                       2026-10-23 走查：路径条数不再在副行复述——同一读数已在「路径 / 课堂」列
                       给全且可排序，副行只说等级。
                       等级词汇单点（learner-profile.ts）：统一「L2 · 进阶」并存格式 -->
                  <span
                    class="mk-cell-sub"
                    :title="u.xp === 0 ? '尚无经验值' : `${u.xp} XP · 距 L${levelFromXp(u.xp) + 1} 还需 ${xpToNext(u.xp)}`"
                  >{{ levelBadgeZh(u.xp, u.currentLevel) }}</span>
                </div>
                <div class="ul-tags">
                  <span v-if="u.deleted" class="mk-badge mk-badge--sm mk-badge--deleted" :title="u.deletedAt ? `删除于 ${u.deletedAt}` : undefined">已删除</span>
                  <!-- 2026-10-21 用户拍板「测试只是备注」：不做视角，也不用筛选，行内一枚备注即可 -->
                  <span
                    v-else-if="isNonRealAccount(u) && !isVirtualAccount(u)"
                    class="mk-badge mk-badge--sm mk-badge--test"
                  >测试</span>
                  <!-- 自己那一行（2026-10-19 用户走查「这不就重复了吗」）：原文案「当前管理员」
                       与身份列的「管理员」徽章读作同一个角色标签，实际标的是「这一行是你正在用的
                       账号」（该行 ⋯ 菜单刻意不给「删除」） -->
                  <span
                    v-else-if="isSelf(u)"
                    class="mk-badge mk-badge--sm mk-badge--self"
                  >当前账号</span>
                </div>
              </div>
            </td>
            <td v-if="showCol('email')">
              <span class="ul-email" :title="u.email">{{ u.email }}</span>
            </td>
            <td v-if="showCol('role')"><span class="mk-badge" :class="u.admin ? 'mk-badge--info' : 'mk-badge--muted'">{{ u.admin ? '管理员' : '用户' }}</span></td>
            <td v-if="showCol('paths')" class="mk-num">
              <!-- 原型列语言：数字列就是 mono 文本，不加自造可视化（双段条退役）。
                   P2：0 值统一 mk-na 弱化（此前只有会话 0 弱化，路径 0 却实心黑，双标） -->
              <span class="ul-ps"><b :class="{ 'mk-na': !u.paths }">{{ u.paths }}</b><i>/</i><b :class="{ 'mk-na': !u.sessions }">{{ u.sessions }}</b></span>
            </td>
            <td v-if="showCol('created')"><span :class="u.createdAt === '从未' ? 'mk-na' : ''">{{ u.createdAt }}</span></td>
            <td v-if="showCol('lastlogin')"><span :class="u.lastLogin === '从未' ? 'mk-na' : ''">{{ u.lastLogin }}</span></td>
            <td>
              <div class="mk-actions">
                <!-- 行点击进详情，操作列留给这页唯一的处置动作：编辑（改昵称 / 邮箱 / 角色、重置密码）。
                     已删除行不给编辑（账号不可登录，先恢复再改）。 -->
                <button v-if="!u.deleted" type="button" class="mk-btn mk-btn--sm" @click.stop="openEdit(u)">编辑</button>
                <div v-if="isLive && (u.deleted || !isSelf(u))" class="mk-menu">
                  <button type="button" class="mk-menu__btn" aria-label="更多操作" aria-haspopup="menu" :aria-expanded="openMenu === u.id" @click.stop="toggleMenu(u.id)">⋯</button>
                  <div v-if="openMenu === u.id" class="mk-menu__pop" :style="popStyle" @click.stop>
                    <button v-if="u.deleted" type="button" class="mk-menu__item" :disabled="u.busy" @click="menuRestore(u)">恢复</button>
                    <button v-else type="button" class="mk-menu__item mk-menu__item--danger" :disabled="u.busy" @click="menuDelete(u)">删除</button>
                  </div>
                </div>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
      </div>

      <!-- 整页空态（筛选无匹配 / 无账号 / 无已删除账号）：min 吃掉卡内剩余高度并居中 -->
      <MkEmptyState
        v-else
        min
        icon="◌"
        :title="isDeletedView ? '暂无已删除账号' : isFiltered ? '当前筛选无用户' : '暂无账号'"
        :action-text="isDeletedView || isFiltered ? '显示全部用户' : '新建用户'"
        @action="isDeletedView || isFiltered ? clearFilters() : openCreate()"
      />
      <!-- 客户端分页（P2：37 行长表单页直排 → mk-pagination 统一分页器，15-30-50-100 条/页）。
           已删除视图走后端分页（getDeletedUsers 支持 page/limit），total 用后端真总数。 -->
      <Pagination
        v-if="isDeletedView ? deletedTotal > 0 : filtered.length"
        v-model:page="page"
        v-model:pageSize="pageSize"
        :total="isDeletedView ? deletedTotal : filtered.length"
        :showTotal="true"
        unit="个账号"
      />
    </div>

    <!-- 批量操作条（全局 mk-batchbar） -->
    <div v-if="isLive && selected.length" class="mk-batchbar">
      <!-- 审核 #13（2026-10-06）：手动跨页勾选时批量条如实标注未显示页行数，
           否则「已选 304 人」在只看得见 15 行的屏上会被读成「全在眼前」
           （2026-10-11 起表头全选只管当前页，跨页集合只能来自手动逐个勾） -->
      <span>已选 {{ selected.length }} 人<template v-if="selectedOffPage">（含未显示页 {{ selectedOffPage }} 行）</template></span>
      <button type="button" class="mk-link" @click="selected = []">取消选择</button>
      <button type="button" class="mk-link" :disabled="batchBusy" @click="exportSelected">导出 CSV</button>
      <button type="button" class="mk-batchbar__danger" :disabled="batchBusy" @click="batchDelete">
        {{ batchBusy ? '删除中…' : '批量删除' }}
      </button>
    </div>

    <UserFormDialog v-model:open="dialogOpen" :user="dialogUser" @saved="onSaved" />
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { openSubPage, intent, isLive } from './store'
import { liveUsers, liveDeleteUser, liveUsersTotal, refreshLiveUsers, timeAgo, errMsg, registrationEnabled, liveLoading, liveFailures, loadLiveData } from './live'
import { useRowMenu } from './useRowMenu'
import { askConfirm, doneConfirm, failConfirm } from './useConfirm'
import MockSkeletonTable from './SkeletonTable.vue'
import Pagination from './Pagination.vue'
import MkFilterSearch from '@/components/mk/MkFilterSearch.vue'
import MkPillSelect from '@/components/mk/MkPillSelect.vue'
import { useTableSort } from './useTableSort'
import MkCols from '@/components/mk/MkCols.vue'
import MkCellAvatar from '@/components/mk/MkCellAvatar.vue'
import { displayNameOf } from '@/components/mk/avatarName'
import MkEmptyState from '@/components/mk/MkEmptyState.vue'
import UserFormDialog, { type EditableUser } from './UserFormDialog.vue'
import { adminUsersApi, getDeletedUsers, restoreUser } from '@/api/adminApi'
import { useIsNarrow } from './useIsNarrow'
import { toast } from '@/utils/toast'
import { isRealAccountUser, isVirtualLearnerAccount, levelFromXp, levelBadgeZh, useListQueryState } from './learner-profile'

/* ---- 行级设计派生（2026-09-26）：身份 chip 色 / 升级进度 / 登录新鲜度 ---- */
type UlUserLite = { deleted?: boolean; isVirtualLearner?: boolean; isTestAccount?: boolean; name?: string; email?: string; id?: string; xp?: number }
function avaTone(u: UlUserLite): 'default' | 'virtual' | 'test' | 'muted' {
  if (u.deleted) return 'muted'
  // 身份判据单点（learner-profile.ts）：payload 标记 ∪ 命名约定，与 KPI / 构成带同口径
  if (isRealAccountUser(u)) return 'default'
  return isVirtualLearnerAccount(u) ? 'virtual' : 'test'
}
/** 昵称与头像共用同一清洗/降级结果（avatarName.ts）：乱码字符剔除后空 → 邮箱前缀 → 「用」 */
function userName(u: UlUserLite): string {
  return displayNameOf(u.name, u.email)
}
/** 升级进度：等级公式 floor(sqrt(xp/100))+1 → 当前级下限 100·(n-1)²，下一级门槛 100·n² */
function xpProgress(xp: number): { pct: number; toNext: number } {
  const n = levelFromXp(xp)
  const floor = 100 * (n - 1) * (n - 1)
  const ceil = 100 * n * n
  const pct = Math.min(Math.max(Math.round(((xp - floor) / Math.max(ceil - floor, 1)) * 100), 0), 100)
  return { pct, toNext: Math.max(ceil - xp, 0) }
}
function xpToNext(xp: number): number {
  return xpProgress(xp).toNext
}

/** 嵌入模式：作为「用户账号」页渲染（仅去掉外层壳，状态条/列表/弹窗保留）。
    2026-10-04：学习状态 tab 拆出独立页 /admin/learner-state，本组件只剩账号管理单视图 */
withDefaults(defineProps<{ embedded?: boolean }>(), { embedded: false })

/* 当前登录管理员（保护自己不被降级/删除）。
   仅按 id 匹配：昵称/邮箱可能与他人重合（真有昵称叫 admin 的用户会被误判为自己，
   从而无法降级/删除）；读不到 storage 时 id 置空使匹配恒为 false——宁可不保护也不误伤真实用户 */
const currentAdmin = computed(() => {
  const raw = localStorage.getItem('admin_user') || sessionStorage.getItem('admin_user')
  if (!raw) return { id: '' }
  try {
    const d = JSON.parse(raw)
    return { id: String(d.id || '') }
  } catch {
    return { id: '' }
  }
})
const isSelf = (u: UserRow) => !!currentAdmin.value.id && u.id === currentAdmin.value.id
/** 虚拟学习者 / 测试账号判定与真实域口径全部走 learner-profile.ts 单点：
    此前这里直接用命名约定正则，漏掉卡库/预置库造出的虚拟学习者（vl-*@cards.local、
    builtin_*@preset.local —— payload 标了 isVirtualLearner=true）——含测试档下这类行既进
    「普通用户」筛选、又能勾选进批量删除/导出（F1-1）。标记优先、正则兜底的口径见该文件。 */
const isVirtualAccount = isVirtualLearnerAccount
/** 非真实账号（虚拟学习者 ∪ 测试/审计）：不参与管理员提升与批量删除（无意义且有风险） */
const isNonRealAccount = (u: UserRow) => !isRealAccountUser(u)

interface UserRow {
  id: string
  name: string
  email: string
  admin: boolean
  online: boolean
  /** 测试/审计备注标记（后端按 isTestAccountUser 判定，行内展示「测试」） */
  isVirtualLearner?: boolean
  isTestAccount?: boolean
  createdAt: string
  lastLogin: string
  /** 原始时间戳（ISO），仅供客户端排序；显示文案见 createdAt / lastLogin */
  createdAtRaw?: string
  lastLoginRaw?: string | null
  paths: number
  sessions: number
  /** 学习态摘要：XP 与等级（等级由 xp 按权威公式推导，L1-L5） */
  xp: number
  currentLevel: string
  /** Phase 2：已软删账号（灰色标记 + 行菜单只保留「恢复」） */
  deleted?: boolean
  deletedAt?: string
  busy?: boolean
}

/** Phase 2：已删除筛选 pill 的独立数据源（后端 status=deleted，与活跃列表隔离）。
    走服务端分页：getDeletedUsers 支持 page / limit / search，超出一页的账号也能翻到。 */
const deletedUsers = ref<UserRow[]>([])
const deletedLoading = ref(false)
const deletedTotal = ref(0)
const isDeletedView = computed(() => pill.value === 'deleted')

function mapDeletedRow(u: Record<string, unknown>): UserRow {
  return {
    id: String(u.id),
    /* 入库即清洗（2026-10-24）：表格、排序、CSV、删除/恢复确认、编辑表单共用同一份
       可渲染昵称，避免头像已降级而弹窗仍显示乱码。 */
    name: displayNameOf(u.name, u.email),
    email: String(u.email || ''),
    admin: !!u.isAdmin,
    online: false,
    createdAt: timeAgo(String(u.createdAt || '')),
    lastLogin: timeAgo(u.lastLoginAt as string | null),
    createdAtRaw: u.createdAt ? String(u.createdAt) : undefined,
    lastLoginRaw: (u.lastLoginAt as string | null) || null,
    paths: Number((u._count as Record<string, number>)?.learning_paths || 0),
    sessions: Number((u._count as Record<string, number>)?.teaching_sessions || 0),
    xp: Number(u.xp || 0),
    currentLevel: String(u.currentLevel || ''),
    deleted: true,
    deletedAt: (u.deletedAt as string) || undefined
  }
}

async function loadDeletedUsers() {
  deletedLoading.value = true
  try {
    const res = await getDeletedUsers({
      page: page.value,
      limit: pageSize.value,
      search: keyword.value.trim() || undefined
    })
    const body = res.data?.data ?? res.data ?? {}
    const items = body.users || body.items || []
    deletedUsers.value = items.map(mapDeletedRow)
    deletedTotal.value = Number(body.pagination?.total ?? items.length)
  } catch (e) {
    // 失败不静默：置空列表会让「已删除」pill 看起来像"没有已删用户"，误导管理员
    deletedUsers.value = []
    deletedTotal.value = 0
    toast.error(`已删除用户加载失败：${errMsg(e)}`)
  } finally {
    deletedLoading.value = false
  }
}

/** 近 7 天活跃（2026-10-11 与宿主 KPI「近 7 天活跃」同窗同词；原 30 分钟窗口恒 0 无区分度） */
const recentLogin = (t: string | null) => !!t && Date.now() - new Date(t).getTime() < 7 * 86400000
/** 近 7 日新增：createdAt 在 7 天内 */
const isNewIn7d = (u: { createdAt: string }) =>
  !!u.createdAt && Date.now() - new Date(u.createdAt).getTime() < 7 * 86400000

const pill = ref('all')
const keyword = ref('')
/** 客户端分页（P2：替代「加载更多」——统一 mk-pagination 页码器）：
    live 列表全量在客户端，筛选后按页切片；已删除视图把 page/pageSize 下发给后端。 */
const page = ref(1)
const pageSize = ref(15)

const users = computed<UserRow[]>(() => {
  if (isDeletedView.value) return deletedUsers.value
  return liveUsers.value.map((u) => ({
    id: u.id,
    name: displayNameOf(u.name, u.email),
    email: u.email,
    admin: u.isAdmin,
    online: recentLogin(u.lastLoginAt),
    isVirtualLearner: u.isVirtualLearner,
    isTestAccount: u.isTestAccount,
    createdAt: timeAgo(u.createdAt),
    lastLogin: timeAgo(u.lastLoginAt),
    createdAtRaw: u.createdAt || undefined,
    lastLoginRaw: u.lastLoginAt || null,
    paths: u.paths,
    sessions: u.sessions,
    xp: u.xp,
    currentLevel: u.currentLevel
  }))
})

/* 视角开关已退役（2026-10-21 用户拍板「没有测试，测试只是备注」）：
   列表 = 全部非虚拟账号；测试/审计账号照常列出，行内以「测试」备注标识。 */

/* D3 表格增强：列显隐（公共组件 MkCols 接管：菜单 + localStorage 持久化；列可隐藏，用户/操作列固定）。
   默认列集对齐原型 .tbl（用户/邮箱/角色/路径会话/最后登录/操作）：「选择框」「注册时间」默认隐藏
   （列菜单可恢复）。首访默认隐藏走 MkCols :default-hidden 单源（与 LearnerCenter/ExecLogs 同判例）；
   页面不再私设 v-model 初值——否则 localStorage 已存在时会被双源钉死。 */
const ulColDefs = [
  { key: 'check', label: '选择框（批量操作）' },
  { key: 'email', label: '邮箱' },
  { key: 'role', label: '角色' },
  { key: 'paths', label: '路径 / 课堂' },
  { key: 'created', label: '注册时间' },
  { key: 'lastlogin', label: '最后登录' },
] as const
const hiddenCols = ref<Set<string>>(new Set())

/* 移动端仅保留「名称 / 状态 / 操作」：隐藏勾选列与时间/邮箱等次要列，避免多列挤进横向滚动。
   中屏（≤1320，覆盖最常见的 1280 笔记本减侧栏后的内容区）再收起「邮箱 / 注册时间」——
   列全开时操作列会被截出可视区（1280 实测），优先保行内操作可达 */
const isNarrow = useIsNarrow()
const isMedium = useIsNarrow(1320)
const MOBILE_HIDDEN_COLS = new Set(['check', 'role', 'email', 'created', 'lastlogin'])
const MEDIUM_HIDDEN_COLS = new Set(['created', 'email'])
const showCol = (key: string) =>
  !hiddenCols.value.has(key) &&
  !(isMedium.value && MEDIUM_HIDDEN_COLS.has(key)) &&
  !(isNarrow.value && MOBILE_HIDDEN_COLS.has(key))

/** 卡头「批量操作」：打开勾选列并进入选择态；再点收起并清空已选 */
const checkVisible = computed(() => isLive.value && showCol('check'))
function toggleBatchMode() {
  if (checkVisible.value) {
    selected.value = []
    hiddenCols.value = new Set([...hiddenCols.value, 'check'])
  } else {
    const next = new Set(hiddenCols.value)
    next.delete('check')
    hiddenCols.value = next
  }
}


/** live 用户域拉取失败（且列表为空）→ 错误态；空态只在真正无数据时展示 */
const loadFailed = computed(
  () => isLive.value && !liveLoading.value && !!liveFailures.value.users && !liveUsers.value.length
)
function retryLoad() {
  void loadLiveData()
}
/* 宿主刷新联动（用户账号宿主「刷新」按钮 → 重拉 live 用户域） */
defineExpose({ refresh: () => { void loadLiveData() }, openCreate })
/* 筛选 pill（角色 / 活跃 / 新增 / 从未登录 / 生命周期；已去掉原「全部角色」下拉，避免与「管理员」pill 语义冲突）。
   计数取自全量 liveUsers（统一判例：除「全部」外一律显命中数）；
   「已删除」为独立数据源（后端分页），切过去才拉取，计数取后端真总数。 */
const pills = computed<Array<{ id: string; label: string; count: number | string | null; title?: string }>>(() => {
  const active = liveUsers.value
  /* 列表即全部非虚拟账号（后端已排除虚拟学习者），计数与筛选同一谓词、无第二套分母。 */
  return [
    { id: 'all', label: '全部', count: active.length },
    { id: 'admin', label: '管理员', count: active.filter((u) => u.isAdmin).length },
    { id: 'user', label: '普通用户', count: active.filter((u) => !u.isAdmin).length },
    { id: 'online', label: '近 7 天活跃', count: active.filter((u) => recentLogin(u.lastLoginAt)).length },
    { id: 'new7d', label: '近 7 日新增', count: active.filter(isNewIn7d).length },
    { id: 'never', label: '从未登录', count: active.filter((u) => !u.lastLoginAt).length },
    { id: 'deleted', label: '已删除', count: deletedTotal.value || null }
  ]
})

/** 卡头「视图」下拉：角色 / 活跃 / 新增 / 生命周期合成一维（与 KPI 同源同计数） */
const ulViewOptions = computed(() => [
  { value: 'all', label: '全部用户' },
  ...pills.value
    .filter((p) => p.id !== 'all')
    .map((p) => ({ value: p.id, label: p.count != null ? `${p.label}（${p.count}）` : p.label }))
])

/* Phase 2：「已删除」是后端分页的独立数据源，取数时机见文件末的 watch（需排在「筛选回第 1 页」之后）。 */

/* 新建 / 编辑用户：表单与校验住 UserFormDialog（详情页「账号与许可」卡头打开同一份） */
const dialogOpen = ref(false)
const dialogUser = ref<EditableUser | null>(null)

const { openMenu, toggleMenu, closeMenu, popStyle } = useRowMenu()

/** 行内 ⋯ 菜单项：先关菜单再执行 */
function menuDelete(u: UserRow) {
  closeMenu()
  void removeUser(u)
}
function menuRestore(u: UserRow) {
  closeMenu()
  void restoreUserRow(u)
}

/* intent 快捷动作：直达并打开新建弹窗 */
watch(
  () => intent.quickAction,
  (a) => {
    if (a === 'create-user') {
      intent.quickAction = ''
      openCreate()
    }
  },
  { immediate: true }
)

function openCreate() {
  dialogUser.value = null
  dialogOpen.value = true
}

function openEdit(u: UserRow) {
  dialogUser.value = { id: u.id, name: u.name, email: u.email, admin: u.admin }
  dialogOpen.value = true
}

function onSaved(payload: { mode: 'create' } | { mode: 'edit'; id: string; name: string; email: string; admin: boolean }) {
  if (payload.mode === 'create') {
    // 新建后无条件回第 1 页：否则停在第 3 页时新账号不在眼前，会被读成「没建成」
    pill.value = 'all'
    page.value = 1
    return
  }
  const target = liveUsers.value.find((x) => x.id === payload.id)
  if (target) {
    target.name = payload.name
    target.email = payload.email
    target.isAdmin = payload.admin
  }
}

/* 批量删除（测试/虚拟账号不参与勾选与提交，参照行菜单过滤逻辑） */
const selected = ref<string[]>([])
const batchBusy = ref(false)
/* 表头全选 = 当前页全选（2026-10-11 用户拍板：跨页全量勾选对批量删除这类动作太易误伤）。
   再点一次只清当前页；跨页仍可手动逐个勾（selected 保留），批量条据此标注未显示页行数。 */
const pageSelectable = computed(() => paged.value.filter((u) => !isNonRealAccount(u) && !u.deleted))
const allChecked = computed(() => pageSelectable.value.length > 0 && pageSelectable.value.every((u) => selected.value.includes(u.id)))
const headerIndeterminate = computed(() => !allChecked.value && pageSelectable.value.some((u) => selected.value.includes(u.id)))
/** 审核 #13（2026-10-06）：已选中但不在当前页的条数——手动跨页勾选时，
    批量条据此如实标注「含未显示页 N 行」 */
const selectedOffPage = computed(() => {
  const onPage = new Set(paged.value.map((u) => u.id))
  return selected.value.filter((id) => !onPage.has(id)).length
})

function toggleAll() {
  const pageIds = pageSelectable.value.map((u) => u.id)
  const allOn = pageIds.length > 0 && pageIds.every((id) => selected.value.includes(id))
  if (allOn) {
    const drop = new Set(pageIds)
    selected.value = selected.value.filter((id) => !drop.has(id))
  } else {
    selected.value = [...new Set([...selected.value, ...pageIds])]
  }
}

async function batchDelete() {
  const ids = selected.value.filter((id) => {
    const u = users.value.find((x) => x.id === id)
    return u ? !isNonRealAccount(u) : false
  })
  if (!ids.length || batchBusy.value) return
  const ok = await askConfirm({
    title: '批量删除用户',
    message: `确认批量删除 ${ids.length} 个用户？删除后用户将无法登录，历史数据保留，可在后台恢复。`,
    confirmText: `删除 ${ids.length} 个用户`,
    busy: true
  })
  if (!ok) return
  batchBusy.value = true
  try {
    await adminUsersApi.batchDeleteUsers([...ids])
    const removed = new Set(ids)
    liveUsers.value = liveUsers.value.filter((u) => !removed.has(u.id))
    toast.success(`已删除 ${ids.length} 个用户`)
    selected.value = []
    doneConfirm()
  } catch (e) {
    toast.error(`批量删除失败：${errMsg(e)}`)
    failConfirm()
  } finally {
    batchBusy.value = false
  }
}

/** 导出选中用户为 CSV（P1：批量操作标配，导出当前选中；含虚拟/测试标记） */
function exportSelected() {
  const rows = selected.value
    .map((id) => users.value.find((u) => u.id === id))
    .filter((u): u is UserRow => !!u)
  if (!rows.length) return
  const esc = (v: unknown) => {
    let s = String(v ?? '')
    // 防公式注入（CSV）：昵称等用户可控字段以 = + - @ 开头时会被 Excel/WPS 当公式执行，前缀 ' 强制按文本呈现
    if (/^[=+\-@]/.test(s)) s = `'${s}`
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const header = ['姓名', '邮箱', '角色', '等级/XP', '路径/课堂', '注册时间', '最后登录', '类型']
  const lines = rows.map((u) =>
    [
      esc(u.name),
      esc(u.email),
      u.admin ? '管理员' : '用户',
      `${levelBadgeZh(u.xp, u.currentLevel)} / ${u.xp}`,
      `${u.paths} / ${u.sessions}`,
      esc(u.createdAt || ''),
      esc(u.lastLogin || ''),
      u.deleted ? '已删除' : isVirtualAccount(u) ? '虚拟学习者' : isNonRealAccount(u) ? '测试' : '普通',
    ].join(',')
  )
  const csv = '\uFEFF' + [header.join(','), ...lines].join('\r\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `wenflow-users-${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(a.href)
  toast.success(`已导出 ${rows.length} 个用户`)
}

async function removeUser(u: UserRow) {
  const ok = await askConfirm({
    title: '删除用户',
    message: `确认删除用户「${u.name}」（${u.email}）？\n删除后用户将无法登录，历史数据保留，可在后台恢复。`,
    confirmText: '删除',
    busy: true
  })
  if (!ok) return
  u.busy = true
  try {
    await liveDeleteUser(u.id)
    toast.success(`「${u.name}」已删除`)
    doneConfirm()
  } catch (e) {
    toast.error(`删除失败：${errMsg(e)}`)
    failConfirm()
  } finally {
    u.busy = false
  }
}

/** Phase 2：恢复已软删用户（身份保留策略下无需查重，后端直接清空 deletedAt/deletedBy） */
async function restoreUserRow(u: UserRow) {
  const ok = await askConfirm({
    title: '恢复用户',
    message: `确认恢复用户「${u.name}」（${u.email}）？\n恢复后该用户可重新登录，历史数据原样保留。`,
    confirmText: '恢复',
    danger: false
  })
  if (!ok) return
  u.busy = true
  try {
    await restoreUser(u.id)
    toast.success(`「${u.name}」已恢复`)
    // 已删列表是后端分页的一页：本地摘行会让 total 与页码对不上，恢复后按当前页重取
    await loadDeletedUsers()
    // 审核 #10（2026-10-06）：恢复必须同步 live 用户域，否则切回「全部」看不到刚恢复的用户
    // （切回 all 不重拉 live 域）——与 liveDeleteUser 的对称清理成对；重拉失败不静默
    if (isLive.value) {
      await refreshLiveUsers().catch(() => {
        toast.error('用户已恢复，但列表刷新失败，请手动刷新')
      })
    }
  } catch (e) {
    toast.error(`恢复失败：${errMsg(e)}`)
  } finally {
    u.busy = false
  }
}

const adminCount = computed(() => users.value.filter((u) => u.admin).length)
const activeToday = computed(() => users.value.filter((u) => u.online).length)

/* 客户端排序：数据全量在客户端（live 全量拉取）→ 排序诚实。
   默认保持服务端顺序（注册时间倒序）；点表头切换，状态 localStorage 记忆。 */
const {
  toggle: toggleUserSort, sortState: userSortState, sortRows: sortUserRows,
  sortKey: userSortKey, sortDir: userSortDir
} = useTableSort<UserRow>({
  accessors: {
    user: (u) => u.name || u.email,
    level: (u) => u.xp,
    paths: (u) => u.paths,
    created: (u) => (u.createdAtRaw ? new Date(u.createdAtRaw).getTime() : null),
    lastlogin: (u) => (u.lastLoginRaw ? new Date(u.lastLoginRaw).getTime() : null)
  },
  storageKey: 'wf_users_sort'
})

const filtered = computed(() => {
  /* 已删除视图：一页由后端给出（page/limit/search），本页只排这一页 */
  if (isDeletedView.value) return sortUserRows(users.value)
  return sortUserRows(users.value.filter((u) => {
    /* 2026-10-21：列表已是全部非虚拟账号，角色/活跃 pill 只看该轴本身，不再叠加身份域
       （否则计数含测试账号、筛选又把它滤掉，同屏两套分母）。 */
    if (pill.value === 'admin' && !u.admin) return false
    if (pill.value === 'user' && u.admin) return false
    if (pill.value === 'online' && !u.online) return false
    if (pill.value === 'new7d' && !(u.createdAtRaw && isNewIn7d({ createdAt: u.createdAtRaw }))) return false
    if (pill.value === 'never' && u.lastLoginRaw) return false
    const q = keyword.value.trim().toLowerCase()
    if (q && !`${u.name} ${u.email} ${u.id}`.toLowerCase().includes(q)) return false
    return true
  }))
})

/* 筛选 / 页码 ↔ URL query（F1-2）：进用户详情时本组件被卸载，返回（面包屑 / 浏览器后退）
   后按 URL 还原搜索词、pill 与页码，深链 / 刷新同样还原。组合式单点在 learner-profile.ts。
   必须在下方「筛选变化回第 1 页」的 watch 之前调用：URL 落位要发生在监听建立之前，
   否则挂载时还原出来的筛选会被当成用户改筛选、把还原的页码打回 1。 */
useListQueryState({
  pill,
  keyword,
  page,
  pageSize,
  allowedPills: ['all', 'admin', 'user', 'online', 'new7d', 'never', 'deleted']
})

const paged = computed(() => {
  if (isDeletedView.value) return filtered.value
  const start = (page.value - 1) * pageSize.value
  return filtered.value.slice(start, start + pageSize.value)
})
/* 筛选变化回第 1 页：监听筛选输入而非 filtered 结果（TeachingSessions 判例）——数据域
   首载 / 重拉（含测试切换、详情返回）也会让 filtered 重算，监听结果会把还原的页码打回 1。
   数据缩水导致的越界页码由 Pagination 自带的收敛 watch 处理。 */
watch([pill, keyword, userSortKey, userSortDir], () => {
  page.value = 1
})
/* 已删除视图：pill 切换 / 翻页 / 改每页条数 / 改搜索词都要回后端取（后端分页），
   与 live 视图的客户端切片是两条路。immediate：深链或返回还原到 ?pill=deleted 时，
   pill 在挂载前就已是 deleted，非立即的 watch 等不到这次变化。
   flush: 'post' 让「筛选变化回第 1 页」先落位，一次切换只打一次请求。 */
watch([pill, page, pageSize, keyword], () => {
  if (isDeletedView.value && isLive.value) void loadDeletedUsers()
}, { immediate: true, flush: 'post' })
watch(filtered, () => {
  // 选中集合同步收敛：切 pill / 改搜索后，屏幕上已看不到的行仍留在 selected 里，
  // 批量条却报「已选 N 人」——此时批量删除会删掉不可见的行、导出会静默少导。
  if (!selected.value.length) return
  const visible = new Set(filtered.value.map((u) => u.id))
  const next = selected.value.filter((id) => visible.has(id))
  if (next.length !== selected.value.length) selected.value = next
})

const isFiltered = computed(() => pill.value !== 'all' || !!keyword.value.trim())
function clearFilters() {
  pill.value = 'all'
  keyword.value = ''
}
</script>

<style scoped>
/* 嵌入模式（宿主 People 页 flex 列内）：占满剩余高度，表格区内滚（对齐 oc-embedded 先例）。
   2026-10-14 走查（「这个组件到底部的高度和其他页不一样」）：嵌入分支的根同时挂着
   .mk-page--fill，于是它把**页面**的底部呼吸位又加了一遍——宿主 .pp-host 已给过 16px，
   卡片离底边就成了 32px（实测 1560 视口：People 32 / 学习状态·目标对话·学习路径·教学会话均 16）。
   这层不是页面、只是宿主页内的填充容器，故清掉它的底部内边距；.mk-page--fill 的 flex 列与 gap
   保留（卡片靠它们撑开）。 */
.u-embedded { flex: 1; min-height: 0; overflow: hidden; padding-bottom: 0; }
/* 窄屏：嵌入根不再占剩余高度，随内容增高，滚动手柄交给 People 页（2026-10-21 全 admin 走查） */
@media (max-width: 900px) {
  .u-embedded { flex: none; height: auto; overflow: visible; }
}
/* 路径/课堂数字列（原型列语言：mono 文本） */
.ul-ps { font-variant-numeric: tabular-nums; }
.ul-ps b { font-weight: 600; }
.ul-ps i { font-style: normal; color: var(--mk-faint); margin: 0 2px; }
/* 筛选弹层外壳（.mk-adv*）已提升为共享原语：见 styles/mk-primitives.css */
/* 视图页签随学习状态拆页退役（2026-10-04，单视图不再需要 .tabs） */
.ul-row { cursor: pointer; }
/* 键盘可达（对齐 gc-row/oc-row 判例）：行可聚焦，焦点态描边提示当前位置 */
.ul-row:focus-visible { outline: 2px solid var(--mk-blue); outline-offset: -2px; }
/* 已删除行（审核 #8，2026-10-06）：整行 opacity 0.62 会把行内文字压到 AA 之下
   （姓名 4.28 / 已删除徽章 2.99 / 次级行 2.45，正文需 4.5:1）。撤整行透明度，
   降色改元素级：主名/副行降一档到 --mk-muted（同底实测 5.07:1），
   保留 saturate(0.2) 表达「已删除」的灰化语义。 */
.ul-row--deleted { filter: saturate(0.2); }
.ul-row--deleted .mk-cell-main strong { color: var(--mk-muted); }
.ul-row--deleted .mk-cell-sub { color: var(--mk-muted); }

/* ===== 行级设计（2026-09-26）：身份 chip / 等级色阶+升级条 / 登录新鲜度 ===== */
/* 固定列宽（2026-10-22 用户「翻页不同页码时候，列宽怎么还在变呢」）：用户/邮箱两列在
   auto 布局下按当页最长文本分宽，翻页跳动；fixed 后按表头宽度定死，余量按权重摊开。 */
.u-c-check { width: 36px; }
.u-c-user { width: 250px; }
.u-c-email { width: 190px; }
.u-c-role { width: 96px; }
/* 390 档 fixed 表按比例摊薄列宽，「路径 / 课堂」+ 右缘 caret（绝对定位 -12px）会贴到内衬里；
   112 = 文字 75 + 左右内衬 32 + 余量，窄屏保整词与箭头。 */
.u-c-paths { width: 112px; min-width: 112px; }
.u-c-created { width: 100px; }
.u-c-lastlogin { width: 100px; }
.u-c-act { width: 110px; }
.ul-user { display: flex; align-items: center; gap: 9px; min-width: 0; }
.ul-user .mk-cell-main { min-width: 0; flex: 1; }
.ul-tags { display: flex; gap: 5px; margin-left: auto; flex: none; }

/* 邮箱列（原型独立邮箱列，sub 字级弱于姓名）。
   原型 .tbl 是自动布局：列宽随内容，超长邮箱用 max-width 截断兜底
   （生产昵称/邮箱是 40+ 字符的机名形态，不设上限会独吃列宽）。
   上限 230→320（2026-10-03）：列实际分到 392px，而 36 字邮箱自然宽 248px——
   230 的旧上限比内容还窄 18px，宽列里照样出省略号（浏览器巡检实锤）。 */
.ul-email {
  display: block; min-width: 0; max-width: 320px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  font-size: var(--mk-fs-micro); color: var(--mk-muted);
}
.ul-user .mk-cell-main strong {
  display: block; max-width: var(--mk-cell-main-max);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
/* 原型 .tbl td：nowrap（长内容由上面的 max-width 兜底，不换行撑行高）。
   2026-10-05 CM6：收敛为全局修饰类 .mk-table--nowrap（表元素已挂该 class）。 */

@media (min-width: 2000px) {
  .ul-tags { gap: 6px; margin-top: 3px; }
}
@media (min-width: 2800px) {
  .ul-tags { gap: 7px; margin-top: 4px; }
}

/* ================= 暗色模式（D1）：用户页局部覆写 ================= */
html[data-theme='dark'] {
  /* 等级 chip 色阶已 token 化（2026-09-26），暗色随 --mk-* 翻转，无需覆写 */
  /* 表格行内复选框：暗色下自定义外观（原生 checkbox 边框过亮） */
  .mk-table input[type='checkbox'] {
    appearance: none;
    width: 14px;
    height: 14px;
    border: 1.5px solid #4d4e51;
    border-radius: 4px;
    background: transparent;
    cursor: pointer;
    vertical-align: middle;
    position: relative;
    flex-shrink: 0;
  }
  .mk-table input[type='checkbox']:checked {
    background: var(--mk-blue);
    border-color: var(--mk-blue);
  }
  .mk-table input[type='checkbox']:checked::after {
    content: '';
    position: absolute;
    left: 4px;
    top: 1px;
    width: 4px;
    height: 8px;
    border: solid var(--mk-on-fill);
    border-width: 0 2px 2px 0;
    transform: rotate(45deg);
  }
}
</style>
