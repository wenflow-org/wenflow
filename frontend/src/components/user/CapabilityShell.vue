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
import { useUserStore } from '@/stores/user';

defineProps<{ title: string; description?: string }>();

const router = useRouter();
const userStore = useUserStore();

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
  position: relative;
  overflow-x: hidden;
  background: var(--bg-body);
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
  filter: blur(100px);
  opacity: 0.4;
  animation: float 20s ease-in-out infinite;
}

.gradient-orb-1 {
  width: 800px;
  height: 800px;
  background: var(--gradient-primary);
  top: -300px;
  right: -200px;
}

.gradient-orb-2 {
  width: 600px;
  height: 600px;
  background: var(--gradient-achievement);
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
  background: rgba(255, 255, 255, 0.8);
  border-bottom: 1px solid transparent;
  transition: all 0.3s ease;
}

[data-theme="dark"] .shell-header {
  background: rgba(26, 37, 47, 0.8);
  border-bottom-color: rgba(255, 255, 255, 0.08);
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
  font-size: 1.75rem;
}

.shell-brand__title {
  font-size: 1.25rem;
  font-weight: 700;
  color: var(--text-primary);
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
  transition: all 0.2s ease;
}

.shell-nav__item:hover,
.shell-nav__item.router-link-active {
  color: var(--text-primary);
  background: var(--bg-muted);
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
  border: 2px solid var(--border-light);
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
  background: var(--gradient-primary);
  color: white;
  font-weight: 600;
  font-size: 1rem;
}

.shell-main {
  position: relative;
  z-index: 1;
  padding: 2rem;
}

.shell-hero {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 24px;
  padding: 2.25rem;
  margin-bottom: 24px;
  border: 1px solid rgba(255, 255, 255, 0.3);
  border-radius: var(--radius-2xl);
  background: rgba(255, 255, 255, 0.7);
  backdrop-filter: blur(20px);
  box-shadow: var(--shadow-md);
}

[data-theme="dark"] .shell-hero {
  background: rgba(26, 37, 47, 0.7);
  border-color: rgba(255, 255, 255, 0.1);
}

.shell-hero__eyebrow {
  margin-bottom: 8px;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-primary);
}

.shell-hero__title {
  margin: 0 0 8px;
  font-size: clamp(1.8rem, 3vw, 2.4rem);
  color: var(--text-primary);
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
  background: rgba(255, 255, 255, 0.7);
  border: 1px solid rgba(255, 255, 255, 0.3);
  backdrop-filter: blur(20px);
  box-shadow: var(--shadow-md);
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
  .shell-main {
    padding: 16px;
  }

  .shell-header__inner {
    padding: 12px 16px;
  }

  .shell-hero {
    padding: 20px;
    border-radius: 22px;
  }

  .shell-hero__title {
    font-size: 1.75rem;
  }
}
</style>
