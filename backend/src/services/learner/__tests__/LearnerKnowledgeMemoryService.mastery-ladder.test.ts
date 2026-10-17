/**
 * 掌握阶梯的信号口径（2026-10-15 P0-2 · F1/F2）
 *
 * 此前 conceptStates 把「任务标签」当学习证据同权平均：task-label 信号对**全路径所有任务**
 * （含 todo）推 0.45/0.25/0.1 分值 → "被后续未开课任务再提一次"就能把从未教过的概念拉破
 * 0.55 落进 struggling；DISPLAY_LABEL_MAP 兜底文案（「理解核心原理」）与克隆源路径的占位 id
 * （concept-4）也会以概念身份落进 fragile/struggling 并被 advisory 正文原样打印
 * （实测 52 条 advisory 里 40 条正文含兜底词）。修复后：
 *   F1 掌握判定只认真实接触证据（会话知识/摘要/痕迹），只有标签信号的概念 = pending；
 *   F2 兜底 displayLabel 与 concept-N 占位键不进概念集合。
 * 断言口径：对外投影只有 globalSignals 三张名单 + globalBackground.conceptLedger（familiarity:
 * mastered→stable / review→understood / learning→practiced / pending→seen）。
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
  learning_paths: { findUnique: jest.Mock; findMany: jest.Mock };
  teaching_sessions: { findMany: jest.Mock };
  learner_evidence: { findMany: jest.Mock };
  memory_traces: { findMany: jest.Mock };
  concept_aliases: { findUnique: jest.Mock };
  concepts: { findUnique: jest.Mock };
};

const END = new Date('2026-10-10T00:00:00.000Z');

function pathWith(tasks: Array<Record<string, unknown>>) {
  return {
    id: 'p1', userId: 'u1', title: '路径', name: '路径', status: 'active',
    milestones: [{ id: 'm1', stageNumber: 1, title: '阶段', goal: null, status: 'active', subtasks: tasks }],
  };
}

function sessionWith(knowledgeState: Array<{ name: string; status: string; progress: number }>) {
  return {
    id: 's1', taskId: 't1', milestoneId: 'm1', status: 'completed',
    knowledgeState: JSON.stringify(knowledgeState),
    wrapup: null, endTime: END, updatedAt: END,
  };
}

async function build(tasks: Array<Record<string, unknown>>, sessions: Array<Record<string, unknown>> = []) {
  prisma.learning_paths.findUnique.mockResolvedValue(pathWith(tasks));
  prisma.teaching_sessions.findMany.mockResolvedValue(sessions);
  prisma.learner_evidence.findMany.mockResolvedValue([]);
  prisma.memory_traces.findMany.mockResolvedValue([]);
  prisma.concept_aliases.findUnique.mockResolvedValue(null);
  prisma.concepts.findUnique.mockResolvedValue(null);
  return learnerKnowledgeMemoryService.build({ userId: 'u1', learningPathId: 'p1', taskId: 't1' });
}

type Memory = Awaited<ReturnType<typeof learnerKnowledgeMemoryService.build>>;

const lists = (memory: Memory) => {
  const g = memory.globalSignals;
  const ledgerFamiliarity = (label: string) =>
    memory.globalBackground.conceptLedger.find((c) => c.label === label)?.familiarity ?? null;
  return {
    fragile: g.fragileConcepts,
    struggling: g.strugglingConcepts,
    mastered: g.masteredConcepts,
    ledgerFamiliarity,
  };
};

describe('F1：任务标签不是学习证据（只有标签信号的概念 = pending）', () => {
  it('概念被 1 个已完成任务 + 6 个 todo 任务的标签引用 → 不落 struggling（旧口径均分 0.11 必落）', async () => {
    const memory = await build([
      { id: 't-done', order: 1, title: '已完成任务', status: 'completed', linkedConceptName: '评审要素对齐', coreConcept: null, displayLabel: '理解核心原理', learningObjectives: null, completedAt: END, updatedAt: END },
      ...[2, 3, 4, 5, 6, 7].map((i) => ({
        id: `t-todo-${i}`, order: i, title: `待办任务${i}`, status: 'todo',
        linkedConceptName: '评审要素对齐', coreConcept: null, displayLabel: null,
        learningObjectives: null, updatedAt: END,
      })),
    ]);
    const { struggling, fragile, ledgerFamiliarity } = lists(memory);
    expect(struggling).not.toContain('评审要素对齐');
    expect(fragile).not.toContain('评审要素对齐');
    expect(ledgerFamiliarity('评审要素对齐')).toBe('seen');
  });

  it('有真实接触证据（会话知识 review）→ 仍 fragile/understood（标签不再稀释判定）', async () => {
    const memory = await build(
      [
        { id: 't-done', order: 1, title: '已完成任务', status: 'completed', linkedConceptName: '驱动问题构造', coreConcept: null, displayLabel: null, learningObjectives: null, completedAt: END, updatedAt: END },
        { id: 't-todo', order: 2, title: '待办任务', status: 'todo', linkedConceptName: '驱动问题构造', coreConcept: null, displayLabel: null, learningObjectives: null, updatedAt: END },
      ],
      [sessionWith([{ name: '驱动问题构造', status: 'review', progress: 40 }])]
    );
    const { fragile, ledgerFamiliarity } = lists(memory);
    expect(fragile).toContain('驱动问题构造');
    expect(ledgerFamiliarity('驱动问题构造')).toBe('understood');
  });

  it('会话知识 mastered → 进 masteredConcepts，不被后续任务标签否决', async () => {
    const memory = await build(
      [
        { id: 't-done', order: 1, title: '已完成任务', status: 'completed', linkedConceptName: '四部件框架', coreConcept: null, displayLabel: null, learningObjectives: null, completedAt: END, updatedAt: END },
        { id: 't-todo', order: 2, title: '待办任务', status: 'todo', linkedConceptName: '四部件框架', coreConcept: null, displayLabel: null, learningObjectives: null, updatedAt: END },
      ],
      [sessionWith([{ name: '四部件框架', status: 'mastered', progress: 90 }])]
    );
    const { mastered, ledgerFamiliarity } = lists(memory);
    expect(mastered).toContain('四部件框架');
    expect(ledgerFamiliarity('四部件框架')).toBe('stable');
  });
});

describe('F2：兜底文案与占位 id 不是概念', () => {
  it('displayLabel（理解核心原理）不进任何概念名单', async () => {
    const memory = await build([
      { id: 't1', order: 1, title: '任务一', status: 'completed', linkedConceptName: null, coreConcept: null, displayLabel: '理解核心原理', learningObjectives: null, completedAt: END, updatedAt: END },
      { id: 't2', order: 2, title: '任务二', status: 'todo', linkedConceptName: null, coreConcept: null, displayLabel: '深入分析原理', learningObjectives: null, updatedAt: END },
    ]);
    const { fragile, struggling, mastered, ledgerFamiliarity } = lists(memory);
    for (const junk of ['理解核心原理', '深入分析原理']) {
      expect(fragile).not.toContain(junk);
      expect(struggling).not.toContain(junk);
      expect(mastered).not.toContain(junk);
      expect(ledgerFamiliarity(junk)).toBeNull();
    }
  });

  it('克隆源路径的占位 coreConcept（concept-N）不进概念集合', async () => {
    const memory = await build([
      { id: 't1', order: 1, title: '任务一', status: 'completed', linkedConceptName: null, coreConcept: 'concept-4', displayLabel: null, learningObjectives: null, completedAt: END, updatedAt: END },
      { id: 't2', order: 2, title: '任务二', status: 'todo', linkedConceptName: null, coreConcept: 'concept-4', displayLabel: null, learningObjectives: null, updatedAt: END },
    ]);
    const { fragile, struggling, ledgerFamiliarity } = lists(memory);
    expect(ledgerFamiliarity('concept-4')).toBeNull();
    expect(fragile).not.toContain('concept-4');
    expect(struggling).not.toContain('concept-4');
  });
});
