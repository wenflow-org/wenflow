<template>
  <Transition name="anb">
    <div v-if="current" class="anb" :class="`anb--${current.severity}`" role="alert">
      <span class="anb__dot"></span>
      <div class="anb__main">
        <strong class="anb__title">{{ current.title }}</strong>
        <span class="anb__body">{{ current.body }}</span>
      </div>
      <button type="button" class="anb__close" aria-label="关闭公告" @click="dismiss">×</button>
    </div>
  </Transition>
</template>

<script setup lang="ts">
/**
 * 平台公告横幅（用户端）
 * 位置：全站最顶部（导航栏上方）
 * 数据：GET /api/announcements/active（需登录）
 */
import { computed, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import api from '@/utils/api'
import { useUserStore } from '@/stores/user'

interface ActiveAnnouncement {
  id: string
  title: string
  body: string
  severity: 'info' | 'warning' | 'critical'
}

const DISMISS_KEY = 'wenflow_announcement_dismissed'

const route = useRoute()
const userStore = useUserStore()
const items = ref<ActiveAnnouncement[]>([])
const dismissedIds = ref<string[]>(loadDismissed())
const loading = ref(false)

function loadDismissed(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(DISMISS_KEY) || '[]')
    return Array.isArray(raw) ? raw.map(String) : []
  } catch {
    return []
  }
}

/** 管理页 / 登录注册 / 营销落地页不展示 */
const isUserAppPage = computed(() => {
  const p = route.path
  if (p.startsWith('/admin')) return false
  if (p === '/login' || p === '/register' || p === '/' || p === '/vision') return false
  return true
})

const current = computed(() => {
  if (!userStore.isLoggedIn || !isUserAppPage.value) return null
  const dismissed = new Set(dismissedIds.value)
  return items.value.find((a) => !dismissed.has(a.id)) || null
})

function dismiss() {
  if (!current.value) return
  const id = current.value.id
  const next = [...new Set([...dismissedIds.value, id])]
  dismissedIds.value = next
  localStorage.setItem(DISMISS_KEY, JSON.stringify(next))
}

async function fetchActive() {
  if (!userStore.isLoggedIn) {
    items.value = []
    return
  }
  loading.value = true
  try {
    const res = await api.get('/announcements/active', { timeout: 10000 })
    const list = res.data?.data?.items || res.data?.items || []
    items.value = Array.isArray(list)
      ? list.map((a: Record<string, unknown>) => ({
          id: String(a.id || ''),
          title: String(a.title || ''),
          body: String(a.body || ''),
          severity: (a.severity as ActiveAnnouncement['severity']) || 'info'
        })).filter((a) => a.id && a.title)
      : []
  } catch {
    items.value = []
  } finally {
    loading.value = false
  }
}

// 登录态恢复 / 路由进入学习应用后拉取（避免 onMounted 时 isLoggedIn 仍为 false）
watch(
  () => [userStore.isLoggedIn, isUserAppPage.value] as const,
  ([loggedIn, onApp]) => {
    if (loggedIn && onApp) void fetchActive()
    if (!loggedIn) items.value = []
  },
  { immediate: true }
)
</script>

<style scoped>
.anb {
  position: sticky;
  top: 0;
  z-index: 200;
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 20px;
  font-size: 13px;
  border-bottom: 1px solid;
  box-shadow: 0 4px 14px rgba(23, 32, 51, 0.06);
}
.anb--info {
  background: #eef5ff;
  border-color: rgba(52, 120, 246, 0.25);
  color: #1f57cc;
}
.anb--warning {
  background: #fffbeb;
  border-color: rgba(180, 83, 9, 0.28);
  color: #92610a;
}
.anb--critical {
  background: #fef2f2;
  border-color: rgba(220, 38, 38, 0.28);
  color: #b91c1c;
}
.anb__dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  margin-top: 5px;
  flex-shrink: 0;
  background: currentColor;
}
.anb__main {
  flex: 1;
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  align-items: baseline;
  min-width: 0;
}
.anb__title { font-weight: 700; }
.anb__body { opacity: 0.92; line-height: 1.5; }
.anb__close {
  border: 0;
  background: transparent;
  color: inherit;
  font-size: 16px;
  cursor: pointer;
  padding: 0 4px;
  /* 对比度修复：opacity 0.7 时 warning 色在浅黄底上约 2.8:1，低于 3:1 控件阈值；提到 0.9 约 4.5:1 */
  opacity: 0.9;
  line-height: 1;
}
.anb__close:hover { opacity: 1; }

.anb-enter-active,
.anb-leave-active { transition: all 0.2s ease; }
.anb-enter-from,
.anb-leave-to { opacity: 0; transform: translateY(-6px); }
</style>
