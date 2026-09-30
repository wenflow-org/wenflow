<template>
  <header class="mknav" :class="{ 'mknav--on': scrolled || menuOpen }">
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
      </div>
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
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { Moon, Sun } from 'lucide-vue-next'
import { useIsDark } from '@/composables/useIsDark';
import { applyDocumentTheme, writeTheme } from '@/utils/theme';

const isDark = useIsDark();
import { useRoute } from 'vue-router'

const props = defineProps<{ loggedIn: boolean }>()

const route = useRoute()
const scrolled = ref(false)
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

function onScroll() {
  scrolled.value = window.scrollY > 20
}

onMounted(() => {
  window.addEventListener('scroll', onScroll, { passive: true })
  onScroll()
})

onUnmounted(() => {
  window.removeEventListener('scroll', onScroll)
  document.body.style.overflow = ''
})
</script>

<style scoped>
.mknav {
  --ink: var(--mk-ink);
  --line: var(--mk-line);
  --blue: #3478f6;
  --blue-deep: #1f57cc;
  --nav-bg: rgba(255, 255, 255, 0.88);
  --nav-shadow: rgba(15, 23, 42, 0.1);
  --btn-ghost-bg: rgba(255, 255, 255, 0.74);
  --burger-bg: rgba(255, 255, 255, 0.8);
  --drawer-bg: rgba(255, 255, 255, 0.96);
  --link-row-bg: #f7faff;
  --ease: cubic-bezier(0.16, 1, 0.3, 1);
  [data-theme='dark'] & {
    --ink: var(--mk-ink);
    --line: var(--mk-line);
    --blue: #4d8bf8;
    --blue-deep: #6fa3ff;
    --nav-bg: rgba(15, 22, 32, 0.88);
    --nav-shadow: rgba(0, 0, 0, 0.45);
    --btn-ghost-bg: rgba(24, 34, 48, 0.66);
    --burger-bg: rgba(24, 34, 48, 0.72);
    --drawer-bg: rgba(17, 25, 36, 0.97);
    --link-row-bg: rgba(230, 237, 247, 0.05);
  }
  position: fixed;
  inset: 0 0 auto;
  z-index: 40;
  border-bottom: 1px solid transparent;
  transition: 0.24s ease;
}
.mknav--on {
  background: var(--nav-bg);
  border-color: var(--line);
  box-shadow: 0 14px 40px rgba(15, 23, 42, 0.06);
}
[data-theme='dark'] .mknav--on {
  box-shadow: 0 14px 40px rgba(0, 0, 0, 0.38);
}
.mknav__shell {
  width: min(1180px, calc(100% - 48px));
  margin: 0 auto;
}
.mknav__in {
  min-height: 72px;
  display: flex;
  align-items: center;
  gap: 20px;
}
.mknav__logo img {
  height: 48px;
  display: block;
}
.mknav__links {
  display: flex;
  gap: 2px;
  flex: 1;
  margin-left: 28px;
}
.mknav__link {
  padding: 8px 14px;
  border-radius: var(--mk-radius-pill);
  font-size: 14px;
  font-weight: 700;
  color: color-mix(in srgb, var(--ink) 72%, #fff);
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
  display: flex;
  align-items: center;
  gap: 10px;
  margin-left: auto;
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
  color: var(--ink, #172033);
}
.mknav__icon:focus-visible {
  outline: 2px solid var(--blue, #2c63d0);
  outline-offset: 2px;
}
.mknav__btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 42px;
  padding: 0 16px;
  border-radius: var(--mk-radius-pill);
  font-size: 14px;
  font-weight: 800;
  text-decoration: none;
  border: 1px solid transparent;
  transition: transform 0.2s var(--ease), box-shadow 0.2s var(--ease);
  width: fit-content;
}
.mknav__btn:hover {
  transform: translateY(-2px);
}
.mknav__btn:active {
  transform: translateY(0) scale(0.98);
}
.mknav__btn--primary {
  color: #fff;
  background: linear-gradient(135deg, var(--blue), var(--blue-deep));
  box-shadow: 0 16px 34px color-mix(in srgb, var(--blue) 22%, transparent);
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

@media (max-width: 980px) {
  /* 移动端只留三件：品牌 · 主题钮 · 汉堡（原型 wf-pnav ≤980：links 与两个
     文字钮全隐，图标钮保留 42px）。汉堡是比原型多带的移动端导航能力。 */
  .mknav__links {
    display: none;
  }
  .mknav__acts {
    display: flex;
    margin-left: auto;
  }
  .mknav__acts .mknav__btn {
    display: none;
  }
  /* 原型 wf-pnav ≤980：64px 条高 + 36px logo（移动首屏被导航吃掉过多高度） */
  .mknav__in {
    min-height: 64px;
  }
  .mknav__logo img {
    height: 36px;
  }
  .mknav__icon {
    width: 42px;
    height: 42px;
  }
  .mknav__burger {
    display: block;
    margin-left: 10px;
  }
  .mknav__drawer {
    display: grid;
    gap: 8px;
    margin: 0 auto 14px;
    padding: 16px;
    border-radius: 20px;
    background: var(--drawer-bg);
    border: 1px solid var(--line);
    box-shadow: 0 18px 48px var(--nav-shadow, rgba(15, 23, 42, 0.1));
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
  [data-theme='dark'] .mknav__drawer .mknav__link.is-on {
    background: rgba(77, 139, 248, 0.18);
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
