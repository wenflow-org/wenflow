import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { defineComponent } from 'vue';
import { useOnline } from '../useOnline';

/**
 * useOnline 是「用户断网/恢复网络」在客户端唯一的判定入口（OfflineBanner 消费它）。
 * 这组用例锁的是它的**判定口径**：事件只负责触发重读 `navigator.onLine`，
 * 不按事件类型直接改值——否则 navigator.onLine 与事件不一致时会出现假在线。
 */

const setOnLine = (value: boolean) => {
  Object.defineProperty(window.navigator, 'onLine', { value, configurable: true });
};

const Host = defineComponent({
  setup() {
    const { online } = useOnline();
    return { online };
  },
  template: '<span data-test="state">{{ online }}</span>',
});

describe('useOnline（浏览器联网状态）', () => {
  const original = window.navigator.onLine;

  beforeEach(() => setOnLine(true));
  afterEach(() => setOnLine(original));

  it('初值取 navigator.onLine', () => {
    const on = mount(Host);
    expect(on.get('[data-test="state"]').text()).toBe('true');
    on.unmount();

    setOnLine(false);
    const off = mount(Host);
    expect(off.get('[data-test="state"]').text()).toBe('false');
    off.unmount();
  });

  it('offline 事件后转为离线，online 事件后恢复', async () => {
    const w = mount(Host);
    expect(w.get('[data-test="state"]').text()).toBe('true');

    setOnLine(false);
    window.dispatchEvent(new Event('offline'));
    await w.vm.$nextTick();
    expect(w.get('[data-test="state"]').text()).toBe('false');

    setOnLine(true);
    window.dispatchEvent(new Event('online'));
    await w.vm.$nextTick();
    expect(w.get('[data-test="state"]').text()).toBe('true');
    w.unmount();
  });

  it('判定以 navigator.onLine 为准：事件类型与它不一致时不改值', async () => {
    const w = mount(Host);

    // 收到 offline，但 navigator.onLine 仍为 true → 不应被改成离线
    window.dispatchEvent(new Event('offline'));
    await w.vm.$nextTick();
    expect(w.get('[data-test="state"]').text()).toBe('true');

    // 收到 online，但 navigator.onLine 已是 false → 不应被改成在线
    setOnLine(false);
    window.dispatchEvent(new Event('online'));
    await w.vm.$nextTick();
    expect(w.get('[data-test="state"]').text()).toBe('false');
    w.unmount();
  });

  it('卸载后不再监听（事件不触达已销毁的组件）', async () => {
    const remove = vi.spyOn(window, 'removeEventListener');
    const w = mount(Host);
    w.unmount();

    expect(remove).toHaveBeenCalledWith('online', expect.any(Function));
    expect(remove).toHaveBeenCalledWith('offline', expect.any(Function));

    // 卸载后再派发事件不应抛错
    setOnLine(false);
    expect(() => window.dispatchEvent(new Event('offline'))).not.toThrow();
    remove.mockRestore();
  });
});
