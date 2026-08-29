<template>
  <div class="mk-page">
    <div class="mk-status" :class="admins.length ? 'mk-status--ok' : 'mk-status--muted'">
      <span class="mk-status__dot"></span>
      <strong class="mk-status__title">管理员</strong>
      <span class="mk-status__sep"></span>
      <span class="mk-status__meta">共 {{ admins.length }} 名</span>
      <span class="mk-status__meta">当前会话 {{ currentAdmin.name || '—' }}</span>
      <button type="button" class="mk-status__action mk-status__action--primary" @click="openAdd">添加管理员</button>
    </div>

    <div class="mk-card">
      <MockSkeletonTable v-if="loading && !admins.length" :cols="6" />
      <div v-else-if="admins.length" class="mk-table-scroll ad-list">
        <table class="mk-table">
          <thead>
            <tr>
              <th>管理员</th>
              <th>角色</th>
              <th>最近登录</th>
              <th class="mk-col--time-full">创建时间</th>
              <th class="mk-col--num">路径</th>
              <th class="mk-col--num">会话</th>
              <th class="mk-col--actions-wide">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="a in admins" :key="a.id" :class="{ 'ad-row--self': isSelfRow(a) }">
              <td>
                <div class="mk-cell-main">
                  <strong>
                    {{ a.name }}
                    <span v-if="isSelfRow(a)" class="mk-badge mk-badge--self">当前</span>
                  </strong>
                  <span class="mk-cell-sub">{{ a.email }}</span>
                </div>
              </td>
              <td>
                <span class="mk-badge" :class="a.isAdmin ? 'mk-badge--self' : 'mk-badge--muted'">{{ a.isAdmin ? '超级管理员' : '管理员' }}</span>
              </td>
              <td :title="a.lastLoginAt ? fmtDate(a.lastLoginAt) : ''">{{ a.lastLoginAt ? timeAgo(a.lastLoginAt) : '从未登录' }}</td>
              <td :title="fmtDate(a.createdAt)">{{ timeAgo(a.createdAt) }}</td>
              <td class="mk-num">{{ a.paths }}</td>
              <td class="mk-num">{{ a.sessions }}</td>
              <td>
                <div class="mk-actions">
                  <button v-if="!isSelfRow(a)" type="button" class="mk-link mk-link--danger" :disabled="a.busy" @click="revoke(a)">移除</button>
                  <span v-else class="mk-na">—</span>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div v-else-if="failed" class="mk-empty">
        <span class="mk-empty__icon" aria-hidden="true">!</span>
        <strong>管理员列表加载失败</strong>
        <button type="button" class="mk-empty__action" @click="load">重试</button>
      </div>
      <div v-else class="mk-empty mk-empty--min">
        <strong>没有管理员</strong>
        <span>把用户提升为管理员以授权后台访问。</span>
        <button type="button" class="mk-empty__action" @click="openAdd">添加管理员</button>
      </div>
    </div>

    <!-- 添加管理员弹窗 -->
    <Teleport to="body">
      <div v-if="addOpen" ref="maskRef" class="mk-modal">
        <div ref="panelRef" class="mk-modal__panel" role="dialog" aria-label="添加管理员">
          <div class="mk-modal__head">
            <h3 class="mk-modal__title">添加管理员</h3>
            <button type="button" class="mk-modal__close" aria-label="关闭" @click="addOpen = false">✕</button>
          </div>
          <div class="mk-modal__body">
            <label class="mk-field" :class="{ 'mk-field--error': errors.search }">
              <span class="mk-field__label">选择用户</span>
              <input v-model="searchQuery" class="mk-field__input" placeholder="搜索姓名 / 邮箱…" @input="searchUsers" />
              <span v-if="errors.search" class="mk-field__err">{{ errors.search }}</span>
            </label>
            <div v-if="searchResults.length" class="ad-candidates">
              <button
                v-for="u in searchResults"
                :key="u.id"
                type="button"
                class="ad-candidate"
                :class="{ 'ad-candidate--on': selectedId === u.id }"
                @click="selectedId = u.id"
              >
                <span class="ad-candidate__avatar">{{ (u.name || u.email || '?')[0].toUpperCase() }}</span>
                <span class="ad-candidate__main">
                  <strong>{{ u.name || u.email }}</strong>
                  <span class="mk-cell-sub">{{ u.email }}</span>
                </span>
                <span v-if="u.isAdmin" class="mk-badge mk-badge--self">已是管理员</span>
              </button>
            </div>
            <p v-else-if="searched" class="ad-none">没有匹配的用户（仅真实用户可提升）</p>
            <p v-else class="mk-field__hint">输入至少 2 个字符搜索真实用户</p>
            <div v-if="addError" class="errorbar">{{ addError }}</div>
          </div>
          <div class="mk-modal__foot">
            <button type="button" class="mk-btn" @click="addOpen = false">取消</button>
            <button type="button" class="mk-btn mk-btn--primary" :disabled="!selectedId || adding" @click="confirmAdd">
              {{ adding ? '添加中…' : '提升为管理员' }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { timeAgo, errMsg } from './live'
import { adminUsersApi } from '@/api/adminApi'
import { useEscape } from './useEscape'
import { useOverlay, useMaskClose } from './useOverlay'
import { askConfirm } from './useConfirm'
import { toast } from '@/utils/toast'
import MockSkeletonTable from './SkeletonTable.vue'

interface AdminRow {
  id: string
  name: string
  email: string
  isAdmin: boolean
  lastLoginAt: string | null
  createdAt: string
  paths: number
  sessions: number
  busy?: boolean
}

const admins = ref<AdminRow[]>([])
const loading = ref(false)
const failed = ref(false)

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
const isSelfRow = (a: AdminRow) =>
  a.id === currentAdmin.value.id || a.email === currentAdmin.value.email

function fmtDate(iso?: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

async function load() {
  loading.value = true
  failed.value = false
  try {
    const res = await adminUsersApi.getUsers({ page: 1, limit: 100, role: 'admin' })
    const body = res.data?.data ?? res.data ?? {}
    const items = body.users || body.items || []
    admins.value = items.map((u: Record<string, unknown>) => ({
      id: String(u.id),
      name: String(u.name || u.email || u.id),
      email: String(u.email || ''),
      isAdmin: !!u.isAdmin,
      lastLoginAt: (u.lastLoginAt as string) || null,
      createdAt: String(u.createdAt || ''),
      paths: Number((u._count as Record<string, number>)?.learning_paths || 0),
      sessions: Number((u._count as Record<string, number>)?.teaching_sessions || 0),
    }))
  } catch (e) {
    failed.value = true
    toast.error(`加载失败：${errMsg(e)}`)
  } finally {
    loading.value = false
  }
}

/* 添加管理员 */
const addOpen = ref(false)
useEscape(() => addOpen.value, () => { addOpen.value = false })
const panelRef = ref<HTMLElement | null>(null)
const maskRef = ref<HTMLElement | null>(null)
useOverlay(computed(() => addOpen.value), panelRef)
useMaskClose(maskRef, () => { addOpen.value = false })

const searchQuery = ref('')
const searchResults = ref<Array<{ id: string; name: string; email: string; isAdmin: boolean }>>([])
const searched = ref(false)
const selectedId = ref('')
const adding = ref(false)
const addError = ref('')
const errors = ref<{ search?: string }>({})

function openAdd() {
  searchQuery.value = ''
  searchResults.value = []
  searched.value = false
  selectedId.value = ''
  addError.value = ''
  errors.value = {}
  addOpen.value = true
}

let searchTimer: ReturnType<typeof setTimeout> | undefined
function searchUsers() {
  clearTimeout(searchTimer)
  const q = searchQuery.value.trim()
  if (q.length < 2) {
    searchResults.value = []
    searched.value = false
    return
  }
  searchTimer = setTimeout(async () => {
    try {
      const res = await adminUsersApi.getUsers({ page: 1, limit: 10, search: q })
      const body = res.data?.data ?? res.data ?? {}
      const items = body.users || body.items || []
      searchResults.value = items.map((u: Record<string, unknown>) => ({
        id: String(u.id),
        name: String(u.name || ''),
        email: String(u.email || ''),
        isAdmin: !!u.isAdmin,
      }))
      searched.value = true
    } catch {
      searchResults.value = []
      searched.value = true
    }
  }, 300)
}

async function confirmAdd() {
  if (!selectedId.value) { errors.value.search = '请选择用户'; return }
  adding.value = true
  addError.value = ''
  try {
    await adminUsersApi.updateUserRole(selectedId.value, 'admin')
    addOpen.value = false
    toast.success('已提升为管理员')
    void load()
  } catch (e) {
    addError.value = errMsg(e)
  } finally {
    adding.value = false
  }
}

/* 移除管理员 */
async function revoke(a: AdminRow) {
  const ok = await askConfirm({
    title: '移除管理员',
    message: `确认将「${a.name}」降级为普通用户？\n该用户将失去后台访问权限。`,
    confirmText: '移除',
  })
  if (!ok) return
  a.busy = true
  try {
    await adminUsersApi.updateUserRole(a.id, 'user')
    admins.value = admins.value.filter((x) => x.id !== a.id)
    toast.success(`已移除「${a.name}」的管理员权限`)
  } catch (e) {
    toast.error(`移除失败：${errMsg(e)}`)
  } finally {
    a.busy = false
  }
}

void load()
</script>

<style scoped>
.ad-list { min-height: var(--mk-empty-min-h, calc(100dvh - 230px)); }
.ad-row--self { background: #f6f9ff; }

.ad-candidates { display: grid; gap: 6px; max-height: 260px; overflow-y: auto; }
.ad-candidate {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border: 1px solid var(--mk-line);
  border-radius: 10px;
  background: var(--mk-surface);
  font: inherit;
  text-align: left;
  cursor: pointer;
  width: 100%;
}
.ad-candidate:hover { border-color: rgba(44, 99, 208, 0.4); }
.ad-candidate--on { border-color: var(--mk-blue); box-shadow: 0 0 0 2px rgba(44, 99, 208, 0.12); }
.ad-candidate__avatar {
  width: 30px;
  height: 30px;
  border-radius: 8px;
  background: #eef2fa;
  color: var(--mk-muted);
  display: grid;
  place-items: center;
  font-size: 13px;
  font-weight: 800;
  flex-shrink: 0;
}
.ad-candidate__main { display: grid; gap: 1px; min-width: 0; flex: 1; }
.ad-candidate__main strong { font-size: 12.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ad-none { color: var(--mk-faint); font-size: 12.5px; text-align: center; padding: 12px 0; }

.errorbar {
  padding: 8px 12px;
  border-radius: 8px;
  background: var(--mk-red-bg, #fef2f2);
  color: var(--mk-red, #dc2626);
  font-size: 12.5px;
  font-weight: 600;
}
</style>
