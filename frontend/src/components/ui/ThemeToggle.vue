<template>
  <button class="theme-toggle" @click="toggle" :title="isDark ? '切换到亮色模式' : '切换到暗色模式'">
    <span v-if="isDark" class="theme-toggle__icon">
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zm0 2a7 7 0 1 1 0-14 7 7 0 0 1 0 14zm0-15V2m0 20v-2m-9-9H1m22 0h-2M4.9 4.9 3.5 3.5m17 17-1.4-1.4m0-14.2 1.4-1.4m-17 17 1.4-1.4"/></svg>
    </span>
    <span v-else class="theme-toggle__icon">
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>
    </span>
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
