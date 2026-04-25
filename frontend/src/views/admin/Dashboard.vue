<template>
  <div class="admin-dashboard">
    <div class="admin-ambient-bg" aria-hidden="true">
      <div class="ambient-orb ambient-orb-1"></div>
      <div class="ambient-orb ambient-orb-2"></div>
    </div>

    <!-- 顶部标题栏 -->
    <header class="dashboard-header">
      <div class="header-container">
        <div class="header-left">
          <h1 class="header-title">
            <span class="title-icon">🎓</span>
            问流 WenFlow · 管理平台
          </h1>

          <el-menu
            :default-active="activeMenu"
            class="top-menu"
            mode="horizontal"
            :ellipsis="false"
            router
          >
            <el-menu-item index="/admin/dashboard">
              <el-icon><DataAnalysis /></el-icon>
              <span>数据概览</span>
            </el-menu-item>

            <el-menu-item index="/admin/users">
              <el-icon><User /></el-icon>
              <span>用户管理</span>
            </el-menu-item>

            <el-menu-item index="/admin/learner-models">
              <el-icon><Reading /></el-icon>
              <span>学习者模型</span>
            </el-menu-item>

            <el-menu-item index="/admin/teaching-sessions">
              <el-icon><Reading /></el-icon>
              <span>教学会话调试</span>
            </el-menu-item>

            <el-menu-item index="/admin/api-config">
              <el-icon><Setting /></el-icon>
              <span>API 管理</span>
            </el-menu-item>

            <el-menu-item index="/admin/execution-logs">
              <el-icon><Cpu /></el-icon>
              <span>执行日志</span>
            </el-menu-item>

            <el-menu-item index="/admin/orchestrators">
              <el-icon><Connection /></el-icon>
              <span>编排器视图</span>
            </el-menu-item>

            <el-menu-item index="/admin/agent-registry">
              <el-icon><Grid /></el-icon>
              <span>Agent 注册</span>
            </el-menu-item>

            <el-menu-item index="/admin/agent-model-configs">
              <el-icon><Cpu /></el-icon>
              <span>Agent 模型配置</span>
            </el-menu-item>

            <el-menu-item index="/admin/manifest-diagnostics">
              <el-icon><WarningFilled /></el-icon>
              <span>架构诊断</span>
            </el-menu-item>
          </el-menu>
        </div>
        <div class="header-right">
          <el-dropdown trigger="click">
            <div class="user-menu">
              <el-avatar :size="36" :src="currentUser?.avatarUrl">
                {{ currentUser?.name?.charAt(0) || 'A' }}
              </el-avatar>
              <span class="user-name">{{ currentUser?.name || 'Admin' }}</span>
              <el-icon><ArrowDown /></el-icon>
            </div>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item @click="handleLogout">
                  <el-icon><SwitchButton /></el-icon>
                  退出登录
                </el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
      </div>
    </header>

    <!-- 主内容区 -->
    <main class="dashboard-content">
      <div class="content-container">
        <router-view />
      </div>
    </main>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { ElMessage } from 'element-plus';
import {
  DataAnalysis,
  User,
  Reading,
  Cpu,
  Connection,
  Grid,
  WarningFilled,
  Setting,
  ArrowDown,
  SwitchButton,
} from '@element-plus/icons-vue';

const router = useRouter();
const route = useRoute();

const currentUser = ref<any>(null);
const activeMenu = computed(() => route.path);

onMounted(() => {
  // 获取当前用户信息
  const userStr = localStorage.getItem('admin_user');
  if (userStr) {
    currentUser.value = JSON.parse(userStr);
  } else {
    router.push('/admin/login');
  }
});

const handleLogout = () => {
  localStorage.removeItem('admin_token');
  localStorage.removeItem('admin_user');
  ElMessage.success('已退出登录');
  router.push('/admin/login');
};
</script>

<style scoped>
.admin-dashboard {
  min-height: 100vh;
  background: var(--bg-body);
  position: relative;
  transition: background var(--transition-normal);
}

.admin-ambient-bg {
  position: fixed;
  inset: 0;
  pointer-events: none;
  overflow: hidden;
  z-index: 0;
}

.ambient-orb {
  position: absolute;
  border-radius: 50%;
  filter: blur(95px);
  opacity: 0.34;
  animation: admin-float 20s ease-in-out infinite;
}

.ambient-orb-1 {
  width: 680px;
  height: 680px;
  background: var(--gradient-primary);
  top: -260px;
  right: -180px;
}

.ambient-orb-2 {
  width: 520px;
  height: 520px;
  background: var(--gradient-achievement);
  left: -120px;
  bottom: -180px;
  animation-delay: -10s;
}

@keyframes admin-float {
  0%, 100% { transform: translate(0, 0) scale(1); }
  50% { transform: translate(36px, 44px) scale(1.05); }
}

/* 顶部标题栏 */
.dashboard-header {
  background: rgba(255, 255, 255, 0.78);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  color: var(--text-primary);
  padding: 0.75rem 0;
  box-shadow: var(--shadow-sm);
  border-bottom: 1px solid transparent;
  position: sticky;
  top: 0;
  z-index: 101;
  transition: background var(--transition-normal), box-shadow var(--transition-normal), border-color var(--transition-normal);
}

[data-theme="dark"] .dashboard-header {
  background: rgba(30, 45, 58, 0.78);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
  color: var(--text-primary);
  border-bottom-color: var(--border-default);
}

.header-container {
  max-width: 1600px;
  margin: 0 auto;
  padding: 0 2rem;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 1rem;
  min-width: 0;
}

.header-title {
  font-size: 1.25rem;
  font-weight: 700;
  margin: 0;
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.title-icon {
  font-size: 1.5rem;
}

.header-right {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.user-menu {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  cursor: pointer;
  padding: 0.5rem 1rem;
  border-radius: var(--radius-xl);
  color: var(--text-secondary);
  transition: background 0.2s ease, color 0.2s ease;
}

.user-menu:hover {
  background: var(--bg-muted);
  color: var(--text-primary);
}

.user-name {
  font-size: 0.95rem;
  font-weight: 500;
}

.top-menu {
  background: rgba(255, 255, 255, 0.58) !important;
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border: 1px solid rgba(255, 255, 255, 0.35) !important;
  border-radius: var(--radius-xl);
  height: 44px;
  line-height: 44px;
  padding: 0 0.35rem;
  flex: 1;
  min-width: 420px;
}

.top-menu :deep(.el-menu-item) {
  height: 36px;
  line-height: 36px;
  margin: 0 0.2rem;
  padding: 0 0.85rem;
  border-radius: var(--radius-md);
  font-size: 0.9rem;
  border-bottom: none !important;
  color: var(--text-secondary) !important;
  transition: all 0.22s ease;
}

.top-menu :deep(.el-menu-item:hover) {
  background: rgba(255, 255, 255, 0.62) !important;
  color: var(--text-primary) !important;
}

.top-menu :deep(.el-menu-item.is-active) {
  background: color-mix(in srgb, var(--color-primary) 14%, white 86%) !important;
  color: var(--color-primary) !important;
  border-bottom-color: transparent !important;
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--color-primary) 35%, white 65%);
  font-weight: var(--font-semibold);
}

[data-theme="dark"] .top-menu {
  background: rgba(30, 45, 58, 0.72) !important;
  border: 1px solid rgba(255, 255, 255, 0.1) !important;
}

[data-theme="dark"] .top-menu :deep(.el-menu-item) {
  color: var(--text-secondary) !important;
}

[data-theme="dark"] .top-menu :deep(.el-menu-item:hover) {
  background: rgba(255, 255, 255, 0.08) !important;
  color: var(--text-primary) !important;
}

[data-theme="dark"] .top-menu :deep(.el-menu-item.is-active) {
  background: color-mix(in srgb, var(--color-primary) 24%, transparent) !important;
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--color-primary) 45%, transparent);
}

.top-menu :deep(.el-icon) {
  margin-right: 0.5rem;
  font-size: 1.1rem;
}

/* 主内容区 */
.dashboard-content {
  position: relative;
  z-index: 1;
  padding: 1.25rem 0;
}

.content-container {
  max-width: 1600px;
  margin: 0 auto;
  padding: 1.25rem 2rem;
  background: rgba(255, 255, 255, 0.72);
  border: 1px solid rgba(255, 255, 255, 0.35);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border-radius: var(--radius-2xl);
  box-shadow: var(--shadow-md);
  min-height: calc(100vh - 110px);
  transition: background var(--transition-normal), box-shadow var(--transition-normal);
}

[data-theme="dark"] .content-container {
  background: rgba(30, 45, 58, 0.76);
  border-color: rgba(255, 255, 255, 0.1);
  box-shadow: var(--shadow-lg);
}

/* 响应式 */
@media (max-width: 1024px) {
  .header-container {
    padding: 0 1rem;
  }

  .top-menu :deep(.el-menu-item) {
    flex-shrink: 0;
    padding: 0 1rem;
  }

  .header-left {
    gap: 0.5rem;
    overflow-x: auto;
  }

  .top-menu {
    min-width: 280px;
  }

  .content-container {
    padding: 0 1rem;
  }
}
</style>
