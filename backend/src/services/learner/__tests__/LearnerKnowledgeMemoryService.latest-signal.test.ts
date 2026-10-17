/**
 * 状态判定改为「最近一条有时间的证据说了算」（#59/#60 第 2 条：消灭 OR 吸收）。
 *
 * 旧口径 `evidence.some(review|fragile)`：只要历史上出现过一次 review，后来的 mastered
 * 永远翻不了案（审计 13.1 的 9 条矛盾项全部由该条造成）。
 * 新口径按 seenAt 取最新；没有时间戳的旧数据退回 OR（保守，行为不变）。
 */
jest.mock('../../../config/database', () => ({
  __esModule: true,
  default: {
    learning_paths: { findUnique: jest.fn(), findFirst: jest.fn(), findMany: jest.fn() },
    teaching_sessions: { findMany: jest.fn() },
    learner_evidence: { findMany: jest.fn() },
    memory_traces: { findMany: jest.fn() },
    concept_aliases: { findUnique: jest.fn() },
    concepts: { findUnique: jest.fn(), create: jest.fn() },
  },
}));
jest.mock('../concept-graph.service', () => ({
  conceptGraphService: { upstreamClosure: jest.fn() },
}));

import { learnerKnowledgeMemoryService } from '../LearnerKnowledgeMemoryService';

const prisma = require('../../../config/database').default as {
  learning_paths: { findUnique: jest.Mock };
  teaching_sessions: { findMany: jest.Mock };
  learner_evidence: { findMany: jest.Mock };
  memory_traces: { findMany: jest.Mock };
  concept_aliases: { findUnique: jest.Mock };
  concepts: { findUnique: jest.Mock };
};

function path() {
  return {
    id: 'p1', userId: 'u1', title: '路径', name: '路径', status: 'active',
    milestones: [{ id: 'm1', stageNumber: 1, title: '阶段', goal: null, status: 'active', subtasks: [] }],
  };
}

function session(id: string, endTime: Date, status: 'mastered' | 'review' | 'learning', progress: number) {
  return {
    id, learningPathId: 'p1', taskId: null, milestoneId: null,
    knowledgeState: JSON.stringify([{ name: '跨回合概念', status, progress }]),
    wrapup: null, endTime, updatedAt: endTime,
  };
}

async function build(sessions: Array<Record<string, unknown>>) {
  prisma.learning_paths.findUnique.mockResolvedValue(path());
  prisma.teaching_sessions.findMany.mockResolvedValue(sessions);
  prisma.learner_evidence.findMany.mockResolvedValue([]);
  prisma.memory_traces.findMany.mockResolvedValue([]);
  prisma.concept_aliases.findUnique.mockResolvedValue(null);
  prisma.concepts.findUnique.mockResolvedValue(null);
  return learnerKnowledgeMemoryService.build({ userId: 'u1', learningPathId: 'p1' });
}

describe('LearnerKnowledgeMemoryService · 最近信号优先（#59/#60）', () => {
  it('旧 review + 新 mastered → mastered（后来掌握能翻案）', async () => {
    const memory = await build([
      session('s-old', new Date('2026-09-01T00:00:00.000Z'), 'review', 60),
      session('s-new', new Date('2026-10-01T00:00:00.000Z'), 'mastered', 100),
    ]);
    const state = memory.currentPath?.conceptStates.find((c) => c.conceptKey === '跨回合概念');
    expect(state?.status).toBe('mastered');
    expect(memory.globalSignals.fragileConcepts).not.toContain('跨回合概念');
  });

  it('旧 mastered + 新 review → review（新一轮失败要真实可见）', async () => {
    const memory = await build([
      session('s-old', new Date('2026-09-01T00:00:00.000Z'), 'mastered', 100),
      session('s-new', new Date('2026-10-01T00:00:00.000Z'), 'review', 55),
    ]);
    const state = memory.currentPath?.conceptStates.find((c) => c.conceptKey === '跨回合概念');
    expect(state?.status).toBe('review');
    expect(memory.globalSignals.fragileConcepts).toContain('跨回合概念');
  });

  it('全部无时间戳（旧数据）→ 退回保守 OR：review 优先', async () => {
    const memory = await build([
      { ...session('s-null-1', new Date('2026-09-01T00:00:00.000Z'), 'review', 60), endTime: null, updatedAt: new Date('2026-09-01T00:00:00.000Z') },
      { ...session('s-null-2', new Date('2026-10-01T00:00:00.000Z'), 'mastered', 100), endTime: null, updatedAt: new Date('2026-10-01T00:00:00.000Z') },
    ]);
    const state = memory.currentPath?.conceptStates.find((c) => c.conceptKey === '跨回合概念');
    expect(state?.status).toBe('review');
  });
});
