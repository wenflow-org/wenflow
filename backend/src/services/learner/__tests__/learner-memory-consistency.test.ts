/**
 * #172-2 + #172-3 画像台账「双源矛盾 + 伪造计数」回归测试
 *
 * #172-2：familiarity 旧口径由 concept.status 派生（review→understood），misconceptionRisk
 *         由 concept.stability 派生（fragile→high），两个独立源、无一致性过滤 → 同一行可以同时
 *         「已理解」且「高误解风险」（issue 实测 136 条投影里 116 条）。
 *         修复：familiarity 改由单一 stability 派生，review/fragile 落 practiced；
 *         并在 globalBackground 名单组装处过滤「已 mastered 却出现在 fragile/blocked」的项。
 * #172-3：`count: struggleCountByKey.get(label) || 1` 把只出现一次（甚至 0 次）的困惑信号
 *         兜底成 1，凭空造出一条 recurring 行。修复：仅 count >= 2 才生成，不再兜底填 1。
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
  learning_paths: { findUnique: jest.Mock; findFirst: jest.Mock; findMany: jest.Mock };
  teaching_sessions: { findMany: jest.Mock };
  learner_evidence: { findMany: jest.Mock };
  memory_traces: { findMany: jest.Mock };
  concept_aliases: { findUnique: jest.Mock };
  concepts: { findUnique: jest.Mock; create: jest.Mock };
};

const LABEL = '驱动问题构造';
const END = new Date('2026-10-10T00:00:00.000Z');
const LATER = new Date('2026-10-20T00:00:00.000Z');

function makePath() {
  return {
    id: 'p1', userId: 'u1', title: '路径', name: '路径', status: 'active',
    milestones: [{
      id: 'm1', stageNumber: 1, title: '阶段', goal: null, status: 'active',
      subtasks: [{
        id: 't1', order: 1, title: '任务', status: 'completed',
        linkedConceptName: LABEL, coreConcept: null, displayLabel: null,
        learningObjectives: null, completedAt: END, updatedAt: END,
      }],
    }],
  };
}

/** 一节课的课后知识状态看板：status='review' 会派生出 stability='fragile'。 */
function session(id: string, endTime: Date, status: 'review' | 'mastered', progress: number) {
  return {
    id,
    learningPathId: 'p1', taskId: 't1', milestoneId: 'm1',
    knowledgeState: JSON.stringify([{ name: LABEL, status, progress }]),
    wrapup: null, endTime, updatedAt: endTime,
  };
}

/** 模型蒸馏证据：payload.blockedFoundations 是「可把已掌握概念写回阻塞名单」的独立来源。 */
function blockedEvidence() {
  return {
    pathId: 'p1', taskId: null, sessionId: 's1', confidence: 0.9,
    evidenceType: 'session-knowledge-distilled',
    payload: JSON.stringify({ conceptLedger: [], blockedFoundations: [LABEL] }),
    occurredAt: LATER,
  };
}

/**
 * 一条真实的 struggle 证据。struggleCountByKey 由 learner_evidence 里的 `lesson:completed`
 * 行统计（signalFromKnowledgeState 把 review 判为 struggle，conceptKeys 取知识状态行的 name）；
 * 会话 knowledgeState 产生的 recentEvidence 在倒排索引之后才写入，不计入该计数。
 */
function struggleEvidence(id: string, occurredAt: Date) {
  return {
    pathId: 'p1', taskId: 't1', sessionId: id, confidence: 0.9,
    evidenceType: 'lesson:completed',
    payload: JSON.stringify({
      linkedConceptName: LABEL,
      conceptKeys: [LABEL],
      knowledgeState: [{ name: LABEL, status: 'review', progress: 30 }],
    }),
    occurredAt,
  };
}

async function build(sessions: Array<Record<string, unknown>>, evidence: Array<Record<string, unknown>> = []) {
  prisma.learning_paths.findUnique.mockResolvedValue(makePath());
  prisma.learning_paths.findFirst.mockResolvedValue(makePath());
  prisma.learning_paths.findMany.mockResolvedValue([]);
  prisma.teaching_sessions.findMany.mockResolvedValue(sessions);
  prisma.learner_evidence.findMany.mockResolvedValue(evidence);
  prisma.memory_traces.findMany.mockResolvedValue([]);
  prisma.concept_aliases.findUnique.mockResolvedValue(null);
  prisma.concepts.findUnique.mockResolvedValue(null);
  return learnerKnowledgeMemoryService.build({ userId: 'u1', learningPathId: 'p1' });
}

describe('#172-2 · 台账 familiarity / misconceptionRisk 同源 + 名单一致性', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('status=review + stability=fragile 的概念：台账不得同时 understood 与 high risk', async () => {
    const memory = await build([session('s1', END, 'review', 30)]);

    // 先确认夹具真的构造出了「双源」概念：status=review 且 stability=fragile
    const state = memory.currentPath?.conceptStates.find((item) => item.label === LABEL);
    expect(state?.status).toBe('review');
    expect(state?.stability).toBe('fragile');

    const row = memory.globalBackground.conceptLedger.find((item) => item.label === LABEL);
    expect(row).toBeDefined();
    // 修复后的口径：review 只算练过（practiced），不是 understood；风险仍如实标 high。
    expect(row?.familiarity).toBe('practiced');
    expect(row?.misconceptionRisk).toBe('high');
    expect(row?.familiarity === 'understood' && row?.misconceptionRisk === 'high').toBe(false);
    // 全表不得残留任何「已理解 + 高误解风险」行
    expect(memory.globalBackground.conceptLedger.some(
      (item) => item.familiarity === 'understood' && item.misconceptionRisk === 'high',
    )).toBe(false);
  });

  it('已 mastered 的概念不得出现在 blockedFoundations / fragileConcepts 名单里', async () => {
    // 看板判已掌握；模型蒸馏行又把同一概念写进 blockedFoundations（独立双源）
    const memory = await build([session('s1', END, 'mastered', 95)], [blockedEvidence()]);

    expect(memory.globalSignals.masteredConcepts).toContain(LABEL);
    expect(memory.globalBackground.blockedFoundations).not.toContain(LABEL);
    expect(memory.globalSignals.fragileConcepts).not.toContain(LABEL);
  });
});

describe('#172-3 · recurringConfusions 真实计数阈值', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('count=1 的困惑信号不生成 recurringConfusions 行', async () => {
    // 一节课 review 看板（让概念进 fragile 名单）+ 恰好 1 条 lesson:completed struggle 证据
    const memory = await build(
      [session('s1', END, 'review', 30)],
      [struggleEvidence('s1', END)],
    );

    expect(memory.globalSignals.fragileConcepts).toContain(LABEL);
    const rows = memory.globalBackground.recurringConfusions.filter((item) => item.label === LABEL);
    expect(rows).toHaveLength(0);
    // 不能靠兜底 1 造出「反复」行，也不能伪造计数
    expect(memory.globalBackground.recurringConfusions.some((item) => item.count === 1)).toBe(false);
  });

  it('count=2 的真实反复信号仍会生成，且 count 取真实次数', async () => {
    const memory = await build(
      [session('s1', END, 'review', 30)],
      [struggleEvidence('s1', END), struggleEvidence('s2', LATER)],
    );

    const rows = memory.globalBackground.recurringConfusions.filter((item) => item.label === LABEL);
    expect(rows).toHaveLength(1);
    expect(rows[0].count).toBe(2);
  });
});
