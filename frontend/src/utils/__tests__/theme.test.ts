/**
 * 用户侧主题统一（SSOT）回归测试：
 * - readTheme：主 key v2_theme 优先，兼容 key wenflow-theme 回退，无值跟随系统偏好
 * - writeTheme：双 key 同步写入（防止 router beforeEach 按旧 key 覆盖 → 黑白闪）
 * - applyDocumentTheme：data-theme 与 .dark class 同步
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyDocumentTheme, readTheme, writeTheme, type ThemeMode } from '../theme';

const THEME_KEY = 'v2_theme';
const LEGACY_KEY = 'wenflow-theme';

function setMatchMedia(matchesDark: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: query.includes('dark') ? matchesDark : false,
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false
  })) as typeof window.matchMedia;
}

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.classList.remove('dark');
});

afterEach(() => {
  localStorage.clear();
});

describe('readTheme', () => {
  it('主 key v2_theme 优先', () => {
    localStorage.setItem(LEGACY_KEY, 'dark');
    localStorage.setItem(THEME_KEY, 'light');
    setMatchMedia(true);
    expect(readTheme()).toBe('light');
  });

  it('主 key 缺失时回退兼容 key wenflow-theme', () => {
    localStorage.setItem(LEGACY_KEY, 'dark');
    setMatchMedia(false);
    expect(readTheme()).toBe('dark');
  });

  it('双 key 均缺失时跟随系统偏好', () => {
    setMatchMedia(true);
    expect(readTheme()).toBe('dark');
    setMatchMedia(false);
    expect(readTheme()).toBe('light');
  });
});

describe('writeTheme', () => {
  it('双 key 同步写入（避免导航被旧 key 覆盖回系统偏好）', () => {
    writeTheme('light');
    expect(localStorage.getItem(THEME_KEY)).toBe('light');
    expect(localStorage.getItem(LEGACY_KEY)).toBe('light');

    writeTheme('dark');
    expect(localStorage.getItem(THEME_KEY)).toBe('dark');
    expect(localStorage.getItem(LEGACY_KEY)).toBe('dark');
  });
});

describe('applyDocumentTheme', () => {
  it('data-theme 与 .dark class 同步设置', () => {
    applyDocumentTheme('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);

    applyDocumentTheme('light');
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('主题状态机：点击切换 → 路由切换 → 刷新后保持一致（黑白闪回归）', () => {
    // 用户点击 ThemeToggle 切日间
    applyDocumentTheme('light');
    writeTheme('light');

    // 模拟路由 beforeEach 的 syncThemeForRoute 重新解析
    const resolved: ThemeMode = readTheme();
    applyDocumentTheme(resolved);
    expect(document.documentElement.dataset.theme).toBe('light');

    // 模拟 F5 后 index.html 首屏脚本按主 key 解析
    expect(readTheme()).toBe('light');
    expect(document.documentElement.dataset.theme).toBe('light');
  });
});
