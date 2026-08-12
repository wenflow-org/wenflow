<template>
  <el-config-provider :locale="zhCn">
    <div id="app">
      <a href="#app-main" class="skip-link">跳到主要内容</a>
      <AnnouncementBanner />
      <div id="app-main" tabindex="-1">
        <RouterView v-slot="{ Component }">
          <transition name="route-fade" mode="out-in">
            <component :is="Component" />
          </transition>
        </RouterView>
      </div>
      <ToastHost />
      <MockConfirm />
    </div>
  </el-config-provider>
</template>

<script setup lang="ts">
import zhCn from 'element-plus/es/locale/lang/zh-cn';
import { useUserStore } from './stores/user';
import ToastHost from './components/ui/ToastHost.vue';
import AnnouncementBanner from './components/AnnouncementBanner.vue';
import MockConfirm from './views/admin-redesign/Confirm.vue';

const userStore = useUserStore();
// 同步恢复登录态，避免子组件 onMounted/watch 时 isLoggedIn 仍为 false
userStore.initFromStorage();
</script>

<style scoped>
#app {
  min-height: 100vh;
  min-height: 100dvh;
}

/* 无障碍：跳到主要内容（仅键盘聚焦时可见） */
.skip-link {
  position: fixed;
  top: 8px;
  left: 8px;
  z-index: 9999;
  padding: 8px 14px;
  border-radius: 8px;
  background: var(--blue, #3478f6);
  color: #fff;
  font-size: 13px;
  font-weight: 700;
  text-decoration: none;
  transform: translateY(-200%);
  transition: transform 0.2s ease;
}

.skip-link:focus-visible {
  transform: translateY(0);
}
</style>

<style>
/* 路由切换 fade-in 微动效 */
.route-fade-enter-active,
.route-fade-leave-active {
  transition: opacity 140ms ease, transform 140ms ease;
}

.route-fade-enter-from {
  opacity: 0;
  transform: translateY(4px);
}

.route-fade-leave-to {
  opacity: 0;
  transform: translateY(-2px);
}

@media (prefers-reduced-motion: reduce) {
  .route-fade-enter-active,
  .route-fade-leave-active {
    transition: none;
  }
  .route-fade-enter-from,
  .route-fade-leave-to {
    opacity: 1;
    transform: none;
  }
}
</style>
