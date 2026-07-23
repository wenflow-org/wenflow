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
 * - 登录后拉取 /announcements/active，展示最新一条未关闭公告
 * - 按公告 id 记忆关闭；过期由服务端过滤
 */
import { computed, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import axios from 'axios';
import { useUserStore } from '@/stores/user';

interface ActiveAnnouncement {
  id: string;
  title: string;
  body: string;
  severity: 'info' | 'warning' | 'critical';
}

const DISMISS_KEY = 'wenflow_announcement_dismissed';

const route = useRoute();
const userStore = useUserStore();
const items = ref<ActiveAnnouncement[]>([]);

const dismissed = computed<Set<string>>(() => {
  try {
    return new Set(JSON.parse(localStorage.getItem(DISMISS_KEY) || '[]'));
  } catch {
    return new Set();
  }
});

/** 管理页/登录页不展示 */
const isUserPage = computed(() => !route.path.startsWith('/admin') && route.path !== '/login');

const current = computed(() => {
  if (!userStore.isLoggedIn || !isUserPage.value) return null;
  return items.value.find((a) => !dismissed.value.has(a.id)) || null;
});

function dismiss() {
  if (!current.value) return;
  const next = new Set(dismissed.value);
  next.add(current.value.id);
  localStorage.setItem(DISMISS_KEY, JSON.stringify([...next]));
  items.value = items.value.filter((a) => a.id !== current.value?.id);
}

onMounted(async () => {
  if (!userStore.isLoggedIn) return;
  try {
    const res = await axios.get('/api/announcements/active', { withCredentials: true, timeout: 10000 });
    items.value = res.data?.data?.items || [];
  } catch {
    items.value = [];
  }
});
</script>

<style scoped>
.anb {
  position: sticky;
  top: 0;
  z-index: 90;
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 9px 16px;
  font-size: 13px;
  border-bottom: 1px solid;
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
.anb__main { flex: 1; display: flex; gap: 8px; flex-wrap: wrap; align-items: baseline; min-width: 0; }
.anb__title { font-weight: 700; }
.anb__body { opacity: 0.9; line-height: 1.5; }
.anb__close {
  border: 0;
  background: transparent;
  color: inherit;
  font-size: 15px;
  cursor: pointer;
  padding: 0 4px;
  opacity: 0.7;
}
.anb__close:hover { opacity: 1; }

.anb-enter-active,
.anb-leave-active { transition: all 0.2s ease; }
.anb-enter-from,
.anb-leave-to { opacity: 0; transform: translateY(-6px); }
</style>
