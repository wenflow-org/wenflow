/**
 * issue #156：概念台账「最旧证据覆盖最新证据」。
 *
 * 根因：台账合并按**数组位置** last-wins 决定 familiarity/transferReadiness/misconceptionRisk，
 * 而不是按证据时间——数组是 [确定性行…, 模型行(按 occurredAt desc 收集)…]，于是
 * ① 模型行之间：末尾的最旧一课反而赢；② 跨通道：模型行恒在确定性行之后 → 更旧的模型蒸馏行
 *    能改写更新的 session knowledgeState / memory_trace（且 lastSeenAt 又取新时间，自相矛盾）。
 *
 * 复核补修（时钟域）：取胜键必须同源为**业务时间**。模型蒸馏行的业务时间取所属会话
 * `teaching_sessions.endTime`（与确定性通道同一来源，模拟/回填链路落模拟日），
 * 绝不用 `learner_evidence.occurredAt`——它由 createDomainEvent 缺省 new Date() 生成＝真墙钟。
 * 因此本测试刻意让 occurredAt（墙钟）与 endTime（业务）**次序相反**：
 * 若代码仍按 occurredAt 取胜，就会落到错误（旧课）的那一行。
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

// 业务时间（会话 endTime，与模拟日同域）
const OLD_AT = '2026-10-10T00:00:00.000Z';
const NEW_AT = '2026-10-20T00:00:00.000Z';
// 墙钟时间（learner_evidence.occurredAt）——刻意与业务时间次序相反。
const WALL_FOR_OLD_LESSON = '2026-10-30T00:00:00.000Z'; // 旧课业务时间、却带最新墙钟戳
const WALL_FOR_NEW_LESSON = '2026-10-01T00:00:00.000Z'; // 新课业务时间、却带最旧墙钟戳

/** 蒸馏证据：业务时间靠 sessionId → teaching_sessions.endTime 提供，occurredAt 只是墙钟噪声。 */
function ledgerEvidence(sessionId: string, occurredAt: string, familiarity: string, readiness: string, risk: string) {
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
    taskId: null, sessionId, confidence: 0.9, occurredAt: new Date(occurredAt),
  };
}

function confusionEvidence(sessionId: string, occurredAt: string, count: number) {
  return {
    pathId: 'p1',
    evidenceType: 'dialogue-concepts-extracted',
    payload: JSON.stringify({
      recurringConfusions: [{ conceptKey: LABEL, label: LABEL, pattern: '反复混淆', confidence: 0.7, count }],
    }),
    taskId: null, sessionId, confidence: 0.9, occurredAt: new Date(occurredAt),
  };
}

/** 会话：endTime 是业务时间（确定性通道的 lastSeenAt 来源），updatedAt 是真墙钟。 */
function session(id: string, endTimeIso: string, knowledgeState?: Array<{ name: string; status: string; progress: number }>) {
  return {
    id, learningPathId: 'p1', taskId: null, milestoneId: null,
    knowledgeState: knowledgeState ? JSON.stringify(knowledgeState) : null,
    wrapup: null, endTime: new Date(endTimeIso), updatedAt: new Date('2026-11-01T00:00:00.000Z'),
  };
}

function stubEmpty() {
  prisma.learning_paths.findUnique.mockResolvedValue(path());
  prisma.learning_paths.findFirst.mockResolvedValue(path());
  prisma.learning_paths.findMany.mockResolvedValue([]);
  prisma.teaching_sessions.findMany.mockResolvedValue([]);
  prisma.memory_traces.findMany.mockResolvedValue([]);
}

describe('LearnerKnowledgeMemoryService · 概念台账取最新证据（issue #156）', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    stubEmpty();
  });

  it('同一概念两节课：按**业务时间**取新证据（occurredAt 墙钟次序相反也翻不动）', async () => {
    // 会话的 endTime 才是取胜时间：新课 NEW_AT、旧课 OLD_AT。
    prisma.teaching_sessions.findMany.mockResolvedValue([
      session('sess-new', NEW_AT),
      session('sess-old', OLD_AT),
    ]);
    // learner_evidence 查询口径 occurredAt desc（最旧一条在末尾，正是旧实现踩坑的排布），
    // 且墙钟 occurredAt 与业务 endTime **次序相反**：新课带最旧墙钟、旧课带最新墙钟。
    prisma.learner_evidence.findMany.mockResolvedValue([
      ledgerEvidence('sess-old', WALL_FOR_OLD_LESSON, 'practiced', 'medium', 'high'),
      ledgerEvidence('sess-new', WALL_FOR_NEW_LESSON, 'understood', 'high', 'low'),
    ]);

    const memory = await learnerKnowledgeMemoryService.build({ userId: 'u1', learningPathId: 'p1' });
    const rows = memory.globalBackground.conceptLedger.filter((item) => item.label === LABEL);
    expect(rows).toHaveLength(1);
    // 旧实现落 practiced/medium/high（最旧证据）；若取胜键退化为墙钟 occurredAt 也落旧课。
    expect(rows[0].familiarity).toBe('understood');
    expect(rows[0].transferReadiness).toBe('high');
    expect(rows[0].misconceptionRisk).toBe('low');
    // 时间戳同样取业务最新；firstSeenAt 取业务最早；且绝不等于任何墙钟 occurredAt。
    expect(rows[0].lastSeenAt).toBe(NEW_AT);
    expect(rows[0].firstSeenAt).toBe(OLD_AT);
    expect(rows[0].lastSeenAt).not.toBe(WALL_FOR_OLD_LESSON);
  });

  it('反复困惑的 lastSeenAt 取 max（业务时间），不停在旧课', async () => {
    prisma.teaching_sessions.findMany.mockResolvedValue([
      session('sess-new', NEW_AT),
      session('sess-old', OLD_AT),
    ]);
    prisma.learner_evidence.findMany.mockResolvedValue([
      confusionEvidence('sess-old', WALL_FOR_OLD_LESSON, 3),
      confusionEvidence('sess-new', WALL_FOR_NEW_LESSON, 1),
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
    prisma.teaching_sessions.findMany.mockResolvedValue([
      session('sess-new', NEW_AT, [{ name: LABEL, status: 'mastered', progress: 98 }]),
      session('sess-old', OLD_AT),
    ]);
    prisma.learner_evidence.findMany.mockResolvedValue([
      ledgerEvidence('sess-old', WALL_FOR_OLD_LESSON, 'seen', 'low', 'high'),
    ]);

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
    prisma.teaching_sessions.findMany.mockResolvedValue([
      session('sess-new', NEW_AT),
      session('sess-old', OLD_AT, [{ name: LABEL, status: 'review', progress: 30 }]),
    ]);
    prisma.learner_evidence.findMany.mockResolvedValue([
      ledgerEvidence('sess-new', WALL_FOR_NEW_LESSON, 'understood', 'high', 'low'),
    ]);

    const memory = await learnerKnowledgeMemoryService.build({ userId: 'u1', learningPathId: 'p1' });
    const rows = memory.globalBackground.conceptLedger.filter((item) => item.label === LABEL);
    expect(rows).toHaveLength(1);
    expect(rows[0].familiarity).toBe('understood');
    expect(rows[0].transferReadiness).toBe('high');
    expect(rows[0].misconceptionRisk).toBe('low');
    expect(rows[0].lastSeenAt).toBe(NEW_AT);
  });
});
