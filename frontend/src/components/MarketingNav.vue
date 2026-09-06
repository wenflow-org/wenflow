<template>
  <header class="mknav" :class="{ 'mknav--on': scrolled || menuOpen }">
    <div class="mknav__shell mknav__in">
      <router-link to="/" class="mknav__logo" @click="closeMenu">
        <img src="/logo.png" alt="问流 WenFlow" />
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
import { useRoute } from 'vue-router'

const props = defineProps<{ loggedIn: boolean }>()

const route = useRoute()
const scrolled = ref(false)
const menuOpen = ref(false)

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
  --ink: #172033;
  --line: rgba(23, 32, 51, 0.08);
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
    --ink: #e6edf7;
    --line: rgba(230, 237, 247, 0.14);
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
  backdrop-filter: blur(18px);
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
  border-radius: 999px;
  font-size: 14px;
  font-weight: 700;
  color: color-mix(in srgb, var(--ink) 72%, #fff);
  text-decoration: none;
  transition: background 0.2s var(--ease), color 0.2s var(--ease);
}
.mknav__link:hover {
  background: rgba(52, 120, 246, 0.08);
  color: var(--blue-deep);
}
.mknav__link.is-on {
  color: var(--blue-deep);
  background: rgba(52, 120, 246, 0.1);
}
.mknav__acts {
  display: flex;
  gap: 10px;
  margin-left: auto;
}
.mknav__btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 42px;
  padding: 0 16px;
  border-radius: 999px;
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
  box-shadow: 0 16px 34px rgba(52, 120, 246, 0.22);
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
  .mknav__links,
  .mknav__acts {
    display: none;
  }
  .mknav__burger {
    display: block;
    margin-left: auto;
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
    border-radius: 12px;
    text-decoration: none;
    color: var(--ink);
    font-weight: 700;
    background: var(--link-row-bg);
  }
  .mknav__drawer .mknav__link.is-on {
    color: var(--blue-deep);
    background: rgba(52, 120, 246, 0.1);
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
