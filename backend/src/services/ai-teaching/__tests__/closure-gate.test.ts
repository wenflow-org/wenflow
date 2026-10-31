import {
  COMPLETION_DEFERRAL_ABSOLUTE_CAP,
  COMPLETION_DEFERRAL_CAP,
  detectTrailingQuestion,
  shouldDeferCompletionForClosure,
} from '../teaching-closure';

describe('收口闭合门禁 shouldDeferCompletionForClosure', () => {
  it('干净收尾（无问号、无检查点）→ 放行完成', () => {
    const d = shouldDeferCompletionForClosure({
      reply: '今天这三个点你都自己走通了，回去记得复习，有问题随时来问。',
      pendingCheckpoint: null,
      checkpointEmittedThisTurn: false,
      priorDeferrals: 0,
    });
    expect(d.defer).toBe(false);
    expect(d.reason).toBeNull();
  });

  it('回复带问号（含句中）→ 延迟一轮', () => {
    expect(detectTrailingQuestion('收尾前就一个快问——三国之后紧接着的是哪一段？A.晋 B.南北朝 C.秦汉')).toBe(true);
    const d = shouldDeferCompletionForClosure({
      reply: '三国之后紧接着的是哪一段？A.晋 B.南北朝 C.秦汉',
      pendingCheckpoint: null,
      checkpointEmittedThisTurn: false,
      priorDeferrals: 0,
    });
    expect(d.defer).toBe(true);
    expect(d.reason).toBe('trailing-question');
  });

  it('遗留未答检查点 → 延迟（优先于问号）', () => {
    const d = shouldDeferCompletionForClosure({
      reply: '这道题你先想想，今天就到这儿。',
      pendingCheckpoint: { id: 'cp_1', question: '…' },
      checkpointEmittedThisTurn: false,
      priorDeferrals: 0,
    });
    expect(d.defer).toBe(true);
    expect(d.reason).toBe('pending-checkpoint-unanswered');
  });

  it('本回合新产出检查题 → 延迟（优先于问号、次于遗留 pending）', () => {
    const base = { reply: '最后考你一道？', pendingCheckpoint: null as unknown, checkpointEmittedThisTurn: true, priorDeferrals: 0 };
    expect(shouldDeferCompletionForClosure(base).reason).toBe('checkpoint-emitted-this-turn');
    expect(
      shouldDeferCompletionForClosure({ ...base, pendingCheckpoint: { id: 'cp_old' } }).reason
    ).toBe('pending-checkpoint-unanswered');
  });

  it(`活力兜底：全会话累计延迟到 ${COMPLETION_DEFERRAL_ABSOLUTE_CAP} 次后放行（防永不收敛）`, () => {
    const d = shouldDeferCompletionForClosure({
      reply: '还有什么想问的吗？',
      pendingCheckpoint: { id: 'cp_1' },
      checkpointEmittedThisTurn: true,
      priorDeferrals: COMPLETION_DEFERRAL_ABSOLUTE_CAP,
      capGraceUsed: true,
    });
    expect(d.defer).toBe(false);
    expect(d.reason).toBeNull();
  });

  it('到顶后的最后一问给一次宽限：先让学员作答，下一回合才放行（P0-2）', () => {
    const grace = shouldDeferCompletionForClosure({
      reply: '最后核对一处：要是表底还有合计，你框打印区域时框到哪儿？',
      pendingCheckpoint: null,
      checkpointEmittedThisTurn: false,
      priorDeferrals: COMPLETION_DEFERRAL_ABSOLUTE_CAP,
    });
    expect(grace.defer).toBe(true);
    expect(grace.capGrace).toBe(true);
    expect(grace.reason).toBe('trailing-question');

    const afterGrace = shouldDeferCompletionForClosure({
      reply: '最后核对一处：要是表底还有合计，你框打印区域时框到哪儿？',
      pendingCheckpoint: null,
      checkpointEmittedThisTurn: false,
      priorDeferrals: COMPLETION_DEFERRAL_ABSOLUTE_CAP + 1,
      capGraceUsed: true,
    });
    expect(afterGrace.defer).toBe(false);
  });

  it('同一道题重复延迟到上限 → 放行；换新题则重新获得额度（P0-2）', () => {
    const repeated = shouldDeferCompletionForClosure({
      reply: '这题再想想？',
      pendingCheckpoint: { id: 'cp_1', question: '一页宽为什么还叠？' },
      checkpointEmittedThisTurn: false,
      priorDeferrals: 3,
      previousDeferredQuestion: '一页宽为什么还叠？',
      priorDeferralsForSameQuestion: COMPLETION_DEFERRAL_CAP,
    });
    expect(repeated.defer).toBe(false);

    const newQuestion = shouldDeferCompletionForClosure({
      reply: '最后一问：手机上能不能整行读完，看哪儿？',
      pendingCheckpoint: null,
      checkpointEmittedThisTurn: false,
      priorDeferrals: 3,
      previousDeferredQuestion: '一页宽为什么还叠？',
      priorDeferralsForSameQuestion: COMPLETION_DEFERRAL_CAP,
    });
    expect(newQuestion.defer).toBe(true);
    expect(newQuestion.reason).toBe('trailing-question');
  });

  it('首次延迟：问号形态在 cap-1 内仍然拦', () => {
    const d = shouldDeferCompletionForClosure({
      reply: '今天就到这儿，好吗？',
      pendingCheckpoint: null,
      checkpointEmittedThisTurn: false,
      priorDeferrals: COMPLETION_DEFERRAL_CAP - 1,
    });
    expect(d.defer).toBe(true);
  });
});
