<template>
  <header class="v2nav">
    <div class="v2nav__brand" @click="$router.push('/dashboard')">
      <img src="/logo.png" alt="问流 WenFlow" class="v2nav__logo" />
    </div>
    <nav class="v2nav__links">
      <router-link
        v-for="item in items"
        :key="item.to"
        :to="item.to"
        :class="{ active: isActive(item) }"
      >{{ item.label }}</router-link>
    </nav>
    <div class="v2nav__right">
      <router-link to="/goal-conversation" class="v2nav__cta">＋ 规划新目标</router-link>
      <router-link to="/user/account" class="v2nav__avatar" :title="userName">
        <i>{{ avatarLetter }}</i>{{ userName }}
      </router-link>
    </div>
  </header>

  <!-- 移动端底部导航（独立于 header，避免 backdrop-filter 成为 fixed 包含块） -->
  <nav class="v2nav__tabs" aria-label="底部导航">
    <router-link
      v-for="item in items"
      :key="item.to"
      :to="item.to"
      class="v2nav__tab"
      :class="{ 'v2nav__tab--active': isActive(item) }"
    >
      <span class="v2nav__tab-icon" v-html="item.icon"></span>
      <span class="v2nav__tab-label">{{ item.label }}</span>
    </router-link>
  </nav>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { useUserStore } from '@/stores/user';

const route = useRoute();
const userStore = useUserStore();

const icons = {
  home: '<svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="m12 3 9 8h-3v9h-4v-6h-4v6H6v-9H3l9-8z"/></svg>',
  goal: '<svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M20 2H4a2 2 0 0 0-2 2v18l4-4h14a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2zM7 9h10v2H7V9zm6 5H7v-2h6v2zm4-6H7V6h10v2z"/></svg>',
  layers: '<svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="m12 2 10 5-10 5L2 7l10-5zm0 7.6L18.9 7 12 4.4 5.1 7 12 9.6zM2 12l10 5 10-5v2l-10 5L2 14v-2zm0 5 10 5 10-5v2l-10 5L2 19v-2z" opacity=".9"/></svg>',
  pulse: '<svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M3 13h4l2-7 4 12 2-7h6v2h-4.6l-2.4 8.4L9.6 7.6 7.6 15H3v-2z"/></svg>',
  medal: '<svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M12 2a7 7 0 0 0-4 12.74V22l4-2 4 2v-7.26A7 7 0 0 0 12 2zm0 2a5 5 0 1 1 0 10 5 5 0 0 1 0-10z"/></svg>'
};

const items = [
  { to: '/dashboard', label: '学习台', match: ['/dashboard'], icon: icons.home },
  { to: '/goal-conversation', label: '目标规划', match: ['/goal-conversation'], icon: icons.goal },
  { to: '/learning-paths', label: '学习路径', match: ['/learning-paths', '/learning-path'], icon: icons.layers },
  { to: '/learning-state', label: '学习状态', match: ['/learning-state'], icon: icons.pulse },
  { to: '/achievements', label: '成就', match: ['/achievements'], icon: icons.medal }
];

function isActive(item: { match: string[] }) {
  return item.match.some((m) => route.path.startsWith(m));
}

const userName = computed(() => userStore.user?.name || '同学');
const avatarLetter = computed(() => (userStore.user?.name || '同').charAt(0));
</script>

<style scoped>
.v2nav {
  display: flex; align-items: center; gap: 28px;
  padding: 0 28px; height: 60px;
  background: rgba(255, 255, 255, 0.86);
  backdrop-filter: blur(16px);
  border-bottom: 1px solid var(--line, #e3e9f4);
  position: sticky; top: 0; z-index: 30;
}
.v2nav__brand { display: flex; align-items: center; cursor: pointer; }
.v2nav__logo { height: 38px; width: auto; object-fit: contain; display: block; }
.v2nav__links { display: flex; gap: 4px; flex: 1; }
.v2nav__links a {
  padding: 7px 12px; border-radius: 9px;
  font-size: 13px; font-weight: 600; color: var(--muted, #5b6577);
  cursor: pointer; text-decoration: none; transition: .14s ease;
}
.v2nav__links a:hover { color: var(--ink, #172033); background: #f1f5fb; }
.v2nav__links a.active { color: var(--blue-deep, #1f57cc); background: rgba(52, 120, 246, 0.09); }
.v2nav__right { display: flex; align-items: center; gap: 12px; }
.v2nav__cta {
  padding: 8px 16px; border-radius: 999px;
  background: linear-gradient(135deg, var(--blue, #3478f6), var(--blue-deep, #1f57cc));
  color: #fff; font-size: 13px; font-weight: 700;
  box-shadow: 0 8px 18px rgba(52, 120, 246, 0.28);
  cursor: pointer; text-decoration: none;
}
.v2nav__avatar {
  display: flex; align-items: center; gap: 7px;
  font-size: 13px; font-weight: 700;
  color: var(--ink, #172033); text-decoration: none;
}
.v2nav__avatar i {
  width: 26px; height: 26px; border-radius: 50%;
  background: var(--blue-deep, #1f57cc); color: #fff;
  font-style: normal; font-size: 12px;
  display: grid; place-items: center;
}
@media (max-width: 900px) {
  .v2nav__links { display: none; }
}
</style>

<style scoped>
/* ---------- 移动端底部导航 ---------- */
.v2nav__tabs { display: none; }

@media (max-width: 900px) {
  .v2nav__tabs {
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    position: fixed;
    left: 0; right: 0; bottom: 0;
    z-index: 40;
    background: rgba(255, 255, 255, 0.92);
    backdrop-filter: blur(16px);
    border-top: 1px solid var(--line, #e3e9f4);
    padding: 6px 4px calc(6px + env(safe-area-inset-bottom, 0px));
  }
  .v2nav__tab {
    display: grid;
    justify-items: center;
    gap: 3px;
    padding: 6px 2px 4px;
    border-radius: 12px;
    color: var(--muted, #5b6577);
    text-decoration: none;
  }
  .v2nav__tab-icon { display: grid; place-items: center; opacity: 0.75; }
  .v2nav__tab-label { font-size: 10.5px; font-weight: 700; }
  .v2nav__tab--active {
    color: var(--blue-deep, #1f57cc);
  }
  .v2nav__tab--active .v2nav__tab-icon { opacity: 1; }
  .v2nav__tab:active { background: rgba(52, 120, 246, 0.08); }
}
</style>
