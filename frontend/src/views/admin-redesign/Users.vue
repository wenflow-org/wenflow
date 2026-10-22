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
      <span v-if="isLive && pill !== 'deleted'" class="mk-status__meta" title="仅统计真实用户（不含虚拟 / 测试账号）">
        真实 {{ realUsers }}
      </span>
      <span v-if="isLive && pill !== 'deleted' && includeTest" class="mk-status__meta" title="含虚拟学习者与测试账号">测试/虚拟 {{ users.length - realUsers }}</span>
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
               左 = 快筛 chips → 搜索（本页不出「清除筛选」，理由见末段）；右 = 页级动作 → 列 → 筛选(仅有次级筛选时) → 计数 meta(仅说独有事实时)。
               计数判例（2026-10-11 用户拍板全站统一）：筛选 pill 一律显命中数，唯「全部」不显
               （总数单源=分页器「共 N 条」）——取代旧「KPI 孪生 pill 不显数」判例，忽隐忽现的计数消失。
               本页无次级筛选（口径开关在页头），「筛选」弹层随之退役——搜索回到行内；
               「N / N 人」meta 维持不渲染（与分页器复读）。
               2026-10-17 用户走查「清除筛选没啥意义」：本页是教学组唯一没有分布条下钻的列表，
               可叠加的只有 pill（单选）与搜索，二者各自已有「全部」与搜索框 ✕ 两条一键复位；
               卡头不再出「清除筛选」（空态里的「显示全部用户」仍保留）。其它四页保留——那里
               它同时负责清掉分布条的下钻段。 -->
          <div class="mk-pills">
            <template v-for="p in pills" :key="p.id">
              <!-- 「已删除」是生命周期维度（独立数据源），与角色/活跃 pills 之间加分隔，
                   视觉语法与真实语义对齐（2026-10-11 用户走查） -->
              <span v-if="p.id === 'deleted'" class="ul-pills__sep" aria-hidden="true"></span>
              <button
                type="button"
                class="mk-pill"
                :class="{ 'mk-pill--active': pill === p.id }"
                :aria-pressed="pill === p.id"
                :title="p.title"
                @click="pill = p.id"
              >{{ p.label }}<span v-if="p.count != null && p.id !== 'all'" class="mk-pill__count">{{ p.count }}</span></button>
            </template>
          </div>
        </div>
        <div class="mk-card__head-right">
          <!-- 搜索槽位统一（2026-10-15 用户拍板全站列表页）：搜索移到右组首位 -->
          <MkFilterSearch v-model="keyword" placeholder="搜索昵称 / 邮箱 / ID" />
          <!-- 选择框列默认隐藏（2026-10-17 用户走查「这个多选，默认不出来吧」）：
               批量删除/导出属低频动作，常驻一整列勾选框会顶在身份列前面，也容易被读成每行都要勾。
               审核 #7 当年担心「批量操作没有入口」——入口保留在「列」菜单（选择框，标了批量操作），
               需要时自己打开。
               2026-10-19 用户走查「可以加一列注册时间」：注册时间本就存在，只是与勾选列一起被默认
               隐藏了（大表默认列多会挤掉操作列）——现在只默认隐藏勾选列，注册时间默认可见。
               存储键升 v5：v4 存下的隐藏集含 created，不升版新默认对已访问过的浏览器不生效
               （与 v3→v4 同一条理由）。窄屏 ≤1320 仍由 MEDIUM_HIDDEN_COLS 收起时间/邮箱列。 -->
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
        tone="error"
        icon="◌"
        title="数据加载失败"
        description="无法加载用户列表，请稍后重试。"
        action-text="重试"
        @action="retryLoad"
      />
      <div v-else-if="filtered.length" class="mk-table-scroll">
        <!-- 固定列宽（2026-10-22 与教学组三表同判例）：自动布局下用户/邮箱两列按当页最长内容
             分宽，翻页整表跳动；改 fixed + 逐列表头宽度，余量按权重摊开。
             单元格 nowrap 不变，长邮箱/长昵称仍由 max-width 截断兜底 -->
        <table class="mk-table mk-table--nowrap mk-table--fixed ul-table">
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
              ><button type="button" class="mk-th__btn" @click.stop="toggleUserSort('paths')">路径 / 课堂<span class="mk-th__caret" aria-hidden="true"></span></button></th>
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
          <tr v-for="u in paged" :key="u.id" class="ul-row" :class="{ 'ul-row--deleted': u.deleted }" tabindex="0" @click="openSubPage('user', u.id, includeTest ? { includeTest: true } : undefined)" @keydown.enter="($event.target === $event.currentTarget) && openSubPage('user', u.id, includeTest ? { includeTest: true } : undefined)">
            <td v-if="isLive && showCol('check')" @click.stop><input v-model="selected" type="checkbox" :value="u.id" :disabled="u.deleted || isNonRealAccount(u)" :aria-label="`选择 ${u.name}`" @click.stop /></td>
            <td>
              <div class="ul-user">
                <MkCellAvatar :name="u.name" :tone="avaTone(u)" />
                <div class="mk-cell-main">
                  <strong :title="u.name">{{ u.name }}</strong>
                  <!-- 原型 celluser meta 模式：等级 · N 条路径（XP 细节进悬停）。
                       等级词汇单点（learner-profile.ts）：统一「L2 · 进阶」并存格式 -->
                  <span
                    class="mk-cell-sub"
                    :title="u.xp === 0 ? '尚无经验值' : `${u.xp} XP · 距 L${levelFromXp(u.xp) + 1} 还需 ${xpToNext(u.xp)}`"
                  >{{ levelBadgeZh(u.xp, u.currentLevel) }} · {{ u.paths }} 条路径</span>
                </div>
                <div class="ul-tags">
                  <span v-if="u.deleted" class="mk-badge mk-badge--sm mk-badge--deleted" :title="u.deletedAt ? `删除于 ${u.deletedAt}` : undefined">已删除</span>
                  <!-- 自己那一行（2026-10-19 用户走查「这不就重复了吗」）：原文案「当前管理员」
                       与身份列的「管理员」徽章读作同一个角色标签，实际标的是「这一行是你正在用的
                       账号」（该行 ⋯ 菜单刻意不给「降为用户 / 删除」）。改说账号，不再复述角色 -->
                  <span
                    v-else-if="isSelf(u)"
                    class="mk-badge mk-badge--sm mk-badge--self"
                    title="你正在使用的账号"
                  >当前账号</span>
                </div>
              </div>
            </td>
            <td v-if="showCol('email')">
              <span class="ul-email" :title="u.email">{{ u.email }}</span>
            </td>
            <td v-if="showCol('role')"><span class="mk-badge" :class="u.admin ? 'mk-badge--info' : 'mk-badge--muted'">{{ u.admin ? '管理员' : '用户' }}</span></td>
            <td v-if="showCol('paths')" class="mk-num">
              <!-- 原型列语言：数字列就是 mono 文本，不加自造可视化（双段条退役，计数进悬停）。
                   P2：0 值统一 mk-na 弱化（此前只有会话 0 弱化，路径 0 却实心黑，双标） -->
              <span class="ul-ps" :title="`路径 ${u.paths} 条 · 课堂 ${u.sessions} 节`"><b :class="{ 'mk-na': !u.paths }">{{ u.paths }}</b><i>/</i><b :class="{ 'mk-na': !u.sessions }">{{ u.sessions }}</b></span>
            </td>
            <td v-if="showCol('created')"><span :class="u.createdAt === '从未' ? 'mk-na' : ''">{{ u.createdAt }}</span></td>
            <td v-if="showCol('lastlogin')"><span :class="u.lastLogin === '从未' ? 'mk-na' : ''">{{ u.lastLogin }}</span></td>
            <td>
              <div class="mk-actions">
                <!-- 原型操作列：文字「详情」描边小钮（.btn--sm 形态），行级管理动作留在 ⋯ 菜单 -->
                <button type="button" class="mk-btn mk-btn--sm" @click.stop="openSubPage('user', u.id, includeTest ? { includeTest: true } : undefined)">详情</button>
                <div v-if="isLive" class="mk-menu">
                  <button type="button" class="mk-menu__btn" aria-label="更多操作" aria-haspopup="menu" :aria-expanded="openMenu === u.id" @click.stop="toggleMenu(u.id)">⋯</button>
                  <div v-if="openMenu === u.id" class="mk-menu__pop" :style="popStyle" @click.stop>
                    <button v-if="u.deleted" type="button" class="mk-menu__item" :disabled="u.busy" @click="menuRestore(u)">恢复</button>
                    <template v-else>
                      <button type="button" class="mk-menu__item" :disabled="u.busy" @click="menuEdit(u)">编辑</button>
                      <template v-if="!isSelf(u)">
                        <div class="mk-menu__sep"></div>
                        <button type="button" class="mk-menu__item mk-menu__item--danger" :disabled="u.busy" @click="menuDelete(u)">删除</button>
                      </template>
                    </template>
                  </div>
                </div>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
      </div>

      <MkEmptyState
        v-else
        icon="◌"
        :title="isFiltered ? '当前筛选无用户' : '暂无真实用户'"
        :description="isFiltered ? '放宽筛选条件试试。' : '用户注册后将自动出现在这里。'"
        :action-text="isFiltered ? '显示全部用户' : ''"
        @action="clearFilters"
      />
      <!-- 客户端分页（P2：37 行长表单页直排 → mk-pagination 统一分页器，15-30-50-100 条/页） -->
      <Pagination
        v-if="filtered.length"
        v-model:page="page"
        v-model:pageSize="pageSize"
        :total="filtered.length"
        :showTotal="true"
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

    <!-- 新建/编辑用户 -->
    <Teleport to="body">
    <div v-if="createOpen" ref="maskRef" class="mk-modal">
      <div ref="panelRef" class="mk-modal__panel" role="dialog" :aria-label="editTarget ? '编辑用户' : '新建用户'">
        <div class="mk-modal__head">
          <h3 class="mk-modal__title">{{ editTarget ? `编辑用户 · ${editTarget.name}` : '新建用户' }}</h3>
          <button type="button" class="mk-modal__close" aria-label="关闭" @click="closeCreate">✕</button>
        </div>
        <div class="mk-modal__body">
          <label class="mk-field" :class="{ 'mk-field--error': errors.name }">
            <span class="mk-field__label">昵称 <em class="mk-field__req">*</em></span>
            <input v-model="form.name" class="mk-field__input" placeholder="例如：陈晓" />
            <span v-if="errors.name" class="mk-field__err">{{ errors.name }}</span>
          </label>
          <label class="mk-field" :class="{ 'mk-field--error': errors.email }">
            <span class="mk-field__label">邮箱 <em class="mk-field__req">*</em></span>
            <input v-model="form.email" class="mk-field__input" placeholder="name@example.com" />
            <span v-if="errors.email" class="mk-field__err">{{ errors.email }}</span>
          </label>
          <label v-if="isLive" class="mk-field" :class="{ 'mk-field--error': errors.password }">
            <span class="mk-field__label">{{ editTarget ? '重置密码' : '初始密码' }} <em class="mk-field__req">*</em></span>
            <input v-model="form.password" type="password" class="mk-field__input" :placeholder="editTarget ? '留空表示不修改' : '至少 8 位，含字母和数字'" />
            <span v-if="errors.password" class="mk-field__err">{{ errors.password }}</span>
          </label>
          <label v-if="isLive && !editTarget" class="mk-field" :class="{ 'mk-field--error': errors.confirmPassword }">
            <span class="mk-field__label">确认密码 <em class="mk-field__req">*</em></span>
            <input v-model="form.confirmPassword" type="password" class="mk-field__input" placeholder="再输入一次" />
            <span v-if="errors.confirmPassword" class="mk-field__err">{{ errors.confirmPassword }}</span>
          </label>
          <label class="mk-field">
            <span class="mk-field__label">角色</span>
            <select v-model="form.admin" class="mk-field__select">
              <option :value="false">用户</option>
              <option :value="true">管理员</option>
            </select>
          </label>
        </div>
        <div class="mk-modal__foot">
          <button type="button" class="mk-btn" @click="closeCreate">取消</button>
          <button type="button" class="mk-btn mk-btn--primary" :disabled="creating" @click="saveUser">
            {{ creating ? '保存中…' : editTarget ? '保存修改' : '创建' }}
          </button>
        </div>
      </div>
    </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { openSubPage, intent, isLive } from './store'
import { liveUsers, liveCreateUser, liveDeleteUser, liveUsersTotal, liveSetUsersIncludeTest, timeAgo, errMsg, registrationEnabled, liveLoading, liveFailures, loadLiveData, liveIncludeVirtual, liveSetIncludeVirtual } from './live'
import { useOverlay, useMaskClose } from './useOverlay'
import { useRowMenu } from './useRowMenu'
import { askConfirm, doneConfirm, failConfirm } from './useConfirm'
import MockSkeletonTable from './SkeletonTable.vue'
import Pagination from './Pagination.vue'
import MkFilterSearch from '@/components/mk/MkFilterSearch.vue'
import { useTableSort } from './useTableSort'
import MkCols from '@/components/mk/MkCols.vue'
import MkCellAvatar from '@/components/mk/MkCellAvatar.vue'
import MkEmptyState from '@/components/mk/MkEmptyState.vue'
import { adminUsersApi, getDeletedUsers, restoreUser } from '@/api/adminApi'
import { useEscape } from './useEscape'
import { useIsNarrow } from './useIsNarrow'
import { toast } from '@/utils/toast'
import { isRealAccountUser, isVirtualLearnerAccount, levelFromXp, levelBadgeZh, useListQueryState } from './learner-profile'

/* ---- 行级设计派生（2026-09-26）：身份 chip 色 / 升级进度 / 登录新鲜度 ---- */
/* 密码规则错误提示单源（R6 复读单源化）：新建与改密两条校验分支共用一份 */
const PASSWORD_RULE_MSG = '密码至少 8 位，且同时包含字母和数字'
type UlUserLite = { deleted?: boolean; isVirtualLearner?: boolean; isTestAccount?: boolean; name?: string; email?: string; id?: string; xp?: number }
function avaTone(u: UlUserLite): 'default' | 'virtual' | 'test' | 'muted' {
  if (u.deleted) return 'muted'
  // 身份判据单点（learner-profile.ts）：payload 标记 ∪ 命名约定，与 KPI / 构成带同口径
  if (isRealAccountUser(u)) return 'default'
  return isVirtualLearnerAccount(u) ? 'virtual' : 'test'
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

/** 嵌入模式：作为「用户与学习者」页渲染（仅去掉外层壳，状态条/列表/弹窗保留）。
    2026-10-04：学习状态 tab 拆出独立页 /admin/learner-state，本组件只剩账号管理单视图 */
withDefaults(defineProps<{ embedded?: boolean }>(), { embedded: false })

/** 与后端 validatePasswordRule 一致：≥8 位且同时包含字母和数字 */
const PASSWORD_RULE = /^(?=.*[A-Za-z])(?=.*\d).{8,}$/

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
const isRealAccount = isRealAccountUser
/** 非真实账号（虚拟学习者 ∪ 测试/审计）：不参与管理员提升与批量删除（无意义且有风险） */
const isNonRealAccount = (u: UserRow) => !isRealAccountUser(u)

interface UserRow {
  id: string
  name: string
  email: string
  admin: boolean
  online: boolean
  /** 数据隔离标记（includeTest=true 时后端带回，供灰标） */
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

/** Phase 2：已删除筛选 pill 的独立数据源（后端 status=deleted，与活跃列表隔离） */
const DELETED_WINDOW = 50
const deletedUsers = ref<UserRow[]>([])
const deletedLoading = ref(false)

function mapDeletedRow(u: Record<string, unknown>): UserRow {
  return {
    id: String(u.id),
    name: String(u.name || u.email || u.id),
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
    const res = await getDeletedUsers({ limit: DELETED_WINDOW })
    const body = res.data?.data ?? res.data ?? {}
    const items = body.users || body.items || []
    deletedUsers.value = items.map(mapDeletedRow)
  } catch (e) {
    // 失败不静默：置空列表会让「已删除」pill 看起来像"没有已删用户"，误导管理员
    deletedUsers.value = []
    toast.error(`已删除用户加载失败：${errMsg(e)}`)
  } finally {
    deletedLoading.value = false
  }
}

/** 近 7 天活跃（2026-10-11 与宿主 KPI「近 7 天活跃」同窗同词；原 30 分钟窗口恒 0 无区分度） */
const recentLogin = (t: string | null) => !!t && Date.now() - new Date(t).getTime() < 7 * 86400000

const users = computed<UserRow[]>(() => {
  if (pill.value === 'deleted') return deletedUsers.value
  return liveUsers.value.map((u) => ({
    id: u.id,
    name: u.name,
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

const pill = ref('all')
const keyword = ref('')

/* 数据隔离（A3）：默认仅真实（排除虚拟/测试账号）；口径整组统一（2026-10-04 用户拍板）——
   get/set 走 live.ts 共享态（页头 DataScopeToggle 同源），本页 watch 只负责按新口径重拉并灰标 */
const includeTest = computed({
  get: () => liveIncludeVirtual.value,
  set: (v) => liveSetIncludeVirtual(v)
})
watch(includeTest, (v) => {
  // D10：测试视角不提供角色/活跃 pill，切过去时若停在旧筛选上会立刻变成空列表。
  if (v && pill.value !== 'all' && pill.value !== 'deleted') pill.value = 'all'
  // 切换失败不静默：用户以为已切到全量/仅真实口径，实际列表还是旧口径
  if (isLive.value && pill.value !== 'deleted') {
    liveSetUsersIncludeTest(v).catch((e) => toast.error(`切换数据范围失败：${errMsg(e)}`))
  }
})

/* D3 表格增强：列显隐（公共组件 MkCols 接管：菜单 + localStorage 持久化；列可隐藏，用户/操作列固定）。
   默认列集对齐原型 .tbl（用户/邮箱/角色/路径会话/最后登录/操作）：「选择框」「注册时间」默认隐藏
   （列菜单可恢复）。首访默认隐藏走 MkCols :default-hidden 单源（与 LearnerCenter/ExecLogs 同判例）；
   页面不再私设 v-model 初值——否则 localStorage 已存在时会被双源钉死。 */
const ulColDefs = [
  /* 默认隐藏后，列菜单这一项就是批量操作的唯一入口：label 直接写清用途 */
  { key: 'check', label: '选择框（批量操作）', title: '勾选后可在列表底部导出 CSV / 批量删除' },
  { key: 'email', label: '邮箱', title: '登录邮箱' },
  { key: 'role', label: '角色', title: '管理员 / 用户' },
  { key: 'paths', label: '路径 / 课堂', title: '学习路径数 / 教学课堂节数' },
  { key: 'created', label: '注册时间', title: '账号创建时间' },
  { key: 'lastlogin', label: '最后登录', title: '最近登录时间' },
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

/** 真实用户数（排除测试/虚拟账号；口径标注用，与总览「总用户」对齐——列表已全量加载，仅超上限时截断） */
const realUsers = computed(() => users.value.filter((u) => !u.deleted && isRealAccount(u)).length)

/** live 用户域拉取失败（且列表为空）→ 错误态；空态只在真正无数据时展示 */
const loadFailed = computed(
  () => isLive.value && !liveLoading.value && !!liveFailures.value.users && !liveUsers.value.length
)
function retryLoad() {
  void loadLiveData()
}
/* 宿主刷新联动（用户与学习者合并宿主「刷新」按钮 → 重拉 live 用户域） */
defineExpose({ refresh: () => { void loadLiveData() }, openCreate })
/* 筛选 pill（角色 / 活跃 / 生命周期；已去掉原「全部角色」下拉，避免与「管理员」pill 语义冲突）。
   计数取自全量 liveUsers（统一判例：除「全部」外一律显命中数）；
   「已删除」为独立数据源，切过去才拉取，未加载时不显示计数。 */
const pills = computed<Array<{ id: string; label: string; count: number | string | null; title?: string }>>(() => {
  const active = liveUsers.value
  /* 审核 #8（2026-10-06）：「普通用户」用真实域口径（排除虚拟/测试），与同面板 KPI
     「真实用户」（hint 明写不含虚拟/测试）保持同一口径。
     走查 F1-1（2026-10-07）：该口径原先只靠命名约定正则，漏掉卡库/预置库的虚拟学习者
     （vl-*@cards.local / builtin_*@preset.local，含测试档实测 10 行）→ pill 比同屏 KPI 多 10、
     这些行还能被筛出来勾进批量删除。改走 learner-profile.ts 单点（payload 标记优先）。 */
  const realActive = active.filter(isRealAccount)
  /* 三枚角色/活跃 pill 一律真实域，且**计数与筛选同谓词**（2026-10-11 走查实测）：
     含测试档下「管理员」badge 0 而点开出现 1 行测试管理员、「近 7 天活跃」badge 0 而点开
     出 3 行——同一控件两套分母（计数取 realActive、筛选取全量行）。现两者都走真实域，
     title 明写口径：含测试档下列表本身含虚拟/测试行，但角色/活跃 pill 不把它们算作「用户」。 */
  const pillDomainTitle = '仅统计真实账号（不含虚拟学习者 / 测试账号）'
  /* D10（2026-10-22 拍板 A）：测试视角下列表含虚拟/测试账号，但角色/活跃三枚 pill 恒定按
     真实域计数，永远是 0、点开还是空列表——不给一条走不通的入口，只留「全部 / 已删除」。 */
  if (includeTest.value) {
    return [
      { id: 'all', label: '全部', count: active.length },
      {
        id: 'deleted',
        label: '已删除',
        count: deletedUsers.value.length
          ? (deletedUsers.value.length >= DELETED_WINDOW ? `${DELETED_WINDOW}+` : deletedUsers.value.length)
          : null,
        title: `最多保留最近 ${DELETED_WINDOW} 条已删除账号记录。超过时计数显示「${DELETED_WINDOW}+」`
      }
    ]
  }
  return [
    { id: 'all', label: '全部', count: active.length },
    { id: 'admin', label: '管理员', count: realActive.filter((u) => u.isAdmin).length, title: pillDomainTitle },
    { id: 'user', label: '普通用户', count: realActive.filter((u) => !u.isAdmin).length, title: pillDomainTitle },
    {
      id: 'online',
      label: '近 7 天活跃',
      count: realActive.filter((u) => recentLogin(u.lastLoginAt)).length,
      title: `近 7 天内有登录。${pillDomainTitle}`
    },
    /* 审核 #14（2026-10-06）：已删除列表取自单次 limit 窗口，超过窗口时计数会小于真实值——
       到顶显示「50+」并在 title 标注截断，界面不再把窗口当全量。 */
    {
      id: 'deleted',
      label: '已删除',
      count: deletedUsers.value.length
        ? (deletedUsers.value.length >= DELETED_WINDOW ? `${DELETED_WINDOW}+` : deletedUsers.value.length)
        : null,
      title: `最多保留最近 ${DELETED_WINDOW} 条已删除账号记录。超过时计数显示「${DELETED_WINDOW}+」`
    }
  ]
})

/* Phase 2：切到「已删除」pill 时拉取已删列表（live 模式）；恢复/删除后回「全部」保持一致性。
   immediate：深链 / 返回还原到 ?pill=deleted 时，pill 在挂载前就已是 deleted，非立即的 watch
   等不到这次变化——已删列表会空着（筛选计数与表格都不出现）。 */
watch(pill, (p) => {
  if (p === 'deleted' && isLive.value) void loadDeletedUsers()
}, { immediate: true })

/* 新建 / 编辑用户 */
const createOpen = ref(false)
const creating = ref(false)
/** 弹窗统一关闭路径：提交中（保存中…）禁止 Esc/遮罩/✕ 误关（请求继续但用户失去上下文） */
function closeCreate() {
  if (!creating.value) createOpen.value = false
}
useEscape(() => createOpen.value, closeCreate)
const { openMenu, toggleMenu, closeMenu, popStyle } = useRowMenu()

/** 行内 ⋯ 菜单项：先关菜单再执行 */
function menuEdit(u: UserRow) {
  closeMenu()
  openEdit(u)
}
function menuDelete(u: UserRow) {
  closeMenu()
  void removeUser(u)
}
function menuRestore(u: UserRow) {
  closeMenu()
  void restoreUserRow(u)
}
const panelRef = ref<HTMLElement | null>(null)
const maskRef = ref<HTMLElement | null>(null)
useOverlay(computed(() => createOpen.value), panelRef)
useMaskClose(maskRef, closeCreate)

/* intent 快捷动作：直达并打开新建弹窗 */
watch(
  () => intent.quickAction,
  (a) => {
    if (a === 'create-user') {
      intent.quickAction = ''
      createOpen.value = true
    }
  },
  { immediate: true }
)
const editTarget = ref<UserRow | null>(null)
const form = ref({ name: '', email: '', password: '', confirmPassword: '', admin: false })
const errors = ref<{ name?: string; email?: string; password?: string; confirmPassword?: string }>({})

function openCreate() {
  editTarget.value = null
  form.value = { name: '', email: '', password: '', confirmPassword: '', admin: false }
  errors.value = {}
  createOpen.value = true
}

function openEdit(u: UserRow) {
  editTarget.value = u
  form.value = { name: u.name, email: u.email, password: '', confirmPassword: '', admin: u.admin }
  errors.value = {}
  createOpen.value = true
}

async function saveUser() {
  errors.value = {}
  if (!form.value.name.trim()) errors.value.name = '请输入昵称'
  if (!form.value.email.trim()) errors.value.email = '请输入邮箱'
  else if (!/^\S+@\S+\.\S+$/.test(form.value.email.trim())) errors.value.email = '邮箱格式不正确'
  if (isLive.value && !editTarget.value && !PASSWORD_RULE.test(form.value.password)) errors.value.password = PASSWORD_RULE_MSG
  if (isLive.value && editTarget.value && form.value.password && !PASSWORD_RULE.test(form.value.password)) errors.value.password = PASSWORD_RULE_MSG
  // 确认密码校验（仅新建时）
  if (isLive.value && !editTarget.value && form.value.confirmPassword !== form.value.password) {
    errors.value.confirmPassword = '两次输入的密码不一致'
  }
  if (Object.keys(errors.value).length) return

  creating.value = true
  try {
    if (editTarget.value) {
      await adminUsersApi.updateUser(editTarget.value.id, {
        name: form.value.name.trim(),
        email: form.value.email.trim(),
        isAdmin: form.value.admin,
        ...(form.value.password ? { password: form.value.password } : {})
      })
      const target = liveUsers.value.find((x) => x.id === editTarget.value?.id)
      if (target) {
        target.name = form.value.name.trim()
        target.email = form.value.email.trim()
        target.isAdmin = form.value.admin
      }
      toast.success('用户已更新')
    } else {
      await liveCreateUser({
        name: form.value.name.trim(),
        email: form.value.email.trim(),
        password: form.value.password,
        admin: form.value.admin
      })
      toast.success('用户已创建')
    }
    createOpen.value = false
    pill.value = 'all'
  } catch (e) {
    toast.error(`保存失败：${errMsg(e)}`)
  } finally {
    creating.value = false
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
      u.deleted ? '已删除' : isVirtualAccount(u) ? '虚拟' : isNonRealAccount(u) ? '测试' : '真实',
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
    deletedUsers.value = deletedUsers.value.filter((x) => x.id !== u.id)
    // 审核 #10（2026-10-06）：恢复必须同步 live 用户域，否则切回「全部」看不到刚恢复的用户
    // （pill 的 watch 只在切到 deleted 时拉取，切回 all 不重拉）——与 liveDeleteUser 的
    // 对称清理成对；重拉失败不静默，如实告知需手动刷新
    if (isLive.value) {
      await liveSetUsersIncludeTest(includeTest.value).catch(() => {
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
const { toggle: toggleUserSort, sortState: userSortState, sortRows: sortUserRows, sortKey: userSortKey, sortDir: userSortDir } = useTableSort<UserRow>({
  accessors: {
    user: (u) => u.name || u.email,
    level: (u) => u.xp,
    paths: (u) => u.paths,
    created: (u) => (u.createdAtRaw ? new Date(u.createdAtRaw).getTime() : null),
    lastlogin: (u) => (u.lastLoginRaw ? new Date(u.lastLoginRaw).getTime() : null)
  },
  storageKey: 'wf_users_sort'
})

const filtered = computed(() =>
  sortUserRows(users.value.filter((u) => {
    if (pill.value === 'deleted' && !u.deleted) return false
    /* 角色 / 活跃三枚 pill 与计数同一真实域口径（2026-10-11 走查：计数取 realActive 而筛选
       只看该轴，含测试档下 badge 与结果打架）。 */
    if (pill.value === 'admin' && (!u.admin || !isRealAccount(u))) return false
    // 审核 #8（2026-10-06）+ 走查 F1-1（2026-10-07）：与 pill 计数同一真实域口径——「普通用户」
    // 不含虚拟/测试账号；判据走 learner-profile.ts 单点（payload 标记 ∪ 命名约定），
    // 否则含测试档下 vl-*/builtin_* 形态的虚拟学习者会被筛出来（badge=虚拟却可勾选）
    if (pill.value === 'user' && (u.admin || !isRealAccount(u))) return false
    if (pill.value === 'online' && (!u.online || !isRealAccount(u))) return false
    const q = keyword.value.trim().toLowerCase()
    if (q && !`${u.name} ${u.email} ${u.id}`.toLowerCase().includes(q)) return false
    return true
  }))
)

/* 客户端分页（P2：替代「加载更多」——统一 mk-pagination 页码器）：
   数据全量在客户端（live 拉取），筛选后按页切片；
   页码与筛选一起住进 URL（下方 useListQueryState），挂载时先由它落位 */
const page = ref(1)
const pageSize = ref(15)

/* 筛选 / 页码 ↔ URL query（F1-2）：进用户详情时本组件被卸载，返回（面包屑 / 浏览器后退）
   后按 URL 还原搜索词、pill 与页码，深链 / 刷新同样还原。组合式单点在 learner-profile.ts。
   必须在下方「筛选变化回第 1 页」的 watch 之前调用：URL 落位要发生在监听建立之前，
   否则挂载时还原出来的筛选会被当成用户改筛选、把还原的页码打回 1。 */
useListQueryState({
  pill,
  keyword,
  page,
  pageSize,
  allowedPills: ['all', 'admin', 'user', 'online', 'deleted']
})

const paged = computed(() => {
  const start = (page.value - 1) * pageSize.value
  return filtered.value.slice(start, start + pageSize.value)
})
/* 筛选变化回第 1 页：监听筛选输入而非 filtered 结果（TeachingSessions 判例）——数据域
   首载 / 重拉（含测试切换、详情返回）也会让 filtered 重算，监听结果会把还原的页码打回 1。
   数据缩水导致的越界页码由 Pagination 自带的收敛 watch 处理。 */
watch([pill, keyword, userSortKey, userSortDir], () => {
  page.value = 1
})
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
/* pill 组维度分隔（角色/活跃 | 生命周期「已删除」）：细竖线，弱于 pill 边界。
   类名走页面前缀 ul-（design:check 规则 1：mk- 前缀属全局原语，页面 scoped 内禁定义）。 */
.ul-pills__sep { width: 1px; align-self: stretch; margin: 7px 6px 7px 2px; background: color-mix(in srgb, currentColor 18%, transparent); }
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
.u-c-paths { width: 104px; }
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

/* ================= D3 表格增强：用户列设置菜单 ================= */

</style>
