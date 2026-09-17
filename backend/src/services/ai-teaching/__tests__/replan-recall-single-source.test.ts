import { toAttributionRecall, type ReplanAdvisory } from '../ReplanAdvisoryService';

/**
 * 回归（审计 §3.19 P1⑦）：归因 skill 的召回输入必须**与动作同源**。
 * 此前 recall 取信号层的 reasonCodes、allowedRecommendations 取建议层，两套阈值各自成立，
 * 会出现"允许 accelerate，但可选原因码里没有 ready_to_accelerate"这类不一致。
 */
describe('归因召回与动作同源（P1⑦）', () => {
  const advisory = (over: Partial<ReplanAdvisory> = {}): ReplanAdvisory => ({
    shouldSuggest: true,
    priority: 'low',
    recommendation: 'accelerate',
    scope: 'next_milestone',
    rationale: 'r',
    reasonCodes: ['stable_mastery', 'ready_to_accelerate'],
    ui: { title: 't', body: 'b', options: [{ key: 'accelerate', label: 'l', description: 'd' }] },
    ...over,
  });

  it('召回原因码/优先级/建议方向全部取自 advisory（而非信号层）', () => {
    const recall = toAttributionRecall(advisory());
    expect(recall.reasonCodes).toEqual(['stable_mastery', 'ready_to_accelerate']);
    expect(recall.priority).toBe('low');
    expect(recall.recommendation).toBe('accelerate');
    expect(recall.shouldSuggest).toBe(true);
  });

  it('建议层的专有原因码（high_risk / moved_to_review / repeated_confusion）能进入召回', () => {
    const recall = toAttributionRecall(
      advisory({
        recommendation: 'slow_down',
        priority: 'high',
        reasonCodes: ['high_risk', 'fragile_concepts', 'moved_to_review', 'repeated_confusion'],
      }),
    );
    expect(recall.reasonCodes).toContain('moved_to_review');
    expect(recall.reasonCodes).toContain('repeated_confusion');
  });

  it('是快照而非引用（避免后续改动反向污染召回）', () => {
    const source = advisory();
    const recall = toAttributionRecall(source);
    source.reasonCodes.push('later_mutation');
    expect(recall.reasonCodes).not.toContain('later_mutation');
  });
});
