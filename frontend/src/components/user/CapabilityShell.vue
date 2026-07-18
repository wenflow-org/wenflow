<template>
  <div class="capability-shell">
    <div class="animated-bg">
      <div class="gradient-orb gradient-orb-1"></div>
      <div class="gradient-orb gradient-orb-2"></div>
    </div>

    <header class="shell-header" :class="{ 'shell-header--scrolled': scrolled }">
      <div class="shell-header__inner">
        <button type="button" class="shell-brand" @click="router.push('/dashboard')">
          <img src="/logo.png" alt="问流 WenFlow" class="shell-brand__logo" />
        </button>

        <nav class="shell-nav" aria-label="应用导航">
          <router-link to="/dashboard" class="shell-nav__item">学习台</router-link>
          <router-link to="/goal-conversation" class="shell-nav__item">目标规划</router-link>
          <router-link to="/learning-paths" class="shell-nav__item">学习路径</router-link>
          <router-link to="/learning-state" class="shell-nav__item">学习状态</router-link>
          <router-link to="/achievements" class="shell-nav__item">成就</router-link>
          <router-link to="/user/account" class="shell-nav__item shell-nav__item--current">个人中心</router-link>
        </nav>

        <div class="shell-header__actions">
          <ThemeSwitcher />
          <MobileSiteMenu
            title="个人中心"
            :user-name="userStore.user?.name || '用户'"
            :user-initial="userStore.user?.name?.charAt(0) || 'U'"
            :nav-items="shellNavItems"
            :show-account-link="false"
            @logout="handleLogout"
          />
          <el-dropdown>
            <button type="button" class="shell-user-chip">
              <span class="shell-user-chip__avatar">{{ userStore.user?.name?.charAt(0) || 'U' }}</span>
              <strong>{{ userStore.user?.name || '用户' }}</strong>
            </button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item @click="router.push('/user/account')">个人中心</el-dropdown-item>
                <el-dropdown-item divided @click="handleLogout">退出登录</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
      </div>
    </header>

    <main class="shell-main">
      <div class="shell-container">
        <section class="shell-hero">
          <div>
            <span class="shell-hero__eyebrow">个人中心</span>
            <h1 class="shell-hero__title">{{ title }}</h1>
            <p v-if="description" class="shell-hero__description">{{ description }}</p>
          </div>
          <div v-if="$slots.actions" class="shell-hero__actions">
            <slot name="actions" />
          </div>
        </section>

        <nav class="capability-nav" aria-label="个人中心导航">
          <router-link v-for="item in capabilityNavItems" :key="item.to" :to="item.to" class="capability-nav__item">
            {{ item.label }}
          </router-link>
        </nav>

        <div class="shell-body">
          <slot />
        </div>
      </div>
    </main>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import { ElMessageBox } from 'element-plus';
import { toast } from '../../utils/toast';
import { useRouter } from 'vue-router';
import ThemeSwitcher from '../ThemeSwitcher.vue';
import MobileSiteMenu from '../MobileSiteMenu.vue';
import { useUserStore } from '@/stores/user';

defineProps<{ title: string; description?: string }>();

const router = useRouter();
const userStore = useUserStore();
const scrolled = ref(false);

const shellNavItems = [
  { label: '学习台', to: '/dashboard', matchPrefixes: ['/dashboard'] },
  { label: '学习路径', to: '/learning-paths', matchPrefixes: ['/learning-paths', '/learning-path/'] },
  { label: '学习状态', to: '/learning-state', matchPrefixes: ['/learning-state'] },
  { label: '成就', to: '/achievements', matchPrefixes: ['/achievements'] },
  { label: '个人中心', to: '/user/account', matchPrefixes: ['/user'] }
];

const capabilityNavItems = [
  { label: '账户概览', to: '/user/account' },
  { label: 'AI 助手', to: '/user/agents' },
  { label: 'Skill 管理', to: '/user/skills' },
  { label: '高级模型', to: '/user/agent-model-settings' },
  { label: 'API 接入', to: '/user/settings' },
  { label: '调用日志', to: '/user/agent-logs' },
  { label: '开发者接入', to: '/user/developer' }
];

function onScroll() {
  scrolled.value = window.scrollY > 6;
}

onMounted(() => {
  onScroll();
  window.addEventListener('scroll', onScroll, { passive: true });
});

onUnmounted(() => {
  window.removeEventListener('scroll', onScroll);
});

async function handleLogout() {
  try {
    await ElMessageBox.confirm('确定要退出登录吗？', '提示', {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      type: 'warning'
    });

    userStore.logout();
    toast.success('已退出登录');
    router.push('/login');
  } catch {
    // ignore cancel
  }
}
</script>

<style scoped lang="scss">
.capability-shell {
  min-height: 100vh;
  min-height: 100dvh;
  position: relative;
  overflow-x: hidden;
  background:
    radial-gradient(circle at top right, rgba(67, 176, 216, 0.16), transparent 30%),
    radial-gradient(circle at bottom left, rgba(141, 107, 255, 0.12), transparent 32%),
    linear-gradient(180deg, color-mix(in srgb, var(--bg-body) 94%, #fff) 0%, var(--bg-body) 100%);
}

.animated-bg {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 0;
  pointer-events: none;
  overflow: hidden;
}

.gradient-orb {
  position: absolute;
  border-radius: 50%;
  filter: blur(120px);
  opacity: 0.5;
  animation: float 20s ease-in-out infinite;
}

.gradient-orb-1 {
  width: 800px;
  height: 800px;
  background: radial-gradient(circle, rgba(67, 176, 216, 0.42) 0%, rgba(52, 120, 246, 0.18) 42%, transparent 72%);
  top: -300px;
  right: -200px;
}

.gradient-orb-2 {
  width: 600px;
  height: 600px;
  background: radial-gradient(circle, rgba(141, 107, 255, 0.3) 0%, rgba(67, 176, 216, 0.14) 46%, transparent 76%);
  bottom: -200px;
  left: -100px;
  animation-delay: -10s;
}

@keyframes float {
  0%, 100% {
    transform: translate(0, 0) scale(1);
  }
  50% {
    transform: translate(50px, 50px) scale(1.05);
  }
}

.shell-header {
  position: sticky;
  top: 0;
  z-index: 10;
  background: rgba(255, 255, 255, 0.82);
  border-bottom: 1px solid rgba(23, 32, 51, 0.06);
  backdrop-filter: blur(18px);
  transition: box-shadow 0.2s ease;
}

.shell-header--scrolled {
  box-shadow: 0 12px 36px rgba(15, 23, 42, 0.06);
}

[data-theme="dark"] .shell-header {
  background: rgba(15, 23, 42, 0.82);
  border-bottom-color: rgba(255, 255, 255, 0.08);
}

.shell-header__inner {
  width: min(1280px, calc(100% - 48px));
  min-height: 72px;
  margin: 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  padding: 0;
}

.shell-container {
  width: min(1280px, calc(100% - 48px));
  margin: 0 auto;
}

.shell-brand {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--text-primary, #172033);
  font: inherit;
  font-weight: 900;
  cursor: pointer;
  flex: 0 0 auto;
}

.shell-brand__logo {
  height: 56px;
  object-fit: contain;
  display: block;
}

.shell-nav {
  display: flex;
  flex-wrap: nowrap;
  gap: 6px;
  padding: 6px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.72);
  border: 1px solid rgba(23, 32, 51, 0.06);
  min-width: 0;
}

[data-theme="dark"] .shell-nav {
  background: rgba(255, 255, 255, 0.05);
  border-color: rgba(255, 255, 255, 0.08);
}

.shell-nav__item {
  padding: 8px 14px;
  border-radius: 999px;
  color: color-mix(in srgb, var(--text-primary, #172033) 68%, white);
  text-decoration: none;
  font-size: 13px;
  font-weight: 800;
  border: 0;
  background: transparent;
  transition: background 0.2s ease, color 0.2s ease;
}

.shell-nav__item:hover,
.shell-nav__item--current,
.shell-nav__item.router-link-active {
  background: rgba(52, 120, 246, 0.09);
  color: var(--color-primary-dark, #1f57cc);
}

[data-theme="dark"] .shell-nav__item {
  color: rgba(255, 255, 255, 0.65);
}

[data-theme="dark"] .shell-nav__item:hover,
[data-theme="dark"] .shell-nav__item--current,
[data-theme="dark"] .shell-nav__item.router-link-active {
  background: rgba(52, 120, 246, 0.18);
  color: #9fc3ff;
}

.shell-header__actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 0 0 auto;
}

.shell-user-chip {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 38px;
  padding: 4px 12px 4px 4px;
  border-radius: 999px;
  border: 1px solid rgba(23, 32, 51, 0.08);
  background: rgba(255, 255, 255, 0.78);
  color: var(--text-primary, #172033);
  font: inherit;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  transition: background 0.2s ease, border-color 0.2s ease;
}

.shell-user-chip:hover {
  background: rgba(255, 255, 255, 0.95);
  border-color: rgba(52, 120, 246, 0.25);
}

.shell-user-chip__avatar {
  width: 30px;
  height: 30px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: rgba(52, 120, 246, 0.1);
  color: var(--color-primary-dark, #1f57cc);
  font-weight: 900;
}

[data-theme="dark"] .shell-user-chip {
  background: rgba(255, 255, 255, 0.06);
  border-color: rgba(255, 255, 255, 0.1);
  color: rgba(255, 255, 255, 0.85);
}

.shell-main {
  position: relative;
  z-index: 1;
  padding: 28px 0 calc(80px + var(--safe-area-bottom));
}

.shell-hero {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 24px;
  padding: 2.25rem;
  margin-bottom: 24px;
  border: 1px solid rgba(52, 120, 246, 0.1);
  border-radius: var(--radius-2xl);
  background:
    linear-gradient(135deg, rgba(255, 255, 255, 0.82), rgba(247, 250, 255, 0.72)),
    rgba(255, 255, 255, 0.68);
  backdrop-filter: blur(20px);
  box-shadow: 0 22px 44px rgba(31, 87, 204, 0.09);
}

[data-theme="dark"] .shell-hero {
  background: linear-gradient(135deg, rgba(26, 37, 47, 0.86), rgba(15, 24, 32, 0.74));
  border-color: rgba(96, 165, 250, 0.12);
  box-shadow: 0 24px 50px rgba(0, 0, 0, 0.24);
}

.shell-hero__eyebrow {
  margin-bottom: 8px;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-secondary-dark);
}

.shell-hero__title {
  margin: 0 0 8px;
  font-size: clamp(1.8rem, 3vw, 2.4rem);
  color: var(--text-primary);
  letter-spacing: -0.03em;
}

.shell-hero__description {
  max-width: 820px;
  margin: 0;
  color: var(--text-secondary);
  line-height: 1.7;
}

.shell-hero__actions {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.shell-body {
  display: grid;
  gap: 24px;
  min-width: 0;
}

.capability-nav {
  display: flex;
  gap: 8px;
  margin-bottom: 24px;
  padding: 8px;
  overflow-x: auto;
  border: 1px solid rgba(52, 120, 246, 0.1);
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.68);
  backdrop-filter: blur(16px);
  scrollbar-width: thin;
}

.capability-nav__item {
  flex: 0 0 auto;
  padding: 9px 14px;
  border-radius: 12px;
  color: var(--text-secondary);
  font-size: 13px;
  font-weight: 700;
  text-decoration: none;
}

.capability-nav__item:hover,
.capability-nav__item.router-link-active {
  color: var(--color-primary-dark);
  background: rgba(52, 120, 246, 0.1);
}

[data-theme='dark'] .capability-nav {
  background: rgba(15, 23, 42, 0.58);
  border-color: rgba(96, 165, 250, 0.12);
}

.shell-body :deep(.glass-card) {
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.76), rgba(248, 250, 255, 0.7));
  border: 1px solid rgba(52, 120, 246, 0.08);
  backdrop-filter: blur(20px);
  box-shadow: 0 18px 36px rgba(31, 87, 204, 0.08);
}

[data-theme="dark"] .shell-body :deep(.glass-card) {
  background: linear-gradient(180deg, rgba(26, 37, 47, 0.84), rgba(15, 24, 32, 0.76));
  border-color: rgba(96, 165, 250, 0.1);
  box-shadow: 0 20px 40px rgba(0, 0, 0, 0.22);
}

@media (max-width: 1024px) {
  .shell-header__inner {
    grid-template-columns: 1fr;
  }

  .shell-nav {
    justify-content: flex-start;
    overflow-x: auto;
    padding-bottom: 2px;
    scrollbar-width: thin;
  }

  .shell-hero {
    flex-direction: column;
  }

  .capability-nav {
    margin-bottom: 16px;
  }

  .shell-hero__actions {
    justify-content: flex-start;
  }
}

@media (max-width: 768px) {
  .shell-header {
    top: 0;
  }

  .shell-main {
    padding: 16px;
    padding-bottom: calc(20px + var(--safe-area-bottom));
  }

  .shell-header__inner {
    padding: 12px 16px;
  }

  .shell-brand__title {
    font-size: 1.1rem;
  }

  .shell-header__actions {
    justify-content: flex-end;
    width: auto;
  }

  .shell-nav,
  .shell-user {
    display: none;
  }

  .shell-hero {
    padding: 20px;
    border-radius: 22px;
  }

  .shell-hero__title {
    font-size: 1.75rem;
  }

  .shell-hero__actions {
    width: 100%;
  }

  .shell-hero__actions :deep(.el-button),
  .shell-hero__actions :deep(.el-button + .el-button) {
    width: 100%;
    margin-left: 0;
  }
}

@media (max-width: 560px) {
  .shell-header__inner {
    gap: 12px;
    padding-inline: 14px;
    grid-template-columns: minmax(0, 1fr) auto;
  }

  .shell-nav {
    grid-column: 1 / -1;
    justify-content: flex-start;
    flex-wrap: nowrap;
    overflow-x: auto;
    padding-bottom: 4px;
  }

  .shell-nav__item {
    flex: 0 0 auto;
    padding: 0.55rem 0.85rem;
    font-size: 0.9rem;
  }

  .shell-main {
    padding-inline: 14px;
  }

  .shell-hero {
    padding: 18px;
    gap: 16px;
  }

  .shell-hero__description {
    font-size: 0.95rem;
  }
}
</style>
