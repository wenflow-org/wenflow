/**
 * 证据条数只认可复算值（2026-11-09 运营字段真值核查）
 *
 * 背景：`conceptLedger[].evidenceCount` 同时有两个来源——
 *   ① 确定性倒排索引：由真实证据行（session knowledgeState / task:completed / 摘要 / 评估）
 *      命中该概念身份的条数算出（LearnerKnowledgeMemoryService.ts 的 evidenceIndicesByKey）；
 *   ② 模型自报：lesson-knowledge-enricher 的 LLM 输出字段。提示词里该字段只有结构占位
 *      `"evidenceCount": 0`，**没有任何计数规则**；真实 LLM 实测同一输入连跑 3 次，
 *      同一概念给出 3 / 2 / 17。
 *
 * 旧合并口径 `Math.max(确定性, 模型)` 让模型值只能抬高、不能压低，运营后台「概念证据密度」
 * 直接把它当确凿读数展示。本测试锁定：合并后一律用可复算的证据行数覆盖模型自报值。
 *
 * 2026-11-09 口径修正：可复算的「证据行」此前只数 task:completed / lesson:completed 两类，
 * 而蒸馏（session-knowledge-distilled）与对话提取（dialogue-concepts-extracted）本身也是
 * 「提到该概念的证据行」——只有蒸馏证据的学习者（虚拟学习者常见）于是恒显 ev=0，运营读成
 * 「没证据」。现在把这两类行的条数并进来：**行数**才是读数，模型自报的数字仍然一律忽略。
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
  learning_paths: { findUnique: jest.Mock; findFirst: jest.Mock; findMany: jest.Mock };
  teaching_sessions: { findMany: jest.Mock };
  learner_evidence: { findMany: jest.Mock };
  memory_traces: { findMany: jest.Mock };
  concept_aliases: { findUnique: jest.Mock };
};

const LABEL = '识别叠字版面';
const AT = '2026-11-01T00:00:00.000Z';

function path() {
  return {
    id: 'p1', userId: 'u1', title: '路径', name: '路径', status: 'active',
    milestones: [{ id: 'm1', stageNumber: 1, title: '阶段', goal: null, status: 'active', subtasks: [] }],
  };
}

/** 一条真实证据行：lesson:completed 的 payload 带该概念 → 命中 1 条。
 *  注意：证据倒排索引只收 task:completed / lesson:completed 两类行；蒸馏/对话提取行另走
 *  只服务台账计数的索引（2026-11-09 起计入），二者 id 空间不相交、并集去重。 */
function lessonCompletedEvidence(label = LABEL) {
  return {
    pathId: 'p1',
    evidenceType: 'lesson:completed',
    payload: JSON.stringify({ knowledgeState: [{ name: label, status: 'mastered', progress: 98 }] }),
    taskId: 't1', sessionId: 'sess-1', confidence: 0.9, occurredAt: new Date(AT),
  };
}

/** 模型蒸馏行：自报一个任意大的 evidenceCount（一律忽略，只算「这一行提到了该概念」）。 */
function distilledEvidence(reportedCount: number, label = LABEL) {
  return {
    pathId: 'p1',
    evidenceType: 'session-knowledge-distilled',
    payload: JSON.stringify({
      conceptLedger: [{
        conceptKey: 'kc-1d', label,
        familiarity: 'stable', transferReadiness: 'high', misconceptionRisk: 'low',
        sourcePaths: ['p1'], sourceTasks: [], evidenceCount: reportedCount,
      }],
    }),
    taskId: null, sessionId: 'sess-1', confidence: 0.9, occurredAt: new Date(AT),
  };
}

function stub() {
  jest.clearAllMocks();
  prisma.learning_paths.findUnique.mockResolvedValue(path());
  prisma.learning_paths.findFirst.mockResolvedValue(path());
  prisma.learning_paths.findMany.mockResolvedValue([]);
  prisma.memory_traces.findMany.mockResolvedValue([]);
  prisma.concept_aliases.findUnique.mockResolvedValue(null);
}

describe('概念台账 evidenceCount 只认可复算值', () => {
  it('模型自报 999 不能抬高读数：合并后等于真实证据行数', async () => {
    stub();
    prisma.teaching_sessions.findMany.mockResolvedValue([]);
    prisma.learner_evidence.findMany.mockResolvedValue([lessonCompletedEvidence(), distilledEvidence(999)]);

    const memory = await learnerKnowledgeMemoryService.build({ userId: 'u1', learningPathId: 'p1' });
    const rows = memory.globalBackground.conceptLedger.filter((item) => item.label === LABEL);
    expect(rows).toHaveLength(1);
    // 2 条证据行都提到了该概念：lesson:completed 1 条 + 蒸馏 1 条（绝口不提模型自报的 999）
    expect(rows[0].evidenceCount).toBe(2);
  });

  it('模型自报数字本身不进读数：只有蒸馏证据时算 1 行，不是它自报的 7', async () => {
    stub();
    prisma.teaching_sessions.findMany.mockResolvedValue([]);
    prisma.learner_evidence.findMany.mockResolvedValue([distilledEvidence(7, '模型自造概念')]);

    const memory = await learnerKnowledgeMemoryService.build({ userId: 'u1', learningPathId: 'p1' });
    const rows = memory.globalBackground.conceptLedger.filter((item) => item.label === '模型自造概念');
    expect(rows).toHaveLength(1);
    // 修复前这里是 0（蒸馏行不进索引）⇒ 只有蒸馏证据的学习者恒显「0 条证据」
    expect(rows[0].evidenceCount).toBe(1);
  });

  it('多条证据行按身份键并集去重计数（同一行同时含 label 与 slug 只计一次）', async () => {
    stub();
    prisma.teaching_sessions.findMany.mockResolvedValue([]);
    prisma.learner_evidence.findMany.mockResolvedValue([
      lessonCompletedEvidence(),
      { ...lessonCompletedEvidence(), sessionId: 'sess-2', taskId: 't2' },
      distilledEvidence(50),
    ]);

    const memory = await learnerKnowledgeMemoryService.build({ userId: 'u1', learningPathId: 'p1' });
    const rows = memory.globalBackground.conceptLedger.filter((item) => item.label === LABEL);
    expect(rows).toHaveLength(1);
    // 2 条 lesson 行 + 1 条蒸馏行 = 3 行；同一行同时含 label 与 conceptKey 只计一次
    expect(rows[0].evidenceCount).toBe(3);
  });

  it('同一概念：lesson 行与蒸馏行不重复计（各自算一行，不相交 id 空间并集去重）', async () => {
    stub();
    prisma.teaching_sessions.findMany.mockResolvedValue([]);
    prisma.learner_evidence.findMany.mockResolvedValue([
      lessonCompletedEvidence(),
      { ...distilledEvidence(3), sessionId: 'sess-9' },
    ]);

    const memory = await learnerKnowledgeMemoryService.build({ userId: 'u1', learningPathId: 'p1' });
    const rows = memory.globalBackground.conceptLedger.filter((item) => item.label === LABEL);
    expect(rows[0].evidenceCount).toBe(2);
  });
});
