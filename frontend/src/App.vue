<template>
  <div id="app">
    <RouterView />
  </div>
</template>

<script setup lang="ts">
import { onMounted } from 'vue';
import { useUserStore } from './stores/user';

const userStore = useUserStore();

onMounted(() => {
  document.title = 'AI学习平台';
  // 从 localStorage 恢复用户信息
  userStore.initFromStorage();
});
</script>

<style scoped>
#app {
  min-height: 100vh;
}
</style>
