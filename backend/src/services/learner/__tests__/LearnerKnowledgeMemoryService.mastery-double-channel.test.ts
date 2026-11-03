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
import { conceptRegistryService } from '../concept-registry.service';

const prisma = require('../../../config/database').default as {
  learning_paths: { findUnique: jest.Mock; findMany: jest.Mock };
  teaching_sessions: { findMany: jest.Mock };
  learner_evidence: { findMany: jest.Mock };
  memory_traces: { findMany: jest.Mock };
  concept_aliases: { findUnique: jest.Mock };
  concepts: { findUnique: jest.Mock };
};

beforeEach(() => {
  conceptRegistryService.clearCache();
});

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

/** 指定 id 与业务结束时间的会话（用于跨会话「最近一条说了算」门控）。 */
function sessionAt(id: string, endTime: Date, knowledgeState: Array<{ name: string; status: string; progress: number }>) {
  return {
    id, taskId: 't1', milestoneId: 'm1', status: 'completed',
    knowledgeState: JSON.stringify(knowledgeState),
    wrapup: null, endTime, updatedAt: endTime,
  };
}

async function build(sessions: Array<Record<string, unknown>>, aliasByNorm: Record<string, string> = {}) {
  prisma.learning_paths.findUnique.mockResolvedValue(pathWith([taskWith('t1')]));
  prisma.teaching_sessions.findMany.mockResolvedValue(sessions);
  prisma.learner_evidence.findMany.mockResolvedValue([]);
  prisma.memory_traces.findMany.mockResolvedValue([]);
  prisma.concept_aliases.findUnique.mockImplementation(({ where }: { where?: { userId_aliasNorm?: { aliasNorm?: string } } } = {}) => {
    const norm = where?.userId_aliasNorm?.aliasNorm;
    return Promise.resolve(norm && aliasByNorm[norm] ? { conceptId: aliasByNorm[norm] } : null);
  });
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

  it('摘要独有概念（幽灵）不对外暴露 state，也不入任何掌握名单', async () => {
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
    // 复核补修：幽灵概念不再以 masteryScore=0/status=pending 的形态对外暴露
    expect(stateOf(memory, '长除法')).toBeUndefined();
    expect(memory.currentPath?.conceptStates.some((c) => c.label === '长除法')).toBe(false);
    // 看板概念照常取结构化信号
    expect(stateOf(memory, '闭包')?.masteryScore).toBeCloseTo(0.6, 5);
    const g = memory.globalSignals;
    expect(g.masteredConcepts).not.toContain('长除法');
    expect(g.fragileConcepts).not.toContain('长除法');
    expect(g.strugglingConcepts).not.toContain('长除法');
  });

  it('幽灵名不再经 currentPath.recentEvidence[].conceptKeys 漏出', async () => {
    const memory = await build([
      {
        // 归属当前路径（learningPathId=p1），否则路径级 recentEvidence 恒空
        id: 's1', learningPathId: 'p1', taskId: 't1', milestoneId: 'm1', status: 'completed',
        knowledgeState: JSON.stringify([{ name: '闭包', status: 'learning', progress: 60 }]),
        wrapup: JSON.stringify({
          status: 'ok',
          sources: { summary: 'llm', evaluation: 'llm' },
          summary: { knowledgeItems: [{ name: '长除法', status: 'learning', progress: 80 }] },
        }),
        endTime: END, updatedAt: END,
      },
    ]);
    const allKeys = (memory.currentPath?.recentEvidence ?? []).flatMap((e) => e.conceptKeys);
    // 摘要证据条目仍保留，但其中的幽灵概念名被剔除
    expect(allKeys).not.toContain('长除法');
    expect(allKeys).toContain('闭包');
  });

  it('任务级 confidence 不把幽灵概念计入（偏差不再由抬高变压低）', async () => {
    const memory = await build([
      sessionWith(
        [{ name: '闭包', status: 'learning', progress: 60 }],
        {
          status: 'ok',
          sources: { summary: 'llm', evaluation: 'llm' },
          summary: { knowledgeItems: [{ name: '长除法', status: 'learning', progress: 0 }] },
        }
      ),
    ]);
    // 任务的唯一真实概念是「闭包」(0.6)；幽灵 masteryScore=0 若计入会把 confidence 压到 0.3
    const task = memory.currentPath?.taskMastery.find((t) => t.taskId === 't1');
    expect(task).toBeDefined();
    expect(task!.confidence).toBeCloseTo(0.6, 5);
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
    // 改写项是只来自摘要的幽灵概念，不对外暴露、不入掌握名单
    expect(stateOf(memory, '闭包的捕获')).toBeUndefined();
    expect(memory.globalSignals.masteredConcepts).not.toContain('闭包的捕获');
  });

  it('去重提到概念身份层：看板与摘要名字不同但同一 conceptId 时只计一次', async () => {
    const memory = await build(
      [
        // 会话 1：看板记「闭包」(0.6)，摘要用别名「闭包的捕获」重复记一次掌握(1.0)
        sessionWith(
          [{ name: '闭包', status: 'learning', progress: 60 }],
          {
            status: 'ok',
            sources: { summary: 'llm', evaluation: 'llm' },
            summary: { knowledgeItems: [{ name: '闭包的捕获', status: 'mastered', progress: 100 }] },
          }
        ),
        // 会话 2：另一课把「闭包的捕获」作为看板概念 (0.2)——它是结构化证据，不是幽灵
        {
          id: 's2', taskId: 't1', milestoneId: 'm1', status: 'completed',
          knowledgeState: JSON.stringify([{ name: '闭包的捕获', status: 'learning', progress: 20 }]),
          wrapup: null, endTime: END, updatedAt: END,
        },
      ],
      { 闭包: 'kc-closure', 闭包的捕获: 'kc-closure' }
    );
    // 会话 1 的摘要别名项被身份级去重跳过 →「闭包的捕获」只剩会话 2 的结构化 0.2
    expect(stateOf(memory, '闭包的捕获')?.masteryScore).toBeCloseTo(0.2, 5);
  });

  it('跨会话去等权：masteryScore 取业务时间最新的证据（与 status 同源），不再等权平均', async () => {
    const T1 = new Date('2026-10-01T00:00:00.000Z');
    const T2 = new Date('2026-10-20T00:00:00.000Z');
    const memory = await build([
      sessionAt('s-old', T1, [{ name: '闭包', status: 'learning', progress: 40 }]),
      sessionAt('s-new', T2, [{ name: '闭包', status: 'mastered', progress: 100 }]),
    ]);
    const state = stateOf(memory, '闭包');
    // 旧口径（等权均值）会得 0.7；本次取最新会话的业务时间证据
    expect(state?.masteryScore).toBeCloseTo(1, 5);
    expect(state?.status).toBe('mastered');
  });

  it('跨会话去等权不是「取最大值」：最新证据为低分时取低分', async () => {
    const T1 = new Date('2026-10-01T00:00:00.000Z');
    const T2 = new Date('2026-10-20T00:00:00.000Z');
    const memory = await build([
      sessionAt('s-old', T1, [{ name: '闭包', status: 'mastered', progress: 100 }]),
      sessionAt('s-new', T2, [{ name: '闭包', status: 'learning', progress: 40 }]),
    ]);
    const state = stateOf(memory, '闭包');
    expect(state?.masteryScore).toBeCloseTo(0.4, 5);
    expect(state?.status).toBe('learning');
  });
});
