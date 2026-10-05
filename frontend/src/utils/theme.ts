/**
 * 用户侧主题唯一事实源（SSOT）。
 *
 * 背景：此前主题状态分散在 index.html 内联脚本（v2_theme）、App.vue（v2_theme）、
 * router beforeEach（wenflow-theme → wf_admin_theme）与 ThemeToggle（v2_theme）四处，
 * 各写各的 key，导致「用户切日间后路由切换被 beforeEach 按旧 key 回退系统偏好」，
 * 出现日间模式下的黑白闪烁。本模块统一读写，其余入口全部收敛到这里：
 *
 * - 主 key：v2_theme（用户侧 ThemeToggle 原 key，index.html 首屏脚本已按此 key 防闪）
 * - 兼容 key：wenflow-theme（router beforeEach 旧机制读取；同步写入避免导航时被旧逻辑覆盖）
 *
 * 系统 prefers-color-scheme 仅在无任何持久化值时作为回退。
 */
const THEME_KEY = 'v2_theme';
const LEGACY_THEME_KEY = 'wenflow-theme';

export type ThemeMode = 'light' | 'dark';

export function readTheme(): ThemeMode {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === 'light' || saved === 'dark') return saved;
    // 兼容：旧机制 key 有值时沿用
    const legacy = localStorage.getItem(LEGACY_THEME_KEY);
    if (legacy === 'light' || legacy === 'dark') return legacy;
  } catch {
    /* 隐私模式忽略 */
  }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function writeTheme(mode: ThemeMode) {
  try {
    localStorage.setItem(THEME_KEY, mode);
    localStorage.setItem(LEGACY_THEME_KEY, mode);
  } catch {
    /* 隐私模式忽略 */
  }
}

export function applyDocumentTheme(mode: ThemeMode) {
  document.documentElement.dataset.theme = mode;
  document.documentElement.classList.toggle('dark', mode === 'dark');
  /* index.html 首屏脚本为了防白闪，直接给 body 写了内联背景/文字色；运行时切主题不会更新它，
     载入浅色再切深色后 body 内联仍停在亮底（当前被 shell 层遮住，属潜在亮块/暗块）。
     body 的基础样式（design-system.css）已按 var(--bg-body)/var(--text-primary) 随 data-theme 翻转，
     故这里清掉内联即可让样式表接管——不在此硬编码颜色，也不与启动脚本字面量分家。 */
  const body = document.body;
  if (body && (body.style.background || body.style.color)) {
    body.style.background = '';
    body.style.color = '';
  }
}
