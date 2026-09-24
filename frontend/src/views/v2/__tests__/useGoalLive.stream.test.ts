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
import { isProbeAnswer, probeAnswerParts } from '../probeAnswer';
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
            reject(Object.assign(new Error('aborted'), { name: 'AbortError', cancelled: true }));
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
      failed: string;
    };
    live.reset();
    void live.send('开始').catch(() => undefined);

    expect(live.sending).toBe(true);
    live.stop();
    expect((capturedSignal as AbortSignal | null)?.aborted).toBe(true);

    // abort 后 run 的 catch/finally 会异步收尾；等一帧验证：
    // - sending 复位
    // - 用户主动停止 → failed 置位（提供重试入口）
    await new Promise((r) => setTimeout(r, 20));
    expect(live.sending).toBe(false);
    expect(live.failed).toBe('start');
  });

  /**
   * 走查 P7：目标对话可能给出「4 段大纲 + scope_size=small(2~3 段)」这类
   * 自相矛盾的输出，生成时会被夹回 3 段，而预览此前照抄 4 段 ⇒ 承诺 4 段、
   * 实际 3 段。后端改为回吐生成口径（plannedMilestones / previewStages）后，
   * 预览的计数与列表都必须用该口径。
   */
  it('预览阶段列表取生成口径（previewStages 截到 plannedMilestones）', async () => {
    driveStream([], makeEnvelope({
      internal: {
        core: { conversationId: 'c1', stage: 'proposing', confidence: 0.8, isCompleted: false },
        ext: {
          goalConversation: {
            understanding: {},
            confirmedProposal: {
              real_problem: '每周手动整理 Excel 周报太耗时',
              first_deliverable: '跑通一次自动读取',
              key_stages: ['阶段A', '阶段B', '阶段C', '阶段D'],
              scope_size: 'small',
              plannedMilestones: 3,
              previewStages: ['阶段A', '阶段B', '阶段C'],
            },
          },
        },
      },
    }));
    const live = useGoalLive();
    live.reset();
    await live.send('开始');

    expect(live.proposal?.stages).toEqual(['阶段A', '阶段B', '阶段C']);
    // 承诺数量用生成口径（plannedMilestones=3），与列表一致
    expect(live.proposal?.stageCount).toBe(3);
  });

  it('后端未回吐生成口径时退回 key_stages（兼容旧会话）', async () => {
    driveStream([], makeEnvelope({
      internal: {
        core: { conversationId: 'c1', stage: 'proposing', confidence: 0.8, isCompleted: false },
        ext: {
          goalConversation: {
            understanding: {},
            confirmedProposal: {
              real_problem: 'x',
              key_stages: ['甲', '乙'],
            },
          },
        },
      },
    }));
    const live = useGoalLive();
    live.reset();
    await live.send('开始');

    expect(live.proposal?.stages).toEqual(['甲', '乙']);
  });

  /**
   * 快速自测作答（2026-09-24 反馈）：作答要经对话消息回传（goal-conversation 据此静默
   * 回填 prerequisiteCheckResults），文案必须"先答案、后原题"，且带前缀供渲染识别成
   * 紧凑记录卡——此前整道题在句首，用户在对话里看到一条像自己发问的消息。
   */
  it('前置自测作答：消息先给答案、题目跟后，并带渲染识别前缀', async () => {
    driveStream([], makeEnvelope());
    apiMock.streamReplyGoalConversation.mockResolvedValueOnce(makeEnvelope());
    const live = useGoalLive() as ReturnType<typeof useGoalLive> & {
      answerProbe: (
        p: { probeId: string; targetConcept: string; question: string; options: Array<{ id: string; text: string }> },
        optionId: string,
        optionText: string,
      ) => Promise<void>;
      probeAnswers: Record<string, string>;
      messages: Array<{ role: string; content: string }>;
      reset: () => void;
      send: (t: string) => Promise<void>;
    };
    live.reset();
    await live.send('开始'); // 建立会话（envelope 带 conversationId）

    const question = '孩子经常把别人玩具抢过来（3-4岁），按指南最可能涉及哪个领域？';
    await live.answerProbe(
      { probeId: 'probe-1', targetConcept: '社会领域', question, options: [{ id: 'A', text: '健康领域' }, { id: 'B', text: '社会领域' }] },
      'B',
      '社会领域（人际交往与规则意识）',
    );

    const last = live.messages.filter((m) => m.role === 'user').at(-1);
    expect(last?.content).toBe(`【快速自测作答】我选 B（社会领域（人际交往与规则意识））· 原题：${question}`);
    expect(isProbeAnswer(last?.content ?? '')).toBe(true);
    expect(probeAnswerParts(last?.content ?? '').question).toBe(question);
    // 已作答记录（面板据此禁用选项）
    expect(live.probeAnswers['probe-1']).toBe('B');
    // 已作答后再点同一题不重复发送
    await live.answerProbe(
      { probeId: 'probe-1', targetConcept: '社会领域', question, options: [{ id: 'A', text: '健康领域' }, { id: 'B', text: '社会领域' }] },
      'A',
      '健康领域（动作发展）',
    );
    expect(live.messages.filter((m) => m.role === 'user').at(-1)?.content).toBe(last?.content);
  });
});
