<template>
  <div class="mk-page">
    <div class="mk-status" :class="users.length ? 'mk-status--ok' : 'mk-status--muted'">
      <span class="mk-status__dot"></span>
      <strong class="mk-status__title">{{ users.length ? '用户体系正常' : '还没有真实用户' }}</strong>
      <span class="mk-status__sep"></span>
      <span class="mk-status__meta">共 {{ users.length }} 人</span>
      <span class="mk-status__meta">管理员 {{ adminCount }}</span>
      <span class="mk-status__meta">今日活跃 {{ activeToday }}</span>
      <button type="button" class="mk-status__action mk-status__action--primary" @click="createOpen = true">新建用户</button>
    </div>

    <div v-if="toast" class="mk-toast mk-toast--ok">✓ {{ toast }}</div>

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

      <table v-if="filtered.length" class="mk-table">
        <thead>
          <tr>
            <th>用户</th>
            <th>角色</th>
            <th>登录状态</th>
            <th>最后登录</th>
            <th style="text-align:right">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="u in filtered" :key="u.id">
            <td>
              <div class="mk-cell-main">
                <strong>{{ u.name }}</strong>
                <span class="mk-cell-sub">{{ u.email }}</span>
              </div>
            </td>
            <td><span class="mk-badge" :class="u.admin ? 'mk-badge--info' : 'mk-badge--muted'">{{ u.admin ? '管理员' : '用户' }}</span></td>
            <td><span class="mk-badge" :class="u.online ? 'mk-badge--ok' : 'mk-badge--muted'">{{ u.online ? '已登录' : '未登录' }}</span></td>
            <td><span :class="u.lastLogin === '从未' ? 'mk-na' : ''">{{ u.lastLogin }}</span></td>
            <td>
              <div class="mk-actions">
                <button type="button" class="mk-link" @click="openSubPage('user', u.id)">详情</button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>

      <div v-else class="mk-empty">
        <strong>没有匹配的用户</strong>
        <span>放宽筛选条件，或邀请第一位真实用户。</span>
      </div>
    </div>

    <!-- 新建用户 -->
    <div v-if="createOpen" class="mk-modal" @mousedown.self="createOpen = false">
      <div class="mk-modal__panel" role="dialog" aria-label="新建用户">
        <div class="mk-modal__head">
          <h3 class="mk-modal__title">新建用户</h3>
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
          <button type="button" class="mk-btn mk-btn--primary" @click="createUser">创建</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { openSubPage } from './mockStore'

const props = defineProps<{ state: 'normal' | 'empty' }>()

interface UserRow {
  id: string
  name: string
  email: string
  admin: boolean
  online: boolean
  lastLogin: string
}

const normalUsers: UserRow[] = [
  { id: 'u1', name: '陈晓', email: 'chenxiao@example.com', admin: false, online: true, lastLogin: '12 分钟前' },
  { id: 'u2', name: '刘一帆', email: 'liu**@163.com', admin: false, online: true, lastLogin: '1 小时前' },
  { id: 'u3', name: '王梓', email: 'wangzi@example.com', admin: false, online: false, lastLogin: '昨天 21:14' },
  { id: 'u4', name: '赵敏', email: 'zhaomin@example.com', admin: false, online: false, lastLogin: '3 天前' },
  { id: 'u5', name: 'admin', email: 'admin@wenflow.local', admin: true, online: true, lastLogin: '刚刚' },
  { id: 'u6', name: '孙可', email: 'sunke@example.com', admin: false, online: false, lastLogin: '2 天前' },
  { id: 'u7', name: '周洁', email: 'zhoujie@example.com', admin: false, online: false, lastLogin: '1 周前' },
  { id: 'u8', name: '吴迪', email: 'wudi@example.com', admin: false, online: false, lastLogin: '昨天 08:32' },
  { id: 'u9', name: '郑爽', email: 'zhengshuang@example.com', admin: false, online: false, lastLogin: '5 天前' },
  { id: 'u10', name: '冯远', email: 'fengyuan@example.com', admin: false, online: false, lastLogin: '4 小时前' },
  { id: 'u11', name: '褚燕', email: 'chuyan@example.com', admin: false, online: false, lastLogin: '从未' },
  { id: 'u12', name: '测试账号', email: 'test@wenflow.local', admin: true, online: false, lastLogin: '从未' }
]

const users = ref<UserRow[]>([])
watch(
  () => props.state,
  (s) => {
    users.value = s === 'empty' ? [normalUsers[4]] : normalUsers
  },
  { immediate: true }
)

const pill = ref('all')
const keyword = ref('')
const pills = [
  { id: 'all', label: '全部' },
  { id: 'admin', label: '管理员' },
  { id: 'online', label: '已登录' }
]

/* 新建用户：表单校验 + 真实加行 */
const createOpen = ref(false)
const form = ref({ name: '', email: '', admin: false })
const errors = ref<{ name?: string; email?: string }>({})
const toast = ref('')
let toastTimer: ReturnType<typeof setTimeout> | null = null

function createUser() {
  errors.value = {}
  if (!form.value.name.trim()) errors.value.name = '请输入昵称'
  if (!form.value.email.trim()) errors.value.email = '请输入邮箱'
  else if (!/^\S+@\S+\.\S+$/.test(form.value.email.trim())) errors.value.email = '邮箱格式不正确'
  if (Object.keys(errors.value).length) return

  const id = `u${Date.now() % 100000}`
  users.value.unshift({
    id,
    name: form.value.name.trim(),
    email: form.value.email.trim(),
    admin: form.value.admin,
    online: false,
    lastLogin: '从未'
  })
  createOpen.value = false
  form.value = { name: '', email: '', admin: false }
  pill.value = 'all'
  toast.value = '用户已创建，出现在列表顶部'
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => (toast.value = ''), 2600)
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
</script>
