/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * 检查点提交链路集成（全量测试报告 #15/#16）：
 *  - #16「turn-engine 计数→强制消费」：同一 cpId 累计作答（含本轮）达到 CHECKPOINT_MAX_ATTEMPTS(=2)
 *    且仍答错 → 强制清 pendingCheckpoint（打破同一题逐轮重发）；未到顶 → 保留 pendingCheckpoint 允许重答；
 *    答对 → 消费。
 *  - #15 简答判分样本在真实引擎链上贯通：代码裁决（含同义组「甲|乙」）→ checkpointHistory 留痕
 *    （passed/judgedBy=code）→ 提交回执 passed 与裁决一致。
 *  - 同题复问抑制（TONIGHT-BROAD-2026-10-07 宽域 C 轨缺陷②）：候选题面与本会话已出过的题面
 *    归一后同文 → 本回合不出题 + 遥测；异题/空历史照常出题。判据与归一逻辑走真实实现。
 *
 * 只 mock 外部协作者（LLM/上下文/观测），检查点判定与消费决策走真实实现。
 */
const mockClaimOperation = jest.fn()
const mockCommitTurnState = jest.fn()
const mockReleaseOperation = jest.fn()
const mockTurnSkill = jest.fn()
const mockRecordCheckpointEvidence = jest.fn(async () => undefined)
const mockRecordCheckpointAttemptEvidence = jest.fn(async () => undefined)
const mockRecordAnchorProbeResult = jest.fn(async () => undefined)
const mockResolveAnchorTarget = jest.fn(async () => null)
const mockRecordDegradation = jest.fn()

jest.mock('../../../config/database', () => ({
  __esModule: true,
  default: { teacher_observations: {}, misconceptions: {}, learner_evidence: {} },
}))
jest.mock('../../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}))
jest.mock('../../../skills', () => ({
  executeSkill: (...args: unknown[]) => mockTurnSkill(...args),
  executeSkillWithResult: jest.fn(),
  auxSkillDefinitionMap: {},
  peerAgentDefinition: {},
}))
jest.mock('../../../skills/teaching-turn', () => ({ teachingTurnAgentDefinition: {} }))
// 降级遥测：同题复问抑制必须打遥测（source='ai-teaching/teaching-turn-checkpoint'），此处只断言调用
jest.mock('../../../skills/degradation-telemetry', () => ({
  recordDegradation: (...args: unknown[]) => mockRecordDegradation(...args),
  degradationCause: (error: unknown) => (error instanceof Error ? error.message : String(error)),
}))
jest.mock('../TeachingContextBuilder', () => ({
  buildTeachingScenarioContext: jest.fn(async () => ({
    subject: '护理', topic: '数值与动作配对',
    taskTitle: '圈出数值旁边的护理动作词', taskDescription: '按课文圈词并配对', taskType: 'practice',
    taskProfile: { knowledgeType: 'procedural', cognitiveLevel: 'apply' },
    currentTaskContext: { description: '圈词配对', acceptanceCriteria: '能说出动作词与数值的对应' },
    cognitiveFrame: { targetRelation: '把数值与动作词配对成可回查的记录', transferGoal: null, cognitiveLevel: 'apply' }, learnerProjection: null,
    pathProgress: { pathTitle: '护考两科过线', pathSummary: null, currentMilestoneTitle: '数值与动作', currentStageNumber: 1, currentTaskOrder: 1, totalTasksInMilestone: 3 },
    taskKnowledgeSeeds: [], anchorMasteredLastSeenAt: null, learningState: null,
  })),
}))
jest.mock('../../field-dispatcher', () => ({
  assembleTeachingTurnChannels: jest.fn(async () => ({ channels: {}, skipped: [] })),
}))
jest.mock('../teaching-classroom-flow', () => {
  const actual = jest.requireActual('../teaching-classroom-flow')
  return {
    ...actual,
    buildLearnerStateContext: () => ({}),
    buildTeachingControlContext: () => ({}),
    buildPathBackgroundContext: () => null,
  }
})
jest.mock('../TeachingContextCompressionService', () => ({
  teachingContextCompressionService: { compress: () => ({ messages: [] }) },
}))
// KnowledgeStateService 真实实现（纯函数，无 IO），无需 mock
jest.mock('../PeerTriggerService', () => ({
  peerTriggerService: { shouldTrigger: () => false },
}))
jest.mock('../teaching-visual.service', () => ({
  generateTeachingVisual: jest.fn(async () => null),
  buildVisualOpportunity: jest.fn(() => null),
  detectExerciseLeakInReply: jest.fn(() => false),
}))
jest.mock('../../../services/learning/learning-state.service', () => ({
  learningStateService: {
    coerceMetrics: (value: unknown) => value || { lss: 0, ktl: 0, lf: 0, lsb: 0 },
    calculateRuntimeState: () => ({ lss: 0.5, ktl: 0.5, lf: 0.5, lsb: 0.5 }),
  },
}))
jest.mock('../../memory/memory-trace.service', () => ({
  memoryTraceService: { applyKtEstimate: jest.fn(async () => undefined) },
}))
jest.mock('../../learner/misconception-ledger.service', () => ({
  recordMisconceptions: jest.fn(async () => undefined),
}))
jest.mock('../../background-task-tracker.service', () => ({
  runBackgroundTask: jest.fn(async (_name: string, fn: () => Promise<unknown>) => fn()),
}))
jest.mock('../TeachingOperationLeaseGuard', () => ({
  TeachingOperationLeaseGuard: class {
    start() {}
    stop() {}
  },
}))
jest.mock('../TeachingSessionRepository', () => {
  const actual = jest.requireActual('../TeachingSessionRepository')
  return {
    ...actual,
    teachingSessionRepository: {
      claimOperation: (...args: unknown[]) => mockClaimOperation(...args),
      commitTurnState: (...args: unknown[]) => mockCommitTurnState(...args),
      releaseOperation: (...args: unknown[]) => mockReleaseOperation(...args),
    },
  }
})
jest.mock('../teaching-checkpoint', () => {
  const actual = jest.requireActual('../teaching-checkpoint')
  return {
    ...actual,
    recordCheckpointResultEvidence: (...args: any[]) => mockRecordCheckpointEvidence(...(args as [])),
    recordCheckpointAttemptEvidence: (...args: any[]) => mockRecordCheckpointAttemptEvidence(...(args as [])),
    recordAnchorProbeResult: (...args: any[]) => mockRecordAnchorProbeResult(...(args as [])),
    resolveAnchorProbeTarget: (...args: any[]) => mockResolveAnchorTarget(...(args as [])),
  }
})

import { processStudentMessage } from '../teaching-turn-engine'
import { isDuplicateCheckpointQuestion, judgeCheckpointAnswer } from '../teaching-checkpoint'

const CHECKPOINT = {
  id: 'cp-1',
  title: '理解检查',
  type: 'short_answer' as const,
  question: '下个月产量汇总这个动作，改用手动复制粘贴会带来什么额外工作？',
  expectedKeywords: ['重新|重填', '再做'],
  allowSkip: true,
};

/** 同题复问抑制用例的候选题面（与 CHECKPOINT.question 同文） */
const CANDIDATE_QUESTION = '下个月产量汇总这个动作，改用手动复制粘贴会带来什么额外工作？';

function sessionRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sess-1',
    userId: 'user-1',
    taskId: 'task-1',
    status: 'active',
    mode: 'tutor',
    messages: [
      { role: 'assistant', content: '我们开始吧', timestamp: new Date().toISOString() },
    ],
    knowledgeState: [],
    teachingState: {
      pendingCheckpoint: CHECKPOINT,
      checkpointHistory: [],
      classroomContext: { stage: { current: 'teaching' } },
      sessionArtifacts: {},
    },
    revision: 5,
    startTime: new Date(),
    ...overrides,
  };
}

function claim(session: any) {
  return { operationId: 'op-1', session, messagesBaseCount: session.messages.length };
}

function turnSkillResult(reply = '我们再对照一遍：这道题的关键动作是重填。', control: Record<string, unknown> = {}) {
  return {
    success: true,
    internal: {
      ext: {
        teachingTurnOutcome: {
          artifact: {
            reply,
            analysis: { understanding: 0.8, engagement: 0.7, confusionPoints: [] },
            knowledge: { currentPoint: '汇总动作', points: [] },
            control,
            pedagogy: { strategies: ['feedback'] },
          },
        },
      },
    },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockCommitTurnState.mockResolvedValue(undefined);
  mockTurnSkill.mockResolvedValue(turnSkillResult());
})

describe('检查点提交链路集成（报告 #15/#16）', () => {
  it('答错未到顶（历史 0 次）→ 保留 pendingCheckpoint，可重答；历史留痕 judgedBy=code', async () => {
    const session = sessionRecord();
    mockClaimOperation.mockResolvedValue(claim(session));
    const judgement = judgeCheckpointAnswer(CHECKPOINT, { answerText: '我把表复制一份再填一遍。' });

    const result = await processStudentMessage('sess-1', '理解检查：…我的答案：我把表复制一份再填一遍。', {
      operationClaim: claim(session) as never,
      checkpointId: 'cp-1',
      checkpointJudgement: judgement,
      checkpointSubmission: {},
    });

    expect(result.checkpointResolution).toEqual({ passed: false, understanding: 0.8, judgedBy: 'code' });
    const committedState = (mockCommitTurnState.mock.calls[0][2] as any).teachingState;
    expect(committedState.pendingCheckpoint).toBeTruthy();
    const history = committedState.checkpointHistory;
    expect(history).toHaveLength(1);
    expect(history[0]).toEqual(expect.objectContaining({ checkpointId: 'cp-1', passed: false, judgedBy: 'code' }));
    // 同题复问抑制的写侧：完整题面随作答落进历史（读侧 isDuplicateCheckpointQuestion 据此比对）
    expect(history[0].question).toBe(CHECKPOINT.question);
    // 独立传感器留痕：真实裁决对象原样交给证据层
    expect(mockRecordCheckpointEvidence).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: 'cp-1' }),
      expect.objectContaining({ passed: false, judgedBy: 'code', detail: expect.stringContaining('缺少要点') }),
    );
    // H1 负对照：未到顶的普通答错不写终局留痕（只有真正的终局才落 checkpoint:attempt）
    expect(mockRecordCheckpointAttemptEvidence).not.toHaveBeenCalled();
  })

  it('同义组命中（重填|再做）→ 判过并消费 pendingCheckpoint', async () => {
    const session = sessionRecord();
    mockClaimOperation.mockResolvedValue(claim(session));
    const judgement = judgeCheckpointAnswer(CHECKPOINT, { answerText: '表复制一份，数字重填一遍，还得再做一次核对。' });
    expect(judgement?.passed).toBe(true);

    const result = await processStudentMessage('sess-1', '理解检查：…我的答案：表复制一份，数字重填一遍，还得再做一次核对。', {
      operationClaim: claim(session) as never,
      checkpointId: 'cp-1',
      checkpointJudgement: judgement,
      checkpointSubmission: {},
    });

    expect(result.checkpointResolution?.passed).toBe(true);
    const committedState = (mockCommitTurnState.mock.calls[0][2] as any).teachingState;
    expect(committedState.pendingCheckpoint).toBeUndefined();
    expect(committedState.sessionArtifacts?.pendingCheckpoint).toBeUndefined();
  })

  it('同一 cpId 累计答错到顶（历史 1 次 + 本轮 = 2）→ 强制消费，打破逐轮重发', async () => {
    const session = sessionRecord({
      teachingState: {
        pendingCheckpoint: CHECKPOINT,
        checkpointHistory: [
          { checkpointId: 'cp-1', title: '理解检查', type: 'short_answer', passed: false, judgedBy: 'code', submittedAt: new Date(Date.now() - 120_000).toISOString() },
        ],
        classroomContext: { stage: { current: 'teaching' } },
        sessionArtifacts: {},
      },
    });
    mockClaimOperation.mockResolvedValue(claim(session));
    const judgement = judgeCheckpointAnswer(CHECKPOINT, { answerText: '我先按常规观察记录处理。' });

    const result = await processStudentMessage('sess-1', '理解检查：…我的答案：我先按常规观察记录处理。', {
      operationClaim: claim(session) as never,
      checkpointId: 'cp-1',
      checkpointJudgement: judgement,
      checkpointSubmission: {},
    });

    expect(result.checkpointResolution?.passed).toBe(false);
    const committedState = (mockCommitTurnState.mock.calls[0][2] as any).teachingState;
    // 到顶强制消费：不再挂同一题（否则课堂在同一确认点空转）
    expect(committedState.pendingCheckpoint).toBeUndefined();
    expect(committedState.sessionArtifacts?.pendingCheckpoint).toBeUndefined();
    expect(committedState.checkpointHistory).toHaveLength(2);
    expect(committedState.checkpointHistory.every((row: any) => row.checkpointId === 'cp-1')).toBe(true);
    // H1 失败留痕：到顶强消的终局也要落 checkpoint:attempt（此前只写日志、测量层不可见）
    expect(mockRecordCheckpointAttemptEvidence).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: 'cp-1' }),
      expect.objectContaining({ outcome: 'attempts_exhausted', attempts: 2 }),
    );
  })
})

describe('检查点同题复问抑制（TONIGHT-BROAD-2026-10-07 宽域 C 轨缺陷②）', () => {
  const ANSWER_TEXT = '表复制一份，数字重填一遍，还得再做一次核对。';
  const OTHER_QUESTION = '如果把汇总动作拆成两个步骤，先做哪一步能少返工？';

  /** 造一个"已出过某题"的上一回合状态（历史行形如落库形状） */
  function stateWithHistory(history: unknown) {
    return {
      checkpointHistory: history,
      classroomContext: { stage: { current: 'teaching' } },
      sessionArtifacts: {},
    };
  }

  /** 一轮真实提交：学生答对 cp-1 → 历史留痕（含完整题面），返回本回合落库的 teachingState */
  async function answerAndConsumeCheckpoint() {
    const session = sessionRecord();
    mockClaimOperation.mockResolvedValue(claim(session));
    await processStudentMessage('sess-1', `理解检查：…我的答案：${ANSWER_TEXT}`, {
      operationClaim: claim(session) as never,
      checkpointId: 'cp-1',
      checkpointJudgement: judgeCheckpointAnswer(CHECKPOINT, { answerText: ANSWER_TEXT }),
      checkpointSubmission: {},
    });
    return (mockCommitTurnState.mock.calls[0][2] as any).teachingState as Record<string, any>;
  }

  /** 下一轮：模型又输出一道检查点候选（control.checkpoint），返回落库状态与回合结果 */
  async function emitCandidate(teachingState: Record<string, any>, candidate: Record<string, unknown>) {
    const session = sessionRecord({ teachingState });
    mockClaimOperation.mockResolvedValue(claim(session));
    mockTurnSkill.mockResolvedValue(turnSkillResult('我们再确认一下别的做法。', { checkpoint: candidate }));
    const result = await processStudentMessage('sess-1', '我明白了', {
      operationClaim: claim(session) as never,
    });
    const committed = (mockCommitTurnState.mock.calls[mockCommitTurnState.mock.calls.length - 1][2] as any).teachingState;
    return { committed, result };
  }

  it('已答题面落历史（写侧）→ 下一轮同文候选被抑制 + 打遥测，课堂照常继续', async () => {
    // 第 1 轮：真实答题链路落历史（题面全文入档，供后续比对）
    const afterAnswer = await answerAndConsumeCheckpoint();
    expect(afterAnswer.checkpointHistory[0]).toEqual(expect.objectContaining({
      checkpointId: 'cp-1',
      question: CHECKPOINT.question,
    }));
    expect(afterAnswer.pendingCheckpoint).toBeUndefined();

    // 第 2 轮：模型再输出完全同文的题面 → 不再问第二遍
    const { committed, result } = await emitCandidate(afterAnswer, {
      type: 'short_answer',
      question: CHECKPOINT.question,
      expectedKeywords: ['重新|重填'],
    });

    expect(committed.pendingCheckpoint).toBeUndefined();
    expect(committed.lastCheckpointTurn).toBeUndefined();
    expect(result.checkpoint).toBeNull();
    // 课堂未被阻塞：回合正常产出回复与知识看板
    expect(result.aiResponse).toContain('别的做法');
    expect(mockRecordDegradation).toHaveBeenCalledWith(expect.objectContaining({
      source: 'ai-teaching/teaching-turn-checkpoint',
      severity: 'P2_DEGRADED',
      mitigationApplied: 'suppress-duplicate-checkpoint',
    }));
  })

  it('归一异写（大小写/空白/全半角标点）也命中同一题 → 抑制', async () => {
    const { committed, result } = await emitCandidate(
      stateWithHistory([{
        checkpointId: 'cp-old',
        title: '旧题',
        type: 'short_answer',
        passed: true,
        question: '  Water Cycle 里 Evaporation 与 Condensation  的区别是什么？',
      }]),
      { type: 'short_answer', question: 'water cycle里evaporation与condensation的区别是什么?' },
    );

    expect(committed.pendingCheckpoint).toBeUndefined();
    expect(result.checkpoint).toBeNull();
    expect(mockRecordDegradation).toHaveBeenCalledTimes(1);
  })

  it('异题（归一后不同）→ 正常出题，不打遥测', async () => {
    const { committed, result } = await emitCandidate(
      stateWithHistory([{
        checkpointId: 'cp-old',
        title: '旧题',
        type: 'short_answer',
        passed: true,
        question: CHECKPOINT.question,
      }]),
      { type: 'short_answer', question: OTHER_QUESTION, expectedKeywords: ['先分类'] },
    );

    expect(committed.pendingCheckpoint).toEqual(expect.objectContaining({
      question: OTHER_QUESTION,
      type: 'short_answer',
      allowSkip: true,
    }));
    expect(committed.lastCheckpointTurn).toBe(2);
    expect(result.checkpoint?.question).toBe(OTHER_QUESTION);
    expect(mockRecordDegradation).not.toHaveBeenCalled();
  })

  it('空/缺失历史 → 不受影响，照常出题', async () => {
    const { committed, result } = await emitCandidate(
      { classroomContext: { stage: { current: 'teaching' } }, sessionArtifacts: {} },
      { type: 'short_answer', question: CANDIDATE_QUESTION },
    );

    expect(committed.pendingCheckpoint).toEqual(expect.objectContaining({ question: CANDIDATE_QUESTION }));
    expect(result.checkpoint?.question).toBe(CANDIDATE_QUESTION);
    expect(mockRecordDegradation).not.toHaveBeenCalled();
  })
})

describe('isDuplicateCheckpointQuestion：同题判据（归一与边界）', () => {
  const question = 'Water Cycle 里 evaporation 与 condensation 的区别是什么？';

  it('完全同文 → 命中', () => {
    expect(isDuplicateCheckpointQuestion([{ checkpointId: 'cp-1', question }], question)).toBe(true);
  })

  it('异题不命中（只拦完全同文，换表征的新题不得被误杀）', () => {
    expect(isDuplicateCheckpointQuestion([{ question: `${question}请举例说明。` }], question)).toBe(false);
    expect(isDuplicateCheckpointQuestion([{ question: '另一个问题？' }], question)).toBe(false);
  })

  it('空历史 / 脏行 / 空题面 → 不命中（不因脏数据误抑制）', () => {
    expect(isDuplicateCheckpointQuestion(undefined, question)).toBe(false);
    expect(isDuplicateCheckpointQuestion([], question)).toBe(false);
    expect(isDuplicateCheckpointQuestion([{ checkpointId: 'cp-1' }], question)).toBe(false);
    expect(isDuplicateCheckpointQuestion([{ question: '   ' }], question)).toBe(false);
    expect(isDuplicateCheckpointQuestion([{ question }], '   ')).toBe(false);
  })

  it('旧行只有 title：短题仍可拦；长题 title 带省略号不与完整题面相等', () => {
    expect(isDuplicateCheckpointQuestion([{ title: '水分如何运输？' }], '水分如何运输？')).toBe(true);
    expect(isDuplicateCheckpointQuestion([{ title: `${question.slice(0, 20)}…` }], question)).toBe(false);
  })
})
