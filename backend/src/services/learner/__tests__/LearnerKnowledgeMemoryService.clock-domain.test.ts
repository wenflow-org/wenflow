/**
 * 概念账本 lastSeenAt 的时钟域（Q8 延迟锚题修复 · B）。
 *
 * 背景：延迟锚题的候选时间与探针 `now` 必须同域（模拟日 vs 真墙钟）。此前
 * `LearnerKnowledgeMemoryService` 在缺业务时间戳时回退 Prisma `@updatedAt`（真墙钟基础设施列），
 * 使 KT-only 记忆痕迹（`applyKtEstimate` 创建、lastSeenAt=null）把真墙钟时间注入账本，
 * 与模拟日 `now` 跨域比较（`utcNaturalDayDiff` 负值被钳 0 → 永不触发）。
 *
 * 本测试锁定：只认业务写入的完成/结束时间（模拟链路经 simulatedNowOr/asOf），
 * 缺时间戳就**不记**，绝不回退 `updatedAt`（真墙钟）。
 */
jest.mock('../../../config/database', () => ({
  __esModule: true,
  default: {
    learning_paths: { findUnique: jest.fn(), findFirst: jest.fn() },
    teaching_sessions: { findMany: jest.fn() },
    learner_evidence: { findMany: jest.fn() },
    memory_traces: { findMany: jest.fn() },
  },
}));

import { learnerKnowledgeMemoryService } from '../LearnerKnowledgeMemoryService';

const prisma = require('../../../config/database').default as {
  learning_paths: { findUnique: jest.Mock; findFirst: jest.Mock };
  teaching_sessions: { findMany: jest.Mock };
  learner_evidence: { findMany: jest.Mock };
  memory_traces: { findMany: jest.Mock };
};

const SIM_DAY = new Date('2026-09-05T00:00:00.000Z');
const REAL_NOW = new Date('2026-09-19T05:00:00.000Z'); // 真墙钟（运行日）

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
        {
          id: 't1',
          order: 1,
          title: '任务',
          status: 'completed',
          completedAt: SIM_DAY, // 业务时间：模拟日
          updatedAt: REAL_NOW, // 基础设施列：真墙钟
          estimatedMinutes: 30,
          linkedConceptName: '任务概念',
          coreConcept: null,
          displayLabel: null,
          learningObjectives: null,
        },
      ],
    },
  ],
};

beforeEach(() => {
  jest.clearAllMocks();
  prisma.learning_paths.findUnique.mockResolvedValue(path);
  prisma.learner_evidence.findMany.mockResolvedValue([]);
  // 会话题：已结束（endTime=模拟日）、未结束（endTime=null）、以及一条 summary 派生
  prisma.teaching_sessions.findMany.mockResolvedValue([
    {
      id: 's1',
      taskId: 't1',
      milestoneId: 'm1',
      endTime: SIM_DAY,
      updatedAt: REAL_NOW,
      knowledgeState: JSON.stringify([{ name: '会话概念', status: 'mastered', progress: 90 }]),
      wrapup: null,
    },
    {
      id: 's2',
      taskId: 't1',
      milestoneId: 'm1',
      endTime: null, // 进行中：无业务结束时间
      updatedAt: REAL_NOW,
      knowledgeState: JSON.stringify([{ name: '进行中概念', status: 'learning', progress: 50 }]),
      wrapup: null,
    },
  ]);
});

describe('LearnerKnowledgeMemoryService · 概念账本时钟域（B）', () => {
  it('记忆痕迹无业务 lastSeenAt（KT-only）→ 不记 seenAt，绝不回退 updatedAt（真墙钟）', async () => {
    prisma.memory_traces.findMany.mockResolvedValue([
      {
        conceptKey: 'KT点',
        label: 'KT点',
        stability: 'unknown',
        masteryScore: 0.3,
        intervalFactor: 1,
        lastSeenAt: null,
        updatedAt: REAL_NOW,
      },
      {
        conceptKey: '已提取点',
        label: '已提取点',
        stability: 'stable',
        masteryScore: 0.9,
        intervalFactor: 1,
        lastSeenAt: SIM_DAY, // 记忆引擎用 simulatedNowOr 写业务时间
        updatedAt: REAL_NOW,
      },
    ]);

    const memory = await learnerKnowledgeMemoryService.build({ userId: 'u1', learningPathId: 'p1' });
    const states = memory.currentPath?.conceptStates ?? [];
    const kt = states.find((c) => c.conceptKey === 'KT点');
    const extracted = states.find((c) => c.conceptKey === '已提取点');

    expect(kt?.lastSeenAt).toBeUndefined();
    expect(kt?.lastSeenAt).not.toBe(REAL_NOW.toISOString());
    expect(extracted?.lastSeenAt).toBe(SIM_DAY.toISOString());

    const ledger = memory.globalBackground.conceptLedger;
    expect(ledger.find((c) => c.conceptKey === 'KT点')?.lastSeenAt).toBeUndefined();
    expect(ledger.find((c) => c.conceptKey === '已提取点')?.lastSeenAt).toBe(SIM_DAY.toISOString());
  });

  it('任务完成时间取 completedAt（模拟日），未结束会话不回退 updatedAt（真墙钟）', async () => {
    prisma.memory_traces.findMany.mockResolvedValue([]);

    const memory = await learnerKnowledgeMemoryService.build({ userId: 'u1', learningPathId: 'p1' });
    const ledger = memory.globalBackground.conceptLedger;
    const taskConcept = ledger.find((c) => c.conceptKey === '任务概念');
    const inProgress = ledger.find((c) => c.conceptKey === '进行中概念');

    // 任务：业务完成时间 completedAt（模拟日），不是 updatedAt（真墙钟）
    expect(taskConcept?.lastSeenAt).toBe(SIM_DAY.toISOString());
    // 会话：已结束取 endTime（模拟日）
    expect(ledger.find((c) => c.conceptKey === '会话概念')?.lastSeenAt).toBe(SIM_DAY.toISOString());
    // 未结束会话：endTime=null → 不记时间，绝不回退真墙钟
    expect(inProgress?.lastSeenAt).toBeUndefined();
    expect(inProgress?.lastSeenAt).not.toBe(REAL_NOW.toISOString());

    // 账本里不应出现任何"真墙钟"时间戳（跨域污染的直接证据）
    const all = ledger.map((c) => c.lastSeenAt).filter(Boolean) as string[];
    expect(all.every((iso) => iso.startsWith('2026-09-05'))).toBe(true);
  });
});
