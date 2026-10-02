import { resolveCacheSessionKey } from '../executor';
import type { ExecutionContext } from '../types';

function ctx(over: Partial<ExecutionContext> = {}): ExecutionContext {
  return {
    sourceEntry: 'user',
    ...over,
  } as ExecutionContext;
}

describe('resolveCacheSessionKey（前缀缓存会话亲和键）', () => {
  const ENV = process.env.AI_CACHE_SESSION_HEADER;
  afterAll(() => {
    if (ENV === undefined) delete process.env.AI_CACHE_SESSION_HEADER;
    else process.env.AI_CACHE_SESSION_HEADER = ENV;
  });

  it('未设置 AI_CACHE_SESSION_HEADER 时恒空（零行为变化契约）', () => {
    delete process.env.AI_CACHE_SESSION_HEADER;
    expect(resolveCacheSessionKey(ctx({ conversationId: 'gc_1' }))).toBe('');
  });

  it('常规形态：conversationId 优先，回落 agentId，兜底 wenflow-global', () => {
    process.env.AI_CACHE_SESSION_HEADER = 'x-opencode-session';
    expect(resolveCacheSessionKey(ctx({ conversationId: 'gc_1', agentId: 'a1' }))).toBe('gc_1');
    expect(resolveCacheSessionKey(ctx({ agentId: 'a1' }))).toBe('a1');
    expect(resolveCacheSessionKey(ctx({}))).toBe('wenflow-global');
  });

  it('虚拟学习者（simulation）：优先虚拟会话 id（跨任务稳定，2026-10-02）', () => {
    process.env.AI_CACHE_SESSION_HEADER = 'x-opencode-session';
    expect(
      resolveCacheSessionKey(ctx({ sourceEntry: 'simulation', sessionId: 'vs_1', conversationId: 'gc_stale', agentId: 'a1' }))
    ).toBe('vlsess:vs_1');
    // 无虚拟会话 id 时回落常规链（如 persona/scenario 设计类无会话调用）
    expect(
      resolveCacheSessionKey(ctx({ sourceEntry: 'simulation', conversationId: 'gc_2', agentId: 'a1' }))
    ).toBe('gc_2');
    expect(
      resolveCacheSessionKey(ctx({ sourceEntry: 'simulation', agentId: 'a1' }))
    ).toBe('a1');
  });
});
