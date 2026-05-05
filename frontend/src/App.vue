<template>
  <div id="app">
    <RouterView />
    <ToastHost />
  </div>
</template>

<script setup lang="ts">
import { onMounted } from 'vue';
import { useUserStore } from './stores/user';
import ToastHost from './components/ui/ToastHost.vue';

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
