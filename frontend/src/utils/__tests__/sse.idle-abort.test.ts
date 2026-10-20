/**
 * SSE 空闲超时接线回归（#111/#113，2026-10-20）：
 *
 * 缺陷：fetch 挂的是 handlers.signal，而空闲超时 abort 的是无人监听的内部 controller——
 * 「60s 无字节即中止」从未真正生效，服务端挂起时流永不收尾（无上层看门狗的调用方永久挂起）。
 *
 * 钉住三侧：空闲超时必须把 fetch 实际使用的 signal 中止并落 transport 错误；
 * 字节到达会重置空闲计时；调用方 signal 中止仍落 cancelled（不误判成传输失败触发重发）。
 * mock 的 read() 与真实 fetch 同构：signal 一旦 abort，挂起的 read 立即 reject。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/utils/api', () => ({
  default: {},
  API_BASE_URL: '/api',
  refreshSessionSilently: vi.fn().mockResolvedValue(false),
}));
vi.mock('@/utils/projection', () => ({ getProjectionToken: () => null }));
vi.mock('@/utils/authFlash', () => ({ setAuthFlashMessage: vi.fn() }));
vi.mock('@/utils/sessionCleanup', () => ({ clearUserLocalState: vi.fn() }));

import { streamSsePost } from '../sse';

const abortErr = () => Object.assign(new Error('The operation was aborted'), { name: 'AbortError' });

/** 模拟真实响应体：read 挂起，但 signal abort 时立即 reject（与浏览器 fetch 同构） */
function hangingBody(signal: AbortSignal | undefined, firstChunk?: Uint8Array) {
  let first = true;
  return {
    getReader: () => ({
      read: () => {
        if (first && firstChunk) {
          first = false;
          return Promise.resolve({ done: false, value: firstChunk });
        }
        return new Promise<{ done: boolean; value?: Uint8Array }>((_resolve, reject) => {
          signal?.addEventListener('abort', () => reject(abortErr()), { once: true });
        });
      },
    }),
  };
}

describe('streamSsePost 空闲超时接线', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('60s 无字节：fetch 实际使用的 signal 被中止，且落 transport 错误', async () => {
    const st: { fetchSignal: AbortSignal | null } = { fetchSignal: null };
    vi.stubGlobal('fetch', vi.fn((_url: string, init?: { signal?: AbortSignal }) => {
      st.fetchSignal = init?.signal ?? null;
      return Promise.resolve({ ok: true, status: 200, body: hangingBody(init?.signal) });
    }));

    const p = streamSsePost('/x', {}, { onEvent: () => {} });
    const assertion = expect(p).rejects.toMatchObject({ transport: true, message: '连接空闲超时，请重试' });
    await vi.advanceTimersByTimeAsync(60_000);
    await assertion;
    expect(st.fetchSignal, 'fetch 必须使用内部 controller 的 signal').toBeTruthy();
    expect(st.fetchSignal!.aborted, '空闲超时必须真正中止 fetch').toBe(true);
  });

  it('字节到达会重置空闲计时：到 59s 仍不超时，随后到点必触发', async () => {
    vi.stubGlobal('fetch', vi.fn((_url: string, init?: { signal?: AbortSignal }) => {
      const chunk = new TextEncoder().encode(': ka\n\n');
      return Promise.resolve({ ok: true, status: 200, body: hangingBody(init?.signal, chunk) });
    }));

    const p = streamSsePost('/x', {}, { onEvent: () => {} });
    let settledFlag = false;
    p.catch(() => {}).then(() => { settledFlag = true; });
    // 唯一一次字节在 t≈0 送达（重置空闲窗至 t=60s）
    await vi.advanceTimersByTimeAsync(59_000);
    expect(settledFlag, '59s（<60s 空闲窗）不得判超时').toBe(false);
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(p).rejects.toMatchObject({ transport: true });
  });

  it('调用方 signal 中止：落 cancelled 而非 transport（不触发上层重发）', async () => {
    const st: { fetchSignal: AbortSignal | null } = { fetchSignal: null };
    vi.stubGlobal('fetch', vi.fn((_url: string, init?: { signal?: AbortSignal }) => {
      st.fetchSignal = init?.signal ?? null;
      return Promise.resolve({ ok: true, status: 200, body: hangingBody(init?.signal) });
    }));

    const outer = new AbortController();
    const p = streamSsePost('/x', {}, { onEvent: () => {}, signal: outer.signal });
    const assertion = expect(p).rejects.toMatchObject({ cancelled: true });
    await vi.advanceTimersByTimeAsync(10_000);
    outer.abort();
    await assertion;
    expect(st.fetchSignal?.aborted).toBe(true);
  });
});
