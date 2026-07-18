<template>
  <el-config-provider :locale="zhCn">
    <div id="app">
      <RouterView v-slot="{ Component }">
        <transition name="route-fade" mode="out-in">
          <component :is="Component" />
        </transition>
      </RouterView>
      <ToastHost />
      <DevOverlay v-if="isTestMode" />
    </div>
  </el-config-provider>
</template>

<script setup lang="ts">
import { defineAsyncComponent, onMounted } from 'vue';
import zhCn from 'element-plus/es/locale/lang/zh-cn';
import { useUserStore } from './stores/user';
import { isTestMode } from '@/utils/debugMode';
import ToastHost from './components/ui/ToastHost.vue';

// 调试浮层仅测试模式加载，普通用户不下载其代码
const DevOverlay = defineAsyncComponent(() => import('./components/dev/DevOverlay.vue'));

const userStore = useUserStore();

onMounted(() => {
  userStore.initFromStorage();
});
</script>

<style scoped>
#app {
  min-height: 100vh;
  min-height: 100dvh;
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
