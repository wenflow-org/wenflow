/**
 * #195：同一「学生掌握」语义经两条通道进入同一 mastery 均值（一课双计 + 幽灵概念）。
 *
 * 1) 同名一课双计：session.knowledgeState（结构化看板）与 wrapup.summary.knowledgeItems
 *    （LLM 摘要）同名概念此前各推一条信号、等权落进同一 mastery 均值。修复后同一课同一概念
 *    只保留结构化信号。
 * 2) 幽灵概念：仅由摘要（derived）支撑、无任何结构化/痕迹证据的概念不进掌握均值。
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

function taskWith(id: string) {
  return {
    id, order: 1, title: '任务', status: 'completed', linkedConceptName: null,
    coreConcept: null, displayLabel: null, learningObjectives: null,
    completedAt: END, updatedAt: END,
  };
}

function sessionWith(knowledgeState: Array<{ name: string; status: string; progress: number }>, wrapup: unknown) {
  return {
    id: 's1', taskId: 't1', milestoneId: 'm1', status: 'completed',
    knowledgeState: JSON.stringify(knowledgeState),
    wrapup: wrapup === null ? null : JSON.stringify(wrapup),
    endTime: END, updatedAt: END,
  };
}

async function build(sessions: Array<Record<string, unknown>>) {
  prisma.learning_paths.findUnique.mockResolvedValue(pathWith([taskWith('t1')]));
  prisma.teaching_sessions.findMany.mockResolvedValue(sessions);
  prisma.learner_evidence.findMany.mockResolvedValue([]);
  prisma.memory_traces.findMany.mockResolvedValue([]);
  prisma.concept_aliases.findUnique.mockResolvedValue(null);
  prisma.concepts.findUnique.mockResolvedValue(null);
  return learnerKnowledgeMemoryService.build({ userId: 'u1', learningPathId: 'p1', taskId: 't1' });
}

type Memory = Awaited<ReturnType<typeof learnerKnowledgeMemoryService.build>>;

const stateOf = (memory: Memory, conceptKey: string) =>
  memory.currentPath?.conceptStates.find((c) => c.conceptKey === conceptKey);

describe('#195：同一课同一概念不双计', () => {
  it('结构化看板 progress=40 与可靠摘要同名 progress=100 → 均值取结构化 0.4（原为 0.7）', async () => {
    const memory = await build([
      sessionWith(
        [{ name: '驱动问题构造', status: 'learning', progress: 40 }],
        {
          status: 'ok',
          sources: { summary: 'llm', evaluation: 'llm' },
          summary: { knowledgeItems: [{ name: '驱动问题构造', status: 'mastered', progress: 100 }] },
        }
      ),
    ]);
    const state = stateOf(memory, '驱动问题构造');
    expect(state).toBeDefined();
    expect(state!.masteryScore).toBeCloseTo(0.4, 5);
  });

  it('摘要独有概念（幽灵）不进掌握均值：masteryScore=0 / status=pending / sourceType=derived，且不入任何掌握名单', async () => {
    const memory = await build([
      sessionWith(
        [{ name: '闭包', status: 'learning', progress: 60 }],
        {
          status: 'ok',
          sources: { summary: 'llm', evaluation: 'llm' },
          summary: { knowledgeItems: [{ name: '长除法', status: 'learning', progress: 80 }] },
        }
      ),
    ]);
    const ghost = stateOf(memory, '长除法');
    expect(ghost).toBeDefined();
    expect(ghost!.masteryScore).toBe(0);
    expect(ghost!.status).toBe('pending');
    expect(ghost!.sourceType).toBe('derived');
    // 看板概念照常取结构化信号
    expect(stateOf(memory, '闭包')?.masteryScore).toBeCloseTo(0.6, 5);
    const g = memory.globalSignals;
    expect(g.masteredConcepts).not.toContain('长除法');
    expect(g.fragileConcepts).not.toContain('长除法');
    expect(g.strugglingConcepts).not.toContain('长除法');
  });

  it('摘要改写了看板概念名（名字键去重失配）时仍不双计均值——改写项按幽灵排除', async () => {
    const memory = await build([
      sessionWith(
        [{ name: '闭包', status: 'learning', progress: 40 }],
        {
          status: 'ok',
          sources: { summary: 'llm', evaluation: 'llm' },
          // 模型把「闭包」改写成「闭包的捕获」——名字键去重命中不了
          summary: { knowledgeItems: [{ name: '闭包的捕获', status: 'mastered', progress: 100 }] },
        }
      ),
    ]);
    // 看板概念不被改写项拉高
    expect(stateOf(memory, '闭包')?.masteryScore).toBeCloseTo(0.4, 5);
    // 改写项是只来自摘要的幽灵概念，不进均值、不入掌握名单
    expect(stateOf(memory, '闭包的捕获')?.masteryScore).toBe(0);
    expect(memory.globalSignals.masteredConcepts).not.toContain('闭包的捕获');
  });
});
