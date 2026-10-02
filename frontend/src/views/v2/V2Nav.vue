<template>
  <!-- ===== 顶栏：品牌居左 · 胶囊导航居中 · 操作居右（原型 2026-09-30 版 wf-appbar：桌面无侧栏）===== -->
  <header class="v2nav-bar" :data-current="onDashboard ? 'dashboard' : 'other'">
    <div class="v2nav-bar__left">
      <button v-if="showBack" type="button" class="v2nav-back" aria-label="返回上一页" @click="goBack">
        <ChevronLeft :size="20" :stroke-width="2" aria-hidden="true" />
      </button>
      <router-link to="/dashboard" class="v2nav-bar__brand" aria-label="问流 WenFlow，返回工作台">
        <img :src="isDark ? '/logo-dark.png' : '/logo.png'" alt="" class="v2nav-bar__logo" />
      </router-link>
      <strong v-if="pageTitle" class="v2nav-bar__title" :class="{ 'v2nav-bar__title--dash': onDashboard }">{{ pageTitle }}</strong>
    </div>

    <!-- 桌面主导航（≥1024）：图标+文字胶囊，<1024 由底部 dock 接管 -->
    <nav class="v2nav-topnav" aria-label="主导航">
      <router-link
        v-for="item in items"
        :key="item.to"
        :to="item.to"
        class="v2nav-topnav__link"
        :class="{ 'v2nav-topnav__link--active': isActive(item) }"
        :aria-current="isActive(item) ? 'page' : undefined"
      >
        <component :is="item.icon" :size="18" :stroke-width="1.75" aria-hidden="true" />
        <span>{{ item.label }}</span>
      </router-link>
    </nav>

    <div class="v2nav-bar__right">
      <V2NotifCenter />
      <div class="v2nav__user" ref="userMenuRef">
        <button
          type="button"
          class="v2nav__avatar"
          :aria-expanded="menuOpen ? 'true' : 'false'"
          aria-haspopup="menu"
          :aria-label="`账户菜单：${userName}`"
          @click="menuOpen = !menuOpen"
        >
          <i>{{ avatarLetter }}</i>
        </button>
        <Transition name="v2menu">
          <div v-if="menuOpen" class="v2nav__menu" role="menu">
            <div class="v2nav__menu-head">
              <span class="v2nav__name">{{ userName }}</span>
              <span class="v2nav__menu-role">学习者</span>
            </div>
            <router-link to="/user/account" role="menuitem" @click="menuOpen = false">
              <UserRound :size="15" :stroke-width="1.75" aria-hidden="true" />
              <span>个人中心</span>
            </router-link>
            <router-link to="/user/achievements" role="menuitem" @click="menuOpen = false">
              <Trophy :size="15" :stroke-width="1.75" aria-hidden="true" />
              <span>我的成就</span>
            </router-link>
            <router-link to="/user/learning-history" role="menuitem" @click="menuOpen = false">
              <History :size="15" :stroke-width="1.75" aria-hidden="true" />
              <span>学习历史</span>
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
import { Activity, ChevronLeft, History, House, Layers2, LogOut, MessageCircle, Moon, Sun, Trophy, UserRound, Waypoints } from 'lucide-vue-next';
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

/* 图标统一走 lucide（1.75 线宽与全站一致）；逐项对齐原型 2026-09-30 版顶栏：
   学习台=House、目标规划=圆角气泡 MessageCircle（原型对话气泡，非方框带线）、
   学习路径=两层叠 Layers2（原型双层，非三层）、知识图谱=Waypoints、学习状态=Activity */
const items: Array<{ to: string; label: string; match: string[]; icon: Component }> = [
  { to: '/dashboard', label: '学习台', match: ['/dashboard'], icon: House },
  { to: '/goal-conversation', label: '目标规划', match: ['/goal-conversation'], icon: MessageCircle },
  { to: '/learning-paths', label: '学习路径', match: ['/learning-paths', '/learning-path'], icon: Layers2 },
  { to: '/knowledge-map', label: '知识图谱', match: ['/knowledge-map'], icon: Waypoints },
  { to: '/learning-state', label: '学习状态', match: ['/learning-state'], icon: Activity }
];
/* 「成就」「学习历史」不进主导航（2026-09-24 用户拍板收进个人中心分段），
   头像菜单保留两条捷径（原型 wf-user-menu 同款五项） */

function isActive(item: { to: string; match: string[] }) {
  // 个人中心 /user/* 挂在「学习台」簇下（从学习台头像菜单进入）：给入口一个当前态
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

/* 主题切换：单一事实源 = <html data-theme>（useIsDark），入口在头像菜单（原型同款） */
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
/* ===== 顶栏（品牌 · 胶囊导航 · 操作）：不透明平面条，sticky 于页面滚动 =====
   批次 D（2026-10-02）平面化：原为 rgba(255,255,255,.94) + blur(10px) 毛玻璃。
   粘性顶栏下滚时内容从其下穿过，半透明无模糊会让文字「糊在一起」；
   规范的材质语言是「平面 + 1px 发丝线」，分层靠线不靠模糊。
   底色改引 --mk-surface（暗色档由 tokens.css 自动翻转，不再需要 --v2nav-bg
   这个半透明兜底——它在暗色下曾是一层白纱）。 */
.v2nav-bar {
  position: sticky; top: 0; z-index: 30;
  display: flex; align-items: center; gap: 8px;
  padding: calc(10px + env(safe-area-inset-top, 0px)) 16px 10px;
  background: var(--mk-surface);
  border-bottom: 1px solid var(--mk-line);
}
.v2nav-bar__left { display: flex; align-items: center; gap: 8px; min-width: 0; }
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
.v2nav-bar__logo { height: 38px; width: auto; object-fit: contain; display: block; }
.v2nav-bar__title {
  margin: 0;
  font-size: 17px; font-weight: 800; letter-spacing: -0.01em;
  color: var(--ink, #172033);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.v2nav-bar__right { display: flex; align-items: center; gap: 2px; margin-left: auto; }

/* 桌面主导航（原型 wf-topnav）：默认隐藏，≥1024 居中胶囊 */
.v2nav-topnav { display: none; }
@media (min-width: 1024px) {
  /* 品牌与操作两翼 flex:1 把导航推到真正居中（原型同款三段式） */
  .v2nav-bar__left { flex: 1 1 0; }
  .v2nav-bar__right { flex: 1 1 0; justify-content: flex-end; margin-left: 0; }
  .v2nav-topnav {
    display: flex; align-items: center; gap: 2px; flex: none;
    margin: 0 8px;
  }
  .v2nav-topnav__link {
    display: flex; align-items: center; gap: 7px;
    min-height: 40px; padding: 0 12px;
    border-radius: 999px;
    color: var(--muted, #5b6577);
    font-size: 13.5px; font-weight: 600; text-decoration: none;
    white-space: nowrap;
    transition: background 0.14s ease, color 0.14s ease;
  }
  .v2nav-topnav__link svg { flex: none; opacity: 0.82; }
  .v2nav-topnav__link:hover { background: var(--mk-surface-2, #eef2fa); color: var(--ink, #172033); }
  .v2nav-topnav__link--active { background: color-mix(in srgb, var(--blue) 10%, transparent); color: var(--blue-deep, #1f57cc); }
  .v2nav-topnav__link--active svg { opacity: 1; }
  .v2nav-topnav__link:focus-visible { outline: 2px solid var(--blue); outline-offset: 2px; }
}

/* 窄屏：dashboard 显品牌、其余屏显标题（原型同款互斥）；≥1024 品牌常驻
   （位置感由导航胶囊表达，原型已在桌面隐藏页题） */
.v2nav-bar__brand { display: none; }
.v2nav-bar__title { display: none; }
.v2nav-bar__title--dash { display: none; }
@media (max-width: 1023.98px) {
  .v2nav-bar[data-current='dashboard'] .v2nav-bar__brand { display: flex; }
  .v2nav-bar:not([data-current='dashboard']) .v2nav-bar__title { display: block; }
}
@media (min-width: 1024px) {
  .v2nav-bar__brand { display: flex; }
}

/* ===== 头像菜单（沿用既有类名：v2nav.fallback 测试与页内样式依赖）===== */
.v2nav__user { position: relative; }
/* 头像-only（原型 wf-avatar）：名字移进菜单头，正文区不再重复身份 */
.v2nav__avatar {
  display: grid; place-items: center;
  width: 44px; height: 44px;
  font: inherit;
  background: transparent;
  border: 0;
  border-radius: 50%;
  cursor: pointer;
  transition: background 0.15s ease;
}
.v2nav__avatar:hover { background: color-mix(in srgb, var(--surface) 92%, var(--ink)); }
.v2nav__avatar i {
  width: 34px; height: 34px; border-radius: 50%;
  /* 扁平强调色底 + 同色系首字母（2026-09-24 去炫彩口径），与导航活跃态同一语言 */
  background: color-mix(in srgb, var(--blue) 12%, transparent);
  color: var(--blue-deep, #1f57cc);
  font-style: normal; font-size: 14px; font-weight: 800;
  display: grid; place-items: center;
}
.v2nav__menu {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  min-width: 180px;
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
/* 菜单头（原型 wf-popover__title）：名字 + 身份，替代旧顶栏常显用户名 */
.v2nav__menu-head {
  padding: 8px 10px 6px;
  display: flex; align-items: baseline; gap: 6px;
  border-bottom: 1px solid var(--line, #e3e9f4);
  margin-bottom: 4px;
}
.v2nav__name {
  font-size: 13px; font-weight: 800;
  color: var(--ink, #172033);
  min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.v2nav__menu-role { font-size: 12px; color: var(--faint, #8492ab); flex: none; }
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
/* 窄屏顶栏：头像 44px 触控（已由基线保证），图标微缩 */
@media (max-width: 1023.98px) {
  .v2nav__right { gap: 4px; }
  .v2nav__right :deep(.nc__bell) { width: 44px; height: 44px; }
  .v2nav__right :deep(.nc__bell svg) { width: 19px; height: 19px; }
  .v2nav__avatar i { width: 28px; height: 28px; font-size: 12px; }
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
