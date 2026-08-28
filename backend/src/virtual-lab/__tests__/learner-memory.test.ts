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
  extractSelfStateFromTrace,
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
