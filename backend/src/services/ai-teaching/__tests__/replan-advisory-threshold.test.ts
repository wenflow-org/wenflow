/**
 * 建议可信度阈值（2026-10-15 双向化配套）
 *
 * 背景：重规划建议此前是「计数>0 即发」，实测全库 51 条带建议会话里 19 条是
 * `reinforce` 打在 sessionLss=low 且 sessionLf=low 的课上——这节课并没有吃力。
 * 阈值改为看**本节课自身的档位证据**（confidence 自评饱和在 0.7-0.9，做阈值等于没做）。
 *
 * 这个契约直接影响「学习者每上完一节课会不会被弹建议」，故把两件事钉死：
 * ① 双低且无显式知识证据 → 不发补救型建议；
 * ② 课不吃力（双低）恰恰是 accelerate/压缩 成立的理由 → 不能一起被压掉。
 */
import { ReplanAdvisoryService, shouldSuppressRemedialAdvisory } from '../ReplanAdvisoryService';

const service = new ReplanAdvisoryService();

function wrapupWith(input: {
  sessionLss?: number | null;
  sessionLf?: number | null;
  metricTiers?: { sessionLss?: string; sessionLf?: string };
  movedToReview?: string[];
  stillLearning?: string[];
  topConfusionPoints?: string[];
  confidence?: number;
}) {
  return {
    evaluation: {
      sessionKtl: 4,
      sessionLss: input.sessionLss ?? 3,
      sessionLf: input.sessionLf ?? 3,
      confidence: input.confidence ?? 0.85,
      metricTiers: input.metricTiers || {},
    },
    progress: {
      movedToReview: input.movedToReview || [],
      stillLearning: input.stillLearning || [],
    },
    evidence: { topConfusionPoints: input.topConfusionPoints || [] },
  } as never;
}

function projectionWith(input: {
  signal: Record<string, unknown> | null;
  milestoneComplete?: boolean;
  fragileConcepts?: string[];
  strugglingConcepts?: string[];
}) {
  return {
    path: { currentPosition: { milestoneId: 'm1' } },
    mastery: {
      fragileConcepts: input.fragileConcepts || [],
      strugglingConcepts: input.strugglingConcepts || [],
    },
    risk: { prerequisiteGaps: [], fatigueRisk: 'low' },
    evidence: {
      milestoneStates: [
        {
          milestoneId: 'm1',
          totalTasks: 3,
          completedTasks: input.milestoneComplete === false ? 1 : 3,
        },
      ],
    },
    signal: input.signal,
  } as never;
}

const reinforceSignal = {
  shouldSuggest: true,
  priority: 'medium',
  recommendation: 'reinforce',
  scope: 'next_milestone',
  rationale: '当前存在不稳定知识点或学习趋势下滑。',
  reasonCodes: ['fragile_concepts'],
};

const nextMilestone = { milestoneId: 'm2', title: '下一阶段', totalTasks: 3 };

describe('shouldSuppressRemedialAdvisory（纯谓词）', () => {
  it('本节课双低 + 补救型动作 → 压制', () => {
    expect(shouldSuppressRemedialAdvisory({
      recommendation: 'reinforce',
      sessionLss: 'low',
      sessionLf: 'low',
      highRisk: false,
      explicitKnowledgeEvidence: false,
    })).toBe(true);
    expect(shouldSuppressRemedialAdvisory({
      recommendation: 'slow_down',
      sessionLss: 'low',
      sessionLf: 'low',
    })).toBe(true);
  });

  it('双低恰恰支持 accelerate/压缩 → 不压', () => {
    expect(shouldSuppressRemedialAdvisory({
      recommendation: 'accelerate',
      sessionLss: 'low',
      sessionLf: 'low',
    })).toBe(false);
  });

  it('resequence 由结构风险/截止落后驱动，与本节课难度不同轴 → 不压', () => {
    expect(shouldSuppressRemedialAdvisory({
      recommendation: 'resequence',
      sessionLss: 'low',
      sessionLf: 'low',
    })).toBe(false);
  });

  it('单侧低（另一侧 mid/high）→ 不压', () => {
    expect(shouldSuppressRemedialAdvisory({
      recommendation: 'reinforce',
      sessionLss: 'low',
      sessionLf: 'mid',
    })).toBe(false);
  });

  it('档位缺失（legacy 行）→ 放行，避免误伤存量', () => {
    expect(shouldSuppressRemedialAdvisory({
      recommendation: 'reinforce',
      sessionLss: undefined,
      sessionLf: undefined,
    })).toBe(false);
  });

  it('highRisk / 显式知识证据 → 豁免', () => {
    expect(shouldSuppressRemedialAdvisory({
      recommendation: 'reinforce',
      sessionLss: 'low',
      sessionLf: 'low',
      highRisk: true,
    })).toBe(false);
    expect(shouldSuppressRemedialAdvisory({
      recommendation: 'reinforce',
      sessionLss: 'low',
      sessionLf: 'low',
      explicitKnowledgeEvidence: true,
    })).toBe(false);
  });
});

describe('ReplanAdvisoryService.build 的阈值行为', () => {
  it('双低且无显式知识证据 → 不发建议，并留压制的 reasonCode 供审计', () => {
    const advisory = service.build({
      wrapup: wrapupWith({ metricTiers: { sessionLss: 'low', sessionLf: 'low' } }),
      learnerReplanProjection: projectionWith({ signal: reinforceSignal, milestoneComplete: false }),
      nextMilestone,
    });
    expect(advisory.shouldSuggest).toBe(false);
    expect(advisory.reasonCodes).toContain('advisory_suppressed_lesson_not_hard');
  });

  it('同一条信号换成 low/mid → 正常发出（阈值只认双低）', () => {
    const advisory = service.build({
      wrapup: wrapupWith({ metricTiers: { sessionLss: 'low', sessionLf: 'mid' } }),
      learnerReplanProjection: projectionWith({ signal: reinforceSignal, milestoneComplete: false }),
      nextMilestone,
    });
    expect(advisory.shouldSuggest).toBe(true);
    expect(advisory.recommendation).toBe('reinforce');
  });

  it('双低但本课真的浮出卡点知识点（struggling）→ 仍发（硬证据盖过自评档位）', () => {
    const advisory = service.build({
      wrapup: wrapupWith({ metricTiers: { sessionLss: 'low', sessionLf: 'low' } }),
      learnerReplanProjection: projectionWith({
        signal: reinforceSignal,
        milestoneComplete: false,
        strugglingConcepts: ['向量组的秩'],
      }),
      nextMilestone,
    });
    expect(advisory.shouldSuggest).toBe(true);
  });

  it('双低 + 只有 fragile（饱和通道，2026-10-15 真课实测的漏斗口）→ 压制，不豁免', () => {
    // 真课回归：新课 dual-low 仍每课必发 reinforce，根因就是豁免口写成了 fragile>0 ||
    // struggling>0，而 fragile（记忆引擎未巩固常态）恒非空 → 豁免恒成立。
    const advisory = service.build({
      wrapup: wrapupWith({ metricTiers: { sessionLss: 'low', sessionLf: 'low' } }),
      learnerReplanProjection: projectionWith({
        signal: reinforceSignal,
        milestoneComplete: false,
        fragileConcepts: ['真实情境问题与学科核心内容的对接', '驱动问题'],
      }),
      nextMilestone,
    });
    expect(advisory.shouldSuggest).toBe(false);
    expect(advisory.reasonCodes).toContain('advisory_suppressed_lesson_not_hard');
  });

  it('双低 + accelerate（压缩下一阶段）→ 不被阈值误压', () => {
    const advisory = service.build({
      wrapup: wrapupWith({ metricTiers: { sessionLss: 'low', sessionLf: 'low' } }),
      learnerReplanProjection: projectionWith({
        signal: {
          shouldSuggest: true,
          priority: 'low',
          recommendation: 'accelerate',
          scope: 'next_milestone',
          rationale: '掌握较稳定，可以考虑压缩下一阶段。',
          reasonCodes: ['stable_mastery', 'ready_to_accelerate'],
        },
        milestoneComplete: false,
      }),
      nextMilestone,
    });
    expect(advisory.shouldSuggest).toBe(true);
    expect(advisory.recommendation).toBe('accelerate');
  });

  it('双低、信号本不建议，但阶段已完课且只有 movedToReview 这类副产品 → 补强分支同样被压', () => {
    const advisory = service.build({
      wrapup: wrapupWith({
        metricTiers: { sessionLss: 'low', sessionLf: 'low' },
        movedToReview: ['一元二次方程求根'],
      }),
      learnerReplanProjection: projectionWith({
        signal: { shouldSuggest: false, priority: 'none', recommendation: 'keep', scope: 'none', rationale: '', reasonCodes: [] },
        milestoneComplete: true,
      }),
      nextMilestone,
    });
    expect(advisory.shouldSuggest).toBe(false);
    expect(advisory.reasonCodes).toContain('advisory_suppressed_lesson_not_hard');
  });
});
