import { ref, type Ref } from 'vue';

/**
 * 页签键盘契约（roving tabindex + 方向键/Home/End）：
 * 声明了 role="tablist"/role="tab" 就必须兑现 ARIA tabs 语义——此前 Skills / ExecLogs /
 * PromptEvalPanel 三处只有 role 与点击，方向键无反应、所有页签都在 Tab 序里逐个停留。
 *
 * 用法：
 *   const { setTabRef, onTabKeydown } = useTablistKeyboard(TABS, tab, switchTab)
 *   <div role="tablist" @keydown="onTabKeydown">
 *     <button v-for="(t, i) in TABS" :ref="(el) => setTabRef(el, i)"
 *             :tabindex="tab === t ? 0 : -1" ...>
 *
 * activate 由调用方提供（保留各页自己的 URL 同步 / 懒加载逻辑）。
 */
export function useTablistKeyboard<T extends string>(
  tabs: readonly T[],
  current: Ref<T>,
  activate: (key: T) => void
) {
  const tabEls = ref<(HTMLButtonElement | null)[]>([]);

  function setTabRef(el: unknown, index: number) {
    tabEls.value[index] = (el as HTMLButtonElement) || null;
  }

  function onTabKeydown(e: KeyboardEvent) {
    const keys = ['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp', 'Home', 'End'];
    if (!keys.includes(e.key) || tabs.length === 0) return;
    const from = Math.max(0, tabs.indexOf(current.value));
    let next = from;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (from + 1) % tabs.length;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (from - 1 + tabs.length) % tabs.length;
    else if (e.key === 'Home') next = 0;
    else next = tabs.length - 1;
    e.preventDefault();
    activate(tabs[next]);
    // 焦点跟随选中（ARIA tabs 的 manual 激活惯例）
    requestAnimationFrame(() => tabEls.value[next]?.focus());
  }

  return { setTabRef, onTabKeydown };
}
