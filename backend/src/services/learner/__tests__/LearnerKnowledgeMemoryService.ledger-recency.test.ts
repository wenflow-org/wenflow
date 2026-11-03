/**
 * issue #156：概念台账「最旧证据覆盖最新证据」。
 *
 * 根因：台账合并按**数组位置** last-wins 决定 familiarity/transferReadiness/misconceptionRisk，
 * 而不是按证据时间——数组是 [确定性行…, 模型行(按 occurredAt desc 收集)…]，于是
 * ① 模型行之间：末尾的最旧一课反而赢；② 跨通道：模型行恒在确定性行之后 → 更旧的模型蒸馏行
 *    能改写更新的 session knowledgeState / memory_trace（且 lastSeenAt 又取新时间，自相矛盾）。
 *
 * 本测试锁定（均可区分新旧实现）：
 * ① 同一概念两节课（模型证据先低后高）取**新**证据的 familiarity/transferReadiness/misconceptionRisk；
 * ② 反复困惑 lastSeenAt 取 max；
 * ③ 跨通道按时间取胜：更新的 session knowledgeState 不被更旧的模型行覆盖（也反向成立）；
 * ④ firstSeenAt 取最早。
 */
jest.mock('../../../config/database', () => ({
  __esModule: true,
  default: {
    learning_paths: { findUnique: jest.fn(), findFirst: jest.fn(), findMany: jest.fn() },
    teaching_sessions: { findMany: jest.fn() },
    learner_evidence: { findMany: jest.fn() },
    memory_traces: { findMany: jest.fn() },
  },
}));

import { learnerKnowledgeMemoryService } from '../LearnerKnowledgeMemoryService';

const prisma = require('../../../config/database').default as {
  learning_paths: { findUnique: jest.Mock; findFirst: jest.Mock; findMany: jest.Mock };
  teaching_sessions: { findMany: jest.Mock };
  learner_evidence: { findMany: jest.Mock };
  memory_traces: { findMany: jest.Mock };
};

const LABEL = '识别叠字版面';

function path() {
  return {
    id: 'p1', userId: 'u1', title: '路径', name: '路径', status: 'active',
    milestones: [{ id: 'm1', stageNumber: 1, title: '阶段', goal: null, status: 'active', subtasks: [] }],
  };
}

const OLD_AT = '2026-10-10T00:00:00.000Z';
const NEW_AT = '2026-10-20T00:00:00.000Z';
function ledgerEvidence(occurredAt: string, familiarity: string, readiness: string, risk: string) {
  return {
    pathId: 'p1',
    evidenceType: 'session-knowledge-distilled',
    payload: JSON.stringify({
      conceptLedger: [{
        conceptKey: 'kc-1d', label: LABEL,
        familiarity, transferReadiness: readiness, misconceptionRisk: risk,
        sourcePaths: ['p1'], sourceTasks: [], evidenceCount: 1,
      }],
    }),
    taskId: null, sessionId: null, confidence: 0.9, occurredAt: new Date(occurredAt),
  };
}

function confusionEvidence(occurredAt: string, count: number) {
  return {
    pathId: 'p1',
    evidenceType: 'dialogue-concepts-extracted',
    payload: JSON.stringify({
      recurringConfusions: [{ conceptKey: LABEL, label: LABEL, pattern: '反复混淆', confidence: 0.7, count }],
    }),
    taskId: null, sessionId: null, confidence: 0.9, occurredAt: new Date(occurredAt),
  };
}

function stubEmpty() {
  prisma.learning_paths.findUnique.mockResolvedValue(path());
  prisma.learning_paths.findFirst.mockResolvedValue(path());
  prisma.learning_paths.findMany.mockResolvedValue([]);
  prisma.teaching_sessions.findMany.mockResolvedValue([]);
  prisma.memory_traces.findMany.mockResolvedValue([]);
}

/** 确定性通道：一节课的 knowledgeState（结构化看板），endTime 即业务 lastSeenAt。 */
function sessionEvidence(endTimeIso: string, status: 'mastered' | 'learning' | 'review', progress: number) {
  return {
    id: `s-${endTimeIso}`, learningPathId: 'p1', taskId: null, milestoneId: null,
    knowledgeState: JSON.stringify([{ name: LABEL, status, progress }]),
    wrapup: null, endTime: new Date(endTimeIso), updatedAt: new Date(endTimeIso),
  };
}

describe('LearnerKnowledgeMemoryService · 概念台账取最新证据（issue #156）', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    stubEmpty();
  });

  it('同一概念两节课：掌握度先低后高，最终台账取**新**证据的值（当前取不到）', async () => {
    // 查询口径：occurredAt desc —— 最新一条在最前，最旧一条在末尾（正是旧实现踩坑的排布）
    prisma.learner_evidence.findMany.mockResolvedValue([
      ledgerEvidence(NEW_AT, 'understood', 'high', 'low'),
      ledgerEvidence(OLD_AT, 'practiced', 'medium', 'high'),
    ]);

    const memory = await learnerKnowledgeMemoryService.build({ userId: 'u1', learningPathId: 'p1' });
    const rows = memory.globalBackground.conceptLedger.filter((item) => item.label === LABEL);
    expect(rows).toHaveLength(1);
    // 旧实现落 practiced/medium/high（最旧证据）
    expect(rows[0].familiarity).toBe('understood');
    expect(rows[0].transferReadiness).toBe('high');
    expect(rows[0].misconceptionRisk).toBe('low');
    // 时间戳同样取最新；firstSeenAt 取最早
    expect(rows[0].lastSeenAt).toBe(NEW_AT);
    expect(rows[0].firstSeenAt).toBe(OLD_AT);
  });

  it('反复困惑的 lastSeenAt 取 max，不停在旧课', async () => {
    prisma.learner_evidence.findMany.mockResolvedValue([
      confusionEvidence(NEW_AT, 1),
      confusionEvidence(OLD_AT, 3),
    ]);

    const memory = await learnerKnowledgeMemoryService.build({ userId: 'u1', learningPathId: 'p1' });
    const rows = memory.globalBackground.recurringConfusions.filter((item) => item.label === LABEL);
    expect(rows).toHaveLength(1);
    expect(rows[0].lastSeenAt).toBe(NEW_AT);
    // 计数取 max（旧行为，保持不变）
    expect(rows[0].count).toBe(3);
  });

  it('跨通道同样按时间取胜：更新的 session knowledgeState 不被更旧的模型蒸馏行覆盖', async () => {
    // 新课（NEW_AT）结构化看板 mastered → 确定性行 stable/high/low；
    // 旧课（OLD_AT）模型蒸馏行 seen/low/high。旧实现里模型行恒排在确定性行之后 → 覆盖成旧模型的
    // seen/low/high，而 lastSeenAt 又取新课时间，出现「掌握度取旧课、时间取新课」的自相矛盾。
    prisma.teaching_sessions.findMany.mockResolvedValue([sessionEvidence(NEW_AT, 'mastered', 98)]);
    prisma.learner_evidence.findMany.mockResolvedValue([ledgerEvidence(OLD_AT, 'seen', 'low', 'high')]);

    const memory = await learnerKnowledgeMemoryService.build({ userId: 'u1', learningPathId: 'p1' });
    const rows = memory.globalBackground.conceptLedger.filter((item) => item.label === LABEL);
    expect(rows).toHaveLength(1);
    // 取新课（确定性）的状态，而不是旧模型行
    expect(rows[0].familiarity).toBe('stable');
    expect(rows[0].transferReadiness).toBe('high');
    expect(rows[0].misconceptionRisk).toBe('low');
    expect(rows[0].lastSeenAt).toBe(NEW_AT);
    expect(rows[0].firstSeenAt).toBe(OLD_AT);
  });

  it('反向：更新的模型证据仍能翻案更旧的 session knowledgeState', async () => {
    prisma.teaching_sessions.findMany.mockResolvedValue([sessionEvidence(OLD_AT, 'review', 30)]);
    prisma.learner_evidence.findMany.mockResolvedValue([ledgerEvidence(NEW_AT, 'understood', 'high', 'low')]);

    const memory = await learnerKnowledgeMemoryService.build({ userId: 'u1', learningPathId: 'p1' });
    const rows = memory.globalBackground.conceptLedger.filter((item) => item.label === LABEL);
    expect(rows).toHaveLength(1);
    expect(rows[0].familiarity).toBe('understood');
    expect(rows[0].transferReadiness).toBe('high');
    expect(rows[0].misconceptionRisk).toBe('low');
    expect(rows[0].lastSeenAt).toBe(NEW_AT);
  });
});
