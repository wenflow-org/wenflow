/**
 * 概念身份（canonical conceptId）在读侧的携带与补齐（KC 概念身份改造 · S2）
 *
 * 背景：`concept_edges` / `memory_traces.conceptId` 等已写入侧双写，但读侧若仍按自由文本
 * 聚合，则"计划↔痕迹"永远 join 不起来（实测贯通率仅 ~6%）。本测试锁定读侧两件事：
 * 1. 痕迹自带的 conceptId 必须被带到 `conceptStates`（不丢）；
 * 2. 不含痕迹的来源（会话知识/摘要/任务标签）经注册表**只读**补齐——`createIfMissing:false`，
 *    读侧绝不创建概念；解析失败留 undefined（读侧各处"conceptId 优先，空则回落 conceptKey"）。
 */
jest.mock('../../../config/database', () => ({
  __esModule: true,
  default: {
    learning_paths: { findUnique: jest.fn(), findFirst: jest.fn() },
    teaching_sessions: { findMany: jest.fn() },
    learner_evidence: { findMany: jest.fn() },
    memory_traces: { findMany: jest.fn() },
    concept_aliases: { findUnique: jest.fn() },
    concepts: { findUnique: jest.fn(), create: jest.fn() },
  },
}));

import { learnerKnowledgeMemoryService } from '../LearnerKnowledgeMemoryService';
import { conceptRegistryService } from '../concept-registry.service';

const prisma = require('../../../config/database').default as {
  learning_paths: { findUnique: jest.Mock };
  teaching_sessions: { findMany: jest.Mock };
  learner_evidence: { findMany: jest.Mock };
  memory_traces: { findMany: jest.Mock };
  concept_aliases: { findUnique: jest.Mock };
  concepts: { create: jest.Mock };
};

const path = {
  id: 'p1',
  userId: 'u1',
  title: '路径',
  name: '路径',
  status: 'active',
  milestones: [
    {
      id: 'm1',
      stageNumber: 1,
      title: '阶段',
      goal: null,
      status: 'active',
      subtasks: [
        { id: 't1', order: 1, title: '任务一', status: 'todo', linkedConceptName: '会话概念', coreConcept: null, displayLabel: null, learningObjectives: null, knowledgeType: null, cognitiveLevel: null },
      ],
    },
  ],
};

describe('概念身份在读侧的携带与补齐', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    conceptRegistryService.clearCache();
    prisma.learning_paths.findUnique.mockResolvedValue(path);
    prisma.learner_evidence.findMany.mockResolvedValue([]);
  });

  it('痕迹自带的 conceptId 被带到 conceptStates', async () => {
    prisma.teaching_sessions.findMany.mockResolvedValue([]);
    prisma.memory_traces.findMany.mockResolvedValue([
      { conceptKey: '识别半联动点', label: null, conceptId: 'cpt_abc', masteryScore: 0.9, stability: 'stable', intervalFactor: 1, lastSeenAt: new Date('2026-09-05T00:00:00.000Z') },
    ]);

    const memory = await learnerKnowledgeMemoryService.build({ userId: 'u1', learningPathId: 'p1' });
    const states = memory.currentPath?.conceptStates ?? [];
    const state = states.find((c) => c.conceptKey === '识别半联动点');
    expect(state?.conceptId).toBe('cpt_abc');
  });

  it('无痕迹的来源经注册表只读补齐，且不创建概念', async () => {
    prisma.teaching_sessions.findMany.mockResolvedValue([]);
    prisma.memory_traces.findMany.mockResolvedValue([]);
    // 注册表：该别名已存在 → 直接命中（读侧 createIfMissing:false，不该走到 create）
    prisma.concept_aliases.findUnique.mockResolvedValue({ conceptId: 'cpt_from_registry' });

    const memory = await learnerKnowledgeMemoryService.build({ userId: 'u1', learningPathId: 'p1' });
    const states = memory.currentPath?.conceptStates ?? [];
    expect(states.length).toBeGreaterThan(0);
    expect(states.every((c) => c.conceptId === 'cpt_from_registry')).toBe(true);
    expect(prisma.concepts.create).not.toHaveBeenCalled();
  });

  it('注册表未命中时留 undefined（不编造身份，不抛错）', async () => {
    prisma.teaching_sessions.findMany.mockResolvedValue([]);
    prisma.memory_traces.findMany.mockResolvedValue([]);
    prisma.concept_aliases.findUnique.mockResolvedValue(null);

    const memory = await learnerKnowledgeMemoryService.build({ userId: 'u1', learningPathId: 'p1' });
    const states = memory.currentPath?.conceptStates ?? [];
    expect(states.length).toBeGreaterThan(0);
    expect(states.every((c) => c.conceptId === undefined)).toBe(true);
    expect(prisma.concepts.create).not.toHaveBeenCalled();
  });
});
