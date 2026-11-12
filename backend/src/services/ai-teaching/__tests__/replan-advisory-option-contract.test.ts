/**
 * #251 契约：建议卡下发的 `ui.options[].key` 必须全部能被 `/advisory-response` 接受。
 *
 * 此前两侧各写一份枚举：服务下发 keep/accelerate/preview/confirm/reinforce/resequence/later，
 * 而端点只认 keep/later/preview/adopt —— 界面自己渲染的按钮点下去恒 400
 * 「无效的建议处置动作」。本用例遍历真实 build() 的三个分支产出，断言：
 *   ① 每个下发的键都在 ADVISORY_RESPONSE_ACTIONS 里（枚举不会再次漂移）；
 *   ② 此前被拒的 confirm/accelerate/reinforce/resequence 确实会被下发（缺口真的被覆盖到）。
 */
import {
  ReplanAdvisoryService,
  ADVISORY_RESPONSE_ACTIONS,
  ADVISORY_UI_OPTION_KEYS,
} from '../ReplanAdvisoryService';

const service = new ReplanAdvisoryService();

function wrapupWith(input: {
  metricTiers?: { sessionLss?: string; sessionLf?: string };
  movedToReview?: string[];
  stillLearning?: string[];
  topConfusionPoints?: string[];
  confidence?: number;
}) {
  return {
    evaluation: {
      sessionKtl: 4,
      sessionLss: 3,
      sessionLf: 3,
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

const nextMilestone = { milestoneId: 'm2', title: '下一阶段', totalTasks: 3 };

function signalWith(recommendation: string) {
  return {
    shouldSuggest: true,
    priority: 'medium',
    recommendation,
    scope: 'next_milestone',
    rationale: '学习者状态中心判断当前路径后续安排需要重新确认。',
    reasonCodes: ['fragile_concepts'],
  };
}

/** 三个产出分支（信号-accelerate / 信号-非 accelerate / 高风险补救），取自 build() 的返回点 */
function buildAllBranchAdvisories() {
  const accelerate = service.build({
    wrapup: wrapupWith({ metricTiers: { sessionLss: 'low', sessionLf: 'mid' } }),
    learnerReplanProjection: projectionWith({ signal: signalWith('accelerate') }),
    nextMilestone,
  });
  const confirm = service.build({
    wrapup: wrapupWith({ metricTiers: { sessionLss: 'low', sessionLf: 'mid' } }),
    learnerReplanProjection: projectionWith({ signal: signalWith('resequence') }),
    nextMilestone,
  });
  const remedial = service.build({
    wrapup: wrapupWith({ topConfusionPoints: ['向量组的秩', '矩阵的零空间'] }),
    learnerReplanProjection: projectionWith({
      signal: null,
      strugglingConcepts: ['向量组的秩', '矩阵的零空间'],
    }),
    nextMilestone,
  });
  return { accelerate, confirm, remedial };
}

describe('#251 建议选项键与处置端点枚举同源', () => {
  it('每个分支都真的产出建议（否则本用例测不到选项）', () => {
    const { accelerate, confirm, remedial } = buildAllBranchAdvisories();
    expect(accelerate.shouldSuggest).toBe(true);
    expect(confirm.shouldSuggest).toBe(true);
    expect(remedial.shouldSuggest).toBe(true);
  });

  it('build() 下发的每个 ui.options 键都在 ADVISORY_RESPONSE_ACTIONS 内', () => {
    const { accelerate, confirm, remedial } = buildAllBranchAdvisories();
    const emitted = [accelerate, confirm, remedial].flatMap((advisory) =>
      advisory.ui.options.map((option) => option.key)
    );
    expect(emitted.length).toBeGreaterThan(0);
    const rejected = emitted.filter(
      (key) => !(ADVISORY_RESPONSE_ACTIONS as readonly string[]).includes(key)
    );
    expect(rejected).toEqual([]);
  });

  it('此前被端点拒收的 confirm/accelerate/reinforce/resequence 确实在下发集合内', () => {
    const { accelerate, confirm, remedial } = buildAllBranchAdvisories();
    const emitted = new Set(
      [accelerate, confirm, remedial].flatMap((advisory) => advisory.ui.options.map((option) => option.key))
    );
    for (const key of ['confirm', 'accelerate', 'reinforce', 'resequence']) {
      expect([key, emitted.has(key)]).toEqual([key, true]);
      expect(ADVISORY_UI_OPTION_KEYS as readonly string[]).toContain(key);
    }
  });
});
