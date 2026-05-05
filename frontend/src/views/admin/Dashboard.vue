<template>
  <div class="admin-dashboard">
    <!-- 顶部栏 -->
    <header class="admin-header">
      <div class="admin-header__brand">
        <img src="/logo.png" alt="" class="admin-header__logo" />
        <span class="admin-header__title">WenFlow 管理平台</span>
      </div>

      <div class="admin-header__right">
        <ThemeSwitcher />
        <el-dropdown trigger="click">
          <div class="admin-header__user">
            <el-avatar :size="32" :src="currentUser?.avatarUrl">
              {{ currentUser?.name?.charAt(0) || 'A' }}
            </el-avatar>
            <span class="admin-header__user-name">{{ currentUser?.name || 'Admin' }}</span>
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
    </header>

    <div class="admin-layout">
      <!-- 侧边栏 -->
      <aside class="admin-sidebar" :class="{ collapsed: sidebarCollapsed }">
        <nav class="admin-sidebar__nav">
          <!-- 分组 1: 内容管理 -->
          <div class="admin-sidebar__group">
            <span class="admin-sidebar__group-title" v-show="!sidebarCollapsed">内容管理</span>
            <router-link
              v-for="item in contentNav"
              :key="item.to"
              :to="item.to"
              class="admin-sidebar__item"
              :class="{ active: isActiveRoute(item.to) }"
            >
              <el-icon><component :is="item.icon" /></el-icon>
              <span v-show="!sidebarCollapsed">{{ item.label }}</span>
            </router-link>
          </div>

          <!-- 分组 2: 系统配置 -->
          <div class="admin-sidebar__group">
            <span class="admin-sidebar__group-title" v-show="!sidebarCollapsed">系统配置</span>
            <router-link
              v-for="item in systemNav"
              :key="item.to"
              :to="item.to"
              class="admin-sidebar__item"
              :class="{ active: isActiveRoute(item.to) }"
            >
              <el-icon><component :is="item.icon" /></el-icon>
              <span v-show="!sidebarCollapsed">{{ item.label }}</span>
            </router-link>
          </div>

          <!-- 分组 3: 监控诊断 -->
          <div class="admin-sidebar__group">
            <span class="admin-sidebar__group-title" v-show="!sidebarCollapsed">监控诊断</span>
            <router-link
              v-for="item in monitorNav"
              :key="item.to"
              :to="item.to"
              class="admin-sidebar__item"
              :class="{ active: isActiveRoute(item.to) }"
            >
              <el-icon><component :is="item.icon" /></el-icon>
              <span v-show="!sidebarCollapsed">{{ item.label }}</span>
            </router-link>
          </div>
        </nav>

        <!-- 折叠按钮 -->
        <el-button class="admin-sidebar__toggle" @click="toggleSidebar" :title="sidebarCollapsed ? '展开' : '折叠'" text>
          <el-icon><component :is="sidebarCollapsed ? 'Expand' : 'Fold'" /></el-icon>
        </el-button>
      </aside>

      <!-- 主内容区 -->
      <main class="admin-main">
        <div class="admin-content">
          <router-view />
        </div>
      </main>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { toast } from '../../utils/toast';
import {
  DataAnalysis,
  User,
  Reading,
  Cpu,
  Operation,
  Connection,
  Grid,
  WarningFilled,
  Setting,
  ArrowDown,
  SwitchButton,
  Expand,
  Fold,
} from '@element-plus/icons-vue';
import ThemeSwitcher from '@/components/ThemeSwitcher.vue';

interface NavItem {
  to: string;
  label: string;
  icon: any;
}

const router = useRouter();
const route = useRoute();

const currentUser = ref<any>(null);
const sidebarCollapsed = ref(false);

// 侧边栏状态持久化
onMounted(() => {
  const saved = localStorage.getItem('admin-sidebar-collapsed');
  if (saved !== null) {
    sidebarCollapsed.value = saved === 'true';
  }

  const userStr = localStorage.getItem('admin_user') || sessionStorage.getItem('admin_user');
  if (userStr) {
    currentUser.value = JSON.parse(userStr);
  } else {
    router.push('/admin/login');
  }
});

const toggleSidebar = () => {
  sidebarCollapsed.value = !sidebarCollapsed.value;
  localStorage.setItem('admin-sidebar-collapsed', String(sidebarCollapsed.value));
};

const isActiveRoute = (path: string) => {
  if (path === '/admin/dashboard') {
    return route.path === '/admin/dashboard' || route.path === '/admin/overview';
  }
  return route.path.startsWith(path);
};

const contentNav: NavItem[] = [
  { to: '/admin/dashboard', label: '概览', icon: DataAnalysis },
  { to: '/admin/users', label: '用户管理', icon: User },
  { to: '/admin/learner-models', label: '学习模型', icon: Reading },
  { to: '/admin/teaching-sessions', label: '教学会话', icon: Reading },
];

const systemNav: NavItem[] = [
  { to: '/admin/api-config', label: 'API 管理', icon: Setting },
  { to: '/admin/agent-registry', label: 'Agent 注册', icon: Grid },
  { to: '/admin/agent-model-configs', label: '模型配置', icon: Cpu },
  { to: '/admin/skill-model-configs', label: 'Skill 模型', icon: Operation },
];

const monitorNav: NavItem[] = [
  { to: '/admin/execution-logs', label: '执行日志', icon: Cpu },
  { to: '/admin/orchestrators', label: '编排视图', icon: Connection },
  { to: '/admin/manifest-diagnostics', label: '诊断', icon: WarningFilled },
];

const handleLogout = () => {
  localStorage.removeItem('admin_token');
  localStorage.removeItem('admin_user');
  sessionStorage.removeItem('admin_token');
  sessionStorage.removeItem('admin_user');
  toast.success('已退出登录');
  router.push('/admin/login');
};
</script>

<style scoped>
.admin-dashboard {
  height: 100vh;
  overflow: hidden;
  background: var(--bg-body);
  display: flex;
  flex-direction: column;
  transition: background var(--transition-normal);
}

/* ========== 顶部栏 ========== */
.admin-header {
  height: 56px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 20px;
  background: var(--glass-bg-light);
  backdrop-filter: var(--glass-blur);
  -webkit-backdrop-filter: var(--glass-blur);
  border-bottom: 1px solid var(--glass-border-light);
  position: sticky;
  top: 0;
  z-index: 101;
  transition: background var(--transition-normal), border-color var(--transition-normal);
}

[data-theme="dark"] .admin-header {
  background: var(--glass-bg-dark);
  border-bottom-color: var(--glass-border-dark);
}

.admin-header__brand {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-shrink: 0;
}

.admin-header__logo {
  height: 28px;
  width: auto;
  object-fit: contain;
}

.admin-header__title {
  font-size: 1rem;
  font-weight: 700;
  color: var(--text-primary);
  white-space: nowrap;
}

.admin-header__right {
  display: flex;
  align-items: center;
  gap: 16px;
}

.admin-header__user {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  padding: 6px 12px;
  border-radius: var(--fluent-radius-lg);
  color: var(--text-secondary);
  transition: background var(--fluent-duration-fast) var(--fluent-easing);
}

.admin-header__user:hover {
  background: var(--bg-muted);
}

.admin-header__user-name {
  font-size: 0.875rem;
  font-weight: 500;
  white-space: nowrap;
}

/* ========== 布局 ========== */
.admin-layout {
  display: grid;
  grid-template-columns: var(--sidebar-width, 240px) 1fr;
  height: calc(100vh - 56px);
  overflow: hidden;
  transition: grid-template-columns var(--fluent-duration-normal) var(--fluent-easing);
}

/* ========== 侧边栏 ========== */
.admin-sidebar {
  width: var(--sidebar-width, 240px);
  height: 100vh;
  position: sticky;
  top: 0;
  align-self: flex-start;
  background: var(--glass-bg-light);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border-right: 1px solid var(--glass-border-light);
  display: flex;
  flex-direction: column;
  padding: 16px 0;
  overflow: hidden;
  transition: width var(--fluent-duration-normal) var(--fluent-easing), background var(--transition-normal);
}

.admin-sidebar.collapsed {
  width: var(--sidebar-collapsed-width, 64px);
}

[data-theme="dark"] .admin-sidebar {
  background: var(--glass-bg-dark);
  border-right-color: var(--glass-border-dark);
}

.admin-sidebar__nav {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 0 12px;
}

.admin-sidebar__nav::-webkit-scrollbar {
  width: 4px;
}

.admin-sidebar__nav::-webkit-scrollbar-thumb {
  background: var(--neutral-400);
  border-radius: var(--radius-full);
}

.admin-sidebar__group {
  margin-bottom: 24px;
}

.admin-sidebar__group-title {
  display: block;
  font-size: 0.7rem;
  font-weight: 700;
  color: var(--text-muted);
  letter-spacing: 0.08em;
  text-transform: uppercase;
  padding: 0 12px;
  margin-bottom: 8px;
  white-space: nowrap;
}

.admin-sidebar__item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-radius: var(--fluent-radius-md);
  color: var(--text-secondary);
  text-decoration: none;
  font-size: 0.875rem;
  font-weight: 500;
  white-space: nowrap;
  position: relative;
  transition: all var(--fluent-duration-fast) var(--fluent-easing);
}

.admin-sidebar__item:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.admin-sidebar__item.active {
  background: var(--sidebar-active-bg, color-mix(in srgb, var(--color-primary) 12%, transparent));
  color: var(--color-primary);
  font-weight: 600;
}

.admin-sidebar__item.active::before {
  content: '';
  position: absolute;
  left: 0;
  top: 50%;
  transform: translateY(-50%);
  width: 3px;
  height: 20px;
  background: var(--color-primary);
  border-radius: 0 2px 2px 0;
}

.admin-sidebar__item .el-icon {
  font-size: 1.125rem;
  flex-shrink: 0;
}

/* 折叠按钮 */
.admin-sidebar__toggle {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 40px;
  border: none;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  border-top: 1px solid var(--border-default);
  transition: all var(--fluent-duration-fast) var(--fluent-easing);
}

.admin-sidebar__toggle:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.admin-sidebar__toggle .el-icon {
  font-size: 1.125rem;
}

/* ========== 主内容区 ========== */
.admin-main {
  padding: 24px;
  background: var(--bg-body);
  height: calc(100vh - 56px);
  overflow-y: auto;
  transition: background var(--transition-normal);
}

.admin-content {
  max-width: 1400px;
  margin: 0 auto;
}

/* ========== 响应式 ========== */
@media (max-width: 1024px) {
  .admin-header__title {
    display: none;
  }

  .admin-header__user-name {
    display: none;
  }

  .admin-layout {
    grid-template-columns: var(--sidebar-collapsed-width, 64px) 1fr;
  }

  .admin-sidebar {
    width: var(--sidebar-collapsed-width, 64px);
  }

  .admin-sidebar .admin-sidebar__group-title,
  .admin-sidebar .admin-sidebar__item span {
    display: none;
  }

  .admin-main {
    padding: 16px;
  }
}

@media (max-width: 768px) {
  .admin-header {
    padding: 0 12px;
  }

  .admin-main {
    padding: 12px;
  }
}
</style>
