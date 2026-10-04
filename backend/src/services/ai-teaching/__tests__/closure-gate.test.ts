import { COMPLETION_DEFERRAL_CAP, detectTrailingQuestion, shouldDeferCompletionForClosure } from '../teaching-closure';

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

  it(`活力兜底：已延迟 ${COMPLETION_DEFERRAL_CAP} 次后一律放行（防永不收敛）`, () => {
    const d = shouldDeferCompletionForClosure({
      reply: '还有什么想问的吗？',
      pendingCheckpoint: { id: 'cp_1' },
      checkpointEmittedThisTurn: true,
      priorDeferrals: COMPLETION_DEFERRAL_CAP,
    });
    expect(d.defer).toBe(false);
    expect(d.reason).toBeNull();
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
