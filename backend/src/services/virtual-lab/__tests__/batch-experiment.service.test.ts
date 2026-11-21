/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * 批量实验运营语义（approved virtual plan §2 最后一条）：
 * - learningGoal / sampleType 落库并传给建号/人设/故事；
 * - setupStage + setupAttempts（初始化断点与预算）；
 * - expectedNoPath 与终态 outcome 对照；
 * - 最后一个任务先结算（completedTasks 对齐 + finalSnapshot）再进入留存；
 * - 3/7/14 衰减非破坏：冻结基线 + getRetentionSnapshot(asOf)，不 UPDATE memory_traces；
 * - 手动推进持久化回执（本文件只验证 service 与账本的接线）。
 */
type Row = Record<string, any>;

const runRows = new Map<string, Row>();
const profileRows = new Map<string, Row>();
const sessionRows = new Map<string, Row>();

function createRun(id: string, overrides: Row = {}): Row {
  const row: Row = {
    id,
    experimentId: 'exp1',
    profileId: null,
    sessionId: null,
    learnerName: `learner-${id}`,
    learningGoal: null,
    sampleType: null,
    expectedNoPath: false,
    frictionBudget: 'normal',
    phase: 'setup',
    status: 'active',
    setupStage: null,
    setupAttempts: 0,
    completedTasks: 0,
    totalTasks: null,
    currentTask: null,
    stallCount: 0,
    lastError: null,
    advanceCalled: false,
    learningStarted: false,
    outcome: null,
    outcomeMatched: null,
    checkpoints: null,
    finalSnapshot: null,
    decayBaselineAt: null,
    decayBaseline: null,
    decaySims: null,
    advanceLockOwner: null,
    advanceLockAt: null,
    createdAt: new Date('2026-11-01T00:00:00.000Z'),
    updatedAt: new Date('2026-11-01T00:00:00.000Z'),
    ...overrides,
  };
  runRows.set(id, row);
  return row;
}

function simpleMatch(row: Row, where: any): boolean {
  for (const [key, value] of Object.entries(where || {})) {
    if (value === null) {
      if (row[key] !== null) return false;
      continue;
    }
    if (value && typeof value === 'object' && 'lt' in (value as any)) {
      if (!(row[key] instanceof Date) || !(row[key] < new Date((value as any).lt))) return false;
      continue;
    }
    if (row[key] !== value) return false;
  }
  return true;
}

function matchesWhere(row: Row, where: any): boolean {
  if (!where) return true;
  if (where.id !== undefined && row.id !== where.id) return false;
  if (where.experimentId !== undefined && row.experimentId !== where.experimentId) return false;
  if (where.status !== undefined && row.status !== where.status) return false;
  if (Array.isArray(where.OR)) return where.OR.some((clause: any) => simpleMatch(row, clause));
  return simpleMatch(row, where);
}

const mockRunFindUnique: jest.Mock = jest.fn(async ({ where }: any) => runRows.get(where.id) ?? null);
const mockRunUpdate: jest.Mock = jest.fn(async ({ where, data }: any) => {
  const row = runRows.get(where.id);
  if (!row) throw new Error('run not found');
  Object.assign(row, data, { updatedAt: data?.updatedAt ?? new Date() });
  return row;
});
const mockRunUpdateMany: jest.Mock = jest.fn(async ({ where, data }: any) => {
  let count = 0;
  for (const row of runRows.values()) {
    if (!matchesWhere(row, where)) continue;
    Object.assign(row, data, { updatedAt: data?.updatedAt ?? new Date() });
    count += 1;
  }
  return { count };
});
const mockRunFindMany: jest.Mock = jest.fn(async ({ where }: any) =>
  [...runRows.values()].filter((row) => matchesWhere(row, where)));
const mockExperimentUpdate: jest.Mock = jest.fn(async () => ({}));
const mockExperimentCreate: jest.Mock = jest.fn(async ({ data }: any) => ({ id: 'exp-new', ...data }));
const mockExperimentFindMany: jest.Mock = jest.fn(async () => []);
const mockExperimentFindUnique: jest.Mock = jest.fn(async () => null);
const mockProfileFindUnique: jest.Mock = jest.fn(async ({ where }: any) => profileRows.get(where.id) ?? null);
const mockSessionFindUnique: jest.Mock = jest.fn(async ({ where }: any) => sessionRows.get(where.id) ?? null);
const mockSessionUpdate: jest.Mock = jest.fn(async () => ({}));
const mockGoalFindFirst: jest.Mock = jest.fn(async () => null);
const mockGoalFindUnique: jest.Mock = jest.fn(async () => null);
const mockPathFindFirst: jest.Mock = jest.fn(async () => null);
const mockSubtasksCount: jest.Mock = jest.fn(async () => 0);
const mockTraceFindMany: jest.Mock = jest.fn(async () => []);
const mockEvidenceGroupBy: jest.Mock = jest.fn(async () => []);
const mockExecuteRaw: jest.Mock = jest.fn(async () => 0);

jest.mock('../../../config/database', () => ({
  __esModule: true,
  default: {
    batch_experiment_runs: {
      findUnique: (...args: any[]) => mockRunFindUnique(...args),
      update: (...args: any[]) => mockRunUpdate(...args),
      updateMany: (...args: any[]) => mockRunUpdateMany(...args),
      findMany: (...args: any[]) => mockRunFindMany(...args),
      create: jest.fn(),
    },
    batch_experiments: {
      update: (...args: any[]) => mockExperimentUpdate(...args),
      create: (...args: any[]) => mockExperimentCreate(...args),
      findMany: (...args: any[]) => mockExperimentFindMany(...args),
      findUnique: (...args: any[]) => mockExperimentFindUnique(...args),
    },
    virtual_learner_profiles: { findUnique: (...args: any[]) => mockProfileFindUnique(...args) },
    virtual_sessions: {
      findUnique: (...args: any[]) => mockSessionFindUnique(...args),
      update: (...args: any[]) => mockSessionUpdate(...args),
    },
    goal_conversations: {
      findFirst: (...args: any[]) => mockGoalFindFirst(...args),
      findUnique: (...args: any[]) => mockGoalFindUnique(...args),
    },
    learning_paths: { findFirst: (...args: any[]) => mockPathFindFirst(...args) },
    subtasks: { count: (...args: any[]) => mockSubtasksCount(...args) },
    memory_traces: { findMany: (...args: any[]) => mockTraceFindMany(...args) },
    learner_evidence: { groupBy: (...args: any[]) => mockEvidenceGroupBy(...args) },
    $executeRawUnsafe: (...args: any[]) => mockExecuteRaw(...args),
  },
}));

jest.mock('../../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const mockRunLeasedExclusive: jest.Mock = jest.fn(async (_sessionId: string, work: any) => work(async () => undefined));
const mockExecuteSingleStep: jest.Mock = jest.fn();
const mockAdvanceToPath: jest.Mock = jest.fn();
const mockStartLearning: jest.Mock = jest.fn();
const mockRestartLearning: jest.Mock = jest.fn();
const mockExecuteLearningStep: jest.Mock = jest.fn();
const mockGenerateWrapup: jest.Mock = jest.fn();

jest.mock('../../../coordinators/simulation.coordinator', () => ({
  __esModule: true,
  default: {
    runLeasedExclusive: (...args: any[]) => mockRunLeasedExclusive(...args),
    executeSingleStep: (...args: any[]) => mockExecuteSingleStep(...args),
    advanceToPathGeneration: (...args: any[]) => mockAdvanceToPath(...args),
    startLearningPhase: (...args: any[]) => mockStartLearning(...args),
    restartLearningPhase: (...args: any[]) => mockRestartLearning(...args),
    executeLearningStep: (...args: any[]) => mockExecuteLearningStep(...args),
    generateWrapupForSession: (...args: any[]) => mockGenerateWrapup(...args),
  },
}));

const mockCreateSession: jest.Mock = jest.fn();
const mockGetStoryPool: jest.Mock = jest.fn();
jest.mock('../../../virtual-lab/session-factory', () => ({
  __esModule: true,
  createSessionForProfile: (...args: any[]) => mockCreateSession(...args),
  getStoryPool: (...args: any[]) => mockGetStoryPool(...args),
}));

const mockProvision: jest.Mock = jest.fn();
const mockGeneratePersona: jest.Mock = jest.fn();
const mockGenerateStory: jest.Mock = jest.fn();
jest.mock('../../../virtual-lab/learner-provisioning', () => ({
  __esModule: true,
  provisionVirtualProfile: (...args: any[]) => mockProvision(...args),
  generateAndApplyPersona: (...args: any[]) => mockGeneratePersona(...args),
  generateAndApplyStory: (...args: any[]) => mockGenerateStory(...args),
}));

jest.mock('../../../gateway/api-gateway/context', () => ({
  __esModule: true,
  runWithContext: jest.fn(async (_ctx: unknown, fn: () => unknown) => fn()),
}));

const mockRetentionOfTrace: jest.Mock = jest.fn();
jest.mock('../../memory/memory-trace.service', () => ({
  __esModule: true,
  fsrsRetentionOfTrace: (...args: any[]) => mockRetentionOfTrace(...args),
}));

const mockReserveReceipt: jest.Mock = jest.fn();
const mockCompleteReceipt: jest.Mock = jest.fn();
const mockFailReceipt: jest.Mock = jest.fn();
const mockTakeoverReceipt: jest.Mock = jest.fn();
jest.mock('../operation-receipt.service', () => ({
  __esModule: true,
  reserveOperationReceipt: (...args: any[]) => mockReserveReceipt(...args),
  completeOperationReceipt: (...args: any[]) => mockCompleteReceipt(...args),
  failOperationReceipt: (...args: any[]) => mockFailReceipt(...args),
  takeoverOperationReceipt: (...args: any[]) => mockTakeoverReceipt(...args),
  OperationReceiptInFlightError: class OperationReceiptInFlightError extends Error {},
}));

import {
  advanceRun,
  advanceRunWithMeta,
  MAX_SETUP_ATTEMPTS,
} from '../batch-experiment.service';

const DAY_MS = 24 * 60 * 60 * 1000;

beforeEach(() => {
  runRows.clear();
  profileRows.clear();
  sessionRows.clear();
  jest.clearAllMocks();
  mockRunLeasedExclusive.mockImplementation(async (_sessionId: string, work: any) => work(async () => undefined));
  mockGetStoryPool.mockReturnValue([]);
  mockTraceFindMany.mockResolvedValue([]);
  mockEvidenceGroupBy.mockResolvedValue([]);
  mockSubtasksCount.mockResolvedValue(0);
  mockGoalFindFirst.mockResolvedValue(null);
  mockGoalFindUnique.mockResolvedValue(null);
  mockPathFindFirst.mockResolvedValue(null);
  mockReserveReceipt.mockResolvedValue({ kind: 'reserved' });
  mockTakeoverReceipt.mockResolvedValue(true);
  profileRows.set('p1', { id: 'p1', userId: 'u1', profile: JSON.stringify({}) });
  mockRetentionOfTrace.mockReturnValue(0.9);
});

describe('setup：learningGoal / sampleType 持久化并传递', () => {
  it('建号用 run.learningGoal；人设/故事收到显式 sampleType；进度落 setupStage', async () => {
    createRun('r1', { learningGoal: '学会微积分', sampleType: 'student' });
    mockProvision.mockResolvedValue({ profileId: 'p1' });

    expect(await advanceRun('r1')).toBe('setup');
    expect(mockProvision).toHaveBeenCalledWith(expect.objectContaining({
      name: 'learner-r1',
      learningGoal: '学会微积分',
      profile: { origin: { kind: 'batch-experiment', runId: 'r1' } },
    }));
    expect(runRows.get('r1')).toMatchObject({ profileId: 'p1', setupStage: 'persona', setupAttempts: 0 });

    expect(await advanceRun('r1')).toBe('setup');
    expect(mockGeneratePersona).toHaveBeenCalledWith('p1', expect.objectContaining({ sampleType: 'student' }));
    expect(runRows.get('r1')).toMatchObject({ setupStage: 'story' });

    expect(await advanceRun('r1')).toBe('setup');
    expect(mockGenerateStory).toHaveBeenCalledWith('p1', expect.objectContaining({
      extraHints: expect.arrayContaining([expect.stringContaining('传统学生样本')]),
    }));
    expect(runRows.get('r1')).toMatchObject({ setupStage: 'session' });

    mockGetStoryPool.mockReturnValue([{ id: 'story1' }]);
    mockCreateSession.mockResolvedValue({ id: 'sess1' });
    expect(await advanceRun('r1')).toBe('goal');
    expect(runRows.get('r1')).toMatchObject({
      sessionId: 'sess1',
      phase: 'goal',
      setupAttempts: 0,
      stallCount: 0,
    });
  });

  it('初始化超预算 → failed，不再无限空转', async () => {
    createRun('r2', {
      setupAttempts: MAX_SETUP_ATTEMPTS - 1,
      setupStage: 'created',
    });
    mockProvision.mockRejectedValue(new Error('db down'));

    expect(await advanceRun('r2')).toBe('setup');
    const row = runRows.get('r2')!;
    expect(row.setupAttempts).toBe(MAX_SETUP_ATTEMPTS);
    expect(row.status).toBe('failed');
    expect(row.phase).toBe('failed');
    expect(row.outcome).toBe('failed');
    expect(String(row.lastError)).toContain('初始化超过');
    expect(mockExperimentUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'done' }),
    }));
  });
});

describe('goal：expected no-path / learner-ended 终态', () => {
  it('会话已完成且 goal.noPath → outcome=no-path，命中 expectedNoPath', async () => {
    createRun('r3', { phase: 'goal', sessionId: 's1', expectedNoPath: true });
    sessionRows.set('s1', {
      id: 's1',
      status: 'completed',
      currentStage: 'goal',
      goalConversationId: null,
      userId: 'u1',
      stageResults: JSON.stringify({ goal: { noPath: true } }),
    });

    expect(await advanceRun('r3')).toBe('done');
    expect(runRows.get('r3')).toMatchObject({
      status: 'done',
      phase: 'done',
      outcome: 'no-path',
      outcomeMatched: true,
    });
    expect(mockExecuteSingleStep).not.toHaveBeenCalled();
  });

  it('单步结果 learnerEnded → outcome=learner-ended，未命中 no-path 预期', async () => {
    createRun('r4', { phase: 'goal', sessionId: 's2', expectedNoPath: true });
    sessionRows.set('s2', {
      id: 's2',
      status: 'running',
      currentStage: 'goal',
      goalConversationId: null,
      userId: 'u1',
      stageResults: JSON.stringify({ goal: {} }),
    });
    mockExecuteSingleStep.mockResolvedValue({ success: true, learnerEnded: true, currentStage: 'goal', goalReady: false });

    expect(await advanceRun('r4')).toBe('done');
    expect(runRows.get('r4')).toMatchObject({
      status: 'done',
      outcome: 'learner-ended',
      outcomeMatched: false,
    });
  });
});

describe('learn：最后一个任务先结算再进入留存', () => {
  it('taskCompleted + isPathCompleted 同回合：completedTasks 对齐、finalSnapshot 落库', async () => {
    createRun('r5', {
      phase: 'learn',
      sessionId: 's3',
      profileId: 'p1',
      learningStarted: true,
      completedTasks: 2,
      totalTasks: 3,
      currentTask: 't2',
    });
    sessionRows.set('s3', { id: 's3', status: 'running', currentStage: 'teaching', stageResults: '{}', userId: 'u1' });
    mockTraceFindMany.mockResolvedValue([
      { conceptKey: 'c1', label: 'C1', masteryScore: 0.8, stability: 'stable', lastSeenAt: new Date(), extractionCount: 2, intervalFactor: 3 },
    ]);
    mockEvidenceGroupBy.mockResolvedValue([{ evidenceKey: 'e1', _count: { _all: 2 } }]);
    mockExecuteLearningStep.mockResolvedValue({
      success: true,
      taskCompleted: true,
      isPathCompleted: true,
      milestoneProgress: { currentTask: 't3', currentMilestone: 1, totalMilestones: 1 },
    });

    expect(await advanceRun('r5')).toBe('learn-done');
    const row = runRows.get('r5')!;
    expect(row).toMatchObject({ phase: 'learn-done', completedTasks: 3, totalTasks: 3, currentTask: 't3' });
    const finalSnapshot = JSON.parse(row.finalSnapshot);
    expect(finalSnapshot).toMatchObject({ final: true, lastTask: 't3', traceCount: 1, mastered: 1 });
    const checkpoints = JSON.parse(row.checkpoints);
    expect(checkpoints[checkpoints.length - 1]).toMatchObject({ final: true, task: 't3' });
    expect(mockGenerateWrapup).toHaveBeenCalledWith('s3');
  });
});

describe('decay：非破坏、固定 3/7/14、同一冻结基线', () => {
  it('冻结后即使记忆库变化，3/7/14 仍用原始记忆计算且不改库', async () => {
    const baselineAt = new Date('2026-11-10T00:00:00.000Z');
    createRun('r6', { phase: 'learn-done', profileId: 'p1', decayBaselineAt: null });
    mockTraceFindMany.mockResolvedValue([
      { conceptKey: 'c1', label: 'C1', masteryScore: 0.8, stability: 'stable', lastSeenAt: baselineAt, extractionCount: 2, intervalFactor: 3 },
    ]);
    // learn-done → decay：只冻结基线，不读保留率、不改 memory_traces
    expect(await advanceRun('r6')).toBe('decay');
    const frozen = runRows.get('r6')!;
    expect(frozen.decayBaselineAt).toBeInstanceOf(Date);
    expect(JSON.parse(frozen.decayBaseline)).toMatchObject({ traceCount: 1, mastered: 1 });
    const frozenAt = new Date(frozen.decayBaselineAt).getTime();
    expect(mockRetentionOfTrace).not.toHaveBeenCalled();
    expect(mockExecuteRaw).not.toHaveBeenCalled();
    mockTraceFindMany.mockResolvedValue([]);

    for (const [index, days] of [3, 7, 14].entries()) {
      expect(await advanceRun('r6')).toBe('decay');
      const call = mockRetentionOfTrace.mock.calls[index];
      expect(call[0]).toMatchObject({ masteryScore: 0.8, lastSeenAt: baselineAt });
      expect((call[1] as Date).getTime()).toBe(frozenAt + days * DAY_MS);
      const row = runRows.get('r6')!;
      const sims = JSON.parse(row.decaySims);
      expect(sims).toHaveLength(index + 1);
      expect(sims[index]).toMatchObject({ days, baselineAt: new Date(frozenAt).toISOString(), traceCount: 1 });
      expect(sims[index].asOf).toBe(new Date(frozenAt + days * DAY_MS).toISOString());
    }

    expect(await advanceRun('r6')).toBe('done');
    expect(runRows.get('r6')).toMatchObject({
      status: 'done',
      phase: 'done',
      outcome: 'max-observed',
    });
    expect(mockExecuteRaw).not.toHaveBeenCalled();
    expect(mockRetentionOfTrace).toHaveBeenCalledTimes(3);
    expect(mockTraceFindMany).toHaveBeenCalledTimes(1);
  });
});

describe('批量推进：持久化回执接线', () => {
  it('命中回执回放时不再跑推进状态机', async () => {
    createRun('r7', { phase: 'goal', sessionId: 's4' });
    mockReserveReceipt.mockResolvedValueOnce({ kind: 'replay', result: { phase: 'learn' } });

    const outcome = await advanceRunWithMeta('r7', { requestKey: 'key-1', request: { runId: 'r7' } });
    expect(outcome).toEqual({ phase: 'learn', reused: true });
    expect(mockExecuteSingleStep).not.toHaveBeenCalled();
    expect(mockCompleteReceipt).not.toHaveBeenCalled();
  });

  it('首次推进成功 → 回执 completed，存 phase', async () => {
    createRun('r8', { phase: 'goal', sessionId: 's5' });
    sessionRows.set('s5', {
      id: 's5', status: 'running', currentStage: 'goal', goalConversationId: null, userId: 'u1',
      stageResults: JSON.stringify({ goal: {} }),
    });
    mockExecuteSingleStep.mockResolvedValue({ success: true, currentStage: 'goal', goalReady: false });

    const outcome = await advanceRunWithMeta('r8', { requestKey: 'key-2', request: { runId: 'r8' } });
    expect(outcome).toEqual({ phase: 'goal', reused: false });
    expect(mockReserveReceipt).toHaveBeenCalledWith(expect.objectContaining({
      scope: 'batch-run',
      scopeId: 'r8',
      kind: 'advance',
      requestKey: 'key-2',
    }));
    expect(mockCompleteReceipt).toHaveBeenCalledWith(expect.objectContaining({
      result: { phase: 'goal' },
    }));
  });
});
