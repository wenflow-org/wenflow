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

  it('教学会话键（2026-10-08 修复）：conversationId=教学会话 id → 会话级亲和', () => {
    process.env.AI_CACHE_SESSION_HEADER = 'x-opencode-session';
    // 同一会话跨轮次 → 键稳定（暖前缀粘住本会话）
    const turnA = () => resolveCacheSessionKey(ctx({ conversationId: 'tsess_a', agentId: 'agent:teaching-turn' }));
    expect(turnA()).toBe(turnA());
    // 不同会话 → 键散开（修复前退化为 agentId：同一 agent 全体用户共享一个暖前缀实例）
    expect(resolveCacheSessionKey(ctx({ conversationId: 'tsess_a', agentId: 'agent:teaching-turn' })))
      .not.toBe(resolveCacheSessionKey(ctx({ conversationId: 'tsess_b', agentId: 'agent:teaching-turn' })));
  });

  it('教学 envelope 双写 conversationId 后 VL simulation 键仍不变（vlsess: 特判优先）', () => {
    process.env.AI_CACHE_SESSION_HEADER = 'x-opencode-session';
    // 修复后教学链路 envelope 现也带 conversationId=教学会话 id，VL 走同一调用点：
    // 键必须仍是 vlsess:<sessionId>，与修复前逐字节一致
    expect(
      resolveCacheSessionKey(ctx({ sourceEntry: 'simulation', sessionId: 'vs_1', conversationId: 'vs_1', agentId: 'a1' }))
    ).toBe('vlsess:vs_1');
  });
});
