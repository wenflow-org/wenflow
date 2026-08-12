/**
 * vitest 全局环境准备（jsdom 缺失 API 补齐）
 * - matchMedia：element-plus / 部分组件挂载时读取
 * - ResizeObserver：el-table / el-select 等组件挂载时读取
 */

if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = (query: string): MediaQueryList =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false
    }) as unknown as MediaQueryList;
}

if (typeof globalThis !== 'undefined' && !('ResizeObserver' in globalThis)) {
  class ResizeObserverStub {
    observe() {
      /* noop */
    }
    unobserve() {
      /* noop */
    }
    disconnect() {
      /* noop */
    }
  }
  (globalThis as unknown as Record<string, unknown>).ResizeObserver = ResizeObserverStub;
}

// vue-router scrollBehavior 会调用 window.scrollTo，jsdom 已定义但抛「Not implemented」→ 覆盖
if (typeof window !== 'undefined') {
  window.scrollTo = () => undefined;
}
