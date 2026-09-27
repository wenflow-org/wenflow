<template>
  <header class="v2nav">
    <div class="v2nav__in">
      <router-link to="/dashboard" class="v2nav__brand" aria-label="问流 WenFlow，返回工作台">
        <img :src="isDark ? '/logo-dark.png' : '/logo.png'" alt="" class="v2nav__logo" />
      </router-link>
      <nav class="v2nav__links">
        <router-link
          v-for="item in items"
          :key="item.to"
          :to="item.to"
          :class="{ active: isActive(item) }"
          :aria-current="isActive(item) ? 'page' : undefined"
        >{{ item.label }}</router-link>
      </nav>
      <div class="v2nav__right">
        <V2NotifCenter />
        <router-link
          to="/goal-conversation"
          class="v2nav__cta"
          @click="onNewGoalClick"
        >规划新目标</router-link>
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
      :aria-current="isActive(item) ? 'page' : undefined"
    >
      <span class="v2nav__tab-icon" aria-hidden="true">
        <component :is="item.icon" :size="20" :stroke-width="1.75" />
      </span>
      <span class="v2nav__tab-label">{{ item.label }}</span>
    </router-link>
  </nav>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, type Component } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { Activity, ChevronDown, House, Layers, LogOut, MessageSquareText, Moon, Sun, UserRound, Waypoints } from 'lucide-vue-next';
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

/* 图标统一走 lucide（1.75 线宽与全站一致），替代原 v-html 字符串注入（批15） */
const items: Array<{ to: string; label: string; match: string[]; icon: Component }> = [
  { to: '/dashboard', label: '学习台', match: ['/dashboard'], icon: House },
  { to: '/goal-conversation', label: '目标规划', match: ['/goal-conversation'], icon: MessageSquareText },
  { to: '/learning-paths', label: '学习路径', match: ['/learning-paths', '/learning-path'], icon: Layers },
  { to: '/knowledge-map', label: '知识图谱', match: ['/knowledge-map'], icon: Waypoints },
  { to: '/learning-state', label: '学习状态', match: ['/learning-state'], icon: Activity }
];
/* 「成就」「学习历史」不再是顶层入口（2026-09-24 用户拍板：成就意义不大、历史也太细），
   移到个人中心 /user/achievements、/user/learning-history，走 CapabilityShell 的分段导航；
   旧路径保留重定向，站内入口（首页快捷卡、复习行、状态页、路径详情）已改指新路径。 */

function isActive(item: { to: string; match: string[] }) {
  // 个人中心 /user/* 挂在「学习台」簇下（从学习台头像进入）：给 tab 一个当前态，
  // 否则 5 个 tab 全灭、层级感丢失（2026-09-25 移动框架审查 A8）
  if (route.path.startsWith('/user') && item.to === '/dashboard') return true;
  return item.match.some((m) => route.path.startsWith(m));
}

/**
 * 已在目标规划页内点击「规划新目标」：router-link 同路由不触发导航，
 * 派发事件由 V2GoalConversation 监听并重置视图（清内存、保留本地恢复入口）。
 */
function onNewGoalClick() {
  // 按路由 name 判断：深链 /goal-conversation/gc_xxx 与无参路由同样命中
  if (route.name === 'V2GoalConversation') {
    window.dispatchEvent(new CustomEvent('v2:new-goal'));
  }
}

const userName = computed(() => userStore.user?.name || '学习者');
const avatarLetter = computed(() => (userStore.user?.name || '学').charAt(0));

/* 主题切换（原 ThemeToggle 逻辑，移入头像菜单）。
   isDark 改用 useIsDark 组合式（单一事实源 = <html data-theme>）：此前自维护 ref，
   别处（如路由 syncThemeForRoute）改主题时这里不同步，logo 暗色版/菜单文案会错位 */
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
.v2nav {
  background: var(--v2nav-bg, rgba(255, 255, 255, 0.94));
  border-bottom: 1px solid var(--line, #e3e9f4);
  position: sticky; top: 0; z-index: 30;
  /* 毛玻璃：94% 半透明底在滚动时会让下层文字透出（移动端走查实测详情/状态页重影），
     blur 后保留通透观感同时压掉透字 */
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
}
/* 内层容器：与页面内容同宽居中（<1680 时 1080，大屏 1360），zoom 下与页面容器天然对齐 */
.v2nav__in {
  width: min(1080px, calc(100% - 56px));
  margin: 0 auto;
  display: flex; align-items: center; gap: 28px;
  height: 72px;
}
.v2nav__brand { display: flex; align-items: center; cursor: pointer; }
.v2nav__logo { height: 48px; width: auto; object-fit: contain; display: block; }
/* 链接在导航条中靠 logo 排列（与营销页导航一致） */
.v2nav__links {
  display: flex; gap: 2px; margin-left: 28px;
}
/* 主导航链接：44px 高 + 14.5px 字号（比 CTA 更突出，主次层级正确） */
.v2nav__links a {
  padding: 11px 16px; border-radius: var(--mk-radius-pill);
  font-size: 14.5px; font-weight: 700; color: var(--muted, #5b6577);
  cursor: pointer; text-decoration: none; transition: color 0.14s ease, background 0.14s ease;
}
.v2nav__links a:hover { color: var(--blue-deep, #1f57cc); background: rgba(52, 120, 246, 0.08); }
.v2nav__links a.active { color: var(--blue-deep, #1f57cc); background: rgba(52, 120, 246, 0.1); }
.v2nav__right { display: flex; align-items: center; gap: 12px; margin-left: auto; }
/* 规划新目标 CTA：36px 高（次级动作，弱于主导航链接）。
   flex-shrink: 0 + nowrap：防止窄屏 flex 行把按钮压缩到文字宽度以下，
   导致文字竖排换行、按钮纵向膨胀超出导航栏并裁出视口顶部（ISSUE-001）。 */
.v2nav__cta {
  display: inline-flex; align-items: center; justify-content: center;
  min-height: 36px; padding: 0 14px; border-radius: var(--mk-radius-pill);
  background: linear-gradient(135deg, var(--blue, #3478f6), var(--blue-deep, #1f57cc));
  color: #fff; font-size: 13px; font-weight: 800;
  box-shadow: 0 6px 14px color-mix(in srgb, var(--blue) 26%, transparent);
  cursor: pointer; text-decoration: none;
  white-space: nowrap; flex-shrink: 0;
  transition: transform 0.18s ease, box-shadow 0.18s ease;
}
.v2nav__cta:hover {
  transform: translateY(-1px);
  box-shadow: 0 9px 18px color-mix(in srgb, var(--blue) 32%, transparent);
}
.v2nav__cta:active {
  transform: translateY(0) scale(0.98);
}
.v2nav__user { position: relative; }
.v2nav__avatar {
  display: flex; align-items: center; gap: 8px;
  /* font 简写写在 font-size/font-weight 之前，否则会把两者一起重置为继承值——
     桌面端用户名因此一直按 16px 渲染，比主导航链接（14.5px）还大（2026-09-26
     用户侧对齐走查扫出的同族死规则，另一个在 V2LearningPage .kp__head）。
     修后层级：主导航 14.5 > 用户名 13.5 > CTA 13。 */
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
  /* 1152~1600 区间导航行刚好占满容器，头像作为最后一个可压缩的 flex 项被压成 28.6×34
     （圆被拉成椭圆）。定死不参与收缩后实测该区间恢复正圆，其余元素尺寸与横向溢出均无变化。 */
  flex: 0 0 auto;
  /* 去炫彩：原来是 blue→accent(#8d6bff) 跨色相渐变 + 蓝色光晕，全站唯一一处，
     深色主题下就是一颗发光紫蓝球（2026-09-24 反馈「头像区太炫彩了，感觉不和主题」）。
     改成扁平强调色底 + 同色系首字母，与导航菜单里的主题图标（blue 10% 底 + blue-deep）
     以及聊天头像（.msg__avatar 早已去掉同一套渐变改 surface+描边）同一语言。 */
  background: color-mix(in srgb, var(--blue, #3478f6) 12%, transparent);
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
  background: color-mix(in srgb, var(--blue, #3478f6) 8%, var(--surface));
}
/* 主题切换项：与其他菜单项同构（图标统一居左，2026-09-27 用户反馈） */
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
  background: color-mix(in srgb, var(--blue, #3478f6) 10%, transparent);
  color: var(--blue-deep, #1f57cc);
  flex-shrink: 0;
}
.v2nav__menu-danger {
  color: var(--red-ink) !important;
  border-top: 1px solid var(--line, #e3e9f4) !important;
  margin-top: 2px;
  border-radius: 0 0 8px 8px !important;
}
@media (max-width: 1100px) {
  .v2nav__links { display: none; }
  .v2nav__name { display: none; }
}

/* 移动端顶部导航：高度 72→56，CTA 36→32，间距收窄。
   比例：logo 由 34 提到 44（132px 宽），右侧三件套整体收小（铃铛 40→34、图标 20→18、
   头像 28→24、chip 内边距 8/4→6/4、caret 10→9），362px 内容宽里
   「132 品牌标 ↔ 87 操作簇」形成清晰主次；改前是 102 ↔ 104，右重左轻。 */
@media (max-width: 900px) {
  .v2nav__in {
    height: 56px;
    gap: 12px;
    width: calc(100% - 28px);
  }
  .v2nav__logo { height: 44px; }
  .v2nav__cta {
    min-height: 32px;
    padding: 0 12px;
    font-size: 12px;
    box-shadow: 0 4px 10px color-mix(in srgb, var(--blue) 22%, transparent);
  }
  .v2nav__right { gap: 4px; }
  /* 头部图标簇按 HIG 44px 触控下限执行（2026-09-25 移动框架）：铃铛原 34、头像原 32
     都是页级常驻入口，误触/够不着代价高；视觉用小一号图标保持头部密度 */
  .v2nav__right :deep(.nc__bell) { width: 44px; height: 44px; }
  .v2nav__right :deep(.nc__bell svg) { width: 19px; height: 19px; }
  .v2nav__avatar {
    min-width: 44px;
    min-height: 44px;
    display: inline-flex;
    align-items: center;
    padding: 4px 8px 4px 4px;
    font-size: 12.5px;
  }
  .v2nav__avatar i { width: 26px; height: 26px; font-size: 12px; }
  .v2nav__caret { font-size: 9px; }
  /* 手机段隐藏「规划新目标」CTA：底部 tab 的「目标规划」就是同一入口，重复且抢眼——
     84×32 的蓝色大按钮与品牌标并排会抢走主次。隐藏后头部只剩
     logo + 铃铛 + 头像三件套；901–1100 平板段保留（该段无顶部链接，CTA 仍是主动作）。 */
  .v2nav__cta { display: none; }
}

/* 大屏（1680+）：导航内容与页面容器同宽（1360）居中，避免 4K 下内容贴左 */
@media (min-width: 1680px) {
  .v2nav__in {
    width: min(1360px, calc(100% - 56px));
  }
}
</style>

<style scoped>
/* ---------- 移动端底部导航 ---------- */
.v2nav__tabs { display: none; }

@media (max-width: 1100px) {
  .v2nav__tabs {
    display: grid;
    /* 5 个入口（学习台/目标规划/学习路径/知识图谱/学习状态）：
       列数必须与 items 数量一致，否则多出的 tab 换行把导航撑成两行（+49px）。
       新增底部入口时同步改这里。
       minmax(0,1fr) 而非 1fr：1fr 的下限是 min-content，标签变长会把整页撑出横向滚动
       （V2Dashboard.vue 同类问题的注释口径）；minmax(0,1fr) + 标签 ellipsis 兜底。 */
    grid-template-columns: repeat(5, minmax(0, 1fr));
    position: fixed;
    left: 0; right: 0; bottom: 0;
    z-index: 40;
    background: color-mix(in srgb, var(--surface, #ffffff) 96%, transparent);
    border-top: 1px solid var(--line, #e3e9f4);
    padding: 6px 4px calc(6px + env(safe-area-inset-bottom, 0px));
  }
  .v2nav__tab {
    display: grid;
    justify-items: center;
    gap: 3px;
    padding: 6px 2px 4px;
    border-radius: var(--mk-radius-xl);
    color: var(--muted, #5b6577);
    text-decoration: none;
  }
  .v2nav__tab-icon { display: grid; place-items: center; opacity: 0.75; }
  .v2nav__tab-label { font-size: 12px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
  .v2nav__tab--active {
    color: var(--blue-deep, #1f57cc);
  }
  .v2nav__tab--active .v2nav__tab-icon { opacity: 1; }
  .v2nav__tab:active { background: color-mix(in srgb, var(--blue) 8%, transparent); }
  /* ≤360px 窄屏：5 列每列仍有 ~72px，4 字标签 10.5px 放得下，只去左右内边距 */
  @media (max-width: 360px) {
    .v2nav__tabs { padding-left: 0; padding-right: 0; }
    .v2nav__tab { padding-left: 0; padding-right: 0; }
  }
}
</style>
