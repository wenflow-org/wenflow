/**
 * 教学证据的 signal 四档语义（P0-2）。
 *
 * 缺陷：lesson:completed 只按「有 review → struggle，否则 mastery」两档判定，
 * 把仍在学（learning/pending）的知识点也说成掌握；summary 则只判 mastered（其余一会 incomplete）。
 * 结果同一概念在概念概览（按 status 显示「进行中」）与证据页（显示绿「掌握」/灰「未完成」）结论相反。
 *
 * 本测试锁定：lesson:completed 与 summary 的 signal 都由 knowledgeState/knowledgeItems 的 status 推导，
 * 与教学会话证据同一套顺序（review→struggle / mastered→mastery / 其余→incomplete）。
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

const path = {
  id: 'p1',
  userId: 'u1',
  title: '路径',
  name: '路径',
  status: 'active',
  milestones: [{ id: 'm1', stageNumber: 1, title: '阶段', goal: null, status: 'active', subtasks: [] }],
};

/** lesson:completed 行：knowledgeState 决定 signal，sessionId 用于在 recentEvidence 里定位 */
function lessonEvidence(sessionId: string, knowledgeState: Array<{ name: string; status: string; progress: number }>) {
  return {
    pathId: 'p1',
    evidenceType: 'lesson:completed',
    payload: JSON.stringify({ knowledgeState, conceptKeys: knowledgeState.map((item) => item.name) }),
    taskId: 't1',
    sessionId,
    confidence: 0.6,
    occurredAt: new Date('2026-10-01T00:00:00.000Z'),
  };
}

async function build() {
  prisma.learning_paths.findUnique.mockResolvedValue(path);
  prisma.memory_traces.findMany.mockResolvedValue([]);
  prisma.concept_aliases.findUnique.mockResolvedValue(null);
  prisma.concepts.findUnique.mockResolvedValue(null);
  return learnerKnowledgeMemoryService.build({ userId: 'u1', learningPathId: 'p1' });
}

async function buildWith(evidence: Array<Record<string, unknown>>, sessions: Array<Record<string, unknown>> = []) {
  prisma.learner_evidence.findMany.mockResolvedValue(evidence);
  prisma.teaching_sessions.findMany.mockResolvedValue(sessions);
  return build();
}

function evidenceSignal(memory: Awaited<ReturnType<typeof build>>, sessionId: string) {
  return memory.currentPath?.recentEvidence.find((item) => item.sessionId === sessionId)?.signal;
}

describe('LearnerKnowledgeMemoryService · 教学证据 signal 四档（P0-2）', () => {
  it('lesson:completed 只含 learning → incomplete，不再冒充掌握', async () => {
    const memory = await buildWith([lessonEvidence('sess-learning', [{ name: '纯学概念', status: 'learning', progress: 40 }])]);
    expect(evidenceSignal(memory, 'sess-learning')).toBe('incomplete');
  });

  it('lesson:completed 含 review → struggle（优先于其它档位）', async () => {
    const memory = await buildWith([
      lessonEvidence('sess-review', [
        { name: '需复习概念', status: 'review', progress: 40 },
        { name: '已掌握概念', status: 'mastered', progress: 95 },
      ]),
    ]);
    expect(evidenceSignal(memory, 'sess-review')).toBe('struggle');
  });

  it('lesson:completed 含 mastered 且无 review → mastery', async () => {
    const memory = await buildWith([
      lessonEvidence('sess-mastered', [
        { name: '已掌握概念', status: 'mastered', progress: 95 },
        { name: '在学概念', status: 'learning', progress: 50 },
      ]),
    ]);
    expect(evidenceSignal(memory, 'sess-mastered')).toBe('mastery');
  });

  it('summary 含 review → struggle，不再降级成 incomplete', async () => {
    const memory = await buildWith([], [
      {
        id: 's1',
        learningPathId: 'p1',
        taskId: 't1',
        milestoneId: 'm1',
        knowledgeState: JSON.stringify([{ name: '复习概念', status: 'review', progress: 40 }]),
        wrapup: JSON.stringify({
          status: 'ok',
          sources: { summary: 'model' },
          summary: { knowledgeItems: [{ name: '复习概念', status: 'review', progress: 40 }] },
        }),
        endTime: new Date('2026-10-02T00:00:00.000Z'),
        updatedAt: new Date('2026-10-02T00:00:00.000Z'),
      },
    ]);
    expect(evidenceSignal(memory, 's1')).toBe('struggle');
  });

  it('summary 只含 learning → incomplete', async () => {
    const memory = await buildWith([], [
      {
        id: 's2',
        learningPathId: 'p1',
        taskId: 't1',
        milestoneId: 'm1',
        knowledgeState: JSON.stringify([{ name: '在学概念', status: 'learning', progress: 50 }]),
        wrapup: JSON.stringify({
          status: 'ok',
          sources: { summary: 'model' },
          summary: { knowledgeItems: [{ name: '在学概念', status: 'learning', progress: 50 }] },
        }),
        endTime: new Date('2026-10-02T00:00:00.000Z'),
        updatedAt: new Date('2026-10-02T00:00:00.000Z'),
      },
    ]);
    expect(evidenceSignal(memory, 's2')).toBe('incomplete');
  });
});
