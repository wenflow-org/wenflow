import { describe, expect, it, afterEach } from 'vitest';
import { installRafStallFallback } from '../raf-stall-fallback';

/**
 * rAF 停帧兜底回归：停帧（rAF 永不回调）时挂起的 rAF 回调必须经看门狗放行；
 * 帧正常时回调走原生路径且不重复触发；cancel 后不再触发。
 */
describe('installRafStallFallback', () => {
  afterEach(() => {
    // 每个用例自行 uninstall，这里仅兜底恢复（若用例中途断言失败）
    delete (window as unknown as Record<string, unknown>).__rafStubMode;
  });

  it('停帧：rAF 回调在 stallMs 后经看门狗放行（一次且仅一次）', async () => {
    // 模拟停帧：原生 rAF 永不回调
    const origRaf = window.requestAnimationFrame;
    const origCancel = window.cancelAnimationFrame;
    (window as unknown as Record<string, unknown>).requestAnimationFrame = () => 1;
    (window as unknown as Record<string, unknown>).cancelAnimationFrame = () => {};

    const uninstall = installRafStallFallback(80);
    try {
      let calls = 0;
      const done = new Promise<number>((resolve) => {
        window.requestAnimationFrame(() => {
          calls += 1;
          resolve(calls);
        });
      });
      const n = await done;
      expect(n).toBe(1);
      // 再等一轮，确认没有重复放行
      await new Promise((r) => setTimeout(r, 160));
      expect(calls).toBe(1);
    } finally {
      uninstall();
      (window as unknown as Record<string, unknown>).requestAnimationFrame = origRaf;
      (window as unknown as Record<string, unknown>).cancelAnimationFrame = origCancel;
    }
  });

  it('帧正常：回调走原生路径立即触发，看门狗不重复触发', async () => {
    const origRaf = window.requestAnimationFrame;
    const origCancel = window.cancelAnimationFrame;
    // 模拟「帧立即到」的原生实现
    (window as unknown as Record<string, unknown>).requestAnimationFrame = (cb: FrameRequestCallback) => {
      const id = setTimeout(() => cb(performance.now()), 0) as unknown as number;
      return id as unknown as number;
    };
    (window as unknown as Record<string, unknown>).cancelAnimationFrame = (id: number) => clearTimeout(id as unknown as number);

    const uninstall = installRafStallFallback(80);
    try {
      let calls = 0;
      window.requestAnimationFrame(() => { calls += 1; });
      await new Promise((r) => setTimeout(r, 200));
      expect(calls).toBe(1);
    } finally {
      uninstall();
      (window as unknown as Record<string, unknown>).requestAnimationFrame = origRaf;
      (window as unknown as Record<string, unknown>).cancelAnimationFrame = origCancel;
    }
  });

  it('cancel 后：停帧放行不再触发回调', async () => {
    const origRaf = window.requestAnimationFrame;
    const origCancel = window.cancelAnimationFrame;
    (window as unknown as Record<string, unknown>).requestAnimationFrame = () => 1;
    (window as unknown as Record<string, unknown>).cancelAnimationFrame = () => {};

    const uninstall = installRafStallFallback(60);
    try {
      let calls = 0;
      const id = window.requestAnimationFrame(() => { calls += 1; });
      window.cancelAnimationFrame(id);
      await new Promise((r) => setTimeout(r, 200));
      expect(calls).toBe(0);
    } finally {
      uninstall();
      (window as unknown as Record<string, unknown>).requestAnimationFrame = origRaf;
      (window as unknown as Record<string, unknown>).cancelAnimationFrame = origCancel;
    }
  });
});
