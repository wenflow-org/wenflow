<template>
  <div class="mobile-site-menu">
    <button type="button" class="mobile-site-menu__trigger" :aria-label="drawerOpen ? '关闭导航菜单' : '打开导航菜单'" @click="drawerOpen = true">
      <el-icon><Menu /></el-icon>
    </button>

    <el-drawer v-model="drawerOpen" direction="rtl" :with-header="false" append-to-body size="min(92vw, 420px)" class="mobile-site-menu__drawer">
      <div class="mobile-site-menu__panel">
        <div class="mobile-site-menu__panel-head">
          <div class="mobile-site-menu__identity">
            <span class="mobile-site-menu__avatar">{{ userInitial }}</span>
            <div>
              <strong>{{ userName }}</strong>
              <p>{{ title }}</p>
            </div>
          </div>

          <button type="button" class="mobile-site-menu__close" aria-label="关闭导航菜单" @click="drawerOpen = false">
            <el-icon><Close /></el-icon>
          </button>
        </div>

        <nav class="mobile-site-menu__nav" aria-label="移动端导航菜单">
          <router-link
            v-for="item in navItems"
            :key="item.label"
            :to="item.to"
            class="mobile-site-menu__link"
            :class="{ 'mobile-site-menu__link--active': isActive(item) }"
            @click="drawerOpen = false"
          >
            <span>{{ item.label }}</span>
            <el-icon><ArrowRight /></el-icon>
          </router-link>
        </nav>

        <div v-if="primaryAction || secondaryAction" class="mobile-site-menu__actions">
          <router-link
            v-if="primaryAction"
            :to="primaryAction.to"
            class="mobile-site-menu__action mobile-site-menu__action--primary"
            @click="drawerOpen = false"
          >
            {{ primaryAction.label }}
          </router-link>
          <router-link
            v-if="secondaryAction"
            :to="secondaryAction.to"
            class="mobile-site-menu__action mobile-site-menu__action--secondary"
            @click="drawerOpen = false"
          >
            {{ secondaryAction.label }}
          </router-link>
        </div>

        <div class="mobile-site-menu__footer">
          <router-link
            v-if="showAccountLink"
            :to="accountPath"
            class="mobile-site-menu__footer-link"
            @click="drawerOpen = false"
          >
            {{ accountLabel }}
          </router-link>
          <button type="button" class="mobile-site-menu__footer-link mobile-site-menu__footer-link--danger" @click="emitLogout">
            退出登录
          </button>
        </div>
      </div>
    </el-drawer>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { ArrowRight, Close, Menu } from '@element-plus/icons-vue'

interface NavItem {
  label: string
  to: string
  matchPrefixes?: string[]
}

interface ActionItem {
  label: string
  to: string
}

const props = withDefaults(defineProps<{
  title?: string
  userName: string
  userInitial: string
  navItems: NavItem[]
  primaryAction?: ActionItem | null
  secondaryAction?: ActionItem | null
  accountLabel?: string
  accountPath?: string
  showAccountLink?: boolean
}>(), {
  title: '学习主站',
  primaryAction: null,
  secondaryAction: null,
  accountLabel: '能力中心',
  accountPath: '/user',
  showAccountLink: true
})

const emit = defineEmits<{
  logout: []
}>()

const route = useRoute()
const drawerOpen = ref(false)

const currentPath = computed(() => route.path)

const isActive = (item: NavItem) => {
  const prefixes = item.matchPrefixes?.length ? item.matchPrefixes : [item.to]
  return prefixes.some((prefix) => currentPath.value === prefix || currentPath.value.startsWith(prefix))
}

const emitLogout = () => {
  drawerOpen.value = false
  emit('logout')
}

watch(() => route.fullPath, () => {
  drawerOpen.value = false
})
</script>

<style scoped>
.mobile-site-menu {
  display: none;
}

.mobile-site-menu__trigger,
.mobile-site-menu__close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 42px;
  height: 42px;
  border-radius: 14px;
  border: 1px solid rgba(52, 120, 246, 0.12);
  background: color-mix(in srgb, var(--glass-bg-light) 88%, white);
  color: var(--color-primary-dark);
  box-shadow: 0 10px 24px rgba(31, 87, 204, 0.08);
  cursor: pointer;
}

.mobile-site-menu__panel {
  display: grid;
  grid-template-rows: auto auto auto 1fr;
  gap: 18px;
  min-height: 100%;
  height: 100%;
  padding: 20px;
  overflow-y: auto;
  background:
    radial-gradient(circle at top right, rgba(67, 176, 216, 0.14), transparent 28%),
    linear-gradient(180deg, rgba(255, 255, 255, 0.98), rgba(244, 248, 255, 0.96));
}

.mobile-site-menu__panel-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.mobile-site-menu__identity {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}

.mobile-site-menu__identity strong {
  display: block;
  color: var(--text-primary);
  font-size: 1rem;
  line-height: 1.2;
  word-break: break-word;
}

.mobile-site-menu__identity p {
  margin: 4px 0 0;
  color: var(--text-secondary);
  font-size: 0.85rem;
  line-height: 1.35;
}

.mobile-site-menu__avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  border-radius: 16px;
  background: linear-gradient(135deg, var(--color-secondary), var(--color-primary));
  color: #fff;
  font-weight: 700;
}

.mobile-site-menu__nav,
.mobile-site-menu__actions,
.mobile-site-menu__footer {
  display: grid;
  gap: 10px;
}

.mobile-site-menu__link,
.mobile-site-menu__footer-link {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 16px;
  border-radius: 16px;
  border: 1px solid rgba(52, 120, 246, 0.08);
  background: rgba(255, 255, 255, 0.7);
  color: var(--text-primary);
  text-decoration: none;
  font-weight: 600;
  min-width: 0;
}

.mobile-site-menu__link span,
.mobile-site-menu__footer-link span {
  min-width: 0;
}

.mobile-site-menu__link--active {
  color: var(--color-primary-dark);
  background: rgba(52, 120, 246, 0.1);
  border-color: rgba(52, 120, 246, 0.14);
}

.mobile-site-menu__action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 46px;
  padding: 0 16px;
  border-radius: 16px;
  text-decoration: none;
  font-weight: 700;
}

.mobile-site-menu__action--primary {
  color: #fff;
  background: linear-gradient(135deg, var(--color-primary), var(--color-primary-dark));
  box-shadow: 0 14px 28px rgba(52, 120, 246, 0.18);
}

.mobile-site-menu__action--secondary {
  color: var(--color-primary-dark);
  background: rgba(255, 255, 255, 0.76);
  border: 1px solid rgba(52, 120, 246, 0.12);
}

.mobile-site-menu__footer-link {
  width: 100%;
  justify-content: center;
}

.mobile-site-menu__footer-link--danger {
  cursor: pointer;
  color: var(--color-danger-dark);
}

.mobile-site-menu__footer-link--danger:hover {
  background: rgba(239, 117, 120, 0.08);
  border-color: rgba(239, 117, 120, 0.14);
}

:deep(.mobile-site-menu__drawer .el-drawer__body) {
  padding: 0;
  height: 100%;
}

@media (max-width: 420px) {
  .mobile-site-menu__panel {
    padding: 16px;
  }

  .mobile-site-menu__panel-head {
    align-items: center;
  }

  .mobile-site-menu__identity {
    gap: 10px;
  }

  .mobile-site-menu__avatar {
    width: 40px;
    height: 40px;
    border-radius: 14px;
  }

  .mobile-site-menu__identity strong {
    font-size: 0.95rem;
  }

  .mobile-site-menu__identity p {
    font-size: 0.8rem;
  }

  .mobile-site-menu__link,
  .mobile-site-menu__footer-link,
  .mobile-site-menu__action {
    border-radius: 14px;
  }
}

[data-theme='dark'] .mobile-site-menu__trigger,
[data-theme='dark'] .mobile-site-menu__close {
  background: rgba(15, 23, 42, 0.68);
  border-color: rgba(96, 165, 250, 0.14);
  color: #9fc3ff;
  box-shadow: 0 12px 28px rgba(0, 0, 0, 0.24);
}

[data-theme='dark'] .mobile-site-menu__panel {
  background:
    radial-gradient(circle at top right, rgba(67, 176, 216, 0.12), transparent 26%),
    linear-gradient(180deg, rgba(15, 24, 32, 0.98), rgba(26, 37, 47, 0.96));
}

[data-theme='dark'] .mobile-site-menu__link,
[data-theme='dark'] .mobile-site-menu__footer-link {
  background: rgba(15, 23, 42, 0.52);
  border-color: rgba(96, 165, 250, 0.12);
  color: #edf2f6;
}

[data-theme='dark'] .mobile-site-menu__link--active {
  color: #9fc3ff;
  background: rgba(52, 120, 246, 0.18);
}

[data-theme='dark'] .mobile-site-menu__action--secondary {
  color: #b8d2ff;
  background: rgba(15, 23, 42, 0.56);
  border-color: rgba(96, 165, 250, 0.14);
}

[data-theme='dark'] .mobile-site-menu__footer-link--danger {
  color: #f6a3a6;
}

@media (max-width: 768px) {
  .mobile-site-menu {
    display: block;
  }
}
</style>
