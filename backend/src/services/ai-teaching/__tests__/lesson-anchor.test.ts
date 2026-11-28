import { buildLessonAnchor, segmentsFromAnchor } from '../lesson-anchor';
import type { TeachingScenarioContext } from '../teaching-context-types';

function makeContext(overrides: Partial<TeachingScenarioContext> = {}): TeachingScenarioContext {
  return {
    userId: 'u1',
    taskId: 't1',
    learningPathId: 'lp1',
    milestoneId: 'ms1',
    subject: '中国乡土社会结构（费孝通《乡土中国》）',
    topic: '「土气」在《乡土本色》开篇里到底指什么',
    taskTitle: '「土气」在《乡土本色》开篇里到底指什么',
    taskDescription: '读《乡土本色》开篇节选，找出费孝通给「土」下界定的那一句。',
    taskType: 'acquire',
    taskKnowledgeScope: { primaryConcepts: [], prerequisiteConcepts: [], supportingConcepts: [] },
    taskKcs: [{ kcId: 'kc-1a', name: '还原土气的谋生根据', taxonomy: 'understand' }],
    taskKnowledgeSeeds: [{ name: '还原土气的谋生根据', status: 'learning', progress: 0 }],
    taskProfile: {
      knowledgeType: 'conceptual',
      cognitiveLevel: 'understand',
      displayLabel: '理解核心原理',
      learningObjectives: [],
      coreConcept: '乡土本色·面对面如何决定信息传法',
      linkedConceptId: 'c1',
      linkedConceptName: '乡土本色·面对面如何决定信息传法',
    },
    currentTaskContext: {
      description: null,
      acceptanceCriteria: '能指出原文中给「土」下界定的那一句，并说清它和「不流动」之间的因果；解释中不出现「素质」「文化水平」这类说法。',
    },
    cognitiveFrame: {
      currentCoreConcept: { id: null, name: null, description: null },
      prerequisiteConcepts: [],
      neighboringConcepts: [],
      targetRelation: null,
      milestoneIntent: null,
      transferGoal: null,
    },
    teachingStrategyGuidance: {
      knowledgeType: 'conceptual',
      cognitiveLevel: 'understand',
      objectiveFocus: [],
      coreConcept: null,
      explanationStyle: '',
      interactionPattern: '',
      targetDepth: '',
      preferredStrategies: [],
      responseConstraints: [],
    },
    canStartLearning: true,
    learningBlockedReason: null,
    pathProgress: {
      pathTitle: '乡土社会结构',
      pathSummary: null,
      currentMilestoneTitle: '第一阶段',
      currentStageNumber: 1,
      currentTaskOrder: 0,
      totalTasksInMilestone: 4,
    },
    schoolAnchor: {
      background: '没有读过《乡土中国》，也未接触过社会学类读物',
      baselineEvidence: '「我没看过」',
    },
    learningState: null,
    learnerProjection: {} as TeachingScenarioContext['learnerProjection'],
    anchorMasteredLastSeenAt: {},
    pathContext: {},
    ...overrides,
  } as TeachingScenarioContext;
}

describe('lesson-anchor：课堂锚构建与自然分段', () => {
  it('《乡土本色》零基础案例：拆出两条正向判据、附挂否定约束，并识别 novice 基线', () => {
    const anchor = buildLessonAnchor(makeContext());
    expect(anchor.mainQuestion).toBe('「土气」在《乡土本色》开篇里到底指什么');
    expect(anchor.learnerBaseline).toBe('novice');
    expect(anchor.baselineNote).toContain('没有读过《乡土中国》');
    expect(anchor.criteria.length).toBe(2);
    expect(anchor.criteria[0].text).toContain('给「土」下界定的那一句');
    expect(anchor.criteria[1].text).toContain('和「不流动」之间的因果');
    expect(anchor.criteria[1].text).toContain('解释中不出现');
    expect(anchor.softConcepts).toEqual(['还原土气的谋生根据']);

    const segments = segmentsFromAnchor(anchor, anchor.mainQuestion);
    expect(segments.length).toBe(2);
    expect(segments[0].title).not.toContain('解释中不出现');
  });

  it('多条分号验收标准（理科/社科通用）各成一段，上限 3 条', () => {
    const anchor = buildLessonAnchor(makeContext({
      taskTitle: '有氧呼吸三阶段如何接力供能',
      schoolAnchor: { background: '学过高中生物必修一，对进阶内容有基础', baselineEvidence: null },
      currentTaskContext: {
        description: null,
        acceptanceCriteria: '说清糖酵解在细胞质基质发生；说明丙酮酸进入线粒体后如何产生 CO₂；对比第三阶段大量 ATP 的来源；只背方程式不算过关。',
      },
    }));
    expect(anchor.learnerBaseline).toBe('familiar');
    expect(anchor.criteria.length).toBe(3);
    expect(anchor.criteria[2].text).toContain('只背方程式不算过关');
    expect(segmentsFromAnchor(anchor, anchor.mainQuestion).length).toBe(3);
  });

  it('无验收标准且无学习目标时，用任务描述兜底为 1 条判据，不硬拆多段', () => {
    const anchor = buildLessonAnchor(makeContext({
      currentTaskContext: { description: null, acceptanceCriteria: null },
      taskProfile: {
        knowledgeType: null,
        cognitiveLevel: null,
        displayLabel: null,
        learningObjectives: [],
        coreConcept: null,
        linkedConceptId: null,
        linkedConceptName: null,
      },
      schoolAnchor: { background: null, baselineEvidence: null },
      learnerPersona: null,
    }));
    expect(anchor.learnerBaseline).toBe('unknown');
    expect(anchor.criteria.length).toBe(1);
    expect(segmentsFromAnchor(anchor, anchor.mainQuestion)).toEqual([]);
  });
});
