/**
 * 前置缺口（L3 · S4b）：缺口 = **当前任务的上游前置**里未掌握的那些。
 *
 * 旧口径的语义是错的——它算的是"当前概念**自己**没掌握"，而"前置缺口"应当指
 * "要学当前任务，但它的上游前置还没掌握"。本测试锁定新口径，并锁死**图缺失时回落旧口径**
 * （未回填路径必须与改造前逐字一致，否则不可灰度/回滚）。
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
jest.mock('../concept-graph.service', () => ({
  conceptGraphService: { upstreamClosure: jest.fn() },
}));

import { learnerKnowledgeMemoryService } from '../LearnerKnowledgeMemoryService';
import { conceptRegistryService } from '../concept-registry.service';
import { conceptGraphService } from '../concept-graph.service';

const prisma = require('../../../config/database').default as {
  learning_paths: { findUnique: jest.Mock };
  teaching_sessions: { findMany: jest.Mock };
  learner_evidence: { findMany: jest.Mock };
  memory_traces: { findMany: jest.Mock };
  concept_aliases: { findUnique: jest.Mock };
  concepts: { create: jest.Mock };
};
const upstreamClosure = conceptGraphService.upstreamClosure as jest.Mock;

/** 当前任务已带 canonical（S1 写入点），且概念名与痕迹对得上 */
const path = {
  id: 'p1', userId: 'u1', title: '路径', name: '路径', status: 'active',
  milestones: [{
    id: 'm1', stageNumber: 1, title: '阶段', goal: null, status: 'active',
    subtasks: [{
      id: 't1', order: 1, title: '任务一', status: 'todo',
      linkedConceptName: '汇总口径映射', coreConcept: null, displayLabel: null,
      learningObjectives: null, knowledgeType: null, cognitiveLevel: null,
      conceptId: 'cpt_current',
    }],
  }],
};

describe('前置缺口 = 上游未掌握（S4b）', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    conceptRegistryService.clearCache();
    prisma.learning_paths.findUnique.mockResolvedValue(path);
    prisma.learner_evidence.findMany.mockResolvedValue([]);
    prisma.teaching_sessions.findMany.mockResolvedValue([]);
    prisma.concept_aliases.findUnique.mockResolvedValue(null);
  });

  it('上游前置未掌握 → 进缺口；深度 1 判 high，深度 2 判 medium', async () => {
    // 上游：一跳"分组键唯一性"（脆弱）、两跳"数据结构基础"（未见过）
    upstreamClosure.mockResolvedValue([
      { conceptId: 'cpt_p1', depth: 1, label: '分组键唯一性' },
      { conceptId: 'cpt_p2', depth: 2, label: '数据结构基础' },
    ]);
    prisma.memory_traces.findMany.mockResolvedValue([
      // 当前任务自己的概念（已掌握）——旧口径会漏掉它、也不该算作缺口
      { conceptKey: '汇总口径映射', label: null, conceptId: 'cpt_current', masteryScore: 0.9, stability: 'stable', intervalFactor: 1, lastSeenAt: new Date('2026-09-05T00:00:00.000Z') },
      // 一跳前置：脆弱
      { conceptKey: '分组键唯一性', label: null, conceptId: 'cpt_p1', masteryScore: 0.4, stability: 'fragile', intervalFactor: 1, lastSeenAt: new Date('2026-09-05T00:00:00.000Z') },
    ]);

    const memory = await learnerKnowledgeMemoryService.build({ userId: 'u1', learningPathId: 'p1', taskId: 't1' });
    const gaps = memory.currentPath?.prerequisiteGaps ?? [];
    const byKey = Object.fromEntries(gaps.map((g) => [g.label, g.severity]));

    expect(upstreamClosure).toHaveBeenCalledWith('u1', 'cpt_current', expect.objectContaining({ maxDepth: 2 }));
    expect(byKey['分组键唯一性']).toBe('high');   // 一跳 = 直接阻塞
    expect(byKey['数据结构基础']).toBe('medium'); // 两跳 = 间接
    // 已掌握的一跳（若有）不该进；当前概念自己不该被当成"缺口"
    expect(gaps.some((g) => g.label === '汇总口径映射')).toBe(false);
  });

  it('上游全部已掌握 → 不进缺口（回落旧口径也无缺口，因为当前概念已掌握）', async () => {
    upstreamClosure.mockResolvedValue([{ conceptId: 'cpt_p1', depth: 1, label: '分组键唯一性' }]);
    prisma.memory_traces.findMany.mockResolvedValue([
      { conceptKey: '汇总口径映射', label: null, conceptId: 'cpt_current', masteryScore: 0.9, stability: 'stable', intervalFactor: 1, lastSeenAt: new Date('2026-09-05T00:00:00.000Z') },
      { conceptKey: '分组键唯一性', label: null, conceptId: 'cpt_p1', masteryScore: 0.9, stability: 'stable', intervalFactor: 1, lastSeenAt: new Date('2026-09-05T00:00:00.000Z') },
    ]);

    const memory = await learnerKnowledgeMemoryService.build({ userId: 'u1', learningPathId: 'p1', taskId: 't1' });
    expect(memory.currentPath?.prerequisiteGaps ?? []).toEqual([]);
  });

  it('图缺失（上游闭包为空）→ 回落旧口径（当前概念自己没掌握即算缺口）', async () => {
    upstreamClosure.mockResolvedValue([]);
    prisma.memory_traces.findMany.mockResolvedValue([
      { conceptKey: '汇总口径映射', label: null, conceptId: 'cpt_current', masteryScore: 0.3, stability: 'fragile', intervalFactor: 1, lastSeenAt: new Date('2026-09-05T00:00:00.000Z') },
    ]);

    const memory = await learnerKnowledgeMemoryService.build({ userId: 'u1', learningPathId: 'p1', taskId: 't1' });
    const gaps = memory.currentPath?.prerequisiteGaps ?? [];
    expect(gaps.length).toBe(1);
    expect(gaps[0].label).toBe('汇总口径映射');
    expect(gaps[0].severity).toBe('high');
  });

  it('上游查询抛错 → 回落旧口径，不阻断画像构建', async () => {
    upstreamClosure.mockRejectedValue(new Error('graph unavailable'));
    prisma.memory_traces.findMany.mockResolvedValue([
      { conceptKey: '汇总口径映射', label: null, conceptId: 'cpt_current', masteryScore: 0.3, stability: 'fragile', intervalFactor: 1, lastSeenAt: new Date('2026-09-05T00:00:00.000Z') },
    ]);

    const memory = await learnerKnowledgeMemoryService.build({ userId: 'u1', learningPathId: 'p1', taskId: 't1' });
    expect((memory.currentPath?.prerequisiteGaps ?? []).length).toBe(1);
  });

  // 2026-09-29：图缺失回落时，`!concept`（概念从未见过）曾被算成缺口。
  // 后果是新任务一开局就自带 4 条"前置缺口" → 上层 structuralRisk 恒真 →
  // 全库 242 条结课投影 242 条恒报 priority=high + resequence（同一条 rationale）。
  // 新知识点没有任何负面证据，不构成缺口。
  it('图缺失 + 概念从未见过 → 不算缺口（新知识点的正常开局）', async () => {
    upstreamClosure.mockResolvedValue([]);
    // 当前任务的概念在 conceptStates 里完全没有记录
    prisma.memory_traces.findMany.mockResolvedValue([]);

    const memory = await learnerKnowledgeMemoryService.build({ userId: 'u1', learningPathId: 'p1', taskId: 't1' });
    expect(memory.currentPath?.prerequisiteGaps ?? []).toEqual([]);
  });

  it('图缺失 + 部分新概念部分脆弱 → 只把有负面证据的那条算缺口', async () => {
    upstreamClosure.mockResolvedValue([]);
    prisma.memory_traces.findMany.mockResolvedValue([
      // 仅"汇总口径映射"有负面证据（fragile）；"未见过的新概念"来自 learningObjectives，无 memory_traces
      { conceptKey: '汇总口径映射', label: null, conceptId: 'cpt_current', masteryScore: 0.3, stability: 'fragile', intervalFactor: 1, lastSeenAt: new Date('2026-09-05T00:00:00.000Z') },
    ]);

    const memory = await learnerKnowledgeMemoryService.build({ userId: 'u1', learningPathId: 'p1', taskId: 't1' });
    const gaps = memory.currentPath?.prerequisiteGaps ?? [];
    expect(gaps.length).toBe(1);
    expect(gaps[0].label).toBe('汇总口径映射');
  });
});
