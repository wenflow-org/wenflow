<template>
  <div class="mk-page">
    <div class="mk-status" :class="users.length ? 'mk-status--ok' : 'mk-status--muted'">
      <span class="mk-status__dot"></span>
      <strong class="mk-status__title">{{ users.length ? '用户体系正常' : '还没有真实用户' }}</strong>
      <span class="mk-status__sep"></span>
      <span class="mk-status__meta">共 {{ users.length }} 人</span>
      <span class="mk-status__meta">管理员 {{ adminCount }}</span>
      <span class="mk-status__meta">当前在线 {{ activeToday }}</span>
      <span v-if="isLive && registrationEnabled !== null" class="mk-status__meta" :class="registrationEnabled ? '' : 'ul-reg--closed'">
        注册{{ registrationEnabled ? '开放' : '关闭' }}
      </span>
      <span v-if="isLive && liveUsersTotal > users.length" class="mk-status__meta ul-truncated" :title="`后端共 ${liveUsersTotal} 人，列表仅加载前 ${users.length} 行`">
        已截断 · 共 {{ liveUsersTotal }} 人
      </span>
      <button type="button" class="mk-status__action mk-status__action--primary" @click="openCreate">新建用户</button>
    </div>

    <div v-if="toast" class="mk-toast" :class="toastCls">{{ toast }}</div>

    <div class="mk-card">
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
        </div>
        <span class="mk-card__meta">{{ filtered.length }} / {{ users.length }} 人</span>
      </div>

      <MockSkeletonTable v-if="liveLoading && !users.length" :cols="6" />
      <div v-else-if="filtered.length" class="mk-table-scroll">
        <table class="mk-table">
          <thead>
            <tr>
              <th v-if="isLive" style="width:32px">
                <input type="checkbox" :checked="allChecked" @change="toggleAll" />
              </th>
              <th>用户</th>
              <th>角色</th>
              <th class="ul-th-num">路径 / 会话</th>
              <th>注册时间</th>
              <th>最后登录</th>
              <th style="text-align:right">操作</th>
            </tr>
          </thead>
        <tbody>
          <tr v-for="u in shown" :key="u.id" class="ul-row" @click="openSubPage('user', u.id)">
            <td v-if="isLive"><input v-model="selected" type="checkbox" :value="u.id" @click.stop /></td>
            <td>
              <div class="mk-cell-main">
                <strong>{{ u.name }}</strong>
                <span class="mk-cell-sub">{{ u.email }}</span>
              </div>
              <div class="ul-tags">
                <span v-if="isSelf(u)" class="ul-tag ul-tag--self">当前管理员</span>
                <span v-else-if="isTestAccount(u)" class="ul-tag ul-tag--test">测试账号</span>
              </div>
            </td>
            <td><span class="mk-badge" :class="u.admin ? 'mk-badge--info' : 'mk-badge--muted'">{{ u.admin ? '管理员' : '用户' }}</span></td>
            <td class="mk-num">{{ u.paths }} / {{ u.sessions }}</td>
            <td><span :class="u.createdAt === '从未' ? 'mk-na' : ''">{{ u.createdAt }}</span></td>
            <td><span :class="u.lastLogin === '从未' ? 'mk-na' : ''">{{ u.lastLogin }}</span></td>
            <td>
              <div class="mk-actions">
                <button type="button" class="mk-link" @click="openSubPage('user', u.id)">详情</button>
                <div v-if="isLive" class="mk-menu">
                  <button type="button" class="mk-menu__btn" aria-label="更多操作" @click.stop="toggleMenu(u.id)">⋯</button>
                  <div v-if="openMenu === u.id" class="mk-menu__pop" @click.stop>
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
                  </div>
                </div>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
      </div>

      <div v-else class="mk-empty">
        <strong>没有匹配的用户</strong>
        <span>放宽筛选条件，或邀请第一位真实用户。</span>
      </div>
      <div v-if="canMore" class="ul-more">
        <button type="button" class="mk-link" @click="loadMore">加载更多（已显示 {{ shown.length }} / {{ filtered.length }} 人）</button>
      </div>
    </div>

    <!-- 批量操作条 -->
    <div v-if="isLive && selected.length" class="ul-batch">
      <span>已选 {{ selected.length }} 人</span>
      <button type="button" class="mk-link" @click="selected = []">取消选择</button>
      <button type="button" class="ul-batch__danger" :disabled="batchBusy" @click="batchDelete">
        {{ batchBusy ? '删除中…' : '批量删除' }}
      </button>
    </div>

    <!-- 新建/编辑用户 -->
    <div v-if="createOpen" ref="maskRef" class="mk-modal">
      <div ref="panelRef" class="mk-modal__panel" role="dialog" :aria-label="editTarget ? '编辑用户' : '新建用户'">
        <div class="mk-modal__head">
          <h3 class="mk-modal__title">{{ editTarget ? `编辑用户 · ${editTarget.name}` : '新建用户' }}</h3>
          <button type="button" class="mk-modal__close" aria-label="关闭" @click="createOpen = false">✕</button>
        </div>
        <div class="mk-modal__body">
          <label class="mk-field" :class="{ 'mk-field--error': errors.name }">
            <span class="mk-field__label">昵称</span>
            <input v-model="form.name" class="mk-field__input" placeholder="例如 陈晓" />
            <span v-if="errors.name" class="mk-field__err">{{ errors.name }}</span>
          </label>
          <label class="mk-field" :class="{ 'mk-field--error': errors.email }">
            <span class="mk-field__label">邮箱</span>
            <input v-model="form.email" class="mk-field__input" placeholder="name@example.com" />
            <span v-if="errors.email" class="mk-field__err">{{ errors.email }}</span>
          </label>
          <label v-if="isLive" class="mk-field" :class="{ 'mk-field--error': errors.password }">
            <span class="mk-field__label">{{ editTarget ? '重置密码' : '初始密码' }}</span>
            <input v-model="form.password" type="password" class="mk-field__input" :placeholder="editTarget ? '留空则不修改' : '至少 6 位'" />
            <span v-if="errors.password" class="mk-field__err">{{ errors.password }}</span>
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
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { openSubPage, dataSource, intent } from './mockStore'
import { liveUsers, liveCreateUser, liveDeleteUser, liveSetUserRole, liveUsersTotal, timeAgo, errMsg, registrationEnabled, liveLoading } from './mockLive'
import { useLoadMore } from './useLoadMore'
import { useOverlay, useMaskClose } from './useOverlay'
import { useRowMenu } from './useRowMenu'
import { askConfirm } from './useConfirm'
import MockSkeletonTable from './MockSkeletonTable.vue'
import { adminUsersApi } from '@/api/adminApi'
import { useEscape } from './useEscape'

const props = defineProps<{ state: 'normal' | 'empty' }>()

const isLive = computed(() => dataSource.value === 'live')

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
/** 虚拟学习者与审计/测试账号：不参与管理员提升（无意义且有风险） */
const isTestAccount = (u: UserRow) =>
  /@test\.local$/.test(u.email) ||
  /^virtual_/.test(u.id) ||
  /^(e2e_|uxaudit_|audit_probe_|ui_check|motion_review)/i.test(u.name)

interface UserRow {
  id: string
  name: string
  email: string
  admin: boolean
  online: boolean
  createdAt: string
  lastLogin: string
  paths: number
  sessions: number
  busy?: boolean
}

const normalUsers: UserRow[] = [
  { id: 'u1', name: '陈晓', email: 'chenxiao@example.com', admin: false, online: true, createdAt: '5 个月前', lastLogin: '12 分钟前', paths: 1, sessions: 8 },
  { id: 'u2', name: '刘一帆', email: 'liu**@163.com', admin: false, online: true, createdAt: '4 个月前', lastLogin: '1 小时前', paths: 1, sessions: 3 },
  { id: 'u3', name: '王梓', email: 'wangzi@example.com', admin: false, online: false, createdAt: '6 个月前', lastLogin: '昨天 21:14', paths: 2, sessions: 11 },
  { id: 'u4', name: '赵敏', email: 'zhaomin@example.com', admin: false, online: false, createdAt: '3 个月前', lastLogin: '3 天前', paths: 1, sessions: 6 },
  { id: 'u5', name: 'admin', email: 'admin@wenflow.local', admin: true, online: true, createdAt: '8 个月前', lastLogin: '刚刚', paths: 0, sessions: 0 },
  { id: 'u6', name: '孙可', email: 'sunke@example.com', admin: false, online: false, createdAt: '2 个月前', lastLogin: '2 天前', paths: 1, sessions: 4 },
  { id: 'u7', name: '周洁', email: 'zhoujie@example.com', admin: false, online: false, createdAt: '1 个月前', lastLogin: '1 周前', paths: 1, sessions: 2 },
  { id: 'u8', name: '吴迪', email: 'wudi@example.com', admin: false, online: false, createdAt: '2 周前', lastLogin: '昨天 08:32', paths: 0, sessions: 1 },
  { id: 'u9', name: '郑爽', email: 'zhengshuang@example.com', admin: false, online: true, createdAt: '5 个月前', lastLogin: '26 分钟前', paths: 2, sessions: 9 },
  { id: 'u10', name: '冯远', email: 'fengyuan@example.com', admin: false, online: false, createdAt: '3 个月前', lastLogin: '4 小时前', paths: 1, sessions: 5 },
  { id: 'u11', name: '褚燕', email: 'chuyan@example.com', admin: false, online: false, createdAt: '3 周前', lastLogin: '从未', paths: 0, sessions: 0 },
  { id: 'u12', name: '测试账号', email: 'test@wenflow.local', admin: true, online: false, createdAt: '2 个月前', lastLogin: '从未', paths: 0, sessions: 0 }
]

const demoUsers = ref<UserRow[]>([])
watch(
  () => props.state,
  (s) => {
    demoUsers.value = s === 'empty' ? [normalUsers[4]] : [...normalUsers]
  },
  { immediate: true }
)

const users = computed<UserRow[]>(() => {
  if (isLive.value) {
    return liveUsers.value.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      admin: u.isAdmin,
      online: !!u.lastLoginAt && Date.now() - new Date(u.lastLoginAt).getTime() < 30 * 60000,
      createdAt: timeAgo(u.createdAt),
      lastLogin: timeAgo(u.lastLoginAt),
      paths: u.paths,
      sessions: u.sessions
    }))
  }
  return demoUsers.value
})

const pill = ref('all')
const keyword = ref('')
const pills = [
  { id: 'all', label: '全部' },
  { id: 'admin', label: '管理员' },
  { id: 'online', label: '近期在线' }
]

/* 新建 / 编辑用户 */
const createOpen = ref(false)
useEscape(() => createOpen.value, () => { createOpen.value = false })
const { openMenu, toggleMenu, closeMenu } = useRowMenu()

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
const form = ref({ name: '', email: '', password: '', admin: false })
const errors = ref<{ name?: string; email?: string; password?: string }>({})
const toast = ref('')
const toastCls = ref('mk-toast--ok')
let toastTimer: ReturnType<typeof setTimeout> | null = null

function showToast(msg: string, cls = 'mk-toast--ok') {
  toast.value = msg
  toastCls.value = cls
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => (toast.value = ''), 3000)
}

function openCreate() {
  editTarget.value = null
  form.value = { name: '', email: '', password: '', admin: false }
  errors.value = {}
  createOpen.value = true
}

function openEdit(u: UserRow) {
  editTarget.value = u
  form.value = { name: u.name, email: u.email, password: '', admin: u.admin }
  errors.value = {}
  createOpen.value = true
}

async function saveUser() {
  errors.value = {}
  if (!form.value.name.trim()) errors.value.name = '请输入昵称'
  if (!form.value.email.trim()) errors.value.email = '请输入邮箱'
  else if (!/^\S+@\S+\.\S+$/.test(form.value.email.trim())) errors.value.email = '邮箱格式不正确'
  if (isLive.value && !editTarget.value && form.value.password.length < 6) errors.value.password = '密码至少 6 位'
  if (isLive.value && editTarget.value && form.value.password && form.value.password.length < 6) errors.value.password = '密码至少 6 位'
  if (Object.keys(errors.value).length) return

  creating.value = true
  try {
    if (isLive.value) {
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
        showToast('用户已更新（真实写入）')
      } else {
        await liveCreateUser({
          name: form.value.name.trim(),
          email: form.value.email.trim(),
          password: form.value.password,
          admin: form.value.admin
        })
        showToast('用户已创建（真实写入）')
      }
    } else {
      demoUsers.value.unshift({
        id: `u${Date.now() % 100000}`,
        name: form.value.name.trim(),
        email: form.value.email.trim(),
        admin: form.value.admin,
        online: false,
        createdAt: '刚刚',
        lastLogin: '从未',
        paths: 0,
        sessions: 0
      })
      showToast('用户已创建，出现在列表顶部')
    }
    createOpen.value = false
    pill.value = 'all'
  } catch (e) {
    showToast(`保存失败：${errMsg(e)}`, 'mk-toast--bad')
  } finally {
    creating.value = false
  }
}

/* 批量删除 */
const selected = ref<string[]>([])
const batchBusy = ref(false)
const allChecked = computed(() => filtered.value.length > 0 && selected.value.length === filtered.value.length)

function toggleAll() {
  selected.value = allChecked.value ? [] : filtered.value.map((u) => u.id)
}

async function batchDelete() {
  if (!selected.value.length || batchBusy.value) return
  const ok = await askConfirm({
    title: '批量删除用户',
    message: `确认批量删除 ${selected.value.length} 个用户？该操作不可撤销，将同时删除其学习记录。`,
    confirmText: `删除 ${selected.value.length} 个用户`
  })
  if (!ok) return
  batchBusy.value = true
  try {
    await adminUsersApi.batchDeleteUsers([...selected.value])
    const removed = new Set(selected.value)
    liveUsers.value = liveUsers.value.filter((u) => !removed.has(u.id))
    showToast(`已删除 ${selected.value.length} 个用户`)
    selected.value = []
  } catch (e) {
    showToast(`批量删除失败：${errMsg(e)}`, 'mk-toast--bad')
  } finally {
    batchBusy.value = false
  }
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
    showToast(`「${u.name}」已${targetAdmin ? '设为管理员' : '降为用户'}`)
  } catch (e) {
    showToast(`操作失败：${errMsg(e)}`, 'mk-toast--bad')
  } finally {
    u.busy = false
  }
}

async function removeUser(u: UserRow) {
  const ok = await askConfirm({
    title: '删除用户',
    message: `确认删除用户「${u.name}」（${u.email}）？\n该操作不可撤销，将同时删除其学习记录。`,
    confirmText: '删除'
  })
  if (!ok) return
  u.busy = true
  try {
    await liveDeleteUser(u.id)
    showToast(`「${u.name}」已删除`)
  } catch (e) {
    showToast(`删除失败：${errMsg(e)}`, 'mk-toast--bad')
  } finally {
    u.busy = false
  }
}

const adminCount = computed(() => users.value.filter((u) => u.admin).length)
const activeToday = computed(() => users.value.filter((u) => u.online).length)

const filtered = computed(() =>
  users.value.filter((u) => {
    if (pill.value === 'admin' && !u.admin) return false
    if (pill.value === 'online' && !u.online) return false
    const q = keyword.value.trim().toLowerCase()
    if (q && !`${u.name} ${u.email} ${u.id}`.toLowerCase().includes(q)) return false
    return true
  })
)

/* 长列表分批渲染：每批 15 行 */
const { shown, canMore, loadMore } = useLoadMore(filtered, 15)
</script>

<style scoped>
.mk-link--danger { color: var(--mk-red, #dc2626); }
.mk-toast--bad { background: var(--mk-red-bg, #fef2f2); color: var(--mk-red, #dc2626); }
.ul-row { cursor: pointer; }
.ul-row:hover { background: #f6f9ff; }
.ul-batch {
  position: sticky;
  bottom: 12px;
  display: flex;
  align-items: center;
  gap: 10px;
  width: fit-content;
  margin: 0 auto;
  padding: 8px 12px 8px 16px;
  border-radius: 999px;
  border: 1px solid rgba(220, 38, 38, 0.25);
  background: var(--mk-surface);
  box-shadow: 0 12px 32px rgba(15, 23, 42, 0.16);
  font-weight: 600;
  font-size: 12.5px;
}
.ul-batch__danger {
  padding: 6px 14px;
  border-radius: 999px;
  border: 0;
  background: var(--mk-red, #dc2626);
  color: #fff;
  font: inherit;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
}
.ul-batch__danger:disabled { opacity: 0.6; }
.ul-reg--closed { color: var(--mk-amber); font-weight: 700; }
.ul-truncated { color: var(--mk-amber); font-weight: 700; }
.ul-tags { display: flex; gap: 6px; margin-top: 2px; }
.ul-tag {
  padding: 1px 8px;
  border-radius: 999px;
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.03em;
}
.ul-tag--self { background: #dbeafe; color: #1f57cc; }
.ul-tag--test { background: #fef3c7; color: #b45309; }
.ul-more {
  display: flex;
  justify-content: center;
  padding: 10px 0 12px;
  border-top: 1px dashed var(--mk-line);
}

/* 数值列（路径/会话）表头与单元格居中；类选择器不受 live 勾选列影响 */
.mk-table td.mk-num,
.mk-table th.ul-th-num { text-align: center; }
</style>
