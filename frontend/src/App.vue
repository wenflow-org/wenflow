<template>
  <div id="app">
    <RouterView v-slot="{ Component, route }">
      <transition name="route-fade" mode="out-in">
        <component :is="Component" :key="route.fullPath" />
      </transition>
    </RouterView>
    <ToastHost />
    <DevOverlay />
  </div>
</template>

<script setup lang="ts">
import { onMounted } from 'vue';
import { useUserStore } from './stores/user';
import ToastHost from './components/ui/ToastHost.vue';
import DevOverlay from './components/dev/DevOverlay.vue';

const userStore = useUserStore();

onMounted(() => {
  document.title = 'AI学习平台';
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
  transition: opacity 220ms ease, transform 220ms ease;
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
