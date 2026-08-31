/**
 * useGoalLive 流式渐进渲染状态机测试（P0-1）：
 * - delta 累积 → streamingText 实时增长（用户可见「正在生成」反馈）
 * - final 落地 → streamingText 清空 + 官方消息替换
 * - 会话重置（reset）→ 过期 delta 不写入（代次守卫）
 * - stop() 中止在途流式请求
 */
import { describe, expect, it, vi } from 'vitest';

type GoalEnvelope = {
  userVisible: string;
  internal: {
    core: {
      conversationId?: string | null;
      stage: 'understanding' | 'proposing' | 'ready' | 'completed';
      confidence: number;
      isCompleted: boolean;
      learningPath?: { id: string; status?: string } | null;
    };
    ext: { goalConversation: Record<string, unknown> };
  };
  renderHints: { quickReplies?: Array<{ text: string; icon?: string }> };
  schemaVersion: string;
  meta: Record<string, unknown>;
};

const apiMock = vi.hoisted(() => ({
  streamStartGoalConversation: vi.fn<(_text: string, _opts: unknown, _handlers: { onDelta?: (t: string) => void; signal?: AbortSignal }) => Promise<GoalEnvelope>>(),
  streamReplyGoalConversation: vi.fn<(_cid: string, _text: string, _opts: unknown, _handlers: { onDelta?: (t: string) => void; signal?: AbortSignal }) => Promise<GoalEnvelope>>(),
  streamRegenerateGoalConversation: vi.fn(),
  startGoalConversation: vi.fn(),
  replyGoalConversation: vi.fn(),
  regenerateGoalConversation: vi.fn(),
  getGoalConversation: vi.fn(),
  deleteGoalConversation: vi.fn()
}));

vi.mock('@/api/goalConversation', () => apiMock);
vi.mock('@/composables/useInteractionMeta', () => ({
  useInteractionMeta: () => ({
    collect: () => ({ draftMs: 0, idleMsBefore: 0, lastIdleMs: 0, editingCount: 0, deleteCount: 0, charsPerSentence: 0 }),
    markAssistantLanded: () => undefined
  })
}));

import { useGoalLive } from '../useGoalLive';
import type { GoalConversationEnvelope } from '@/api/goalConversation';

function makeEnvelope(overrides: Partial<GoalConversationEnvelope> = {}): GoalConversationEnvelope {
  return {
    userVisible: '官方回复',
    internal: {
      core: {
        conversationId: 'gc_1',
        stage: 'understanding',
        confidence: 0.5,
        isCompleted: false
      },
      ext: { goalConversation: { understanding: {}, quickReplies: [] } }
    },
    renderHints: { quickReplies: [] },
    schemaVersion: 'agent-output-v1',
    meta: { source: 'test', timestamp: new Date().toISOString() },
    ...overrides
  };
}

/** 让流式 API 按 delta 序列驱动 onDelta，最后 resolve envelope */
function driveStream(deltas: string[], env: GoalConversationEnvelope) {
  apiMock.streamStartGoalConversation.mockImplementationOnce(
    (_text: string, _opts: unknown, handlers: { onDelta?: (t: string) => void }) => {
      for (const d of deltas) handlers.onDelta?.(d);
      return Promise.resolve(env);
    }
  );
}

describe('useGoalLive 流式渐进渲染', () => {
  it('delta 累积到 streamingText，final 后清空并以官方消息为准', async () => {
    driveStream(['你好，', '我是问流。'], makeEnvelope());
    const live = useGoalLive();
    live.reset();

    await live.send('开始');

    expect(live.streamingText).toBe('');
    expect(live.messages.some((m) => m.role === 'ai' && m.content === '官方回复')).toBe(true);
  });

  it('reset 后过期 delta 不写入（代次守卫）', async () => {
    let capturedOnDelta: ((t: string) => void) | null = null;
    apiMock.streamStartGoalConversation.mockImplementationOnce(
      (_text: string, _opts: unknown, handlers: { onDelta?: (t: string) => void }) => {
        capturedOnDelta = handlers.onDelta ?? null;
        return new Promise(() => { /* 永不 resolve，模拟慢请求 */ });
      }
    );
    const live = useGoalLive();
    live.reset();
    void live.send('开始').catch(() => undefined);

    // 会话重置后再收到 delta → 不写入（代次守卫）
    live.reset();
    (capturedOnDelta as ((t: string) => void) | null)?.('过期文本');
    expect(live.streamingText).toBe('');
    expect(live.sending).toBe(false);
  });

  it('stop() 中止在途流式请求', async () => {
    let capturedSignal: AbortSignal | null = null;
    apiMock.streamStartGoalConversation.mockImplementationOnce(
      (_text: string, _opts: unknown, handlers: { signal?: AbortSignal }) => {
        capturedSignal = handlers.signal ?? null;
        return new Promise((_resolve, reject) => {
          capturedSignal?.addEventListener('abort', () => {
            reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
          });
        });
      }
    );
    const live = useGoalLive() as ReturnType<typeof useGoalLive> & {
      send: (t: string) => Promise<void>;
      stop: () => void;
      reset: () => void;
      sending: boolean;
      streamingText: string;
    };
    live.reset();
    void live.send('开始').catch(() => undefined);

    expect(live.sending).toBe(true);
    live.stop();
    expect((capturedSignal as AbortSignal | null)?.aborted).toBe(true);

    // abort 后 run 的 catch/finally 会异步收尾；等一帧验证 sending 复位
    await new Promise((r) => setTimeout(r, 20));
    expect(live.sending).toBe(false);
  });
});
