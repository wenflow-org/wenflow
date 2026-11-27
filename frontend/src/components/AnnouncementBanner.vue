<template>
  <Transition name="anb">
    <div v-if="current" ref="bannerEl" class="anb" :class="`anb--${current.severity}`" role="alert">
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
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import api from '@/utils/api'
import { resolveVisualScale } from '@/utils/zoom'
import { useUserStore } from '@/stores/user'

/* 吸顶叠层协调（2026-11-21 公告遮住导航修复）：
   本横幅与 V2Nav 顶栏都是 sticky top:0——横幅展示期两者同点吸顶，z-index 200 的横幅
   会盖住导航。横幅把实测高度写进 :root 的 --wf-anb-h，V2Nav 用它作吸顶 top 偏移，
   两层上下堆叠互不遮挡；横幅隐藏/关闭后变量清除，导航回到 top:0。 */
const ANB_HEIGHT_VAR = '--wf-anb-h'
const bannerEl = ref<HTMLElement | null>(null)
let heightObserver: ResizeObserver | null = null

function syncHeightVar() {
  const el = bannerEl.value
  if (el) {
    /* 横幅挂在 #app 下（在 .v2-page 之外，量到的是未缩放视觉高），消费方 V2Nav 在
       .v2-page 里，sticky top 会被 zoom 再放大——先折回 .v2-page 的逻辑 px 再写变量。 */
    const page = document.querySelector('.v2-page') as HTMLElement | null
    const pageZoom = (page && resolveVisualScale(page)) || 1
    document.documentElement.style.setProperty(
      ANB_HEIGHT_VAR,
      `${Math.round(el.getBoundingClientRect().height / pageZoom)}px`
    )
  } else {
    document.documentElement.style.removeProperty(ANB_HEIGHT_VAR)
  }
}

function watchBannerHeight() {
  heightObserver?.disconnect()
  heightObserver = null
  const el = bannerEl.value
  if (!el || !current.value) {
    syncHeightVar()
    return
  }
  heightObserver = new ResizeObserver(syncHeightVar)
  heightObserver.observe(el)
  syncHeightVar()
}

onBeforeUnmount(() => {
  heightObserver?.disconnect()
  heightObserver = null
  document.documentElement.style.removeProperty(ANB_HEIGHT_VAR)
})

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
    // 公告为辅助信息：加载失败静默（不显示横幅 > 错误条打扰），区别于面板类（如通知）需可见错误
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

// 公告出现/消失/切换 → 同步吸顶偏移变量（等 DOM 渲染后再量高度）。
// bannerEl 一并纳入：离场动画结束后 v-if 卸载元素、ref 置 null，此时也要把变量清掉，
// 否则导航会永久停在一个不存在的横幅高度下方。
watch([current, bannerEl], () => void nextTick(watchBannerHeight), { immediate: true })
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
  /* 吸顶横幅 → 悬浮阴影档（0 4px 14px 自写档退役） */
  box-shadow: var(--mk-shadow-sm);
}
.anb--info {
  background: var(--brand-soft);
  border-color: color-mix(in srgb, var(--mk-blue) 25%, transparent);
  color: var(--wf-color-primary-dark);
}
.anb--warning {
  background: var(--mk-amber-bg);
  border-color: color-mix(in srgb, var(--mk-amber) 28%, transparent);
  color: #92610a;
}
.anb--critical {
  background: var(--mk-red-bg);
  border-color: color-mix(in srgb, var(--mk-red-fill) 28%, transparent);
  color: var(--mk-red-strong);
}
/* 暗色模式：公告语义条（在用户端学习应用顶部展示，随主题翻转） */
[data-theme='dark'] .anb--info {
  border-color: color-mix(in srgb, var(--mk-blue) 30%, transparent);
  color: var(--mk-ghost-fg);
}
[data-theme='dark'] .anb--warning {
  background: color-mix(in srgb, var(--mk-amber) 12%, transparent);
  border-color: color-mix(in srgb, var(--mk-amber) 30%, transparent);
  color: #f6bb63;
}
[data-theme='dark'] .anb--critical {
  background: color-mix(in srgb, var(--mk-red) 12%, transparent);
  border-color: color-mix(in srgb, var(--mk-red) 30%, transparent);
  color: #fca5a5;
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
  /* 触屏热区（P1 审计）：16px 字形 + padding 12px 四周 → ≥36px 命中盒（本仓触屏门禁），
     负外边距抵消 padding 占位，横幅排版高度与 × 视觉位置均不变 */
  padding: 12px;
  margin: -12px;
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
