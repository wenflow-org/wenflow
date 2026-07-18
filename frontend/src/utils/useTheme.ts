/**
 * 主题切换组合式函数
 * 支持亮色/暗色模式切换，自动保存用户偏好
 */

import { ref, onMounted } from 'vue'

export type Theme = 'light' | 'dark' | 'system'

const STORAGE_KEY = 'wenflow-theme'

// 全局状态，确保多个组件共享同一状态
const currentTheme = ref<Theme>('system')
const isDark = ref(false)

/**
 * 获取系统偏好
 */
function getSystemPreference(): boolean {
  if (typeof window === 'undefined') return false
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

/**
 * 应用主题到DOM
 */
function applyTheme(dark: boolean) {
  if (typeof document === 'undefined') return
  
  const html = document.documentElement
  
  if (dark) {
    html.setAttribute('data-theme', 'dark')
    html.classList.add('dark')
  } else {
    html.setAttribute('data-theme', 'light')
    html.classList.remove('dark')
  }
  
  isDark.value = dark
}

/**
 * 解析存储的主题值
 */
function parseStoredTheme(value: string | null): Theme {
  if (value === 'light' || value === 'dark' || value === 'system') {
    return value
  }
  return 'system'
}

// 系统主题监听器提升到模块级，只注册一次（避免每个组件挂载都累加监听）
let systemThemeListenerRegistered = false;

function registerSystemThemeListenerOnce() {
  if (systemThemeListenerRegistered || typeof window === 'undefined') return;
  systemThemeListenerRegistered = true;
  const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
  mediaQuery.addEventListener('change', (e: MediaQueryListEvent) => {
    if (currentTheme.value === 'system') {
      applyTheme(e.matches);
    }
  });
}

/**
 * 主题切换组合式函数
 */
export function useTheme() {
  /**
   * 设置主题
   */
  function setTheme(theme: Theme) {
    currentTheme.value = theme
    
    // 保存到本地存储
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, theme)
    }
    
    // 应用主题
    if (theme === 'system') {
      applyTheme(getSystemPreference())
    } else {
      applyTheme(theme === 'dark')
    }
  }
  
  /**
   * 切换亮色/暗色模式
   */
  function toggleTheme() {
    if (currentTheme.value === 'system') {
      // 如果当前是系统模式，根据当前实际显示切换
      setTheme(isDark.value ? 'light' : 'dark')
    } else {
      setTheme(currentTheme.value === 'dark' ? 'light' : 'dark')
    }
  }
  
  /**
   * 初始化主题
   */
  function initTheme() {
    // 读取存储的偏好
    const stored = typeof localStorage !== 'undefined' 
      ? localStorage.getItem(STORAGE_KEY) 
      : null
    
    const theme = parseStoredTheme(stored)
    currentTheme.value = theme
    
    // 应用主题
    if (theme === 'system') {
      applyTheme(getSystemPreference())
    } else {
      applyTheme(theme === 'dark')
    }
    
    // 监听系统主题变化（模块级只注册一次）
    registerSystemThemeListenerOnce();
  }
  
  // 组件挂载时初始化
  onMounted(() => {
    initTheme()
  })
  
  return {
    /** 当前主题设置 */
    theme: currentTheme,
    /** 是否为暗色模式（实际显示） */
    isDark,
    /** 设置主题 */
    setTheme,
    /** 切换主题 */
    toggleTheme,
    /** 初始化主题 */
    initTheme,
  }
}

/**
 * 主题图标映射
 */
export const themeIcons = {
  light: '☀️',
  dark: '🌙',
  system: '💻',
} as const

/**
 * 主题名称映射
 */
export const themeNames = {
  light: '亮色模式',
  dark: '暗色模式',
  system: '跟随系统',
} as const
