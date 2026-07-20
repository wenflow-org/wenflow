<template>
  <div class="mk-page">
    <div class="mk-status" :class="users.length ? 'mk-status--ok' : 'mk-status--muted'">
      <span class="mk-status__dot"></span>
      <strong class="mk-status__title">{{ users.length ? '用户体系正常' : '还没有真实用户' }}</strong>
      <span class="mk-status__sep"></span>
      <span class="mk-status__meta">共 {{ users.length }} 人</span>
      <span class="mk-status__meta">管理员 {{ adminCount }}</span>
      <span class="mk-status__meta">今日活跃 {{ activeToday }}</span>
      <button type="button" class="mk-status__action mk-status__action--primary">新建用户</button>
    </div>

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
                <button type="button" class="mk-link">编辑</button>
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
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'

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
  { id: 'u6', name: '测试账号', email: 'test@wenflow.local', admin: true, online: false, lastLogin: '从未' }
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
