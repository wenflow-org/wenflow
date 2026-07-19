<template>
  <div class="theme-switcher">
    <button
      class="theme-btn"
      :title="isDark ? '切换到亮色模式' : '切换到暗色模式'"
      :aria-label="isDark ? '切换到亮色模式' : '切换到暗色模式'"
      :aria-pressed="isDark"
      @click="toggleTheme"
    >
      <span class="theme-icon">
        {{ isDark ? '☀️' : '🌙' }}
      </span>
    </button>
    
    <!-- 可选：下拉菜单模式 -->
    <div v-if="showDropdown" class="theme-dropdown">
      <button
        v-for="(name, key) in themeNames"
        :key="key"
        class="theme-option"
        :class="{ active: theme === key }"
        @click="setTheme(key as Theme)"
      >
        <span class="theme-option-icon">{{ themeIcons[key] }}</span>
        <span class="theme-option-name">{{ name }}</span>
        <span v-if="theme === key" class="theme-option-check">✓</span>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useTheme, themeIcons, themeNames, type Theme } from '@/utils/useTheme'

defineProps<{
  showDropdown?: boolean
}>()

const { theme, isDark, setTheme, toggleTheme } = useTheme()
</script>

<style scoped>
.theme-switcher {
  position: relative;
}

.theme-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-lg);
  background: var(--bg-surface);
  color: var(--text-secondary);
  cursor: pointer;
  transition: all var(--transition-fast);
}

.theme-btn:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
  border-color: var(--border-dark);
  transform: scale(1.05);
}

.theme-btn:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 2px;
}

.theme-icon {
  font-size: 18px;
  transition: transform var(--transition-normal);
}

.theme-btn:hover .theme-icon {
  transform: rotate(15deg);
}

.theme-dropdown {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  min-width: 160px;
  background: var(--bg-surface);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
  padding: var(--spacing-1);
  z-index: var(--z-dropdown);
}

.theme-option {
  display: flex;
  align-items: center;
  width: 100%;
  padding: var(--spacing-2) var(--spacing-3);
  border: none;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  transition: all var(--transition-fast);
  font-size: var(--text-sm);
}

.theme-option:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.theme-option.active {
  background: var(--color-primary-bg, rgba(74, 111, 165, 0.1));
  color: var(--color-primary);
}

.theme-option-icon {
  margin-right: var(--spacing-2);
  font-size: 16px;
}

.theme-option-name {
  flex: 1;
  text-align: left;
}

.theme-option-check {
  color: var(--color-primary);
  font-weight: var(--font-bold);
}
</style>
