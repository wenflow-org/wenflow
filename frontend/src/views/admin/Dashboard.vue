<template>
  <router-view v-if="isTestRoute" />
  <div v-else class="admin-dashboard">
    <!-- 顶部栏 -->
    <header class="admin-header">
      <div class="admin-header__brand">
        <el-button
          class="admin-header__menu"
          text
          aria-label="打开后台导航"
          @click="mobileNavOpen = true"
        >
          <el-icon><Menu /></el-icon>
        </el-button>
        <img src="/logo.png" alt="" class="admin-header__logo" />
        <span class="admin-header__title">管理后台</span>
      </div>

      <div class="admin-header__right">
        <button
          class="admin-header__search"
          type="button"
          aria-label="快速跳转（Ctrl+K）"
          @click="commandPaletteOpen = true"
        >
          <el-icon><Search /></el-icon>
          <span class="admin-header__search-text">快速跳转</span>
          <kbd class="admin-header__search-kbd">Ctrl K</kbd>
        </button>
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
      <button
        v-if="mobileNavOpen"
        class="admin-sidebar__backdrop"
        type="button"
        aria-label="关闭后台导航"
        @click="mobileNavOpen = false"
      ></button>
      <!-- 侧边栏 -->
      <aside class="admin-sidebar" :class="{ collapsed: sidebarCollapsed, 'mobile-open': mobileNavOpen }">
        <nav class="admin-sidebar__nav">
          <section
            v-for="group in navGroups"
            :key="group.title"
            class="admin-sidebar__group"
          >
            <div class="admin-sidebar__group-head">
              <span class="admin-sidebar__group-title">{{ group.title }}</span>
            </div>

            <component
              v-for="item in group.items"
              :key="item.to"
              :is="item.external ? 'a' : 'router-link'"
              v-bind="item.external ? { href: item.to, target: '_blank', rel: 'noopener noreferrer' } : { to: item.to }"
              class="admin-sidebar__item admin-sidebar__item--secondary"
              :class="item.external ? null : { active: isActiveRoute(item.to) }"
              :aria-label="item.label"
              :title="item.label"
              @click="mobileNavOpen = false"
            >
              <el-icon><component :is="item.icon" /></el-icon>
              <span>{{ item.label }}</span>
            </component>
          </section>
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

    <!-- Ctrl+K 命令面板 -->
    <AdminCommandPalette
      v-model:visible="commandPaletteOpen"
      :nav-groups="navGroups"
      @select="handlePaletteSelect"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed, watch, type Component } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { adminAuthApi, hasAdminSession } from '@/api/adminApi';
import { toast } from '../../utils/toast';
import AdminCommandPalette from './components/AdminCommandPalette.vue';
import {
  DataAnalysis,
  User,
  Reading,
  Cpu,
  Operation,
  Connection,
  Grid,
  Setting,
  ArrowDown,
  SwitchButton,
  Tickets,
  Document,
  EditPen,
  Menu,
  Search,
} from '@element-plus/icons-vue';

interface NavItem {
  to: string;
  label: string;
  icon: Component;
  external?: boolean;
}

interface NavGroup {
  title: string;
  items: NavItem[];
}

const router = useRouter();
const route = useRoute();
const isTestRoute = computed(() => route.path.startsWith('/admin/test/'));

const currentUser = ref<{ name?: string; avatarUrl?: string; [key: string]: unknown } | null>(null);
const sidebarCollapsed = ref(false);
const mobileNavOpen = ref(false);
const commandPaletteOpen = ref(false);

// Ctrl+K / Cmd+K 打开命令面板
const handleGlobalKeydown = (event: KeyboardEvent) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    commandPaletteOpen.value = !commandPaletteOpen.value;
  }
};

interface PaletteNavItem {
  to: string;
  label: string;
  icon: Component;
  external?: boolean;
}

const handlePaletteSelect = (item: PaletteNavItem) => {
  if (item.external) {
    window.open(item.to, '_blank', 'noopener,noreferrer');
    return;
  }
  router.push(item.to);
};

// 侧边栏状态持久化
onMounted(() => {
  const saved = localStorage.getItem('admin-sidebar-collapsed');
  if (saved !== null) {
    sidebarCollapsed.value = saved === 'true';
  }

  const userStr = localStorage.getItem('admin_user') || sessionStorage.getItem('admin_user');
  if (userStr) {
    try {
      currentUser.value = JSON.parse(userStr);
    } catch {
      currentUser.value = null;
    }
  }
  if (!hasAdminSession()) {
    router.push('/admin/login');
  }
});

window.addEventListener('keydown', handleGlobalKeydown);

onUnmounted(() => {
  window.removeEventListener('keydown', handleGlobalKeydown);
});

const toggleSidebar = () => {
  sidebarCollapsed.value = !sidebarCollapsed.value;
  localStorage.setItem('admin-sidebar-collapsed', String(sidebarCollapsed.value));
};

watch(() => route.fullPath, () => {
  mobileNavOpen.value = false;
});

const isActiveRoute = (path: string) => {
  if (path === '/admin/dashboard') {
    return route.path === '/admin/dashboard';
  }

  if (path === '/admin/skills') {
    return route.path === '/admin/skills' || route.path.startsWith('/admin/skills/');
  }

  if (path === '/admin/virtual-learners') {
    return route.path.startsWith('/admin/virtual-learners') || route.path.startsWith('/admin/virtual-session/');
  }

  if (path === '/admin/learner-center') {
    return route.path.startsWith('/admin/learner-center') || route.path.startsWith('/admin/learner-models');
  }

  return route.path.startsWith(path);
};

const navGroups: NavGroup[] = [
  {
    title: '总览',
    items: [
      { to: '/admin/dashboard', label: '平台总览', icon: DataAnalysis },
    ],
  },
  {
    title: '学习',
    items: [
      { to: '/admin/users', label: '用户', icon: User },
      { to: '/admin/learner-center', label: '学习者中心', icon: Reading },
      { to: '/admin/virtual-learners', label: '虚拟学习者', icon: User },
    ],
  },
  {
    title: '运行',
    items: [
      { to: '/admin/skills', label: 'Skill 目录', icon: Grid },
      { to: '/admin/agents/topology', label: 'Agent 拓扑', icon: Connection },
      { to: '/admin/orchestrator-definitions', label: '编排结构', icon: Connection },
    ],
  },
  {
    title: '日志',
    items: [
      { to: '/admin/execution-logs', label: '执行日志', icon: Cpu },
      { to: '/admin/path-generation-events', label: '流程事件', icon: Connection },
      { to: '/admin/prompt-call-logs', label: 'Prompt 日志', icon: Document },
    ],
  },
  {
    title: '配置',
    items: [
      { to: '/admin/api-config', label: '连接与安全', icon: Setting },
      { to: '/admin/skill-model-configs', label: '外挂组件', icon: Operation },
    ],
  },
  {
    title: '调试',
    items: [
      { to: '/admin/prompt-lab', label: 'Prompt Dry Run', icon: EditPen },
      { to: '/admin/test/dashboard', label: '测试学习台', icon: Tickets, external: true },
    ],
  },
];

const handleLogout = () => {
  adminAuthApi.logout();
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
  padding: 0 24px;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.97), rgba(249, 251, 255, 0.95));
  backdrop-filter: var(--glass-blur);
  -webkit-backdrop-filter: var(--glass-blur);
  border-bottom: 1px solid rgba(216, 224, 238, 0.85);
  position: sticky;
  top: 0;
  z-index: 101;
  transition: background var(--transition-normal), border-color var(--transition-normal);
}

.admin-header__brand {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-shrink: 0;
}

.admin-header__menu {
  display: none;
  width: 44px;
  height: 44px;
  padding: 0;
}

.admin-header__logo {
  height: 48px;
  width: auto;
  object-fit: contain;
}

.admin-header__title {
  font-size: 0.9375rem;
  font-weight: 700;
  color: #24364e;
  letter-spacing: -0.02em;
  white-space: nowrap;
}

.admin-header__right {
  display: flex;
  align-items: center;
  gap: 16px;
}

/* Ctrl+K 命令面板入口 */
.admin-header__search {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 7px 12px;
  border-radius: var(--admin-radius-md, 12px);
  border: 1px solid rgba(214, 223, 240, 0.9);
  background: rgba(255, 255, 255, 0.9);
  color: #5f7187;
  font-size: 0.8125rem;
  font-weight: 600;
  cursor: pointer;
  transition: all var(--fluent-duration-fast, 180ms) var(--fluent-easing, ease);
}

.admin-header__search:hover {
  background: rgba(247, 250, 255, 0.98);
  border-color: rgba(52, 120, 246, 0.24);
  color: #22344d;
}

.admin-header__search-kbd {
  padding: 1px 6px;
  border-radius: 4px;
  border: 1px solid rgba(214, 223, 240, 0.9);
  background: #f6f8fc;
  color: #8ba3b5;
  font-size: 0.6875rem;
  font-family: inherit;
  font-weight: 600;
}

.admin-header__user {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  padding: 8px 14px;
  border-radius: 16px;
  border: 1px solid rgba(214, 223, 240, 0.9);
  background: rgba(255, 255, 255, 0.9);
  color: #5f7187;
  transition: all var(--fluent-duration-fast) var(--fluent-easing);
}

.admin-header__user:hover {
  background: rgba(247, 250, 255, 0.98);
  border-color: rgba(52, 120, 246, 0.16);
  color: #22344d;
}

.admin-header__user-name {
  font-size: 0.875rem;
  font-weight: 600;
  white-space: nowrap;
}

/* ========== 布局 ========== */
.admin-layout {
  display: grid;
  grid-template-columns: var(--sidebar-width, 240px) 1fr;
  height: calc(100vh - 56px);
  overflow: hidden;
  transition: grid-template-columns 0.25s ease;
}

/* 折叠状态自动调整布局 */
.admin-layout:has(.admin-sidebar.collapsed) {
  grid-template-columns: var(--sidebar-collapsed-width, 64px) 1fr;
}

/* ========== 侧边栏 ========== */
.admin-sidebar {
  width: var(--sidebar-width, 240px);
  height: 100%;
  position: sticky;
  top: 0;
  align-self: flex-start;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.97), rgba(248, 250, 254, 0.95));
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border-right: 1px solid rgba(216, 224, 238, 0.85);
  display: flex;
  flex-direction: column;
  padding: 16px 0;
  overflow: hidden;
  transition: width 0.25s ease;
}

.admin-sidebar.collapsed {
  width: var(--sidebar-collapsed-width, 64px);
}

.admin-sidebar.collapsed .admin-sidebar__group-head,
.admin-sidebar.collapsed .admin-sidebar__item span {
  display: none;
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
  margin-bottom: 22px;
}

.admin-sidebar__group-head {
  padding-bottom: 8px;
}

.admin-sidebar__group-title {
  display: block;
  font-size: 0.75rem;
  font-weight: 700;
  color: #64748b;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  padding: 0 14px;
  white-space: nowrap;
}

.admin-sidebar__item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 11px 14px;
  border-radius: var(--admin-radius-md, 12px);
  border: 1px solid transparent;
  background: transparent;
  color: #5f7187;
  text-decoration: none;
  font-size: 0.875rem;
  font-weight: 600;
  white-space: nowrap;
  position: relative;
  transition: all 180ms ease;
}

.admin-sidebar__item:hover {
  background: rgba(247, 250, 255, 0.96);
  border-color: rgba(216, 224, 238, 0.95);
  color: #22344d;
}

.admin-sidebar__item.active {
  background: linear-gradient(180deg, rgba(235, 243, 255, 0.96), rgba(228, 239, 255, 0.96));
  border-color: rgba(52, 120, 246, 0.18);
  color: #2d6df2;
  font-weight: 700;
}

.admin-sidebar__item.active::before {
  content: '';
  position: absolute;
  left: -12px;
  top: 50%;
  transform: translateY(-50%);
  width: 3px;
  height: 20px;
  border-radius: 0 3px 3px 0;
  background: var(--admin-text-brand, #3478f6);
}

.admin-sidebar__item--secondary {
  color: #708199;
}

.admin-sidebar__item--secondary:not(.active) {
  font-weight: 500;
}


.admin-sidebar__item .el-icon {
  font-size: 1.125rem;
  flex-shrink: 0;
}

.admin-sidebar__toggle {
  display: flex;
  align-items: center;
  justify-content: center;
  width: calc(100% - 24px);
  margin: 0 12px;
  height: 42px;
  border: 1px solid transparent;
  border-radius: var(--admin-radius-md, 12px);
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  transition: all 180ms ease;
}

.admin-sidebar__toggle:hover {
  background: rgba(247, 250, 255, 0.96);
  border-color: rgba(216, 224, 238, 0.95);
  color: #22344d;
}

.admin-sidebar__toggle .el-icon {
  font-size: 1.125rem;
}

.admin-sidebar__backdrop {
  display: none;
}

/* ========== 主内容区 ========== */
.admin-main {
  padding: 24px 28px 28px;
  background:
    linear-gradient(180deg, rgba(246, 249, 254, 0.96), rgba(240, 245, 252, 0.9));
  height: calc(100vh - 56px);
  overflow-y: auto;
  transition: background var(--transition-normal);
}

.admin-content {
  max-width: 1480px;
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

  .admin-sidebar .admin-sidebar__brand,
  .admin-sidebar .admin-sidebar__group-title,
  .admin-sidebar .admin-sidebar__item span {
    display: none;
  }

  .admin-main {
    padding: 16px;
  }
}

@media (max-width: 768px) {
  .admin-layout {
    grid-template-columns: minmax(0, 1fr);
  }

  .admin-header {
    padding: 0 12px;
  }

  .admin-header__menu {
    display: inline-flex;
  }

  .admin-header__search-text,
  .admin-header__search-kbd {
    display: none;
  }

  .admin-header__logo {
    height: 42px;
  }

  .admin-sidebar,
  .admin-sidebar.collapsed {
    position: fixed;
    z-index: 120;
    top: 56px;
    bottom: 0;
    left: 0;
    width: min(82vw, 300px);
    height: calc(100dvh - 56px);
    transform: translateX(-100%);
    transition: transform 180ms ease;
    box-shadow: var(--admin-shadow-sticky);
  }

  .admin-sidebar.mobile-open {
    transform: translateX(0);
  }

  .admin-sidebar .admin-sidebar__group-title,
  .admin-sidebar .admin-sidebar__item span,
  .admin-sidebar.collapsed .admin-sidebar__group-head,
  .admin-sidebar.collapsed .admin-sidebar__item span {
    display: block;
  }

  .admin-sidebar__nav {
    padding: 0 12px;
  }

  .admin-sidebar__item {
    min-height: 44px;
  }

  .admin-sidebar__toggle {
    display: none;
  }

  .admin-sidebar__backdrop {
    display: block;
    position: fixed;
    z-index: 119;
    inset: 56px 0 0;
    width: 100%;
    border: 0;
    background: rgba(15, 23, 42, 0.4);
    backdrop-filter: blur(2px);
  }

  .admin-main {
    padding: 12px;
  }
}
</style>
