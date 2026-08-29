<template>
  <div class="nb" ref="rootRef">
    <button
      type="button"
      class="nb__bell"
      :aria-label="`通知${unread > 0 ? `（${unread} 条未读）` : ''}`"
      aria-haspopup="dialog"
      :aria-expanded="open ? 'true' : 'false'"
      @click="toggle"
    >
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
        <path d="M13.73 21a2 2 0 0 1-3.46 0" />
      </svg>
      <span v-if="unread > 0" class="nb__dot">{{ unread > 99 ? '99+' : unread }}</span>
    </button>

    <Transition name="nb-pop">
      <div v-if="open" class="nb__panel" role="dialog" aria-label="通知中心">
        <div class="nb__head">
          <strong>通知</strong>
          <div class="nb__head-actions">
            <button v-if="unread > 0" type="button" class="nb__readall" @click="readAll">全部已读</button>
            <button type="button" class="nb__close" aria-label="关闭" @click="open = false">✕</button>
          </div>
        </div>
        <div class="nb__body">
          <div v-if="loading" class="nb__empty"><span class="mk-spinner"></span> 加载中…</div>
          <template v-else-if="items.length">
            <div
              v-for="n in items"
              :key="n.id"
              class="nb__item"
              :class="{ 'nb__item--unread': !n.isRead }"
              :title="n.body || ''"
              @click="onItemClick(n)"
            >
              <div class="nb__item-main">
                <strong>{{ n.title }}</strong>
                <span v-if="n.body" class="nb__item-body">{{ n.body }}</span>
                <span class="nb__item-time">{{ timeAgo(n.createdAt) }}</span>
              </div>
              <span v-if="!n.isRead" class="nb__item-dot" aria-hidden="true"></span>
            </div>
            <button v-if="total > items.length" type="button" class="nb__more" @click="loadMore">加载更多</button>
          </template>
          <div v-else class="nb__empty">
            <span class="nb__empty-icon" aria-hidden="true">🔔</span>
            <span>暂无通知</span>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import api from '@/utils/api'
import { timeAgo } from '@/views/admin-redesign/live'

interface NotifItem {
  id: string
  title: string
  body: string | null
  kind: string
  link: string | null
  isRead: boolean
  createdAt: string
}

const open = ref(false)
const items = ref<NotifItem[]>([])
const total = ref(0)
const page = ref(1)
const loading = ref(false)
const rootRef = ref<HTMLElement | null>(null)

const unread = computed(() => items.value.filter((n) => !n.isRead).length)

async function load(reset = true) {
  if (reset) {
    page.value = 1
    items.value = []
  }
  loading.value = true
  try {
    const res = await api.get('/notifications', { params: { page: page.value, limit: 10 } })
    const data = res.data?.data ?? {}
    const list = data.items || []
    if (reset) items.value = list
    else items.value = [...items.value, ...list]
    total.value = data.total ?? items.value.length
  } catch {
    // 通知失败静默降级（不打扰学习主流程）
  } finally {
    loading.value = false
  }
}

function toggle() {
  open.value = !open.value
  if (open.value && !items.value.length) void load()
}

async function readAll() {
  try {
    await api.post('/notifications/read-all')
    items.value = items.value.map((n) => ({ ...n, isRead: true }))
  } catch {
    // 静默
  }
}

function loadMore() {
  page.value += 1
  void load(false)
}

function onItemClick(n: NotifItem) {
  if (!n.isRead) {
    void api.post(`/notifications/${encodeURIComponent(n.id)}/read`)
    n.isRead = true
  }
  if (n.link) {
    window.location.href = n.link
  }
}

function onDocClick(e: MouseEvent) {
  if (open.value && rootRef.value && !rootRef.value.contains(e.target as Node)) open.value = false
}
function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') open.value = false
}

onMounted(() => {
  document.addEventListener('click', onDocClick)
  document.addEventListener('keydown', onKey)
})
onBeforeUnmount(() => {
  document.removeEventListener('click', onDocClick)
  document.removeEventListener('keydown', onKey)
})
</script>

<style scoped>
.nb { position: relative; }
.nb__bell {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border-radius: 999px;
  border: 0;
  background: transparent;
  color: var(--muted, #5b6577);
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
}
.nb__bell:hover { background: #f1f5fb; color: var(--blue-deep, #1f57cc); }
.nb__dot {
  position: absolute;
  top: 3px;
  right: 2px;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  border-radius: 999px;
  background: #e5484d;
  color: #fff;
  font-size: 10px;
  font-weight: 800;
  line-height: 16px;
  text-align: center;
  box-shadow: 0 0 0 2px #fff;
}

.nb__panel {
  position: absolute;
  top: calc(100% + 10px);
  right: 0;
  width: min(340px, calc(100vw - 32px));
  border-radius: 14px;
  background: #fff;
  border: 1px solid var(--line, #e3e9f4);
  box-shadow: 0 16px 40px rgba(23, 32, 51, 0.14);
  overflow: hidden;
  z-index: 60;
  transform-origin: top right;
}
.nb-pop-enter-active, .nb-pop-leave-active { transition: opacity 0.16s ease, transform 0.16s ease; }
.nb-pop-enter-from, .nb-pop-leave-to { opacity: 0; transform: translateY(-6px) scale(0.97); }

.nb__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 14px;
  border-bottom: 1px solid var(--line, #e3e9f4);
}
.nb__head strong { font-size: 14px; }
.nb__head-actions { display: flex; align-items: center; gap: 8px; }
.nb__readall {
  border: 0;
  background: transparent;
  color: var(--blue-deep, #1f57cc);
  font: inherit;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  padding: 4px 6px;
  border-radius: 6px;
}
.nb__readall:hover { background: #f1f5fb; }
.nb__close {
  border: 0;
  background: #f1f5fb;
  color: var(--muted, #5b6577);
  width: 24px;
  height: 24px;
  border-radius: 7px;
  cursor: pointer;
  font-size: 11px;
}

.nb__body { max-height: min(420px, 60vh); overflow-y: auto; }
.nb__item {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 12px 14px;
  border-bottom: 1px solid #f5f7fb;
  cursor: pointer;
  transition: background 0.12s ease;
}
.nb__item:hover { background: #f8faff; }
.nb__item--unread { background: #f2f7ff; }
.nb__item--unread:hover { background: #eaf2ff; }
.nb__item-main { flex: 1; min-width: 0; display: grid; gap: 3px; }
.nb__item-main strong { font-size: 13px; line-height: 1.4; }
.nb__item--unread .nb__item-main strong { color: var(--blue-deep, #1f57cc); }
.nb__item-body {
  font-size: 12px;
  color: var(--muted, #5b6577);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.nb__item-time { font-size: 11px; color: var(--faint, #8492ab); }
.nb__item-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #e5484d;
  flex-shrink: 0;
  margin-top: 6px;
}
.nb__more {
  display: block;
  width: 100%;
  padding: 10px;
  border: 0;
  background: transparent;
  color: var(--blue-deep, #1f57cc);
  font: inherit;
  font-size: 12.5px;
  font-weight: 700;
  cursor: pointer;
}
.nb__more:hover { background: #f8faff; }
.nb__empty {
  display: grid;
  justify-items: center;
  gap: 8px;
  padding: 36px 16px;
  color: var(--faint, #8492ab);
  font-size: 13px;
}
.nb__empty-icon { font-size: 22px; }

@media (max-width: 1100px) {
  .nb__panel { right: -8px; }
}
</style>
