/**
 * 幽灵课 / 弃跑状态泄漏拦截 + F2 入队侧收紧（2026-10-06 修复轮）。
 *
 * A. 非正常终态（`endReason==='learner-abandoned'` 等）的会话**仍然收束**（状态机照常闭合、wrapup 照常落库、
 *    调用方轮询/清场逻辑不变），但**不写正式轨**：learner_evidence（lesson:completed 事件不带 userId）、
 *    learning_metrics（session-wrapup / session_load）、记忆回写（FSRS trace）、误解台账、休眠信号、
 *    检查点留痕、aux 课后刷新链一律跳过，只落一条审计日志。
 * B. `review:completed` 只在 endSession **真正成功**（completed + wrapup，且非弃跑）后入队；
 *    抛错 / processing 时入队为 0。
 *
 * 对照口径：正常收束（manual-end / task-completed）逐项行为**逐字不变**——本文件用同一 fixture
 * 同时跑正常与弃跑两条路径，逐项断言"正常仍写、弃跑不写"。
 */
const mockClaimFinalization = jest.fn();
const mockCompleteWithEvent = jest.fn();
const mockRenewFinalizationLease = jest.fn();
const mockFailFinalization = jest.fn();
const mockAssertOwnership = jest.fn();

const mockExecuteSkill = jest.fn();
const mockPrepareSessionScoreCommit = jest.fn();
const mockCommitSessionLoadMetric = jest.fn();

const mockRefreshDashboardGuidance = jest.fn();
const mockRefreshLearnerStateReview = jest.fn();
const mockRefreshConceptConsolidator = jest.fn();
const mockWarmConceptLoad = jest.fn();
const mockPrepareNextLesson = jest.fn();
const mockRecordSessionOutcome = jest.fn();
const mockMarkMisconceptionsAddressed = jest.fn();
const mockRecordChurnRiskAtFinalize = jest.fn();
const mockRecordCheckpointAttemptEvidence = jest.fn();

jest.mock('../../../config/database', () => ({
  __esModule: true,
  default: { memory_traces: { findMany: jest.fn().mockResolvedValue([]) }, teaching_sessions: {} },
}));
jest.mock('../../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));
jest.mock('../../../skills', () => ({
  executeSkill: mockExecuteSkill,
  sessionWrapupAgentDefinition: {},
}));
jest.mock('../TeachingSessionRepository', () => {
  const actual = jest.requireActual('../TeachingSessionRepository');
  return {
    ...actual,
    teachingSessionRepository: {
      claimFinalization: mockClaimFinalization,
      completeWithEvent: mockCompleteWithEvent,
      renewFinalizationLease: mockRenewFinalizationLease,
      failFinalization: mockFailFinalization,
      assertOwnership: mockAssertOwnership,
    },
  };
});
jest.mock('../teaching-session-views', () => {
  const actual = jest.requireActual('../teaching-session-views');
  return { ...actual, commitSessionLoadMetric: mockCommitSessionLoadMetric };
});
jest.mock('../../learning/learning-state.service', () => ({
  learningStateService: { prepareSessionScoreCommit: mockPrepareSessionScoreCommit },
}));
jest.mock('../TeachingContextBuilder', () => ({
  buildTeachingScenarioContext: jest.fn().mockResolvedValue({
    taskTitle: 't',
    taskDescription: 'd',
    pathContext: { pathTitle: null, pathSummary: null },
    learningState: null,
    cognitiveFrame: { transferGoal: null },
  }),
}));
jest.mock('../ReplanAdvisoryService', () => ({
  replanAdvisoryService: {
    build: jest.fn().mockReturnValue({ shouldSuggest: false, recommendation: 'keep', ui: { options: [] } }),
    applyAttribution: jest.fn(),
  },
  toAttributionRecall: jest.fn(),
}));
jest.mock('../ReplanAttributionService', () => ({
  replanAttributionService: { attribute: jest.fn() },
  isCalibratableDirection: jest.fn().mockReturnValue(false),
}));
jest.mock('../../learner/LearnerSnapshotService', () => ({
  learnerSnapshotService: {
    previewSnapshotFromMetrics: jest.fn().mockResolvedValue(snapshot()),
    getSnapshot: jest.fn().mockResolvedValue(snapshot()),
  },
}));
jest.mock('../../learner/LearnerProjectionService', () => ({
  learnerProjectionService: {
    toReplanProjection: jest.fn().mockReturnValue({
      mastery: { stableConcepts: ['稳定概念'], fragileConcepts: [], strugglingConcepts: [] },
    }),
  },
}));
jest.mock('../../learner/insight-calibration.service', () => ({
  insightCalibrationService: { recordInsights: jest.fn() },
}));
jest.mock('../../learner/DashboardGuidanceSnapshotService', () => ({
  dashboardGuidanceSnapshotService: { refreshInBackground: mockRefreshDashboardGuidance },
}));
jest.mock('../../learner/LearnerStateReviewService', () => ({
  learnerStateReviewService: { refreshInBackground: mockRefreshLearnerStateReview },
}));
jest.mock('../../learner/ConceptConsolidatorService', () => ({
  conceptConsolidatorService: { refreshInBackground: mockRefreshConceptConsolidator },
}));
jest.mock('../../memory/concept-load.service', () => ({
  conceptLoadService: { warmInBackground: mockWarmConceptLoad },
}));
jest.mock('../lesson-prep.service', () => ({
  lessonPrepService: { prepareNextLesson: mockPrepareNextLesson },
}));
jest.mock('../../memory/memory-trace.service', () => ({
  memoryTraceService: { recordSessionOutcome: mockRecordSessionOutcome },
}));
jest.mock('../../learner/misconception-ledger.service', () => ({
  markMisconceptionsAddressed: mockMarkMisconceptionsAddressed,
}));
jest.mock('../../learner/churn-evidence.service', () => ({
  recordChurnRiskAtFinalize: mockRecordChurnRiskAtFinalize,
}));
jest.mock('../teaching-checkpoint', () => {
  const actual = jest.requireActual('../teaching-checkpoint');
  return {
    ...actual,
    // 故意保留真实 getPendingCheckpoint（判别性要求：H1 留痕断言必须在"确有挂起检查点"时才有意义）
    recordCheckpointAttemptEvidence: mockRecordCheckpointAttemptEvidence,
  };
});

import { endSession, isAbnormalSessionClosure } from '../teaching-session-lifecycle';
import { getPendingCheckpoint } from '../teaching-checkpoint';

function snapshot() {
  return {
    dynamicState: { recentTrend: null, fatigueRisk: null, recommendedPacing: null },
    knowledgeMemory: { currentPath: null },
    profile: null,
  };
}

function session(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sess-abandon-1',
    userId: 'user-1',
    taskId: 'task-1',
    learningPathId: 'path-1',
    milestoneId: 'ms-1',
    subject: '生物',
    topic: '光合作用',
    taskType: 'concept',
    mode: 'tutor',
    status: 'active',
    messages: [
      { role: 'user', content: '开始吧', timestamp: '2026-10-06T10:00:00.000Z' },
      { role: 'assistant', content: '好', timestamp: '2026-10-06T10:00:30.000Z' },
      { role: 'user', content: '我懂了', timestamp: '2026-10-06T10:01:00.000Z' },
    ],
    knowledgeState: [{ name: '叶绿体', status: 'learning', progress: 40 }],
    // 挂起检查点：收尾时仍未作答 → 正常路径必须落一条 checkpoint:attempt(unresolved)；
    // 弃跑路径不得落（该断言依赖这里的非空 fixture，否则不具判别力）
    teachingState: {
      pendingCheckpoint: { id: 'cp-1', type: 'short_answer', question: '根细胞里有没有叶绿体？' },
      sessionArtifacts: { initialKnowledgeState: [] },
    },
    wrapup: null,
    advisory: null,
    startTime: new Date('2026-10-06T09:50:00.000Z'),
    endTime: null,
    duration: null,
    revision: 7,
    openKey: 'open-1',
    operationId: null,
    operationKind: null,
    operationLeaseExpiresAt: null,
    createdAt: new Date('2026-10-06T09:50:00.000Z'),
    updatedAt: new Date('2026-10-06T10:01:00.000Z'),
    ...overrides,
  };
}

/** 让 LLM 收尾产出可用评估 → scoreInput 非空（正常路径必然走 prepareSessionScoreCommit） */
function primeWrapupLlm() {
  mockExecuteSkill.mockResolvedValue({
    internal: {
      ext: {
        sessionWrapup: {
          result: {
            evaluation: { sessionLss: 7, sessionKtl: 6, sessionLf: 5, confidence: 0.8 },
            evaluationSource: 'model',
            summarySource: 'model',
          },
          artifact: { summary: { topicSummary: '本节讲了光合作用' } },
        },
      },
    },
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  primeWrapupLlm();
  mockClaimFinalization.mockResolvedValue({
    status: 'claimed',
    operationId: 'end-op-1',
    leaseOwner: 'lease-1',
    session: session({ status: 'finalizing' }),
  });
  mockCompleteWithEvent.mockResolvedValue(undefined);
  mockRenewFinalizationLease.mockResolvedValue(new Date(Date.now() + 60_000));
  mockPrepareSessionScoreCommit.mockResolvedValue({
    userId: 'user-1',
    expectedRevision: 3,
    sourceKey: 'session-wrapup:sess-abandon-1',
    data: { sourceKey: 'session-wrapup:sess-abandon-1' },
    metrics: { lss: 6.1, ktl: 5.2, lf: 4.3, lsb: -1.2, timestamp: new Date().toISOString() },
  });
  mockCommitSessionLoadMetric.mockResolvedValue(undefined);
  mockRecordSessionOutcome.mockReturnValue(Promise.resolve());
  mockMarkMisconceptionsAddressed.mockResolvedValue(undefined);
  mockRecordChurnRiskAtFinalize.mockResolvedValue(undefined);
  mockRecordCheckpointAttemptEvidence.mockResolvedValue(undefined);
});

describe('isAbnormalSessionClosure 判定口径', () => {
  it('learner-abandoned 命中（当前唯一可达的异常信号）', () => {
    expect(isAbnormalSessionClosure({ endReason: 'learner-abandoned', status: 'finalizing' })).toBe(true);
  });

  it('正常收束理由不命中（manual-end / task-completed / review-completed / 未传）', () => {
    expect(isAbnormalSessionClosure({ endReason: 'manual-end', status: 'finalizing' })).toBe(false);
    expect(isAbnormalSessionClosure({ endReason: 'task-completed', status: 'finalizing' })).toBe(false);
    expect(isAbnormalSessionClosure({ endReason: 'review-completed', status: 'finalizing' })).toBe(false);
    expect(isAbnormalSessionClosure({ status: 'finalizing' })).toBe(false);
  });

  it('timeout 刻意**不**算异常（可恢复态：超时后回来继续学、正常收束必须逐字不变）', () => {
    expect(isAbnormalSessionClosure({ endReason: 'manual-end', status: 'timeout' })).toBe(false);
    expect(isAbnormalSessionClosure({ endReason: 'learner-abandoned', status: 'timeout' })).toBe(true);
  });

  it('防御性覆盖：discarded / superseded / failed 命中', () => {
    for (const status of ['discarded', 'superseded', 'failed']) {
      expect(isAbnormalSessionClosure({ endReason: 'manual-end', status })).toBe(true);
    }
    expect(isAbnormalSessionClosure({ status: 'active' })).toBe(false);
    expect(isAbnormalSessionClosure({ status: 'completed' })).toBe(false);
  });
});

describe('弃跑/非正常终态收束：只闭合状态机，不写正式轨', () => {
  it('fixture 前置：会话确实带挂起检查点（无此条则 H1 留痕断言不具判别力）', () => {
    expect(getPendingCheckpoint(session().teachingState)).toEqual(
      expect.objectContaining({ id: 'cp-1' })
    );
  });

  it('learner-abandoned：状态机照常闭合，正式轨七项写入全部跳过', async () => {
    const result = await endSession('sess-abandon-1', 'learner-abandoned', 7, 'end-op-1');

    // ① 收束本身照常完成（调用方轮询/清场逻辑不变）
    expect(result.status).toBe('completed');
    expect(result.wrapup).toBeUndefined();
    expect(mockCompleteWithEvent).toHaveBeenCalledTimes(1);

    // ② lesson:completed 事件不带 userId → 证据投影/知识增强/画像刷新全链早退（零 learner_evidence）
    // completeWithEvent(sessionId, operationId, leaseOwner, payload, event, metricCommit)
    const event = mockCompleteWithEvent.mock.calls[0][4];
    expect(event.type).toBe('lesson:completed');
    expect(event.userId).toBeNull();

    // ③ learning_metrics：session-wrapup 的 metricCommit 为 null（第 6 参），session_load 不写
    expect(mockPrepareSessionScoreCommit).not.toHaveBeenCalled();
    expect(mockCompleteWithEvent.mock.calls[0][5]).toBeNull();
    expect(mockCommitSessionLoadMetric).not.toHaveBeenCalled();
    // 不落正式 wrapup（保持 NULL）→ streak/下节 recap/path-mutation 三个 completed+wrapup 消费者读不到
    expect(mockCompleteWithEvent.mock.calls[0][3].wrapup).toBeNull();

    // ④ 记忆回写 / 误解台账 / 休眠信号 / 检查点留痕：全不写
    // （fixture 含挂起检查点，故此条在 HEAD 上会失败——具判别力）
    expect(mockRecordSessionOutcome).not.toHaveBeenCalled();
    expect(mockMarkMisconceptionsAddressed).not.toHaveBeenCalled();
    expect(mockRecordChurnRiskAtFinalize).not.toHaveBeenCalled();
    expect(mockRecordCheckpointAttemptEvidence).not.toHaveBeenCalled();

    // ⑤ aux 课后刷新链（快照/状态评审/概念归并/概念负担/备课）不触发
    expect(mockRefreshDashboardGuidance).not.toHaveBeenCalled();
    expect(mockRefreshLearnerStateReview).not.toHaveBeenCalled();
    expect(mockRefreshConceptConsolidator).not.toHaveBeenCalled();
    expect(mockWarmConceptLoad).not.toHaveBeenCalled();
    expect(mockPrepareNextLesson).not.toHaveBeenCalled();
  });

  it('正常收束（manual-end）：同一 fixture 下正式轨逐项仍然写（对照，防误伤）', async () => {
    const result = await endSession('sess-abandon-1', 'manual-end', 7, 'end-op-1');

    expect(result.status).toBe('completed');
    expect(result.wrapup).toBeTruthy();
    const event = mockCompleteWithEvent.mock.calls[0][4];
    expect(event.userId).toBe('user-1');
    expect(mockPrepareSessionScoreCommit).toHaveBeenCalledTimes(1);
    expect(mockCompleteWithEvent.mock.calls[0][5]).not.toBeNull();
    expect(mockCommitSessionLoadMetric).toHaveBeenCalledTimes(1);
    const wrapup = mockCompleteWithEvent.mock.calls[0][3].wrapup;
    expect(wrapup.stateUpdate).toEqual(expect.objectContaining({ lss: 6.1 }));
    expect(mockRecordSessionOutcome).toHaveBeenCalledTimes(1);
    expect(mockMarkMisconceptionsAddressed).toHaveBeenCalledTimes(1);
    expect(mockRecordChurnRiskAtFinalize).toHaveBeenCalledTimes(1);
    // 挂起检查点未作答 → 正常路径必须留痕（判别性对照：弃跑路径为 0）
    expect(mockRecordCheckpointAttemptEvidence).toHaveBeenCalledTimes(1);
    expect(mockRefreshDashboardGuidance).toHaveBeenCalledTimes(1);
    expect(mockPrepareNextLesson).toHaveBeenCalledTimes(1);
  });

  it('status=discarded 的防御分支同样不写正式轨', async () => {
    mockClaimFinalization.mockResolvedValue({
      status: 'claimed',
      operationId: 'end-op-2',
      leaseOwner: 'lease-2',
      session: session({ status: 'discarded' }),
    });

    const result = await endSession('sess-abandon-1', 'manual-end', 7, 'end-op-2');

    expect(result.status).toBe('completed');
    expect(mockCompleteWithEvent.mock.calls[0][4].userId).toBeNull();
    expect(mockCompleteWithEvent.mock.calls[0][3].wrapup).toBeNull();
    expect(mockPrepareSessionScoreCommit).not.toHaveBeenCalled();
    expect(mockCommitSessionLoadMetric).not.toHaveBeenCalled();
    expect(mockRecordSessionOutcome).not.toHaveBeenCalled();
    expect(mockRecordCheckpointAttemptEvidence).not.toHaveBeenCalled();
  });
});