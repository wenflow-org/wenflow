import { writeProposalTriageSnapshot } from '../goal-conversation.service';

/**
 * 提案时刻分诊快照（修复批 30-①，u07 reeval26 goal→path 断链）：
 * 提案可见（stage=proposing）时把此刻分诊定格；确认轮硬阻断读快照而非重新分诊——
 * understanding 漂移（blockType 缺失 + supportNeed=emotional → fresh 翻成 emotional_support）
 * 不再翻转已展示的承诺。F96/F97 保护不变：提案前已是 referral/emotional 则快照即阻断结论。
 */
describe('writeProposalTriageSnapshot（提案时刻分诊快照）', () => {
  const learningUnderstanding = {
    primary_block_type: 'capability',
    platform_judgment: 'judgeable',
    support_need: 'none',
  };

  it('proposing 且无快照：定格当前分诊（learning_path）', () => {
    const data: Record<string, any> = { understanding: learningUnderstanding };
    writeProposalTriageSnapshot('proposing', data);
    expect(data.responseTriage).toMatchObject({ mode: 'learning_path' });
  });

  it('u07 病历单形态：提案轮定格 learning_path 后，确认轮 understanding 漂移不覆盖快照', () => {
    const data: Record<string, any> = { understanding: learningUnderstanding };
    writeProposalTriageSnapshot('proposing', data);
    // 确认轮：understanding 漂移为 blockType 缺失 + supportNeed=emotional（fresh 分诊会翻成 emotional_support）
    data.understanding = { support_need: 'emotional' };
    writeProposalTriageSnapshot('proposing', data);
    expect(data.responseTriage).toMatchObject({ mode: 'learning_path' });
  });

  it('F96/F97 保护：提案轮已是 referral → 快照即阻断结论，确认时照旧拦', () => {
    const data: Record<string, any> = {
      understanding: { platform_judgment: 'not_judgeable', skill_nature: 'physical_internalized' },
    };
    writeProposalTriageSnapshot('proposing', data);
    expect(data.responseTriage.mode).toBe('referral');
  });

  it('非 proposing 阶段 / 已有 gated 待确认项 → 不写', () => {
    const a: Record<string, any> = { understanding: learningUnderstanding };
    writeProposalTriageSnapshot('understanding', a);
    expect(a.responseTriage).toBeUndefined();
    const b: Record<string, any> = { understanding: learningUnderstanding, responseTriagePending: { mode: 'referral' } };
    writeProposalTriageSnapshot('proposing', b);
    expect(b.responseTriage).toBeUndefined();
  });
});
