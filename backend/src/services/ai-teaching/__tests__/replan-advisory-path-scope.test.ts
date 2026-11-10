/**
 * 建议点名的概念必须落在本条路径上（2026-11-03 心理课真人走查根因修复）。
 *
 * 实测缺陷：账号 `123@123.com` 同时有「讲清心理学五大流派」与「用教育测量学核对 AI 测评建议」
 * 两条路径。上完心理学那节课后，评估页出现
 * 「系统检测到 区分分数与能力推断、识别字段的变量角色 这些点仍会影响后续推进」——
 * 这两个短语在本节课任何画面都没出现过，它们属于另一条路径。根因是
 * `learnerReplanProjection.mastery.strugglingConcepts` 来自**全学习者**投影，不按路径切。
 */
import { ReplanAdvisoryService } from '../ReplanAdvisoryService';

const service = new ReplanAdvisoryService();

function wrapupWith(input: { movedToReview?: string[] }) {
  return {
    evaluation: {
      sessionKtl: 4,
      sessionLss: 3,
      sessionLf: 3,
      confidence: 0.85,
      metricTiers: {},
    },
    progress: {
      movedToReview: input.movedToReview || [],
      stillLearning: [],
    },
    evidence: { topConfusionPoints: [] },
  } as never;
}

function projectionWith(strugglingConcepts: string[]) {
  return {
    path: { currentPosition: { milestoneId: 'm1' } },
    mastery: { fragileConcepts: [], strugglingConcepts },
    risk: { prerequisiteGaps: [], fatigueRisk: 'low' },
    evidence: { milestoneStates: [{ milestoneId: 'm1', totalTasks: 3, completedTasks: 3 }] },
    signal: {
      shouldSuggest: true,
      priority: 'medium',
      recommendation: 'reinforce',
      scope: 'next_milestone',
      rationale: '当前存在不稳定知识点或学习趋势下滑。',
      reasonCodes: ['fragile_concepts'],
    },
  } as never;
}

const nextMilestone = { milestoneId: 'm2', title: '下一阶段', totalTasks: 3 };
const PSYCH_PATH_CONCEPTS = ['常识解释与心理解释', '划定心理学问题域'];

describe('重排建议点名按本条路径收窄', () => {
  it('投影里的卡点不属于本条路径 → 不点名，文案退回通用句', () => {
    const advisory = service.build({
      wrapup: wrapupWith({}),
      learnerReplanProjection: projectionWith(['区分分数与能力推断', '识别字段的变量角色']),
      nextMilestone,
      pathConceptNames: PSYCH_PATH_CONCEPTS,
    });
    expect(advisory.shouldSuggest).toBe(true);
    expect(advisory.ui.body).not.toContain('区分分数与能力推断');
    expect(advisory.ui.body).not.toContain('识别字段的变量角色');
  });

  it('属于本条路径的卡点照常点名', () => {
    const advisory = service.build({
      wrapup: wrapupWith({}),
      learnerReplanProjection: projectionWith(['常识解释与心理解释', '识别字段的变量角色']),
      nextMilestone,
      pathConceptNames: PSYCH_PATH_CONCEPTS,
    });
    expect(advisory.ui.body).toContain('常识解释与心理解释');
    expect(advisory.ui.body).not.toContain('识别字段的变量角色');
  });

  it('不传 pathConceptNames 时不做收窄（旧调用方行为不变）', () => {
    const advisory = service.build({
      wrapup: wrapupWith({}),
      learnerReplanProjection: projectionWith(['识别字段的变量角色']),
      nextMilestone,
    });
    expect(advisory.ui.body).toContain('识别字段的变量角色');
  });

  it('movedToReview（本节课自己的复习项）不因路径概念名不匹配被误删', () => {
    const advisory = service.build({
      wrapup: wrapupWith({ movedToReview: ['本课独有的复习项'] }),
      learnerReplanProjection: projectionWith([]),
      nextMilestone,
      pathConceptNames: PSYCH_PATH_CONCEPTS,
    });
    expect(advisory.ui.body).toContain('本课独有的复习项');
  });

  it('名字空白/标点差异不影响命中（区分 A 与 B vs 区分A与B）', () => {
    const advisory = service.build({
      wrapup: wrapupWith({}),
      learnerReplanProjection: projectionWith(['区分 常识解释 与 心理解释']),
      nextMilestone,
      pathConceptNames: ['区分常识解释与心理解释'],
    });
    expect(advisory.ui.body).toContain('区分 常识解释 与 心理解释');
  });
});
