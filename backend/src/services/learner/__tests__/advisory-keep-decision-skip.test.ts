/**
 * 用户走查（2026-10-31）：课后点了「保持原计划」的会话（advisory.learnerResponse.action='keep'）
 * 仍会进决策流 → 仪表盘/学习状态永远挂着「AI 建议调整…去处理」，与学习者已做的决定矛盾。
 * 修复：决策流对 keep 处置过的建议消账；later/preview 仍待处置；adopt 未重排（待确认）保留。
 */
import { learningDecisionFeedService } from '../LearningDecisionFeedService';

function sessionWith(over: { shouldSuggest?: boolean; learnerResponse?: { action: string; at: string } | null }) {
  return {
    id: 'teaching_session_keep_1',
    status: 'completed',
    endTime: new Date('2026-10-31T00:00:00.000Z'),
    updatedAt: new Date('2026-10-31T00:00:00.000Z'),
    learningPathId: 'lp_keep_1',
    advisory: JSON.stringify({
      shouldSuggest: over.shouldSuggest ?? true,
      priority: 'medium',
      recommendation: 'accelerate',
      rationale: '掌握稳定且压力不高，可压缩下一阶段',
      ui: { title: '可以考虑加速下一阶段', body: '建议压缩下一阶段', options: [] },
      learnerResponse: over.learnerResponse ?? null,
    }),
    wrapup: JSON.stringify({ progress: { stillLearning: [], movedToReview: [] } }),
  };
}

const baseInput = () => ({
  paths: [{ id: 'lp_keep_1', title: '部门明细表自动合并与表头校验' }] as never[],
  learnerSnapshot: null,
  summary: null,
});

describe('LearningDecisionFeedService · 学习者已处置的建议消账', () => {
  it('keep 处置过 → 不再出 path-adjust 卡', () => {
    const cards = learningDecisionFeedService.build({
      ...baseInput(),
      sessions: [sessionWith({ learnerResponse: { action: 'keep', at: '2026-10-31T00:05:00.000Z' } })] as never,
    });
    expect(cards.some((c) => c.kind === 'path-adjust')).toBe(false);
  });

  it('later / preview 仍视为待处置 → 出卡', () => {
    for (const action of ['later', 'preview']) {
      const cards = learningDecisionFeedService.build({
        ...baseInput(),
        sessions: [sessionWith({ learnerResponse: { action, at: '2026-10-31T00:05:00.000Z' } })] as never,
      });
      expect(cards.some((c) => c.kind === 'path-adjust')).toBe(true);
    }
  });

  it('未处置（learnerResponse 为空）→ 出卡（回归保护）', () => {
    const cards = learningDecisionFeedService.build({
      ...baseInput(),
      sessions: [sessionWith({})] as never,
    });
    expect(cards.some((c) => c.kind === 'path-adjust')).toBe(true);
  });
});
