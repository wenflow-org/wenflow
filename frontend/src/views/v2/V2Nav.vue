<template>
  <!-- ===== 侧栏：≥1024px 固定左列（原型 newui/home wf-sidebar 形态），<1024px 隐藏改用底部导航 ===== -->
  <aside class="v2nav-side" aria-label="主导航">
    <router-link to="/dashboard" class="v2nav-side__brand" aria-label="问流 WenFlow，返回工作台">
      <img :src="isDark ? '/logo-dark.png' : '/logo.png'" alt="" class="v2nav-side__logo" />
    </router-link>
    <nav class="v2nav-side__group">
      <router-link
        v-for="item in items"
        :key="item.to"
        :to="item.to"
        class="v2nav-side__link"
        :class="{ 'v2nav-side__link--active': isActive(item) }"
        :aria-current="isActive(item) ? 'page' : undefined"
      >
        <component :is="item.icon" :size="20" :stroke-width="1.75" aria-hidden="true" />
        <span>{{ item.label }}</span>
      </router-link>
    </nav>
    <div class="v2nav-side__foot">
      <router-link to="/user/account" class="v2nav-side__link">
        <UserRound :size="20" :stroke-width="1.75" aria-hidden="true" />
        <span>个人中心</span>
      </router-link>
      <button type="button" class="v2nav-side__link" @click="toggleTheme">
        <span class="v2nav-side__link-icon" aria-hidden="true">
          <Sun v-if="isDark" :size="20" :stroke-width="1.75" />
          <Moon v-else :size="20" :stroke-width="1.75" />
        </span>
        <span>切换深浅色</span>
      </button>
    </div>
  </aside>

  <!-- ===== 顶栏：内容列顶部的毛玻璃条（原型 wf-appbar）===== -->
  <header class="v2nav-bar">
    <div class="v2nav-bar__left">
      <button v-if="showBack" type="button" class="v2nav-back" aria-label="返回上一页" @click="goBack">
        <ChevronLeft :size="20" :stroke-width="2" aria-hidden="true" />
      </button>
      <router-link
        v-if="onDashboard"
        to="/dashboard"
        class="v2nav-bar__brand"
        aria-label="问流 WenFlow"
      >
        <img :src="isDark ? '/logo-dark.png' : '/logo.png'" alt="" class="v2nav-bar__logo" />
      </router-link>
      <strong v-if="pageTitle" class="v2nav-bar__title" :class="{ 'v2nav-bar__title--dash': onDashboard }">{{ pageTitle }}</strong>
    </div>
    <div class="v2nav-bar__right">
      <V2NotifCenter />
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
          <span class="v2nav__caret" :class="{ 'v2nav__caret--open': menuOpen }" aria-hidden="true">
            <ChevronDown :size="13" :stroke-width="2.25" />
          </span>
        </button>
        <Transition name="v2menu">
          <div v-if="menuOpen" class="v2nav__menu" role="menu">
            <router-link to="/user/account" role="menuitem" @click="menuOpen = false">
              <UserRound :size="15" :stroke-width="1.75" aria-hidden="true" />
              <span>个人中心</span>
            </router-link>
            <button type="button" role="menuitem" class="v2nav__menu-theme" @click="toggleTheme">
              <span class="v2nav__menu-theme-icon" aria-hidden="true">
                <Sun v-if="isDark" :size="14" :stroke-width="2" />
                <Moon v-else :size="14" :stroke-width="2" />
              </span>
              <span class="v2nav__menu-theme-label">{{ isDark ? '切换到亮色模式' : '切换到暗色模式' }}</span>
            </button>
            <button type="button" role="menuitem" class="v2nav__menu-danger" @click="handleLogout">
              <LogOut :size="15" :stroke-width="1.75" aria-hidden="true" />
              <span>退出登录</span>
            </button>
          </div>
        </Transition>
      </div>
    </div>
  </header>

  <!-- ===== 底部导航：<1024px（独立于 header，避免 backdrop-filter 成为 fixed 包含块）===== -->
  <nav class="v2nav__dock" aria-label="底部导航">
    <router-link
      v-for="item in items"
      :key="item.to"
      :to="item.to"
      class="v2nav__dock-item"
      :class="{ 'v2nav__dock-item--active': isActive(item) }"
      :aria-current="isActive(item) ? 'page' : undefined"
    >
      <span class="v2nav__dock-icon" aria-hidden="true">
        <component :is="item.icon" :size="22" :stroke-width="1.75" />
      </span>
      <span class="v2nav__dock-label">{{ item.label }}</span>
    </router-link>
  </nav>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, type Component } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { Activity, ChevronDown, ChevronLeft, House, Layers, LogOut, MessageSquareText, Moon, Sun, UserRound, Waypoints } from 'lucide-vue-next';
import { useUserStore } from '@/stores/user';
import { toast } from '@/utils/toast';
import { applyDocumentTheme, readTheme, writeTheme } from '@/utils/theme';
import { useIsDark } from '@/composables/useIsDark';
import V2NotifCenter from './V2NotifCenter.vue';

const route = useRoute();
const router = useRouter();
const userStore = useUserStore();

const menuOpen = ref(false);
const userMenuRef = ref<HTMLElement | null>(null);

/* 图标统一走 lucide（1.75 线宽与全站一致） */
const items: Array<{ to: string; label: string; match: string[]; icon: Component }> = [
  { to: '/dashboard', label: '学习台', match: ['/dashboard'], icon: House },
  { to: '/goal-conversation', label: '目标规划', match: ['/goal-conversation'], icon: MessageSquareText },
  { to: '/learning-paths', label: '学习路径', match: ['/learning-paths', '/learning-path'], icon: Layers },
  { to: '/knowledge-map', label: '知识图谱', match: ['/knowledge-map'], icon: Waypoints },
  { to: '/learning-state', label: '学习状态', match: ['/learning-state'], icon: Activity }
];
/* 「成就」「学习历史」不再是顶层入口（2026-09-24 用户拍板），收在个人中心分段里；
   旧路径保留重定向。 */

function isActive(item: { to: string; match: string[] }) {
  // 个人中心 /user/* 挂在「学习台」簇下（从学习台侧栏/头像进入）：给入口一个当前态
  if (route.path.startsWith('/user') && item.to === '/dashboard') return true;
  return item.match.some((m) => route.path.startsWith(m));
}

/* 原型壳语义：5 个 tab 屏不带返回钮，其余（路径详情/个人中心等）带 */
const onTabSection = computed(() => items.some((item) => route.path.startsWith(item.to)));
const showBack = computed(() => !onTabSection.value);
const onDashboard = computed(() => route.path.startsWith('/dashboard'));
const pageTitle = computed(() => {
  const t = route.meta?.title;
  return typeof t === 'string' ? t : '';
});
/** 返回：有站内历史就回退；深链直达（无上一页）兜底回学习台 */
function goBack() {
  const state = window.history.state as { back?: string } | null;
  if (state?.back) router.back();
  else void router.push('/dashboard');
}

const userName = computed(() => userStore.user?.name || '学习者');
const avatarLetter = computed(() => (userStore.user?.name || '学').charAt(0));

/* 主题切换：单一事实源 = <html data-theme>（useIsDark），侧栏足部与头像菜单双入口（原型两处都有） */
const isDark = useIsDark();
function applyTheme(dark: boolean) {
  applyDocumentTheme(dark ? 'dark' : 'light');
  writeTheme(dark ? 'dark' : 'light');
}
function toggleTheme() {
  applyTheme(!isDark.value);
}

async function handleLogout() {
  menuOpen.value = false;
  // 等 logout 真正结束再按结果提示：此前不等结果就报成功——网络失败时
  // store 已 toast「登出失败」，会再叠一条自相矛盾的「已退出登录」
  if (await userStore.logout()) toast.success('已退出登录');
  // 本地会话状态在 store.logout 里先行清理，无论后端登出成败都应回登录页
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
  applyTheme(readTheme() === 'dark');
  document.addEventListener('click', onDocClick);
  document.addEventListener('keydown', onKey);
});

onUnmounted(() => {
  document.removeEventListener('click', onDocClick);
  document.removeEventListener('keydown', onKey);
});
</script>

<style scoped>
/* ===== 侧栏（≥1024）：固定左列，页面内容由 v2.css 的 .v2-page 左移距让位 ===== */
.v2nav-side { display: none; }

/* ===== 顶栏（内容列毛玻璃条）===== */
.v2nav-bar {
  position: sticky; top: 0; z-index: 30;
  display: flex; align-items: center; gap: 12px;
  padding: 10px 16px;
  background: var(--v2nav-bg, rgba(255, 255, 255, 0.94));
  border-bottom: 1px solid var(--line, #e3e9f4);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
}
.v2nav-bar__left { display: flex; align-items: center; gap: 10px; min-width: 0; }
/* 返回钮：44px 圆形触控（HIG 下限），仅非 tab 屏渲染 */
.v2nav-back {
  display: grid; place-items: center;
  width: 44px; height: 44px; flex: none;
  border: 0; border-radius: 50%;
  background: transparent; color: var(--ink, #172033);
  cursor: pointer; transition: background 0.14s ease;
}
.v2nav-back:hover { background: color-mix(in srgb, var(--blue) 8%, transparent); }
.v2nav-bar__brand { display: flex; align-items: center; flex: none; }
.v2nav-bar__logo { height: 34px; width: auto; object-fit: contain; display: block; }
.v2nav-bar__title {
  margin: 0;
  font-size: 17px; font-weight: 800; letter-spacing: -0.01em;
  color: var(--ink, #172033);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.v2nav-bar__right { display: flex; align-items: center; gap: 6px; margin-left: auto; }

/* 窄屏：dashboard 显品牌、其余屏显标题；标题常显于 ≥1024 */
.v2nav-bar__brand { display: none; }
.v2nav-bar__title { display: none; }
@media (max-width: 1023.98px) {
  .v2nav-bar__brand { display: flex; }
  .v2nav-bar__title:not(.v2nav-bar__title--dash) { display: block; }
}
@media (min-width: 1024px) {
  /* 左移距由页面根 .v2-page 统一给（本组件渲染在 .v2-page 内部，这里不再加，
     否则双重 252px——真机实测 barLeft=504） */
  .v2nav-bar__title { display: block; }
}
.v2nav-bar__title--dash { display: none; }
@media (min-width: 1024px) {
  .v2nav-bar__title--dash { display: block; }
}

/* ===== 侧栏展开态（≥1024）===== */
@media (min-width: 1024px) {
  .v2nav-side {
    display: flex; flex-direction: column; gap: 6px;
    position: fixed; top: 0; bottom: 0; left: 0;
    width: var(--v2-sidebar-w, 252px);
    padding: 20px 14px 18px;
    background: var(--surface, #ffffff);
    border-right: 1px solid var(--line, #e3e9f4);
    overflow-y: auto;
    z-index: 40;
  }
  .v2nav-side__brand { display: flex; align-items: center; padding: 2px 10px 18px; }
  .v2nav-side__logo { height: 40px; width: auto; object-fit: contain; display: block; }
  .v2nav-side__group { display: grid; gap: 2px; }
  .v2nav-side__foot {
    margin-top: auto; padding-top: 12px;
    border-top: 1px solid var(--line, #e3e9f4);
    display: grid; gap: 2px;
  }
  .v2nav-side__link {
    display: flex; align-items: center; gap: 11px; width: 100%;
    min-height: 44px; padding: 0 12px;
    border: 0; border-radius: 10px;
    background: transparent; color: var(--muted, #5b6577);
    font: inherit; font-size: 14px; font-weight: 600; text-align: left;
    cursor: pointer; text-decoration: none;
    transition: background 0.14s ease, color 0.14s ease;
  }
  .v2nav-side__link svg { flex: none; opacity: 0.82; }
  .v2nav-side__link:hover { background: var(--mk-surface-2, #eef2fa); color: var(--ink, #172033); }
  .v2nav-side__link--active { background: color-mix(in srgb, var(--blue) 10%, transparent); color: var(--blue-deep, #1f57cc); }
  .v2nav-side__link--active svg { opacity: 1; }
  .v2nav-side__link:focus-visible { outline: 2px solid var(--blue); outline-offset: 2px; }
  .v2nav-side__link-icon { display: grid; place-items: center; }
}

/* ===== 头像菜单（沿用既有类名：v2nav.fallback 测试与页内样式依赖）===== */
.v2nav__user { position: relative; }
.v2nav__avatar {
  display: flex; align-items: center; gap: 8px;
  font: inherit;
  font-size: 13.5px; font-weight: 700;
  color: var(--ink, #172033);
  background: transparent;
  border: 0;
  padding: 5px 10px 5px 5px;
  border-radius: var(--mk-radius-pill);
  cursor: pointer;
  transition: background 0.15s ease;
}
.v2nav__avatar:hover { background: color-mix(in srgb, var(--surface) 92%, var(--ink)); }
.v2nav__avatar i {
  width: 34px; height: 34px; border-radius: 50%;
  flex: 0 0 auto;
  /* 扁平强调色底 + 同色系首字母（2026-09-24 去炫彩口径），与侧栏活跃态同一语言 */
  background: color-mix(in srgb, var(--blue) 12%, transparent);
  color: var(--blue-deep, #1f57cc);
  font-style: normal; font-size: 15px; font-weight: 800;
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
  border-radius: var(--mk-radius-xl);
  background: var(--surface, #fff);
  border: 1px solid var(--line, #e3e9f4);
  box-shadow: 0 16px 40px rgba(23, 32, 51, 0.12);
  display: grid;
  gap: 2px;
  z-index: 50;
  transform-origin: top right;
}
.v2menu-enter-active,
.v2menu-leave-active {
  transition: opacity var(--mk-dur-fast, 120ms) var(--mk-ease-out, ease),
    transform var(--mk-dur-fast, 120ms) var(--mk-ease-out, ease);
}
.v2menu-enter-from,
.v2menu-leave-to {
  opacity: 0;
  transform: translateY(-6px) scale(0.97);
}
.v2nav__menu a,
.v2nav__menu button {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  text-align: left;
  padding: 10px 12px;
  border: 0;
  border-radius: var(--mk-radius-md);
  background: transparent;
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  color: var(--ink, #172033);
  text-decoration: none;
  cursor: pointer;
}
.v2nav__menu a svg,
.v2nav__menu button svg {
  color: var(--muted, #5b6577);
  flex-shrink: 0;
}
.v2nav__menu button.v2nav__menu-danger svg {
  color: var(--red-ink);
}
.v2nav__menu a:hover,
.v2nav__menu button:hover {
  background: color-mix(in srgb, var(--blue) 8%, var(--surface));
}
.v2nav__menu-theme {
  display: flex !important;
  align-items: center;
  gap: 8px;
}
.v2nav__menu-theme-icon {
  display: grid;
  place-items: center;
  width: 22px; height: 22px;
  border-radius: 7px;
  background: color-mix(in srgb, var(--blue) 10%, transparent);
  color: var(--blue-deep, #1f57cc);
  flex-shrink: 0;
}
.v2nav__menu-danger {
  color: var(--red-ink) !important;
  border-top: 1px solid var(--line, #e3e9f4) !important;
  margin-top: 2px;
  border-radius: 0 0 8px 8px !important;
}
/* 窄屏顶栏：隐藏用户名，头像 44px 触控 */
@media (max-width: 1023.98px) {
  .v2nav__name { display: none; }
  .v2nav__right { gap: 4px; }
  .v2nav__right :deep(.nc__bell) { width: 44px; height: 44px; }
  .v2nav__right :deep(.nc__bell svg) { width: 19px; height: 19px; }
  .v2nav__avatar { min-width: 44px; min-height: 44px; padding: 4px 8px 4px 4px; font-size: 12.5px; }
  .v2nav__avatar i { width: 26px; height: 26px; font-size: 12px; }
  .v2nav__caret { font-size: 9px; }
}
</style>

<style scoped>
/* ===== 底部导航（<1024）：5 列 dock，课堂等沉浸页不挂本组件 ===== */
.v2nav__dock { display: none; }

@media (max-width: 1023.98px) {
  .v2nav__dock {
    display: grid;
    /* 列数必须与 items 数量一致，否则多出的 tab 换行把导航撑成两行。
       minmax(0,1fr)：1fr 的下限是 min-content，标签变长会把整页撑出横向滚动。 */
    grid-template-columns: repeat(5, minmax(0, 1fr));
    position: fixed;
    left: 0; right: 0; bottom: 0;
    z-index: 40;
    background: color-mix(in srgb, var(--surface, #ffffff) 96%, transparent);
    border-top: 1px solid var(--line, #e3e9f4);
    padding: 6px 4px calc(6px + env(safe-area-inset-bottom, 0px));
  }
  .v2nav__dock-item {
    display: grid;
    justify-items: center;
    gap: 3px;
    min-height: 48px;
    padding: 6px 2px 4px;
    border-radius: var(--mk-radius-xl);
    color: var(--muted, #5b6577);
    text-decoration: none;
  }
  .v2nav__dock-icon { display: grid; place-items: center; opacity: 0.75; }
  .v2nav__dock-label { font-size: 11px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
  .v2nav__dock-item--active { color: var(--blue-deep, #1f57cc); }
  .v2nav__dock-item--active .v2nav__dock-icon { opacity: 1; }
  .v2nav__dock-item:active { background: color-mix(in srgb, var(--blue) 8%, transparent); }
  /* ≤360px 窄屏：5 列每列仍有 ~72px，4 字标签放得下，只去左右内边距 */
  @media (max-width: 360px) {
    .v2nav__dock { padding-left: 0; padding-right: 0; }
    .v2nav__dock-item { padding-left: 0; padding-right: 0; }
  }
}
</style>
