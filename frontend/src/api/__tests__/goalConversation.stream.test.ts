/**
 * goal-conversation 流式渐进渲染回归测试：
 * - 后端 SSE 的 delta 事件（{ text }）正确触发 onDelta 回调（P0-1 核心）
 * - final 事件携带完整 envelope，resolve 给调用方
 * - 混合 delta + final 的典型序列不丢事件、不重复
 */
import { describe, expect, it, vi } from 'vitest';

const sseMock = vi.hoisted(() => ({
  streamSsePost: vi.fn()
}));

vi.mock('@/utils/sse', () => ({
  streamSsePost: sseMock.streamSsePost
}));

import { streamStartGoalConversation, streamReplyGoalConversation } from '../goalConversation';

/** 构造最小可用的 envelope（符合 GoalConversationEnvelope 形状） */
function makeEnvelope(text: string) {
  return {
    userVisible: text,
    internal: {
      core: {
        conversationId: 'gc_test_1',
        stage: 'understanding',
        confidence: 0.6,
        isCompleted: false
      },
      ext: {
        goalConversation: {
          understanding: {},
          quickReplies: [{ text: '继续' }]
        }
      }
    },
    renderHints: { quickReplies: [{ text: '继续' }] },
    schemaVersion: 'agent-output-v1',
    meta: { source: 'test', timestamp: new Date().toISOString() }
  };
}

function driveSse(events: Array<[string, unknown]>) {
  sseMock.streamSsePost.mockImplementationOnce((_url: string, _body: unknown, handlers: { onEvent: (e: string, d: unknown) => void }) => {
    for (const [event, data] of events) handlers.onEvent(event, data);
    return Promise.resolve();
  });
}

describe('goal-conversation 流式渐进渲染', () => {
  it('delta 事件逐段触发 onDelta，累积为流式文本', async () => {
    driveSse([
      ['delta', { text: '我理解你的目标，' }],
      ['delta', { text: '先澄清几个问题。' }],
      ['final', { data: makeEnvelope('我理解你的目标，先澄清几个问题。') }],
      ['done', {}]
    ]);

    const deltas: string[] = [];
    const env = await streamStartGoalConversation('我想学 Python', {}, {
      onDelta: (t) => deltas.push(t)
    });

    expect(deltas).toEqual(['我理解你的目标，', '先澄清几个问题。']);
    expect(env.internal.core.conversationId).toBe('gc_test_1');
    expect(env.userVisible).toContain('我理解你的目标');
  });

  it('无 delta 时仅 final 落地（向后兼容非流式场景）', async () => {
    driveSse([
      ['final', { data: makeEnvelope('好的，请补充时间。') }],
      ['done', {}]
    ]);

    const deltas: string[] = [];
    const env = await streamReplyGoalConversation('gc_test_1', '我有两小时', {}, {
      onDelta: (t) => deltas.push(t)
    });

    expect(deltas).toEqual([]);
    expect(env.userVisible).toBe('好的，请补充时间。');
  });

  it('delta 中夹杂非 text 载荷时忽略，不影响 final', async () => {
    driveSse([
      ['delta', { text: '正在思考' }],
      ['delta', { other: true }],
      ['final', { data: makeEnvelope('最终回复') }],
      ['done', {}]
    ]);

    const deltas: string[] = [];
    const env = await streamStartGoalConversation('x', {}, { onDelta: (t) => deltas.push(t) });

    expect(deltas).toEqual(['正在思考']);
    expect(env.userVisible).toBe('最终回复');
  });

  it('流式请求中止（abort）时正常 reject', async () => {
    const controller = new AbortController();
    sseMock.streamSsePost.mockImplementationOnce((_url: string, _body: unknown) => {
      const err = new Error('aborted');
      return Promise.reject(Object.assign(err, { name: 'AbortError' }));
    });

    await expect(
      streamStartGoalConversation('x', {}, { onDelta: () => undefined, signal: controller.signal })
    ).rejects.toMatchObject({ name: 'AbortError' });
  });
});
