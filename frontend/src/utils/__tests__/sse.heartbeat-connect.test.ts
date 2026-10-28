/**
 * SSE 心跳回调 + 连接阶段超时（#128/#129，2026-10-22）：
 *
 * 缺陷一：服务端心跳注释行（`: hb`）不进事件分发，上层停滞看门狗收不到任何喂狗信号——
 * JSON 输出的健康慢回合（final 前整段无 delta）在 90s 被误杀。sse.ts 需把注释行
 * 作为传输层活动经 onActivity 透出。
 *
 * 缺陷二：空闲计时在拿到响应头之后才启动——请求被网络黑洞吞掉时 fetch 永不返回、
 * 也没有任何计时器兜底（goal 首条消息实测挂 25 分钟，#129）。需有独立的连接超时。
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

/** 模拟真实响应体：read 挂起，signal abort 时立即 reject（与浏览器 fetch 同构） */
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

describe('streamSsePost 心跳回调与连接超时', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('心跳注释行触发 onActivity（不进 onEvent）', async () => {
    const seen: { activity: number; events: string[] } = { activity: 0, events: [] };
    vi.stubGlobal('fetch', vi.fn((_url: string, init?: { signal?: AbortSignal }) => {
      const chunk = new TextEncoder().encode(': hb\n\n');
      return Promise.resolve({ ok: true, status: 200, body: hangingBody(init?.signal, chunk) });
    }));

    const outer = new AbortController();
    const p = streamSsePost('/x', {}, {
      onEvent: (event) => seen.events.push(event),
      onActivity: () => { seen.activity += 1; },
      signal: outer.signal,
    });
    p.catch(() => {});
    await vi.advanceTimersByTimeAsync(50);
    outer.abort();
    await p.catch(() => {});
    expect(seen.activity).toBe(1);
    expect(seen.events, '注释行不是事件，不得进 onEvent').toEqual([]);
  });

  it('连接阶段超时：响应头一直不到达，30s 兜底中止并落 transport 错误', async () => {
    vi.stubGlobal('fetch', vi.fn((_url: string, init?: { signal?: AbortSignal }) => {
      // 网络黑洞：fetch 永不 resolve，仅在 abort 时 reject（与真实浏览器行为同构）
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(abortErr()), { once: true });
      });
    }));

    const p = streamSsePost('/x', {}, { onEvent: () => {} });
    const assertion = expect(p).rejects.toMatchObject({ transport: true, message: '连接超时，请重试' });
    await vi.advanceTimersByTimeAsync(30_000);
    await assertion;
  });

  it('连接阶段不误伤：响应头及时到达则连接超时不再触发', async () => {
    vi.stubGlobal('fetch', vi.fn((_url: string, init?: { signal?: AbortSignal }) => {
      return Promise.resolve({ ok: true, status: 200, body: hangingBody(init?.signal) });
    }));

    const outer = new AbortController();
    const p = streamSsePost('/x', {}, { onEvent: () => {}, signal: outer.signal });
    let transportError: unknown = null;
    p.catch((e) => { transportError = e; });
    // 越过 30s 连接窗（响应头早已到达），此时中止只应落 cancelled 而非连接超时
    await vi.advanceTimersByTimeAsync(31_000);
    outer.abort();
    await p.catch(() => {});
    expect((transportError as { message?: string })?.message).not.toBe('连接超时，请重试');
  });
});
