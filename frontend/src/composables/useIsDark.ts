import { onBeforeUnmount, onMounted, ref, type Ref } from 'vue';

/**
 * 响应式暗色模式开关（单一事实源 = <html data-theme>）。
 *
 * 主题由 utils/theme.ts 的 applyDocumentTheme 写到 documentElement.dataset.theme，
 * 这里用 MutationObserver 跟随，无需各组件各自维护主题 state。
 *
 * 用途：需要按主题切换静态资源（如品牌 logo 暗色版），CSS token 覆盖不到 img 资源。
 */
export function useIsDark(): Ref<boolean> {
  const isDark = ref(false);
  let observer: MutationObserver | null = null;

  const sync = () => {
    isDark.value = document.documentElement.dataset.theme === 'dark';
  };

  onMounted(() => {
    sync();
    observer = new MutationObserver(sync);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  });
  onBeforeUnmount(() => observer?.disconnect());

  return isDark;
}
