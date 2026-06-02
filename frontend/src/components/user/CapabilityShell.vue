<template>
  <div class="capability-shell">
    <div class="animated-bg">
      <div class="gradient-orb gradient-orb-1"></div>
      <div class="gradient-orb gradient-orb-2"></div>
    </div>

    <header class="shell-header">
      <div class="shell-header__inner">
        <div class="shell-brand">
          <span class="shell-brand__icon">🎓</span>
          <div>
            <div class="shell-brand__title">能力中心</div>
            <div class="shell-brand__subtitle">账户</div>
          </div>
        </div>

        <nav class="shell-nav">
          <router-link to="/learning-paths" class="shell-nav__item shell-nav__item--back">
            <el-icon><ArrowLeft /></el-icon>
            返回学习
          </router-link>
          <router-link to="/user/account" class="shell-nav__item">账户</router-link>
        </nav>

        <div class="shell-header__actions">
          <ThemeSwitcher />
          <MobileSiteMenu
            title="能力中心"
            :user-name="userStore.user?.name || '用户'"
            :user-initial="userStore.user?.name?.charAt(0) || 'U'"
            :nav-items="shellNavItems"
            :show-account-link="false"
            @logout="handleLogout"
          />
          <el-dropdown>
            <div class="shell-user">
              <img v-if="userStore.user?.avatarUrl" :src="userStore.user.avatarUrl" alt="avatar" />
              <div v-else class="shell-user__placeholder">
                {{ userStore.user?.name?.charAt(0) || 'U' }}
              </div>
            </div>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item>{{ userStore.user?.name || '用户' }}</el-dropdown-item>
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
            <div class="shell-hero__eyebrow">Account</div>
            <h1 class="shell-hero__title">{{ title }}</h1>
            <p v-if="description" class="shell-hero__description">{{ description }}</p>
          </div>
          <div v-if="$slots.actions" class="shell-hero__actions">
            <slot name="actions" />
          </div>
        </section>

        <div class="shell-body">
          <slot />
        </div>
      </div>
    </main>
  </div>
</template>

<script setup lang="ts">
import { ElMessageBox } from 'element-plus';
import { ArrowLeft } from '@element-plus/icons-vue';
import { toast } from '../../utils/toast';
import { useRouter } from 'vue-router';
import ThemeSwitcher from '../ThemeSwitcher.vue';
import MobileSiteMenu from '../MobileSiteMenu.vue';
import { useUserStore } from '@/stores/user';

defineProps<{ title: string; description?: string }>();

const router = useRouter();
const userStore = useUserStore();
const shellNavItems = [
  { label: '返回学习', to: '/learning-paths', matchPrefixes: ['/learning-paths', '/learning-path/', '/dashboard', '/goal-conversation', '/learning-state', '/achievements'] },
  { label: '账户', to: '/user/account', matchPrefixes: ['/user', '/user/account'] }
];

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
  z-index: 1000;
  backdrop-filter: blur(20px);
  background: color-mix(in srgb, var(--glass-bg-light) 92%, white);
  border-bottom: 1px solid rgba(52, 120, 246, 0.08);
  box-shadow: 0 10px 30px rgba(31, 87, 204, 0.06);
  transition: all 0.3s ease;
}

[data-theme="dark"] .shell-header {
  background: color-mix(in srgb, var(--glass-bg-dark) 88%, #0f1820);
  border-bottom-color: rgba(96, 165, 250, 0.12);
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.22);
}

.shell-header__inner,
.shell-container {
  max-width: 1600px;
  margin: 0 auto;
}

.shell-header__inner {
  display: grid;
  grid-template-columns: auto 1fr auto;
  gap: 20px;
  align-items: center;
  padding: 14px 24px;
  min-width: 0;
}

.shell-brand {
  display: flex;
  align-items: center;
  gap: 12px;
}

.shell-brand__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 48px;
  border-radius: 16px;
  font-size: 1.4rem;
  background: linear-gradient(135deg, rgba(67, 176, 216, 0.18), rgba(52, 120, 246, 0.18));
  border: 1px solid rgba(52, 120, 246, 0.12);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.32);
}

.shell-brand__title {
  font-size: 1.25rem;
  font-weight: 700;
  color: var(--text-primary);
  letter-spacing: -0.02em;
}

.shell-brand__subtitle {
  font-size: 12px;
  color: var(--text-secondary);
}

.shell-nav {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: center;
  min-width: 0;
}

.shell-nav__item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.625rem 1rem;
  border-radius: var(--radius-xl);
  color: var(--text-secondary);
  text-decoration: none;
  font-size: 0.95rem;
  font-weight: 500;
  border: 1px solid transparent;
  background: rgba(255, 255, 255, 0.36);
  transition: all 0.2s ease;
}

.shell-nav__item:hover,
.shell-nav__item.router-link-active {
  color: var(--color-primary-dark);
  background: rgba(52, 120, 246, 0.1);
  border-color: rgba(52, 120, 246, 0.12);
  box-shadow: 0 8px 20px rgba(52, 120, 246, 0.1);
}

[data-theme="dark"] .shell-nav__item {
  background: rgba(15, 23, 42, 0.28);
}

[data-theme="dark"] .shell-nav__item:hover,
[data-theme="dark"] .shell-nav__item.router-link-active {
  color: #9fc3ff;
  background: rgba(52, 120, 246, 0.18);
  border-color: rgba(96, 165, 250, 0.16);
}

.shell-nav__item--back {
  color: var(--color-primary);
}

.shell-nav__item--back:hover {
  background: rgba(64, 158, 255, 0.1);
}

.shell-header__actions {
  display: flex;
  align-items: center;
  gap: 14px;
  min-width: 0;
}

.shell-user {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  overflow: hidden;
  cursor: pointer;
  border: 1px solid rgba(52, 120, 246, 0.16);
  box-shadow: 0 8px 18px rgba(52, 120, 246, 0.12);
}

.shell-user img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.shell-user__placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, var(--color-secondary), var(--color-primary));
  color: white;
  font-weight: 600;
  font-size: 1rem;
}

.shell-main {
  position: relative;
  z-index: 1;
  padding: 2rem;
  padding-bottom: calc(2rem + var(--safe-area-bottom));
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
