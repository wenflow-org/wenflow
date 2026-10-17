/**
 * fragile 证据门（#59 P-34 / #60 P-35 第 1、3 条）。
 *
 * 旧判定 `stability==='fragile' || masteryScore<0.5 || intervalFactor>4` 把「刚学一半」
 * 与「真卡住」混成同一名单；KT 幽灵痕（applyKtEstimate 创建、extractionCount=0、
 * masteryScore 被写成 0.3）更是让从未提取过的概念直接进 fragile，反过来焊死难度升档。
 *
 * 现口径：
 * ① KT 幽灵痕不参与掌握判定（不是学习证据）；
 * ② 低分只有在「提取次数 ≥3 且已过 7 天遗忘窗口」时才算脆弱；
 * ③ FSRS 标记 fragile / 间隔因子 >4 仍然直接算脆弱（真实到期证据）。
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

const NOW = Date.now();
const DAY = 86400000;

function trace(overrides: Record<string, unknown>) {
  return {
    conceptKey: '占位',
    label: '占位',
    conceptId: null,
    masteryScore: 0.5,
    stability: 'developing',
    intervalFactor: 1,
    extractionCount: 0,
    source: 'derived',
    lastSeenAt: null,
    ...overrides,
  };
}

function path() {
  return {
    id: 'p1', userId: 'u1', title: '路径', name: '路径', status: 'active',
    milestones: [{ id: 'm1', stageNumber: 1, title: '阶段', goal: null, status: 'active', subtasks: [] }],
  };
}

async function build(traces: Array<Record<string, unknown>>) {
  prisma.learning_paths.findUnique.mockResolvedValue(path());
  prisma.teaching_sessions.findMany.mockResolvedValue([]);
  prisma.learner_evidence.findMany.mockResolvedValue([]);
  prisma.memory_traces.findMany.mockResolvedValue(traces);
  prisma.concept_aliases.findUnique.mockResolvedValue(null);
  prisma.concepts.findUnique.mockResolvedValue(null);
  return learnerKnowledgeMemoryService.build({ userId: 'u1', learningPathId: 'p1' });
}

describe('LearnerKnowledgeMemoryService · fragile 证据门（#59/#60）', () => {
  it('KT 幽灵痕不进掌握判定（即使 masteryScore=0.3）', async () => {
    const memory = await build([
      trace({ conceptKey: '幽灵点', label: '幽灵点', source: 'kt-estimate', extractionCount: 0, masteryScore: 0.3 }),
    ]);
    expect(memory.globalSignals.fragileConcepts).not.toContain('幽灵点');
    expect(memory.currentPath?.conceptStates.find((c) => c.conceptKey === '幽灵点')).toBeUndefined();
  });

  it('低分只有在「≥3 次提取 + 过 7 天遗忘窗口」时才算脆弱', async () => {
    const memory = await build([
      trace({ conceptKey: '久未提取', label: '久未提取', masteryScore: 0.4, extractionCount: 5, lastSeenAt: new Date(NOW - 10 * DAY) }),
      trace({ conceptKey: '刚学一半', label: '刚学一半', masteryScore: 0.4, extractionCount: 1, lastSeenAt: new Date(NOW - 10 * DAY) }),
      trace({ conceptKey: '近期提取', label: '近期提取', masteryScore: 0.4, extractionCount: 5, lastSeenAt: new Date(NOW - 1 * DAY) }),
    ]);
    expect(memory.globalSignals.fragileConcepts).toContain('久未提取');
    expect(memory.globalSignals.fragileConcepts).not.toContain('刚学一半');
    expect(memory.globalSignals.fragileConcepts).not.toContain('近期提取');
  });

  it('FSRS fragile / 间隔因子 >4 仍然直接算脆弱（真实到期证据）', async () => {
    const memory = await build([
      trace({ conceptKey: 'FSRS脆弱', label: 'FSRS脆弱', stability: 'fragile', masteryScore: 0.6 }),
      trace({ conceptKey: '已到期', label: '已到期', intervalFactor: 5, masteryScore: 0.9 }),
    ]);
    expect(memory.globalSignals.fragileConcepts).toContain('FSRS脆弱');
    expect(memory.globalSignals.fragileConcepts).toContain('已到期');
  });
});

describe('LearnerKnowledgeMemoryService · 机器 slug 过滤（#59/#60 第 4 条）', () => {
  it('下划线/连字符 slug 与命名空间键不进概念集合；带空格的英文名仍保留', async () => {
    const memory = await build([
      trace({ conceptKey: 'rubric_document_alignment', label: 'rubric_document_alignment', masteryScore: 0.2, stability: 'fragile' }),
      trace({ conceptKey: 'reliability_vs_validity', label: 'reliability_vs_validity', masteryScore: 0.2, stability: 'fragile' }),
      trace({ conceptKey: 'intrinsic-vs-extrinsic-motivation', label: 'intrinsic-vs-extrinsic-motivation', masteryScore: 0.2, stability: 'fragile' }),
      trace({ conceptKey: 'skill:teaching-turn', label: 'skill:teaching-turn', masteryScore: 0.2, stability: 'fragile' }),
      trace({ conceptKey: 'supply and demand', label: 'supply and demand', masteryScore: 0.9, stability: 'stable' }),
    ]);
    const keys = (memory.currentPath?.conceptStates ?? []).map((c) => c.conceptKey);
    expect(keys).not.toContain('rubric_document_alignment');
    expect(keys).not.toContain('reliability_vs_validity');
    expect(keys).not.toContain('intrinsic-vs-extrinsic-motivation');
    expect(keys).not.toContain('skill:teaching-turn');
    expect(keys).toContain('supply and demand');
    expect(memory.globalSignals.fragileConcepts).toEqual([]);
  });
});
