<template>
  <header class="mknav">
    <div class="mknav__shell mknav__in">
      <router-link to="/" class="mknav__logo" @click="closeMenu">
        <img :src="isDark ? '/logo-dark.png' : '/logo.png'" alt="问流 WenFlow" />
      </router-link>
      <nav class="mknav__links" aria-label="页面导航">
        <router-link
          to="/"
          class="mknav__link"
          :class="{ 'is-on': route.path === '/' }"
          @click="onNavHome"
        >首页</router-link>
        <router-link
          to="/vision"
          class="mknav__link"
          :class="{ 'is-on': route.path === '/vision' }"
          @click="closeMenu"
        >愿景</router-link>
        <a href="https://github.com/wenflow-org/wenflow" target="_blank" rel="noreferrer" class="mknav__link" @click="closeMenu">GitHub</a>
      </nav>
      <div class="mknav__acts">
        <!-- 主题切换降噪（原型 wf-pnav 同款）：顶栏内不描边，只留 hover 反馈，
             让「登录 / 从一个问题开始」保持为唯一两个按钮 -->
        <button
          type="button"
          class="mknav__icon"
          :aria-label="isDark ? '切换到亮色模式' : '切换到暗色模式'"
          @click="toggleTheme"
        >
          <Sun v-if="isDark" :size="19" :stroke-width="1.75" aria-hidden="true" />
          <Moon v-else :size="19" :stroke-width="1.75" aria-hidden="true" />
        </button>
        <router-link :to="secondaryPath" class="mknav__btn mknav__btn--ghost">{{ secondaryLabel }}</router-link>
        <router-link :to="primaryPath" class="mknav__btn mknav__btn--primary">{{ primaryLabel }}</router-link>
        <button
          type="button"
          class="mknav__burger"
          :class="{ 'mknav__burger--open': menuOpen }"
          :aria-label="menuOpen ? '关闭菜单' : '打开菜单'"
          :aria-expanded="menuOpen"
          @click="menuOpen = !menuOpen"
        >
          <span /><span /><span />
        </button>
      </div>
    </div>
    <Transition name="mknav-drawer">
      <div v-if="menuOpen" class="mknav__drawer mknav__shell">
        <router-link
          to="/"
          class="mknav__link"
          :class="{ 'is-on': route.path === '/' }"
          @click="onNavHome"
        >首页</router-link>
        <router-link
          to="/vision"
          class="mknav__link"
          :class="{ 'is-on': route.path === '/vision' }"
          @click="closeMenu"
        >愿景</router-link>
        <a href="https://github.com/wenflow-org/wenflow" target="_blank" rel="noreferrer" class="mknav__link" @click="closeMenu">GitHub</a>
        <router-link :to="secondaryPath" class="mknav__btn mknav__btn--ghost" @click="closeMenu">{{ secondaryLabel }}</router-link>
        <router-link :to="primaryPath" class="mknav__btn mknav__btn--primary" @click="closeMenu">{{ primaryLabel }}</router-link>
      </div>
    </Transition>
  </header>
</template>

<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import { Moon, Sun } from 'lucide-vue-next'
import { useIsDark } from '@/composables/useIsDark';
import { applyDocumentTheme, writeTheme } from '@/utils/theme';

const isDark = useIsDark();
import { useRoute } from 'vue-router'

const props = defineProps<{ loggedIn: boolean }>()

const route = useRoute()
const menuOpen = ref(false)

/* 主题切换：与用户侧唯一事实源同一套读写（v2_theme + 兼容 key），
   公开页此前没有任何切换入口（原型 wf-pnav 带降噪图标钮） */
function toggleTheme() {
  const next = !isDark.value
  applyDocumentTheme(next ? 'dark' : 'light')
  writeTheme(next ? 'dark' : 'light')
}

const primaryPath = computed(() => (props.loggedIn ? '/goal-conversation' : '/register'))
const secondaryPath = computed(() => (props.loggedIn ? '/dashboard' : '/login'))
const primaryLabel = computed(() => (props.loggedIn ? '规划新目标' : '从一个问题开始'))
const secondaryLabel = computed(() => (props.loggedIn ? '回到学习台' : '登录'))

function closeMenu() {
  menuOpen.value = false
}

/* 已在首页时点击「首页」→ 平滑回到顶部 */
function onNavHome() {
  if (route.path === '/') {
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }
  closeMenu()
}

watch(menuOpen, (open) => {
  document.body.style.overflow = open ? 'hidden' : ''
})

onUnmounted(() => {
  document.body.style.overflow = ''
})
</script>

<style scoped>
.mknav {
  --ink: var(--mk-ink);
  --muted: var(--mk-muted);
  --line: var(--mk-line);
  --surface: var(--mk-surface);
  /* 品牌蓝全站同一事实源（原型 --blue / --blue-deep 与 --mk-* 同值，暗色随主题自动翻转） */
  --blue: var(--mk-blue);
  --blue-deep: var(--mk-accent-deep);
  --nav-bg: var(--surface);
  --nav-shadow: var(--wf-shadow-overlay);
  --btn-ghost-bg: var(--surface);
  --burger-bg: var(--surface);
  --drawer-bg: var(--surface);
  --link-row-bg: color-mix(in srgb, var(--blue) 6%, transparent);
  --ease: var(--mk-ease-out);
  [data-theme='dark'] & {
    --link-row-bg: color-mix(in srgb, var(--blue) 8%, transparent);
  }
  /* 原型 wf-pnav：sticky 常显底色 + 下边框（不再等滚动才上底色），三区居中栅格 */
  position: sticky;
  top: 0;
  z-index: 30;
  /* 「友好而平」：材质一律平面化。顶栏原先是 86% 半透明 + backdrop-filter: blur(10px) 的磨砂玻璃，
     玻璃会随滚动内容变色、且在低性能设备上掉帧；改为 --surface 实底，只保留下边框发丝线来分隔层次。 */
  background: var(--nav-bg);
  border-bottom: 1px solid var(--line);
}
.mknav__shell {
  width: min(1180px, calc(100% - 48px));
  margin: 0 auto;
}
.mknav__in {
  min-height: 72px;
  /* 三区栅格：品牌居左 · 导航居中 · 操作居右（原型 wf-pnav__in） */
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  grid-template-areas: 'brand links acts';
  align-items: center;
  column-gap: 20px;
}
.mknav__logo {
  grid-area: brand;
  justify-self: start;
  display: inline-flex;
  align-items: center;
  border-radius: var(--mk-radius-xl);
}
.mknav__logo img {
  height: 44px;
  display: block;
}
.mknav__links {
  grid-area: links;
  justify-self: center;
  display: flex;
  gap: 4px;
}
.mknav__link {
  padding: 9px 14px;
  /* 圆角 12px = 抽屉里同一批导航行（.mknav__drawer a）与同栏 logo/主题钮的档位。
     原型 .wf-pnav__link 是直角，用户拍板「还是做成圆角的」——悬停/选中都是整块浅蓝底，
     直角在顶栏里读成「一块被裁切的色块」，圆角才读成「一个可点的项」。 */
  border-radius: var(--mk-radius-xl);
  font-size: 14px;
  font-weight: 700;
  color: var(--muted);
  text-decoration: none;
  transition: background 0.2s var(--ease), color 0.2s var(--ease);
}
.mknav__link:hover {
  background: color-mix(in srgb, var(--blue) 8%, transparent);
  color: var(--blue-deep);
}
.mknav__link.is-on {
  color: var(--blue-deep);
  background: color-mix(in srgb, var(--blue) 10%, transparent);
}
.mknav__acts {
  grid-area: acts;
  justify-self: end;
  display: flex;
  align-items: center;
  gap: 10px;
}
/* 主题切换：降噪图标钮（原型 wf-pnav .wf-piconbtn：44px、12px 圆角、无描边底，
   仅 hover/焦点反馈）——公开页此前无任何主题入口 */
.mknav__icon {
  width: 44px;
  height: 44px;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: 12px;
  background: transparent;
  color: var(--muted, #5b6577);
  cursor: pointer;
  transition: background 0.14s ease, color 0.14s ease;
}
.mknav__icon:hover {
  background: color-mix(in srgb, var(--blue) 10%, transparent);
  color: var(--blue-deep);
}
.mknav__icon:focus-visible {
  outline: 2px solid var(--blue);
  outline-offset: 2px;
}
.mknav__btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 44px;
  padding: 0 18px;
  border-radius: var(--mk-radius-pill);
  font-size: 15px;
  font-weight: 800;
  text-decoration: none;
  border: 1px solid transparent;
  /* 平面化后按钮已无彩色投影，transition 里一并去掉 box-shadow，只留 :active 用到的 transform */
  transition: transform 0.18s var(--ease);
  width: fit-content;
}
/* 「友好而平」：取消 hover 上浮。悬停只允许改背景/描边/文字，位移一律不做，
   按压反馈留给 :active 的 scale(0.98)。 */
.mknav__btn:active {
  transform: scale(0.98);
}
.mknav__btn:focus-visible {
  outline: 2px solid var(--blue);
  outline-offset: 2px;
}
/* 主按钮：实心品牌蓝，不再用 linear-gradient(135deg, …)；
   原先的 0 14px 30px 蓝色投影属于彩色光晕，一并退休。 */
.mknav__btn--primary {
  color: #fff;
  background: var(--blue);
  transition: transform 0.18s var(--ease), background 0.18s var(--ease);
}
/* 悬停改用 darker 蓝档（--blue-deep 即 --wf-color-primary-dark），不给投影 */
.mknav__btn--primary:hover {
  background: var(--blue-deep);
}
.mknav__btn--ghost {
  color: var(--ink);
  background: var(--btn-ghost-bg);
  border-color: var(--line);
}
.mknav__burger {
  display: none;
  width: 42px;
  height: 42px;
  border: 1px solid var(--line);
  border-radius: 14px;
  background: var(--burger-bg);
  cursor: pointer;
}
.mknav__burger span {
  display: block;
  width: 18px;
  height: 2px;
  margin: 4px auto;
  background: var(--ink);
  border-radius: 99px;
  transition: transform 0.28s var(--ease), opacity 0.2s var(--ease);
}
.mknav__burger--open span:nth-child(1) {
  transform: translateY(6px) rotate(45deg);
}
.mknav__burger--open span:nth-child(2) {
  opacity: 0;
}
.mknav__burger--open span:nth-child(3) {
  transform: translateY(-6px) rotate(-45deg);
}
.mknav__drawer {
  display: none;
}
.mknav-drawer-enter-active,
.mknav-drawer-leave-active {
  transition: opacity 0.24s var(--ease), transform 0.24s var(--ease);
}
.mknav-drawer-enter-from,
.mknav-drawer-leave-to {
  opacity: 0;
  transform: translateY(-10px);
}

/* 原型 wf-rise 入场编排：顶栏 0.6s 上浮（reduced-motion 由 main.css 全局压到瞬时） */
@media (prefers-reduced-motion: no-preference) {
  .mknav {
    animation: mknav-rise 0.6s var(--ease) both;
  }
}
@keyframes mknav-rise {
  from {
    opacity: 0;
    transform: translateY(26px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

@media (max-width: 980px) {
  /* 原型 wf-pnav ≤980：两区栅格（品牌 · 操作），主导航折叠；64px 条高 + 36px logo。
     汉堡是比原型多带的移动端导航能力（原型窄屏不提供页间跳转）。 */
  .mknav__in {
    grid-template-columns: 1fr auto;
    grid-template-areas: 'brand acts';
    min-height: 64px;
  }
  .mknav__links {
    display: none;
  }
  .mknav__acts {
    display: flex;
  }
  .mknav__logo img {
    height: 36px;
  }
  .mknav__burger {
    display: block;
  }
  .mknav__drawer {
    display: grid;
    gap: 8px;
    margin: 0 auto 14px;
    padding: 16px;
    border-radius: 20px;
    background: var(--drawer-bg);
    border: 1px solid var(--line);
    /* 悬浮抽屉：投影对齐中性 overlay 档（--wf-shadow-overlay），去掉原先自定的 4 档阴影值 */
    box-shadow: var(--nav-shadow);
  }
  .mknav__drawer a:not(.mknav__btn) {
    padding: 12px;
    border-radius: var(--mk-radius-xl);
    text-decoration: none;
    color: var(--ink);
    font-weight: 700;
    background: var(--link-row-bg);
  }
  .mknav__drawer .mknav__link.is-on {
    color: var(--blue-deep);
    background: color-mix(in srgb, var(--blue) 10%, transparent);
  }
}

/* 原型 wf-pub ≤760：容器收窄 + 按钮降档（40/14/14） */
@media (max-width: 760px) {
  .mknav__shell {
    width: min(100% - 28px, 1180px);
  }
  .mknav__acts {
    gap: 8px;
  }
  .mknav__btn {
    min-height: 40px;
    padding: 0 14px;
    font-size: 14px;
  }
}

/* 原型 wf-pnav ≤600：操作区只留主题图标（两个文字钮移入页面/抽屉），logo 放大到 40px */
@media (max-width: 600px) {
  .mknav__in {
    column-gap: 12px;
  }
  .mknav__logo img {
    height: 40px;
  }
  .mknav__acts .mknav__btn {
    display: none;
  }
  .mknav__icon {
    width: 42px;
    height: 42px;
  }
}

/* 超大屏（2K/4K）：nav 随视口放大，与页面容器同宽 */
@media (min-width: 2000px) {
  .mknav__shell {
    width: min(1560px, calc(100% - 64px));
  }
  .mknav__in {
    min-height: 84px;
  }
  .mknav__logo img {
    height: 58px;
  }
  .mknav__link {
    font-size: 16px;
    padding: 10px 18px;
  }
  .mknav__btn {
    min-height: 48px;
    padding: 0 20px;
    font-size: 16px;
  }
}
</style>
