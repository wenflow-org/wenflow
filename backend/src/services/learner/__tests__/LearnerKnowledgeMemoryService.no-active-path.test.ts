/**
 * #155：没有 active 路径时，用户级 globalSignals / globalBackground 不得整体清零。
 *
 * 旧实现在找不到 active 路径（或路径不属于本用户）时**提前 return 空结构**，早于读取用户级
 * memory_traces 与各路径证据。于是路径完成/归档后，管理端列表与 learner-center 的全局快照
 * 显示 0 个已掌握 / 脆弱概念，replanSignal / reviewPriority 回落为「无风险」。
 *
 * 本测试锁定：无 active 路径（路径已 completed）时，
 * ① 用户级 memory_traces 仍进入 globalSignals；
 * ② 已完成路径上的证据仍按用户级视角进入画像（otherPaths 不依赖 active）；
 * ③ currentPath 仍为空（只有它真正依赖具体路径）。
 */
jest.mock('../../../config/database', () => ({
  __esModule: true,
  default: {
    learning_paths: { findUnique: jest.fn(), findFirst: jest.fn(), findMany: jest.fn() },
    teaching_sessions: { findMany: jest.fn() },
    learner_evidence: { findMany: jest.fn() },
    memory_traces: { findMany: jest.fn() },
  },
}));

import { learnerKnowledgeMemoryService } from '../LearnerKnowledgeMemoryService';

const prisma = require('../../../config/database').default as {
  learning_paths: { findUnique: jest.Mock; findFirst: jest.Mock; findMany: jest.Mock };
  teaching_sessions: { findMany: jest.Mock };
  learner_evidence: { findMany: jest.Mock };
  memory_traces: { findMany: jest.Mock };
};

const NOW = new Date('2026-10-01T10:00:00.000Z');

function buildPath(id: string, status: string, task: Record<string, unknown>) {
  return {
    id,
    userId: 'u1',
    title: id,
    name: id,
    status,
    deadline: null,
    createdAt: NOW,
    updatedAt: NOW,
    milestones: [
      {
        id: `${id}-m1`,
        stageNumber: 1,
        title: '阶段',
        goal: null,
        status: 'active',
        subtasks: [task],
      },
    ],
  };
}

const baseTask = {
  order: 1,
  title: '任务',
  status: 'completed',
  completedAt: NOW,
  updatedAt: NOW,
  estimatedMinutes: 30,
  linkedConceptName: null,
  coreConcept: null,
  displayLabel: null,
  learningObjectives: null,
};

describe('LearnerKnowledgeMemoryService · 无 active 路径不清零（#155）', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    prisma.teaching_sessions.findMany.mockResolvedValue([]);
    prisma.learner_evidence.findMany.mockResolvedValue([]);
    prisma.memory_traces.findMany.mockResolvedValue([]);
  });

  it('无 active 路径时仍读用户级 memory_traces，globalSignals 非空', async () => {
    // 无 pathId 的调用（如全局快照）：自动定位 active 路径失败，但只剩一条 completed 路径
    prisma.learning_paths.findFirst.mockResolvedValue(null);
    prisma.learning_paths.findMany.mockResolvedValue([
      buildPath('p1', 'completed', { ...baseTask, id: 't1', linkedConceptName: '已完成路径概念' }),
    ]);
    prisma.memory_traces.findMany.mockResolvedValue([
      {
        id: 'tr1',
        userId: 'u1',
        conceptKey: '光合作用',
        label: '光合作用',
        masteryScore: 0.9,
        stability: 'stable',
        extractionCount: 4,
        intervalFactor: 1.2,
        source: 'extraction',
        lastSeenAt: NOW,
        updatedAt: NOW,
      },
    ]);

    const memory = await learnerKnowledgeMemoryService.build({ userId: 'u1' });

    expect(memory.currentPath).toBeUndefined();
    expect(memory.globalSignals.masteredConcepts).toContain('光合作用');
    // 用户级台账同样不再为空
    expect(memory.globalBackground.conceptLedger.map((item) => item.label)).toContain('光合作用');
  });

  it('已完成路径上的证据仍进入用户级画像（otherPaths 不依赖 active）', async () => {
    prisma.learning_paths.findFirst.mockResolvedValue(null);
    prisma.learning_paths.findMany.mockResolvedValue([
      buildPath('p1', 'completed', { ...baseTask, id: 't1', linkedConceptName: null }),
    ]);
    prisma.teaching_sessions.findMany.mockResolvedValue([
      {
        id: 's1',
        learningPathId: 'p1',
        taskId: 't1',
        milestoneId: 'p1-m1',
        knowledgeState: JSON.stringify([{ name: '光合作用', status: 'mastered', progress: 92 }]),
        wrapup: null,
        endTime: NOW,
        updatedAt: NOW,
      },
    ]);

    const memory = await learnerKnowledgeMemoryService.build({ userId: 'u1' });

    expect(memory.currentPath).toBeUndefined();
    expect(memory.globalSignals.masteredConcepts).toContain('光合作用');
  });
});
