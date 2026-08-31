<template>
  <button class="theme-toggle" @click="toggle" :title="isDark ? '切换到亮色模式' : '切换到暗色模式'">
    <span v-if="isDark" class="theme-toggle__icon">☀️</span>
    <span v-else class="theme-toggle__icon">🌙</span>
  </button>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { applyDocumentTheme, readTheme, writeTheme } from '@/utils/theme'

const isDark = ref(false)

function apply(dark: boolean) {
  isDark.value = dark
  applyDocumentTheme(dark ? 'dark' : 'light')
  writeTheme(dark ? 'dark' : 'light')
}

function toggle() {
  apply(!isDark.value)
}

onMounted(() => {
  apply(readTheme() === 'dark')
})
</script>

<style scoped>
.theme-toggle {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border: 1px solid var(--line, #e3e9f4);
  border-radius: 8px;
  background: none;
  cursor: pointer;
  transition: background 0.2s ease, border-color 0.2s ease;
  flex-shrink: 0;
}
.theme-toggle:hover {
  background: var(--canvas, #f3f6fb);
  border-color: rgba(52, 120, 246, 0.3);
}
.theme-toggle__icon {
  font-size: 18px;
  line-height: 1;
}
</style>
