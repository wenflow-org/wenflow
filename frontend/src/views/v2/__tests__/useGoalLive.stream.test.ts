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

  it('恢复信封缺少 conversationId 时仍沿用请求的会话 id，避免下一条消息新建会话', async () => {
    apiMock.streamStartGoalConversation.mockClear();
    apiMock.streamReplyGoalConversation.mockClear();
    apiMock.getGoalConversation.mockResolvedValueOnce(makeEnvelope({
      internal: {
        core: { stage: 'understanding', confidence: 0.5, isCompleted: false },
        ext: { goalConversation: { understanding: {}, quickReplies: [] } }
      }
    }));
    const live = useGoalLive();
    live.reset();

    await expect(live.resumeById('gc_old')).resolves.toBe(true);
    expect(live.conversationId).toBe('gc_old');

    apiMock.streamReplyGoalConversation.mockResolvedValueOnce(makeEnvelope({
      internal: {
        core: { conversationId: 'gc_old', stage: 'understanding', confidence: 0.5, isCompleted: false },
        ext: { goalConversation: { understanding: {}, quickReplies: [] } }
      }
    }));
    await live.send('继续');
    expect(apiMock.streamReplyGoalConversation).toHaveBeenCalledWith(
      'gc_old', '继续', expect.anything(), expect.anything()
    );
    expect(apiMock.streamStartGoalConversation).not.toHaveBeenCalled();
  });

  it('恢复最近会话遇到 404 时暴露归属/失效状态，供入口页安全移除旧链接', async () => {
    apiMock.getGoalConversation.mockRejectedValueOnce({ status: 404, message: '对话会话不存在' });
    const live = useGoalLive();
    live.reset();

    await expect(live.resumeById('gc_missing')).resolves.toBe(false);
    expect(live.failed).toBe('resume');
    expect(live.resumeErrorStatus).toBe(404);
  });

  it('恢复最近会话遇到网络错误时不伪报 404', async () => {
    apiMock.getGoalConversation.mockRejectedValueOnce({ message: '网络错误，请检查连接' });
    const live = useGoalLive();
    live.reset();

    await expect(live.resumeById('gc_retry')).resolves.toBe(false);
    expect(live.failed).toBe('resume');
    expect(live.resumeErrorStatus).toBeNull();
  });

  it('reset 会清掉上一次恢复的 HTTP 状态', async () => {
    apiMock.getGoalConversation.mockRejectedValueOnce({ status: 404 });
    const live = useGoalLive();
    live.reset();
    await live.resumeById('gc_missing');
    expect(live.resumeErrorStatus).toBe(404);

    live.reset();
    expect(live.resumeErrorStatus).toBeNull();
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
   * 快速自测作答（2026-11-02 口径重做）：作答是**面板内的本地表单动作**，不发对话回合。
   *
   * 旧实现（2026-09-24）每答一题就把答案当用户消息发出去、走一个完整回合，两题场景实测卡住：
   * 答第 1 题后面板全部选项禁用、等 30-90s、回来时方案重渲染（题目可能少一道/换题）。
   * 现在只记本地状态，点「确认」时随确认请求一次性提交（后端按 correctOption 确定性判分）。
   */
  it('前置自测作答：只记本地状态、不发对话回合，再点即改答案', async () => {
    const question = '孩子经常把别人玩具抢过来（3-4岁），按指南最可能涉及哪个领域？';
    const withProbe = makeEnvelope({
      internal: {
        core: { conversationId: 'gc_1', stage: 'proposing', confidence: 0.8, isCompleted: false },
        ext: {
          goalConversation: {
            understanding: {},
            confirmedProposal: {
              real_problem: '问题',
              first_deliverable: '产出',
              key_stages: ['阶段一'],
              prerequisiteDiagnostics: [{
                probeId: 'probe-1',
                targetConcept: '社会领域',
                question,
                options: [{ id: 'A', text: '健康领域' }, { id: 'B', text: '社会领域' }],
              }],
            },
          },
        },
      },
    });
    driveStream([], withProbe);
    const live = useGoalLive() as ReturnType<typeof useGoalLive> & {
      answerProbe: (
        p: { probeId: string; targetConcept: string; question: string; options: Array<{ id: string; text: string }> },
        optionId: string,
      ) => void;
      probeAnswers: Record<string, string>;
      probeProgress: () => { answered: number; total: number };
      pendingProbeAnswers: () => Array<{ probeId: string; userAnswer: string; targetConcept?: string }>;
      messages: Array<{ role: string; content: string }>;
      reset: () => void;
      send: (t: string) => Promise<void>;
    };
    live.reset();
    await live.send('开始'); // 建立会话（envelope 带 conversationId）

    const callsAfterSend =
      apiMock.streamStartGoalConversation.mock.calls.length + apiMock.streamReplyGoalConversation.mock.calls.length;
    const probe = { probeId: 'probe-1', targetConcept: '社会领域', question, options: [{ id: 'A', text: '健康领域' }, { id: 'B', text: '社会领域' }] };

    live.answerProbe(probe, 'B');

    // 作答不再产生用户消息、不再发模型请求
    expect(live.messages.filter((m) => m.role === 'user').map((m) => m.content)).toEqual(['开始']);
    expect(
      apiMock.streamStartGoalConversation.mock.calls.length + apiMock.streamReplyGoalConversation.mock.calls.length,
    ).toBe(callsAfterSend);
    // 本地记录（面板据此显示选中态与回执）
    expect(live.probeAnswers['probe-1']).toBe('B');
    expect(live.probeProgress()).toEqual({ answered: 1, total: 1 });
    expect(live.pendingProbeAnswers()).toEqual([{ probeId: 'probe-1', userAnswer: 'B', targetConcept: '社会领域' }]);

    // 再点别的选项 = 改答案（不锁死、不重复发送）
    live.answerProbe(probe, 'A');
    expect(live.probeAnswers['probe-1']).toBe('A');
  });

  /**
   * 换题保护（2026-11-02 业务口径）：方案重渲染换了题/少一道时，按题号取答案会**静默失效**
   * （回执从 2/2 掉回 1/2，用户以为「我答过的丢了」）。这里钉住：旧题号被清掉时给出可见计数。
   */
  it('前置自测换题：旧题作答被清掉并计入 droppedProbeAnswers（不静默蒸发）', async () => {
    const withProbes = (ids: string[]) =>
      makeEnvelope({
        internal: {
          core: { conversationId: 'gc_1', stage: 'proposing', confidence: 0.8, isCompleted: false },
          ext: {
            goalConversation: {
              understanding: {},
              confirmedProposal: {
                real_problem: '问题',
                first_deliverable: '产出',
                key_stages: ['阶段一'],
                prerequisiteDiagnostics: ids.map((id) => ({
                  probeId: id,
                  targetConcept: `概念${id}`,
                  question: `问题${id}？`,
                  options: [{ id: 'A', text: '甲' }, { id: 'B', text: '乙' }],
                })),
              },
            },
          },
        },
      });
    driveStream([], withProbes(['probe-1', 'probe-2']));
    const live = useGoalLive() as ReturnType<typeof useGoalLive> & {
      answerProbe: (p: { probeId: string }, optionId: string) => void;
      acknowledgeProbeChange: () => void;
      probeAnswers: Record<string, string>;
      droppedProbeAnswers: number;
      probeProgress: () => { answered: number; total: number };
      reset: () => void;
      send: (t: string) => Promise<void>;
    };
    live.reset();
    await live.send('开始');
    live.answerProbe({ probeId: 'probe-1' }, 'A');
    live.answerProbe({ probeId: 'probe-2' }, 'B');
    expect(live.probeProgress()).toEqual({ answered: 2, total: 2 });

    // 第二轮方案换了题：probe-2 消失
    apiMock.streamReplyGoalConversation.mockResolvedValueOnce(withProbes(['probe-1', 'probe-3']));
    await live.send('换个方向');

    expect(live.probeAnswers['probe-2']).toBeUndefined();
    expect(live.probeAnswers['probe-1']).toBe('A');
    expect(live.droppedProbeAnswers).toBe(1);
    expect(live.probeProgress()).toEqual({ answered: 1, total: 2 });

    // 重新作答即视为已知悉换题，提示收起
    live.acknowledgeProbeChange();
    expect(live.droppedProbeAnswers).toBe(0);
  });
});
