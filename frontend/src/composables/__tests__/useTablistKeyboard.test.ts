import { describe, expect, it, vi } from 'vitest';
import { defineComponent, h, ref } from 'vue';
import { mount } from '@vue/test-utils';
import { useTablistKeyboard } from '../useTablistKeyboard';

/**
 * #75：三处手搓 tablist（Skills / ExecLogs / PromptEvalPanel）补 ARIA 契约后，
 * 把「roving tabindex + 方向键循环 + Home/End」这套行为钉在 composable 上。
 */
const TABS = ['a', 'b', 'c'] as const;

function mountTabs() {
  const activate = vi.fn((key: (typeof TABS)[number]) => {
    current.value = key;
  });
  const current = ref<(typeof TABS)[number]>('a');
  const Host = defineComponent({
    setup() {
      const { setTabRef, onTabKeydown } = useTablistKeyboard(TABS, current, activate);
      return () =>
        h('div', { role: 'tablist', onKeydown: onTabKeydown }, TABS.map((t, i) =>
          h('button', {
            key: t,
            ref: (el: unknown) => setTabRef(el, i),
            role: 'tab',
            tabindex: current.value === t ? 0 : -1,
          }, t)
        ));
    },
  });
  const w = mount(Host, { attachTo: document.body });
  return { w, activate, current };
}

describe('useTablistKeyboard', () => {
  it('右/左方向键循环切换，并从列表外回到首尾', async () => {
    const { w, activate } = mountTabs();
    const list = w.find('[role="tablist"]');
    await list.trigger('keydown', { key: 'ArrowRight' });
    expect(activate).toHaveBeenLastCalledWith('b');
    await list.trigger('keydown', { key: 'ArrowLeft' });
    expect(activate).toHaveBeenLastCalledWith('a');
    await list.trigger('keydown', { key: 'ArrowLeft' });
    expect(activate).toHaveBeenLastCalledWith('c');
    w.unmount();
  });

  it('Home / End 跳首尾；非导航键不拦截', async () => {
    const { w, activate } = mountTabs();
    const list = w.find('[role="tablist"]');
    await list.trigger('keydown', { key: 'End' });
    expect(activate).toHaveBeenLastCalledWith('c');
    await list.trigger('keydown', { key: 'Home' });
    expect(activate).toHaveBeenLastCalledWith('a');
    await list.trigger('keydown', { key: 'Enter' });
    expect(activate).toHaveBeenCalledTimes(2);
    w.unmount();
  });

  it('roving tabindex：仅选中页签在 Tab 序里', () => {
    const { w } = mountTabs();
    const tabindexes = w.findAll('[role="tab"]').map((b) => b.attributes('tabindex'));
    expect(tabindexes).toEqual(['0', '-1', '-1']);
    w.unmount();
  });
});
