/**
 * #93：globalSignals / globalBackground 是用户级画像，必须跨路径并集。
 *
 * 旧实现只从「当前路径」的任务与会话取数：多路径学习者在另一条路径上已经掌握/卡住的概念
 * 完全不进 globalSignals，台账的 sourcePaths 也只有当前路径，转学/换目标后画像瞬间失忆。
 *
 * 本测试锁定：
 * ① 其它路径的会话知识进入 globalSignals；
 * ② 其它路径的概念不进 currentPath.conceptStates（不污染 taskMastery / 前置缺口）；
 * ③ globalBackground.conceptLedger 如实带 sourcePaths（跨路径溯源）。
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

function buildPath(id: string, task: Record<string, unknown>, milestoneId: string) {
  return {
    id,
    userId: 'u1',
    title: id,
    name: id,
    status: 'active',
    deadline: null,
    createdAt: NOW,
    updatedAt: NOW,
    milestones: [
      {
        id: milestoneId,
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

describe('LearnerKnowledgeMemoryService · 跨路径并集（#93）', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    const currentPath = buildPath(
      'p1',
      { ...baseTask, id: 't1', title: '当前路径任务', linkedConceptName: '当前路径概念' },
      'm1',
    );
    const otherPath = buildPath(
      'p2',
      { ...baseTask, id: 't2', title: '旧路径任务', linkedConceptName: '旧路径概念' },
      'm2',
    );

    prisma.learning_paths.findUnique.mockResolvedValue(currentPath);
    prisma.learning_paths.findMany.mockResolvedValue([otherPath]);
    // 旧路径上的一节课：光合作用 mastered
    prisma.teaching_sessions.findMany.mockResolvedValue([
      {
        id: 's2',
        learningPathId: 'p2',
        taskId: 't2',
        milestoneId: 'm2',
        knowledgeState: JSON.stringify([{ name: '光合作用', status: 'mastered', progress: 92 }]),
        wrapup: null,
        endTime: NOW,
        updatedAt: NOW,
      },
    ]);
    prisma.learner_evidence.findMany.mockResolvedValue([]);
    prisma.memory_traces.findMany.mockResolvedValue([]);
  });

  it('其它路径的已掌握概念进入 globalSignals，但不进 currentPath.conceptStates', async () => {
    const memory = await learnerKnowledgeMemoryService.build({ userId: 'u1', learningPathId: 'p1' });

    expect(memory.globalSignals.masteredConcepts).toContain('光合作用');
    expect(memory.currentPath?.conceptStates.map((concept) => concept.label) ?? []).not.toContain('光合作用');
    // 当前路径自己的概念仍在路径视图里
    expect(memory.currentPath?.conceptStates.map((concept) => concept.label) ?? []).toContain('当前路径概念');
    // taskMastery 只覆盖当前路径
    expect(memory.currentPath?.taskMastery.map((task) => task.taskId) ?? []).toEqual(['t1']);
  });

  it('globalBackground 台账跨路径溯源：sourcePaths 带出旧路径', async () => {
    const memory = await learnerKnowledgeMemoryService.build({ userId: 'u1', learningPathId: 'p1' });
    const row = memory.globalBackground.conceptLedger.find((item) => item.label === '光合作用');
    expect(row).toBeDefined();
    expect(row?.sourcePaths).toContain('p2');
  });
});
