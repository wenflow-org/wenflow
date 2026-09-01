<template>
  <div class="mk-page mk-page--fill">
    <div class="mk-status" :class="users.length ? 'mk-status--ok' : 'mk-status--muted'">
      <span class="mk-status__dot"></span>
      <strong class="mk-status__title">用户</strong>
      <span class="mk-status__sep"></span>
      <span class="mk-status__meta" :title="isLive ? '后端共 ' + liveUsersTotal + ' 人，列表仅加载前 ' + users.length + ' 行' : undefined">
        共 {{ users.length }} 人
      </span>
      <span v-if="isLive && pill !== 'deleted'" class="mk-status__meta" title="仅真实用户（不含模拟账号）；切换「含模拟」后显示全量并灰标模拟行">
        真实 {{ realUsers }}
      </span>
      <span v-if="isLive && pill !== 'deleted' && includeTest" class="mk-status__meta" title="全量口径：含虚拟学习者与测试/审计账号（行内带标记）">测试/虚拟 {{ users.length - realUsers }}</span>
      <span v-if="isLive && pill !== 'deleted'" class="mk-status__meta" :title="`管理员 ${adminCount} · 当前在线 ${activeToday}${registrationEnabled !== null ? ' · 注册' + (registrationEnabled ? '开放' : '关闭') : ''}`">
        在线 {{ activeToday }}
      </span>
      <span class="mk-status__actions">
        <button type="button" class="mk-status__action mk-status__action--primary" @click="openCreate">新建用户</button>
      </span>
    </div>


    <div class="mk-card mk-card--fill">
      <div class="mk-card__head">
        <div class="mk-filter">
          <div class="mk-pills">
            <button
              v-for="p in pills"
              :key="p.id"
              type="button"
              class="mk-pill"
              :class="{ 'mk-pill--active': pill === p.id }"
              @click="pill = p.id"
            >
              {{ p.label }}
            </button>
          </div>
          <input class="mk-filter__input" v-model="keyword" placeholder="搜索昵称 / 邮箱 / ID" />
          <select v-model="roleFilter" class="mk-filter__select" aria-label="按角色筛选">
            <option value="">全部角色</option>
            <option value="admin">管理员</option>
            <option value="user">普通用户</option>
          </select>
        </div>
        <div class="mk-card__head-right">
          <DataScopeToggle v-if="isLive && pill !== 'deleted'" v-model="includeTest" />
          <MkCols
            :col-defs="ulColDefs"
            storage-key="wf_users_hidden_cols"
            v-model:hidden="hiddenCols"
          />
          <span class="mk-card__meta">{{ filtered.length }} / {{ users.length }} 人</span>
        </div>
      </div>

      <MockSkeletonTable v-if="liveLoading && !users.length || (deletedLoading && !users.length)" :cols="7" />
      <div v-else-if="loadFailed" class="mk-empty">
        <span class="mk-empty__icon" aria-hidden="true">◌</span>
        <strong>数据加载失败</strong>
        <span>无法从后端拉取用户列表。</span>
        <button type="button" class="mk-empty__action" @click="retryLoad">重试</button>
      </div>
      <div v-else-if="filtered.length" class="mk-table-scroll">
        <table class="mk-table mk-table--fixed">
          <thead>
            <tr>
              <th v-if="isLive && !hiddenCols.has('check')" scope="col" style="width:32px">
                <input type="checkbox" aria-label="全选" :checked="allChecked" @change="toggleAll" />
              </th>
              <th scope="col" style="width:200px">用户</th>
              <th v-if="!hiddenCols.has('role')" scope="col" style="width:90px">角色</th>
              <th v-if="!hiddenCols.has('level')" scope="col" style="width:100px">等级 / XP</th>
              <th v-if="!hiddenCols.has('paths')" scope="col" class="mk-th--right" style="width:90px">路径 / 会话</th>
              <!-- 相对时间列固定宽（--mk-col-time-full 110px，防 1920 全列等比放大 42% 与刷新跳动） -->
              <th v-if="!hiddenCols.has('created')" scope="col" class="mk-col--time-full">注册时间</th>
              <th v-if="!hiddenCols.has('lastlogin')" scope="col" class="mk-col--time-full">最后登录</th>
              <th scope="col" class="mk-th--right mk-col--actions-wide">操作</th>
            </tr>
          </thead>
        <tbody>
          <tr v-for="u in paged" :key="u.id" class="ul-row" :class="{ 'ul-row--deleted': u.deleted }" @click="openSubPage('user', u.id)">
            <td v-if="isLive && !hiddenCols.has('check')"><input v-model="selected" type="checkbox" :value="u.id" :disabled="u.deleted || isTestAccount(u)" :aria-label="`选择 ${u.name}`" @click.stop /></td>
            <td>
              <div class="mk-cell-main">
                <strong>{{ u.name }}</strong>
                <span class="mk-cell-sub">{{ u.email }}</span>
              </div>
              <div class="ul-tags">
                <span v-if="u.deleted" class="mk-badge mk-badge--sm mk-badge--deleted" :title="u.deletedAt ? `删除于 ${u.deletedAt}` : undefined">已删除</span>
                <span v-else-if="isSelf(u)" class="mk-badge mk-badge--sm mk-badge--self">当前管理员</span>
                <span v-else-if="u.isVirtualLearner" class="mk-badge mk-badge--sm mk-badge--virtual" title="虚拟学习者（仿真数据，可再生成）">虚拟</span>
                <span v-else-if="isTestAccount(u)" class="mk-badge mk-badge--sm mk-badge--warn">测试账号</span>
              </div>
            </td>
            <td v-if="!hiddenCols.has('role')"><span class="mk-badge" :class="u.admin ? 'mk-badge--info' : 'mk-badge--muted'">{{ u.admin ? '管理员' : '用户' }}</span></td>
            <td v-if="!hiddenCols.has('level')">
              <div class="ul-level">
                <span class="ul-level__badge" :title="`XP 推导等级 ${levelFromXp(u.xp)}`">{{ levelLabel(u.xp) }}</span>
                <span class="ul-level__xp" :class="{ 'mk-na': u.xp === 0 }">{{ u.xp }} XP</span>
              </div>
            </td>
            <td v-if="!hiddenCols.has('paths')" class="mk-num">{{ u.paths }} / {{ u.sessions }}</td>
            <td v-if="!hiddenCols.has('created')"><span :class="u.createdAt === '从未' ? 'mk-na' : ''">{{ u.createdAt }}</span></td>
            <td v-if="!hiddenCols.has('lastlogin')"><span :class="u.lastLogin === '从未' ? 'mk-na' : ''">{{ u.lastLogin }}</span></td>
            <td>
              <div class="mk-actions">
                <button type="button" class="mk-icon-btn" title="详情" @click.stop="openSubPage('user', u.id)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M6 21v-1a6 6 0 0 1 12 0v1"/></svg></button>
                <div v-if="isLive" class="mk-menu">
                  <button type="button" class="mk-menu__btn" aria-label="更多操作" aria-haspopup="menu" :aria-expanded="menuOpen" @click.stop="toggleMenu(u.id)">⋯</button>
                  <div v-if="openMenu === u.id" class="mk-menu__pop" :style="popStyle" @click.stop>
                    <button v-if="u.deleted" type="button" class="mk-menu__item" :disabled="u.busy" @click="menuRestore(u)">恢复</button>
                    <template v-else>
                      <button type="button" class="mk-menu__item" :disabled="u.busy" @click="menuEdit(u)">编辑</button>
                      <button
                        v-if="!isSelf(u) && !isTestAccount(u)"
                        type="button"
                        class="mk-menu__item"
                        :class="{ 'mk-menu__item--danger': u.admin }"
                        :disabled="u.busy"
                        @click="menuRole(u)"
                      >{{ u.admin ? '降为用户' : '设为管理员' }}</button>
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

      <div v-else class="mk-empty">
        <strong>{{ isFiltered ? '没有匹配的用户' : '暂无真实用户' }}</strong>
        <span>{{ isFiltered ? '放宽筛选条件试试。' : '用户注册后将自动出现在这里。' }}</span>
        <button v-if="isFiltered" type="button" class="mk-empty__action" @click="clearFilters">清除筛选</button>
      </div>
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
      <span>已选 {{ selected.length }} 人</span>
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
          <button type="button" class="mk-modal__close" aria-label="关闭" @click="createOpen = false">✕</button>
        </div>
        <div class="mk-modal__body">
          <label class="mk-field" :class="{ 'mk-field--error': errors.name }">
            <span class="mk-field__label">昵称 <em class="mk-field__req">*</em></span>
            <input v-model="form.name" class="mk-field__input" placeholder="例如 陈晓" />
            <span v-if="errors.name" class="mk-field__err">{{ errors.name }}</span>
          </label>
          <label class="mk-field" :class="{ 'mk-field--error': errors.email }">
            <span class="mk-field__label">邮箱 <em class="mk-field__req">*</em></span>
            <input v-model="form.email" class="mk-field__input" placeholder="name@example.com" />
            <span v-if="errors.email" class="mk-field__err">{{ errors.email }}</span>
          </label>
          <label v-if="isLive" class="mk-field" :class="{ 'mk-field--error': errors.password }">
            <span class="mk-field__label">{{ editTarget ? '重置密码' : '初始密码' }} <em class="mk-field__req">*</em></span>
            <input v-model="form.password" type="password" class="mk-field__input" :placeholder="editTarget ? '留空则不修改' : '至少 8 位，含字母和数字'" />
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
          <button type="button" class="mk-btn" @click="createOpen = false">取消</button>
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
import { liveUsers, liveCreateUser, liveDeleteUser, liveSetUserRole, liveUsersTotal, liveSetUsersIncludeTest, timeAgo, errMsg, registrationEnabled, liveLoading, liveFailures, loadLiveData } from './live'
import { useOverlay, useMaskClose } from './useOverlay'
import { useRowMenu } from './useRowMenu'
import { askConfirm } from './useConfirm'
import MockSkeletonTable from './SkeletonTable.vue'
import Pagination from './Pagination.vue'
import DataScopeToggle from './DataScopeToggle.vue'
import MkCols from './MkCols.vue'
import { adminUsersApi, getDeletedUsers, restoreUser } from '@/api/adminApi'
import { useEscape } from './useEscape'
import { toast } from '@/utils/toast'
import { isTestAccountUser, levelFromXp, levelLabel } from './learner-profile'

/** 与后端 validatePasswordRule 一致：≥8 位且同时包含字母和数字 */
const PASSWORD_RULE = /^(?=.*[A-Za-z])(?=.*\d).{8,}$/

/* 当前登录管理员（保护自己不被降级/删除） */
const currentAdmin = computed(() => {
  const raw = localStorage.getItem('admin_user') || sessionStorage.getItem('admin_user')
  if (!raw) return { id: '', name: 'admin', email: 'admin@wenflow.local' }
  try {
    const d = JSON.parse(raw)
    return { id: String(d.id || ''), name: String(d.name || ''), email: String(d.email || '') }
  } catch {
    return { id: '', name: 'admin', email: 'admin@wenflow.local' }
  }
})
const isSelf = (u: UserRow) =>
  u.id === currentAdmin.value.id ||
  u.email === currentAdmin.value.email ||
  (!!currentAdmin.value.name && u.name === currentAdmin.value.name)
/** 虚拟学习者与审计/测试账号：不参与管理员提升（无意义且有风险）；识别逻辑单点见 learner-profile.ts */
const isTestAccount = isTestAccountUser

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
    const res = await getDeletedUsers({ limit: 50 })
    const body = res.data?.data ?? res.data ?? {}
    const items = body.users || body.items || []
    deletedUsers.value = items.map(mapDeletedRow)
  } catch {
    deletedUsers.value = []
  } finally {
    deletedLoading.value = false
  }
}

const users = computed<UserRow[]>(() => {
  if (pill.value === 'deleted') return deletedUsers.value
  return liveUsers.value.map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    admin: u.isAdmin,
    online: !!u.lastLoginAt && Date.now() - new Date(u.lastLoginAt).getTime() < 30 * 60000,
    isVirtualLearner: u.isVirtualLearner,
    isTestAccount: u.isTestAccount,
    createdAt: timeAgo(u.createdAt),
    lastLogin: timeAgo(u.lastLoginAt),
    paths: u.paths,
    sessions: u.sessions,
    xp: u.xp,
    currentLevel: u.currentLevel
  }))
})

const pill = ref('all')
const keyword = ref('')
const roleFilter = ref('')

/* 数据隔离（A3）：默认仅真实（排除虚拟/测试账号）；切换「含虚拟·测试」后按新口径重拉并灰标虚拟/测试行 */
const includeTest = ref(false)
watch(includeTest, (v) => {
  if (isLive.value && pill.value !== 'deleted') void liveSetUsersIncludeTest(v)
})

/* D3 表格增强：列显隐（公共组件 MkCols 接管：菜单 + localStorage 持久化；6 列可隐藏，用户/操作列固定） */
const ulColDefs = [
  { key: 'check', label: '选择框', title: '批量操作选择框' },
  { key: 'role', label: '角色', title: '管理员 / 用户' },
  { key: 'level', label: '等级 / XP', title: 'XP 推导等级' },
  { key: 'paths', label: '路径 / 会话', title: '学习路径数 / 会话数' },
  { key: 'created', label: '注册时间', title: '账号创建时间' },
  { key: 'lastlogin', label: '最后登录', title: '最近登录时间' },
] as const
const hiddenCols = ref<Set<string>>(new Set())

/** 真实用户数（排除测试/虚拟账号；口径标注用，与总览「总用户」对齐的近似值——列表为前 50 行样本） */
const realUsers = computed(() => users.value.filter((u) => !u.deleted && !isTestAccountUser(u)).length)

/** live 用户域拉取失败（且列表为空）→ 错误态；空态只在真正无数据时展示 */
const loadFailed = computed(
  () => isLive.value && !liveLoading.value && !!liveFailures.value.users && !liveUsers.value.length
)
function retryLoad() {
  void loadLiveData()
}
const pills = [
  { id: 'all', label: '全部' },
  { id: 'admin', label: '管理员' },
  { id: 'online', label: '近期在线' },
  { id: 'deleted', label: '已删除' }
]

/* Phase 2：切到「已删除」pill 时拉取已删列表（live 模式）；恢复/删除后回「全部」保持一致性 */
watch(pill, (p) => {
  if (p === 'deleted' && isLive.value) void loadDeletedUsers()
})

/* 新建 / 编辑用户 */
const createOpen = ref(false)
useEscape(() => createOpen.value, () => { createOpen.value = false })
const { openMenu, toggleMenu, closeMenu, menuOpen, popStyle } = useRowMenu()

/** 行内 ⋯ 菜单项：先关菜单再执行 */
function menuEdit(u: UserRow) {
  closeMenu()
  openEdit(u)
}
function menuRole(u: UserRow) {
  closeMenu()
  void toggleRole(u)
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
useMaskClose(maskRef, () => { createOpen.value = false })

/* 命令面板快捷动作：直达并打开新建弹窗 */
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
const creating = ref(false)
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
  if (isLive.value && !editTarget.value && !PASSWORD_RULE.test(form.value.password)) errors.value.password = '密码至少 8 位，且同时包含字母和数字'
  if (isLive.value && editTarget.value && form.value.password && !PASSWORD_RULE.test(form.value.password)) errors.value.password = '密码至少 8 位，且同时包含字母和数字'
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
      toast.success('用户已更新（真实写入）')
    } else {
      await liveCreateUser({
        name: form.value.name.trim(),
        email: form.value.email.trim(),
        password: form.value.password,
        admin: form.value.admin
      })
      toast.success('用户已创建（真实写入）')
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
const selectable = computed(() => filtered.value.filter((u) => !isTestAccount(u) && !u.deleted))
const allChecked = computed(() => selectable.value.length > 0 && selected.value.length === selectable.value.length)

function toggleAll() {
  selected.value = allChecked.value ? [] : selectable.value.map((u) => u.id)
}

async function batchDelete() {
  const ids = selected.value.filter((id) => {
    const u = users.value.find((x) => x.id === id)
    return u ? !isTestAccount(u) : false
  })
  if (!ids.length || batchBusy.value) return
  const ok = await askConfirm({
    title: '批量删除用户',
    message: `确认批量删除 ${ids.length} 个用户？删除后用户将无法登录，历史数据保留，可在后台恢复。`,
    confirmText: `删除 ${ids.length} 个用户`
  })
  if (!ok) return
  batchBusy.value = true
  try {
    await adminUsersApi.batchDeleteUsers([...ids])
    const removed = new Set(ids)
    liveUsers.value = liveUsers.value.filter((u) => !removed.has(u.id))
    toast.success(`已删除 ${ids.length} 个用户`)
    selected.value = []
  } catch (e) {
    toast.error(`批量删除失败：${errMsg(e)}`)
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
    const s = String(v ?? '')
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const header = ['姓名', '邮箱', '角色', '等级/XP', '路径/会话', '注册时间', '最后登录', '类型']
  const lines = rows.map((u) =>
    [
      esc(u.name),
      esc(u.email),
      u.admin ? '管理员' : '用户',
      `${levelLabel(u.xp)} / ${u.xp}`,
      `${u.paths} / ${u.sessions}`,
      esc(u.createdAt || ''),
      esc(u.lastLogin || ''),
      u.deleted ? '已删除' : u.isVirtualLearner ? '虚拟' : isTestAccount(u) ? '测试' : '真实',
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

async function toggleRole(u: UserRow) {
  const targetAdmin = !u.admin
  const verb = targetAdmin ? '设为管理员' : '降为普通用户'
  const ok = await askConfirm({
    title: `${verb}「${u.name}」`,
    message: targetAdmin
      ? `确认将「${u.name}」设为管理员？该用户将获得全部管理权限。`
      : `确认将「${u.name}」降为普通用户？将失去管理后台访问权限。`,
    confirmText: verb,
    danger: !targetAdmin
  })
  if (!ok) return
  u.busy = true
  try {
    await liveSetUserRole(u.id, targetAdmin)
    toast.success(`「${u.name}」已${targetAdmin ? '设为管理员' : '降为用户'}`)
  } catch (e) {
    toast.error(`操作失败：${errMsg(e)}`)
  } finally {
    u.busy = false
  }
}

async function removeUser(u: UserRow) {
  const ok = await askConfirm({
    title: '删除用户',
    message: `确认删除用户「${u.name}」（${u.email}）？\n删除后用户将无法登录，历史数据保留，可在后台恢复。`,
    confirmText: '删除'
  })
  if (!ok) return
  u.busy = true
  try {
    await liveDeleteUser(u.id)
    toast.success(`「${u.name}」已删除`)
  } catch (e) {
    toast.error(`删除失败：${errMsg(e)}`)
  } finally {
    u.busy = false
  }
}

/** Phase 2：恢复已软删用户（身份保留策略下无需查重，后端直接清空 deletedAt/deletedBy） */
async function restoreUserRow(u: UserRow) {
  const ok = await askConfirm({
    title: '恢复用户',
    message: `确认恢复用户「${u.name}」（${u.email}）？\n恢复后该用户可重新登录，历史数据原样保留。`,
    confirmText: '恢复'
  })
  if (!ok) return
  u.busy = true
  try {
    await restoreUser(u.id)
    toast.success(`「${u.name}」已恢复`)
    deletedUsers.value = deletedUsers.value.filter((x) => x.id !== u.id)
  } catch (e) {
    toast.error(`恢复失败：${errMsg(e)}`)
  } finally {
    u.busy = false
  }
}

const adminCount = computed(() => users.value.filter((u) => u.admin).length)
const activeToday = computed(() => users.value.filter((u) => u.online).length)

const filtered = computed(() =>
  users.value.filter((u) => {
    if (pill.value === 'deleted' && !u.deleted) return false
    if (pill.value === 'admin' && !u.admin) return false
    if (pill.value === 'online' && !u.online) return false
    if (roleFilter.value === 'admin' && !u.admin) return false
    if (roleFilter.value === 'user' && u.admin) return false
    const q = keyword.value.trim().toLowerCase()
    if (q && !`${u.name} ${u.email} ${u.id}`.toLowerCase().includes(q)) return false
    return true
  })
)

/* 客户端分页（P2：替代「加载更多」——统一 mk-pagination 页码器）：
   数据全量在客户端（live 拉取），筛选后按页切片；
   筛选/数据源变化自动回第 1 页（watch filtered） */
const page = ref(1)
const pageSize = ref(15)
const paged = computed(() => {
  const start = (page.value - 1) * pageSize.value
  return filtered.value.slice(start, start + pageSize.value)
})
watch(filtered, () => {
  page.value = 1
})

const isFiltered = computed(() => pill.value !== 'all' || !!keyword.value.trim() || !!roleFilter.value)
function clearFilters() {
  pill.value = 'all'
  keyword.value = ''
  roleFilter.value = ''
}
</script>

<style scoped>
.ul-row { cursor: pointer; }
.ul-row--deleted { opacity: 0.62; filter: saturate(0.2); }
.ul-tag--deleted { background: #e5e7eb; color: #4b5563; }
.ul-tags { display: flex; gap: 6px; margin-top: 2px; }
.ul-tag {
  padding: 1px 8px;
  border-radius: 999px;
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.03em;
}
.ul-tag--self { background: #dbeafe; color: var(--mk-accent-deep, #1f57cc); }
.ul-tag--test { background: #fef3c7; color: #b45309; }
.ul-tag--virtual { background: #f1f5f9; color: #64748b; border: 1px dashed #cbd5e1; }
.ul-level { display: flex; align-items: center; gap: 6px; }
.ul-level__badge {
  padding: 1px 8px;
  border-radius: 999px;
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.03em;
  background: #e0f2fe;
  color: #0369a1;
  cursor: help;
}
.ul-level__xp { font-variant-numeric: tabular-nums; font-size: 12px; color: var(--mk-muted); font-weight: 600; }

@media (min-width: 2000px) {
  .ul-tags { gap: 7px; margin-top: 3px; }
  .ul-tag { font-size: 12px; padding: 2px 10px; }
}
@media (min-width: 2800px) {
  .ul-tags { gap: 8px; margin-top: 4px; }
  .ul-tag { font-size: 14px; padding: 3px 12px; }
}

/* ================= 暗色模式（D1）：用户页局部覆写 ================= */
html[data-theme='dark'] {
  .ul-level__badge { background: rgba(91, 141, 239, 0.2); color: #9db8f5; }
  .ul-tag--self { background: rgba(91, 141, 239, 0.22); color: #9db8f5; }
  .ul-tag--test { background: rgba(251, 191, 36, 0.16); color: #fcd34d; }
  .ul-tag--virtual { background: #1c2637; color: #8fa3bd; border-color: #33415c; }
  .ul-tag--deleted { background: #252d3d; color: #94a3b8; }
  /* 表格行内复选框：暗色下自定义外观（原生 checkbox 边框过亮） */
  .mk-table input[type='checkbox'] {
    appearance: none;
    width: 14px;
    height: 14px;
    border: 1.5px solid #4a5874;
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
    border: solid #fff;
    border-width: 0 2px 2px 0;
    transform: rotate(45deg);
  }
}

/* ================= D3 表格增强：用户列设置菜单 ================= */
.ul-cols { position: relative; display: inline-flex; }
.ul-cols__menu {
  position: absolute;
  right: 0;
  top: calc(100% + 4px);
  z-index: var(--mk-z-menu);
  min-width: 150px;
  padding: 6px;
  display: grid;
  gap: 2px;
  background: var(--mk-surface, #fff);
  border: 1px solid var(--mk-line);
  border-radius: 10px;
  box-shadow: var(--mk-shadow-pop);
}
.ul-cols__item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: 7px;
  font-size: 12.5px;
  color: var(--mk-muted);
  cursor: pointer;
  white-space: nowrap;
  user-select: none;
}
.ul-cols__item:hover { background: #f0f5ff; }
html[data-theme='dark'] .ul-cols__item:hover { background: #1f2b40; }
.ul-cols__item input { accent-color: var(--mk-blue, #2c63d0); }
.ul-cols__reset {
  margin-top: 4px;
  border: 0;
  background: transparent;
  padding: 6px 8px;
  border-radius: 7px;
  border-top: 1px dashed var(--mk-line);
  font: inherit;
  font-size: 12px;
  font-weight: 700;
  color: var(--mk-blue);
  cursor: pointer;
  text-align: left;
}
.ul-cols__reset:hover { background: #eff6ff; }
html[data-theme='dark'] .ul-cols__reset:hover { background: #1f2b40; }
</style>
