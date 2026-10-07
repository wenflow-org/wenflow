/**
 * learner-memory（虚拟学习者记忆：画像回写 / 记忆快照 / 成果登记）单元测试
 *
 * 覆盖：
 * - writeProfileConceptsAfterLesson：mastered → knownConcepts，review/learning → struggleConcepts
 * - buildLearnerMemorySnapshot：画像概念 + 到期复习点（memory_traces）合并、成果物透出
 * - recordCompletedArtifact：登记去重 + 上限 + 画像 profile JSON 更新
 * 通过 mock prisma 与 memoryTraceService 隔离数据库与 ACT-R 计算。
 */

import prisma from '../../config/database';
import { memoryTraceService } from '../../services/memory/memory-trace.service';
import {
  buildLearnerMemorySnapshot,
  deriveCuratedSelfState,
  extractSelfStateFromTrace,
  parseSelfCalibrationVerdict,
  recordCompletedArtifact,
  selfExtractLearnerMemory,
  writeProfileConceptsAfterLesson,
} from '../learner-memory';

jest.mock('../../config/database', () => {
  const profiles = {
    findUnique: jest.fn(),
    update: jest.fn(),
  };
  const mockPrisma = { virtual_learner_profiles: profiles };
  return {
    __esModule: true,
    default: mockPrisma,
    prisma: mockPrisma,
  };
});

jest.mock('../../services/memory/memory-trace.service', () => ({
  memoryTraceService: {
    getDueTraces: jest.fn(),
  },
}));

const mockedPrisma = prisma as unknown as {
  virtual_learner_profiles: {
    findUnique: jest.Mock;
    update: jest.Mock;
  };
};

const mockFindUnique = mockedPrisma.virtual_learner_profiles.findUnique;
const mockUpdate = mockedPrisma.virtual_learner_profiles.update;
const mockGetDueTraces = memoryTraceService.getDueTraces as jest.Mock;

function profileRow(profileData: Record<string, unknown>) {
  return {
    id: 'vp1',
    userId: 'u1',
    profile: JSON.stringify(profileData),
    learningGoal: '',
    knownConcepts: JSON.stringify(profileData.knownConcepts || []),
    struggleConcepts: JSON.stringify(profileData.struggleConcepts || []),
  };
}

describe('selfExtractLearnerMemory（内部提炼：自己觉得学会了什么）', () => {
  it('自评掌握高 + 自认完成 + 无卡点 → mastered', () => {
    const result = selfExtractLearnerMemory({
      conceptName: '剪辑节奏',
      conceptualMastery: 0.82,
      taskUnderstanding: 0.8,
      proceduralMastery: 0.75,
      selfReportedTaskDone: true,
      confidence: 0.85,
      wantsMoreHelp: false,
      remainingBlockers: [],
      wantsHint: false,
    });
    expect(result.mastered).toEqual(['剪辑节奏']);
    expect(result.struggling).toEqual([]);
  });

  it('自评掌握低 / 想要提示 / 有剩余卡点 → struggling', () => {
    const result = selfExtractLearnerMemory({
      conceptName: '色彩校正',
      conceptualMastery: 0.32,
      selfReportedTaskDone: false,
      confidence: 0.3,
      wantsMoreHelp: true,
      remainingBlockers: ['曲线工具不会用'],
      wantsHint: true,
    });
    expect(result.mastered).toEqual([]);
    expect(result.struggling).toEqual(['色彩校正']);
  });

  it('自评完成但掌握中低 → 记入 struggling（嘴硬但没真会）', () => {
    const result = selfExtractLearnerMemory({
      conceptName: '转场',
      conceptualMastery: 0.55,
      selfReportedTaskDone: true,
      confidence: 0.7,
      wantsMoreHelp: false,
      remainingBlockers: [],
      wantsHint: false,
    });
    expect(result.mastered).toEqual([]);
    expect(result.struggling).toEqual(['转场']);
  });

  it('无概念名 / 空状态 → 空结果', () => {
    expect(selfExtractLearnerMemory(null)).toEqual({ mastered: [], struggling: [] });
    expect(selfExtractLearnerMemory({ conceptName: '', selfReportedTaskDone: true }))
      .toEqual({ mastered: [], struggling: [] });
  });
});

describe('extractSelfStateFromTrace（从私有状态轨迹提炼收束轮自述）', () => {
  it('取指定 task 最近的 teaching 轨迹条目', () => {
    const trace = [
      { stage: 'goal', state: { phaseFocus: 'understanding' } },
      { stage: 'teaching', taskId: 't1', state: { conceptualMastery: 0.9, learnerFeedback: { selfReportedTaskDone: true, confidence: 0.9, remainingBlockers: [] } } },
      { stage: 'teaching', taskId: 't2', state: { conceptualMastery: 0.3, learnerFeedback: { selfReportedTaskDone: false, remainingBlockers: ['卡住'] } } },
    ];
    const self = extractSelfStateFromTrace(trace, 't1');
    expect(self?.conceptualMastery).toBe(0.9);
    expect(self?.selfReportedTaskDone).toBe(true);
  });

  it('无 teaching 轨迹时返回 null', () => {
    expect(extractSelfStateFromTrace([{ stage: 'goal' }], 't1')).toBeNull();
    expect(extractSelfStateFromTrace(null, 't1')).toBeNull();
  });
});

describe('writeProfileConceptsAfterLesson', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFindUnique.mockResolvedValue(profileRow({ knownConcepts: [], struggleConcepts: [] }));
    mockUpdate.mockResolvedValue({});
  });

  it('mastered 概念并入 knownConcepts，review/learning 并入 struggleConcepts', async () => {
    await writeProfileConceptsAfterLesson('u1', [
      { name: '剪辑节奏', status: 'mastered', progress: 100 },
      { name: '色彩校正', status: 'learning', progress: 40 },
      { name: '转场', status: 'review', progress: 30 },
    ]);

    expect(mockUpdate).toHaveBeenCalledWith({
      where: { userId: 'u1' },
      data: expect.objectContaining({
        knownConcepts: JSON.stringify(['剪辑节奏']),
        struggleConcepts: JSON.stringify(['色彩校正', '转场']),
      }),
    });
  });

  it('mastered 概念同时从 struggleConcepts 中移除', async () => {
    mockFindUnique.mockResolvedValue(profileRow({
      knownConcepts: ['剪辑节奏'],
      struggleConcepts: ['剪辑节奏', '调色'],
    }));

    await writeProfileConceptsAfterLesson('u1', [
      { name: '剪辑节奏', status: 'mastered', progress: 100 },
    ]);

    expect(mockFindUnique).toHaveBeenCalled();
    expect(mockUpdate).toHaveBeenCalled();
    const data = mockUpdate.mock.calls[0][0].data;
    expect(JSON.parse(data.knownConcepts)).toEqual(['剪辑节奏']);
    expect(JSON.parse(data.struggleConcepts)).toEqual(['调色']);
  });

  it('无变化时不写库', async () => {
    mockFindUnique.mockResolvedValue(profileRow({
      knownConcepts: ['剪辑节奏'],
      struggleConcepts: [],
    }));
    await writeProfileConceptsAfterLesson('u1', [
      { name: '剪辑节奏', status: 'mastered', progress: 100 },
    ]);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('空输入不写库', async () => {
    await writeProfileConceptsAfterLesson('u1', []);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('selfState 优先于老师侧 knowledgeState（内部提炼）', async () => {
    mockFindUnique.mockResolvedValue(profileRow({ knownConcepts: [], struggleConcepts: [] }));
    // 老师认为 mastered，但学习者自己觉得没学会 → 应记 struggle
    await writeProfileConceptsAfterLesson('u1', [
      { name: '剪辑节奏', status: 'mastered', progress: 100 },
    ], {
      selfState: {
        conceptName: '剪辑节奏',
        conceptualMastery: 0.3,
        selfReportedTaskDone: false,
        confidence: 0.35,
        wantsMoreHelp: true,
        remainingBlockers: ['还不会'],
        wantsHint: true,
      },
    });
    expect(mockUpdate).toHaveBeenCalled();
    const data = mockUpdate.mock.calls[0][0].data;
    expect(JSON.parse(data.knownConcepts)).toEqual([]);
    expect(JSON.parse(data.struggleConcepts)).toEqual(['剪辑节奏']);
  });
});

describe('buildLearnerMemorySnapshot', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('合并画像概念与到期复习点，去重优先复习点', async () => {
    mockFindUnique.mockResolvedValue(profileRow({
      knownConcepts: ['剪辑节奏', '叙事结构'],
      struggleConcepts: ['调色'],
      recentCompleted: [
        { taskId: 't1', title: '探店视频初剪', artifactType: 'project', deliverable: '一支 3 分钟探店视频', completedAt: '2026-08-01T00:00:00Z' },
      ],
    }));
    mockGetDueTraces.mockResolvedValue([
      { conceptKey: '剪辑节奏', retention: 0.35, label: null, masteryScore: 0.5, stability: 'fragile', lastSeenAt: new Date(), extractionCount: 2, intervalDays: 1, reason: 'below-threshold' },
    ]);

    const memory = await buildLearnerMemorySnapshot('u1');

    // 到期复习的「剪辑节奏」从 mastered 移到 dueReview
    expect(memory.mastered.map((m) => m.name)).toEqual(['叙事结构']);
    expect(memory.dueReview.map((m) => m.name)).toEqual(['剪辑节奏']);
    expect(memory.dueReview[0].progress).toBe(35);
    expect(memory.struggling.map((m) => m.name)).toEqual(['调色']);
    expect(memory.recentTaskTitles).toEqual(['探店视频初剪']);
    expect(memory.recentCompleted[0].deliverable).toBe('一支 3 分钟探店视频');
  });

  it('无画像时返回空快照（不抛错）', async () => {
    mockFindUnique.mockResolvedValue(null);
    const memory = await buildLearnerMemorySnapshot('u1');
    expect(memory).toEqual({
      mastered: [],
      dueReview: [],
      struggling: [],
      recentCompleted: [],
      recentTaskTitles: [],
    });
  });

  it('画像读取抛错 → 空快照但带 degraded（不再静默）', async () => {
    mockFindUnique.mockRejectedValue(new Error('db down'));
    const memory = await buildLearnerMemorySnapshot('u1');
    expect(memory.mastered).toEqual([]);
    expect(memory.degraded?.some((d) => d.source === 'virtual-lab/learner-memory')).toBe(true);
    expect(memory.degraded?.some((d) => d.impactedDimensions.includes('profile'))).toBe(true);
  });

  it('到期线索读取抛错 → dueReview 保底为空且打标', async () => {
    mockFindUnique.mockResolvedValue(profileRow({ knownConcepts: ['a'], struggleConcepts: [], recentCompleted: [] }));
    mockGetDueTraces.mockRejectedValue(new Error('trace down'));
    const memory = await buildLearnerMemorySnapshot('u1');
    expect(memory.dueReview).toEqual([]);
    expect(memory.degraded?.some((d) => d.impactedDimensions.includes('dueReview'))).toBe(true);
  });
});

describe('recordCompletedArtifact', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('登记成果物并去重（同 taskId 只保留最新）', async () => {
    mockFindUnique.mockResolvedValue(profileRow({
      knownConcepts: [],
      struggleConcepts: [],
      recentCompleted: [
        { taskId: 't1', title: '旧标题', completedAt: '2026-07-01T00:00:00Z' },
      ],
    }));
    mockUpdate.mockResolvedValue({});

    await recordCompletedArtifact({
      userId: 'u1',
      taskId: 't1',
      taskTitle: '探店视频初剪',
      artifactType: 'project',
      deliverable: '一支 3 分钟探店视频',
      knowledgePoints: [{ name: '剪辑节奏', status: 'mastered', progress: 100 }],
    });

    const data = mockUpdate.mock.calls[0][0].data;
    const updatedProfile = JSON.parse(data.profile);
    expect(updatedProfile.recentCompleted).toHaveLength(1);
    expect(updatedProfile.recentCompleted[0]).toMatchObject({
      taskId: 't1',
      title: '探店视频初剪',
      artifactType: 'project',
      deliverable: '一支 3 分钟探店视频',
      masteredConcepts: ['剪辑节奏'],
    });
  });

  it('成果物上限 12 条', async () => {
    const existing = Array.from({ length: 12 }, (_, i) => ({
      taskId: `t${i}`,
      title: `任务${i}`,
      completedAt: `2026-07-${String(i + 1).padStart(2, '0')}T00:00:00Z`,
    }));
    mockFindUnique.mockResolvedValue(profileRow({
      knownConcepts: [],
      struggleConcepts: [],
      recentCompleted: existing,
    }));
    mockUpdate.mockResolvedValue({});

    await recordCompletedArtifact({
      userId: 'u1',
      taskId: 't-new',
      taskTitle: '新任务',
    });

    const data = mockUpdate.mock.calls[0][0].data;
    const updatedProfile = JSON.parse(data.profile);
    expect(updatedProfile.recentCompleted).toHaveLength(12);
    expect(updatedProfile.recentCompleted[0].taskId).toBe('t-new');
  });
});

describe('P1-2：写回遍历 curator 全量名单 + 跨表去重', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFindUnique.mockResolvedValue(profileRow({ knownConcepts: [], struggleConcepts: [] }));
    mockUpdate.mockResolvedValue({});
  });

  it('curatedConcepts 全量遍历（mastered→known、struggle→struggle），不再只吃单 conceptName', async () => {
    await writeProfileConceptsAfterLesson('u1', [], {
      source: 'test',
      selfState: { conceptName: '单概念', conceptualMastery: 0.9, selfReportedTaskDone: true },
      curatedConcepts: {
        mastered: ['剪辑节奏', '转场'],
        struggling: ['调色', '曲线'],
      },
    });
    const data = mockUpdate.mock.calls[0][0].data;
    // curated 全量名单 + 自述状态取并集（curated 的 2 项都在，不是只沉淀 1 项）
    expect(JSON.parse(data.knownConcepts)).toEqual(['剪辑节奏', '转场', '单概念']);
    expect(JSON.parse(data.struggleConcepts)).toEqual(['调色', '曲线']);
  });

  it('同名概念不得同时进 mastered 与 struggle（跨表去重，mastered 优先）', async () => {
    await writeProfileConceptsAfterLesson('u1', [], {
      curatedConcepts: {
        mastered: ['剪辑节奏'],
        struggling: ['剪辑节奏', '调色'],
      },
    });
    const data = mockUpdate.mock.calls[0][0].data;
    expect(JSON.parse(data.knownConcepts)).toEqual(['剪辑节奏']);
    expect(JSON.parse(data.struggleConcepts)).toEqual(['调色']);
  });

  it('既有画像已知/卡点重名时，最终两张表不双表共存', async () => {
    mockFindUnique.mockResolvedValue(profileRow({
      knownConcepts: ['剪辑节奏'],
      struggleConcepts: ['剪辑节奏', '调色'],
    }));
    await writeProfileConceptsAfterLesson('u1', [], {
      curatedConcepts: { mastered: [], struggling: ['曲线'] },
    });
    const data = mockUpdate.mock.calls[0][0].data;
    expect(JSON.parse(data.knownConcepts)).toEqual(['剪辑节奏']);
    expect(JSON.parse(data.struggleConcepts)).toEqual(['调色', '曲线']);
  });
});

describe('P1-2：deriveCuratedSelfState（mastery 来自 curator confidence，不写死 0.85）', () => {
  it('conceptualMastery 取 curator confidence，不是 0.85', () => {
    const state = deriveCuratedSelfState(null, {
      mastered: [{ name: '剪辑节奏', confidence: 0.9 }],
      struggle: [],
    });
    expect(state.conceptName).toBe('剪辑节奏');
    expect(state.conceptualMastery).toBe(0.9);
    expect(state.conceptualMastery).not.toBe(0.85);
  });

  it('selfReportedTaskDone 缺失时按 confidence 判：低于 0.65 即 false', () => {
    const low = deriveCuratedSelfState(null, { mastered: [{ name: 'a', confidence: 0.5 }], struggle: [] });
    expect(low.selfReportedTaskDone).toBe(false);
    const high = deriveCuratedSelfState(null, { mastered: [{ name: 'a', confidence: 0.8 }], struggle: [] });
    expect(high.selfReportedTaskDone).toBe(true);
  });

  it('尊重学习者原话：自报 taskDone=false 不被 curator 覆盖', () => {
    const state = deriveCuratedSelfState(
      { selfReportedTaskDone: false, conceptualMastery: 0.2 },
      { mastered: [{ name: 'a', confidence: 0.9 }], struggle: [] },
    );
    expect(state.selfReportedTaskDone).toBe(false);
    expect(state.conceptualMastery).toBe(0.9);
  });
});

describe('P2-33：selfCalibration 确定性解析（否定辖域 + 语境守卫 + 动作词兜底）', () => {
  it('「本课未见高估」不得判 overconfident', () => {
    expect(parseSelfCalibrationVerdict('本课未见高估')).not.toBe('overconfident');
    expect(parseSelfCalibrationVerdict('本课未见高估')).toBeNull();
  });

  it('否定辖域覆盖合取：「没有明显高估或低估」/「既没有高估也没有低估」= 无偏差', () => {
    expect(parseSelfCalibrationVerdict('自评较可靠，没有明显高估或低估')).toBeNull();
    expect(parseSelfCalibrationVerdict('既没有高估也没有低估')).toBeNull();
  });

  it('「此前低估本次较准」不得判 underconfident（时相对照）', () => {
    expect(parseSelfCalibrationVerdict('此前低估本次较准')).not.toBe('underconfident');
    expect(parseSelfCalibrationVerdict('此前低估本次较准')).toBe('calibrated');
  });

  it('单向倾向句必须判出方向（不得落进 calibrated 桶）', () => {
    expect(parseSelfCalibrationVerdict('高估倾向，自评需打折')).toBe('overconfident');
    expect(parseSelfCalibrationVerdict('高估倾向明显，实际掌握不足，需打折处理')).toBe('overconfident');
    expect(parseSelfCalibrationVerdict('阶段性嘴硬，自评需略打折')).toBe('overconfident');
    expect(parseSelfCalibrationVerdict('自评偏保守、爱说拿不准，可对其自评适度上修')).toBe('underconfident');
    expect(parseSelfCalibrationVerdict('自评偏低估，掌握程度可按其自述上修')).toBe('underconfident');
  });

  it('可靠度语境下的「偏高/偏低」不是偏差方向', () => {
    expect(parseSelfCalibrationVerdict('自评可靠度中等偏高')).not.toBe('overconfident');
    expect(parseSelfCalibrationVerdict('可靠度中等偏低，需结合表现校准')).not.toBe('underconfident');
  });

  it('确定性 fallback 文案自带方向，不再一律判 calibrated', () => {
    expect(parseSelfCalibrationVerdict('画像显示该学习者自评倾向高估，记忆按打折处理。')).toBe('overconfident');
    expect(parseSelfCalibrationVerdict('画像显示该学习者自评倾向低估，记忆可适度上修。')).toBe('underconfident');
    expect(parseSelfCalibrationVerdict('本课未获得可用的自评校准信息，不作校准结论。')).toBeNull();
  });

  it('无判决信息返回 null（不写回）', () => {
    expect(parseSelfCalibrationVerdict('')).toBeNull();
    expect(parseSelfCalibrationVerdict('这课还行')).toBeNull();
  });
});

describe('P2-32/P2-33：recordCompletedArtifact 证据落库与校准回写', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUpdate.mockResolvedValue({});
  });

  it('evidence/severity 随名单落库 + 跨表去重', async () => {
    mockFindUnique.mockResolvedValue(profileRow({ knownConcepts: [], struggleConcepts: [] }));
    await recordCompletedArtifact({
      userId: 'u1',
      taskId: 't1',
      taskTitle: '探店视频初剪',
      memoryCurated: {
        mastered: [{ name: '剪辑节奏', evidence: '第23轮自己发现「你慢慢想」是自己试出来的', confidence: 0.8 }],
        struggling: [
          { name: '剪辑节奏', blocker: '同名重复', severity: 'low' },
          { name: '调色', blocker: '白平衡搞不定', severity: 'high' },
        ],
        selfCalibration: '较准',
      },
    });
    const updated = JSON.parse(mockUpdate.mock.calls[0][0].data.profile);
    const entry = updated.recentCompleted[0];
    expect(entry.masteredConcepts).toEqual(['剪辑节奏']);
    expect(entry.struggleConcepts).toEqual(['调色']);
    expect(entry.masteredEvidence).toEqual([{
      name: '剪辑节奏', evidence: '第23轮自己发现「你慢慢想」是自己试出来的', confidence: 0.8,
    }]);
    expect(entry.struggleEvidence).toEqual([{ name: '调色', blocker: '白平衡搞不定', severity: 'high' }]);
  });

  it('selfCalibration 判决只在变化时写回（打破回声闭环）', async () => {
    mockFindUnique.mockResolvedValue(profileRow({ selfAssessmentAccuracy: 'overconfident' }));
    await recordCompletedArtifact({
      userId: 'u1',
      taskId: 't2',
      taskTitle: 'x',
      memoryCurated: { mastered: [], struggling: [], selfCalibration: '高估倾向明显' },
    });
    const updated = JSON.parse(mockUpdate.mock.calls[0][0].data.profile);
    expect(updated.selfAssessmentAccuracy).toBe('overconfident');
  });

  it('否定句不写回 overconfident', async () => {
    mockFindUnique.mockResolvedValue(profileRow({ knownConcepts: [], struggleConcepts: [] }));
    await recordCompletedArtifact({
      userId: 'u1',
      taskId: 't3',
      taskTitle: 'y',
      memoryCurated: { mastered: [], struggling: [], selfCalibration: '本课未见高估' },
    });
    const updated = JSON.parse(mockUpdate.mock.calls[0][0].data.profile);
    expect(updated.selfAssessmentAccuracy).toBeUndefined();
  });

  it("calibrated（较准/准确）不写回画像——自由文本不足以覆盖默认值 'accurate'", async () => {
    mockFindUnique.mockResolvedValue(profileRow({ knownConcepts: [], struggleConcepts: [] }));
    await recordCompletedArtifact({
      userId: 'u1',
      taskId: 't4',
      taskTitle: 'z',
      memoryCurated: { mastered: [], struggling: [], selfCalibration: '本轮自评较准' },
    });
    const updated = JSON.parse(mockUpdate.mock.calls[0][0].data.profile);
    expect(updated.selfAssessmentAccuracy).toBeUndefined();
  });

  it('单向判决仍写回（overconfident）', async () => {
    mockFindUnique.mockResolvedValue(profileRow({ knownConcepts: [], struggleConcepts: [] }));
    await recordCompletedArtifact({
      userId: 'u1',
      taskId: 't4b',
      taskTitle: 'z2',
      memoryCurated: { mastered: [], struggling: [], selfCalibration: '高估倾向，自评需打折' },
    });
    const updated = JSON.parse(mockUpdate.mock.calls[0][0].data.profile);
    expect(updated.selfAssessmentAccuracy).toBe('overconfident');
  });

  it('确定性 fallback 的「无校准信息」文案不得覆盖画像（不得写成 accurate）', async () => {
    mockFindUnique.mockResolvedValue(profileRow({ knownConcepts: [], struggleConcepts: [] }));
    await recordCompletedArtifact({
      userId: 'u1',
      taskId: 't5',
      taskTitle: 'w',
      memoryCurated: { mastered: [], struggling: [], selfCalibration: '本课未获得可用的自评校准信息，不作校准结论。' },
    });
    const updated = JSON.parse(mockUpdate.mock.calls[0][0].data.profile);
    expect(updated.selfAssessmentAccuracy).toBeUndefined();
  });
});

describe('P2-32：快照透出 evidence/severity', () => {
  it('buildLearnerMemorySnapshot 透出 masteredEvidence/struggleEvidence', async () => {
    mockFindUnique.mockResolvedValue(profileRow({
      knownConcepts: [],
      struggleConcepts: [],
      recentCompleted: [{
        taskId: 't1', title: 'x', completedAt: '2026-08-01T00:00:00Z',
        struggleConcepts: ['调色'],
        masteredEvidence: [{ name: '剪辑节奏', evidence: 'e', confidence: 0.8 }],
        struggleEvidence: [{ name: '调色', blocker: 'b', severity: 'high' }],
      }],
    }));
    mockGetDueTraces.mockResolvedValue([]);
    const memory = await buildLearnerMemorySnapshot('u1');
    expect(memory.recentCompleted[0].masteredEvidence).toEqual([{ name: '剪辑节奏', evidence: 'e', confidence: 0.8 }]);
    expect(memory.recentCompleted[0].struggleEvidence).toEqual([{ name: '调色', blocker: 'b', severity: 'high' }]);
    expect(memory.recentCompleted[0].struggleConcepts).toEqual(['调色']);
  });
});
