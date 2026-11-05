/**
 * issue #194：knowledgeStateSummary 声明为 profile 产出，此前只写 learner_evidence、
 * 从不进快照；预测器等消费方于是绕过画像直查证据。
 *
 * 本测试锁定：enricher 写入 `session-knowledge-distilled` 证据里的知识状态摘要
 * 会被聚合并落进快照的 knowledgeMemory.globalBackground.knowledgeStateSummary，
 * 且取**最新**一条、空/纯空白不入快照。
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

import { learnerKnowledgeMemoryService } from '../LearnerKnowledgeMemoryService';

const prisma = require('../../../config/database').default as {
  learning_paths: { findUnique: jest.Mock; findMany: jest.Mock };
  teaching_sessions: { findMany: jest.Mock };
  learner_evidence: { findMany: jest.Mock };
  memory_traces: { findMany: jest.Mock };
  concept_aliases: { findUnique: jest.Mock };
};

const path = {
  id: 'p1',
  userId: 'u1',
  title: '路径',
  name: '路径',
  status: 'active',
  milestones: [],
};

const distilled = (summary: unknown, occurredAt: string) => ({
  evidenceType: 'session-knowledge-distilled',
  pathId: 'p1',
  payload: JSON.stringify(summary === undefined ? {} : { knowledgeStateSummary: summary }),
  occurredAt: new Date(occurredAt),
});

const build = () => learnerKnowledgeMemoryService.build({ userId: 'u1', learningPathId: 'p1' });

beforeEach(() => {
  jest.clearAllMocks();
  prisma.learning_paths.findUnique.mockResolvedValue(path);
  prisma.learning_paths.findMany.mockResolvedValue([]);
  prisma.teaching_sessions.findMany.mockResolvedValue([]);
  prisma.memory_traces.findMany.mockResolvedValue([]);
  prisma.concept_aliases.findUnique.mockResolvedValue(null);
  prisma.learner_evidence.findMany.mockResolvedValue([]);
});

describe('globalBackground.knowledgeStateSummary（issue #194）', () => {
  it('证据里的摘要进入快照，且取最新一条（findMany 已按 occurredAt desc）', async () => {
    prisma.learner_evidence.findMany.mockResolvedValue([
      distilled('本节课后：已掌握分组聚合，合并仍脆弱。', '2026-09-06T00:00:00.000Z'),
      distilled('上一节摘要（应被覆盖）', '2026-09-05T00:00:00.000Z'),
    ]);

    const memory = await build();

    expect(memory.globalBackground.knowledgeStateSummary)
      .toBe('本节课后：已掌握分组聚合，合并仍脆弱。');
  });

  it('无证据 / 摘要为空或纯空白时不落该键', async () => {
    prisma.learner_evidence.findMany.mockResolvedValue([
      distilled(undefined, '2026-09-06T00:00:00.000Z'),
      distilled('   ', '2026-09-05T00:00:00.000Z'),
      distilled(42, '2026-09-04T00:00:00.000Z'),
    ]);

    const memory = await build();

    expect(memory.globalBackground).not.toHaveProperty('knowledgeStateSummary');
  });
});
