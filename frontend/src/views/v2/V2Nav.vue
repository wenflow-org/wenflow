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
      <div class="v2nav__user" ref="userMenuRef">
        <button
          type="button"
          class="v2nav__avatar"
          :aria-expanded="menuOpen ? 'true' : 'false'"
          aria-haspopup="menu"
          @click="menuOpen = !menuOpen"
        >
          <i>{{ avatarLetter }}</i>
          <span class="v2nav__name">{{ userName }}</span>
          <span class="v2nav__caret" :class="{ 'v2nav__caret--open': menuOpen }" aria-hidden="true">▾</span>
        </button>
        <Transition name="v2menu">
          <div v-if="menuOpen" class="v2nav__menu" role="menu">
            <router-link to="/user/account" role="menuitem" @click="menuOpen = false">个人中心</router-link>
            <button type="button" role="menuitem" class="v2nav__menu-danger" @click="handleLogout">
              退出登录
            </button>
          </div>
        </Transition>
      </div>
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
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useUserStore } from '@/stores/user';
import { toast } from '@/utils/toast';

const route = useRoute();
const router = useRouter();
const userStore = useUserStore();

const menuOpen = ref(false);
const userMenuRef = ref<HTMLElement | null>(null);

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

async function handleLogout() {
  menuOpen.value = false;
  userStore.logout();
  toast.success('已退出登录');
  await router.push('/login');
}

function onDocClick(e: MouseEvent) {
  if (!menuOpen.value || !userMenuRef.value) return;
  if (!userMenuRef.value.contains(e.target as Node)) menuOpen.value = false;
}

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') menuOpen.value = false;
}

onMounted(() => {
  document.addEventListener('click', onDocClick);
  document.addEventListener('keydown', onKey);
});

onUnmounted(() => {
  document.removeEventListener('click', onDocClick);
  document.removeEventListener('keydown', onKey);
});
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
  transition: transform 0.18s ease, box-shadow 0.18s ease;
}
.v2nav__cta:hover {
  transform: translateY(-1px);
  box-shadow: 0 12px 24px rgba(52, 120, 246, 0.34);
}
.v2nav__cta:active {
  transform: translateY(0) scale(0.97);
}
.v2nav__user { position: relative; }
.v2nav__avatar {
  display: flex; align-items: center; gap: 7px;
  font-size: 13px; font-weight: 700;
  color: var(--ink, #172033);
  background: transparent;
  border: 0;
  padding: 4px 6px 4px 4px;
  border-radius: 999px;
  cursor: pointer;
  font: inherit;
}
.v2nav__avatar:hover { background: #f1f5fb; }
.v2nav__avatar i {
  width: 26px; height: 26px; border-radius: 50%;
  background: var(--blue-deep, #1f57cc); color: #fff;
  font-style: normal; font-size: 12px;
  display: grid; place-items: center;
}
.v2nav__caret {
  font-size: 10px;
  color: var(--faint, #8492ab);
  transition: transform 0.15s ease;
  line-height: 1;
}
.v2nav__caret--open { transform: rotate(180deg); }
.v2nav__menu {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  min-width: 160px;
  padding: 6px;
  border-radius: 12px;
  background: #fff;
  border: 1px solid var(--line, #e3e9f4);
  box-shadow: 0 16px 40px rgba(23, 32, 51, 0.12);
  display: grid;
  gap: 2px;
  z-index: 50;
  transform-origin: top right;
}
.v2menu-enter-active,
.v2menu-leave-active {
  transition: opacity 0.16s ease, transform 0.16s ease;
}
.v2menu-enter-from,
.v2menu-leave-to {
  opacity: 0;
  transform: translateY(-6px) scale(0.97);
}
.v2nav__menu a,
.v2nav__menu button {
  display: block;
  width: 100%;
  text-align: left;
  padding: 10px 12px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  color: var(--ink, #172033);
  text-decoration: none;
  cursor: pointer;
}
.v2nav__menu a:hover,
.v2nav__menu button:hover {
  background: #f1f5fb;
}
.v2nav__menu-danger {
  color: #c0454a !important;
  border-top: 1px solid var(--line, #e3e9f4) !important;
  margin-top: 2px;
  border-radius: 0 0 8px 8px !important;
}
@media (max-width: 900px) {
  .v2nav__links { display: none; }
  .v2nav__name { display: none; }
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
