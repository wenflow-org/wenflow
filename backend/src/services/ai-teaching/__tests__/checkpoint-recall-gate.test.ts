/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * 连续复述问抑制（2026-11-13 修复批 4，课堂 ASSESSMENT_REPEAT_RECALL 聚类重评 5/5）：
 *  - 纯函数 `isCheckpointAnswerAlreadyGiven`：答案键（正确选项文本/简答要点，≥8 归一字符）
 *    在教师已说过的内容里逐字出现 → 该题是对已贴标签材料的复述确认；短术语/无答案键不判。
 *  - 引擎出题门槛：上一问已复述 + 本问又复述 → 本回合抑制出题 + 遥测；单次复述放行但留
 *    `answerAlreadyGiven` 标记（pending → history），下一题门槛据此读「上一问是否复述型」。
 *  - 全链路真值：发射（打标）→ 作答落 history（标记随行）→ 下一题连击被抑制，三段都走真实实现。
 *  - 就地换题面（答错补救）按新题面重算标记，旧标记失真即剥掉。
 *
 * 只 mock 外部协作者（LLM/上下文/观测），复述判定与出题闸走真实实现。
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

import {
  isCheckpointAnswerAlreadyGiven,
  judgeCheckpointAnswer,
} from '../teaching-checkpoint'

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
jest.mock('../../../skills/degradation-telemetry', () => ({
  recordDegradation: (...args: unknown[]) => mockRecordDegradation(...args),
  degradationCause: (error: unknown) => (error instanceof Error ? error.message : String(error)),
}))
jest.mock('../TeachingContextBuilder', () => ({
  buildTeachingScenarioContext: jest.fn(async () => ({
    subject: '劳动法', topic: '无法指认的判断口径',
    taskTitle: '找出合同里无法指认的条款', taskDescription: '按口径逐条核对', taskType: 'practice',
    taskProfile: { knowledgeType: 'conceptual', cognitiveLevel: 'apply' },
    currentTaskContext: { description: '逐条核对', acceptanceCriteria: '能把口径用到新条款上' },
    cognitiveFrame: { targetRelation: '把判断口径迁移到未贴标签的新条款', transferGoal: null, cognitiveLevel: 'apply' }, learnerProjection: null,
    pathProgress: { pathTitle: '合同审查入门', pathSummary: null, currentMilestoneTitle: '口径建立', currentStageNumber: 1, currentTaskOrder: 1, totalTasksInMilestone: 3 },
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
  hasDanglingFigureReference: jest.fn(() => false),
  stripDanglingFigureReferences: jest.fn((text: string) => text),
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

/* ────────────── 纯函数：isCheckpointAnswerAlreadyGiven ────────────── */

describe('isCheckpointAnswerAlreadyGiven（复述问可复算判定）', () => {
  const TAUGHT = '这处条款没有指明履行期限也没有约定验收节点，就是你要找的那处无法指认。';
  const GIVEN_CONCLUSION = '没有指明履行期限也没有约定验收节点';

  it('正确选项文本已在教师内容里逐字出现 → recall', () => {
    const result = isCheckpointAnswerAlreadyGiven(
      {
        options: [
          { id: 'A', text: '条款写明了履行期限' },
          { id: 'B', text: GIVEN_CONCLUSION },
        ],
        correctOptionIds: ['B'],
      },
      [TAUGHT],
    );
    expect(result.recall).toBe(true);
    expect(result.matched).toBe('没有指明履行期限也没有约定验收节点');
  });

  it('只有干扰项文本命中、正确项未命中 → 不算复述', () => {
    const result = isCheckpointAnswerAlreadyGiven(
      {
        options: [
          { id: 'A', text: GIVEN_CONCLUSION },
          { id: 'B', text: '另一类完全没出现过的新情形表述' },
        ],
        correctOptionIds: ['B'],
      },
      [TAUGHT],
    );
    expect(result.recall).toBe(false);
  });

  it('简答要点词命中 → recall；要点词过短（<8 归一字符）不参与比对', () => {
    expect(isCheckpointAnswerAlreadyGiven(
      { expectedKeywords: [GIVEN_CONCLUSION] },
      [TAUGHT],
    ).recall).toBe(true);
    // 「无法指认」只有 4 个归一字符——教学必然提过的术语，按它判会把一切简答误判成复述
    expect(isCheckpointAnswerAlreadyGiven(
      { expectedKeywords: ['无法指认'] },
      [TAUGHT],
    ).recall).toBe(false);
  });

  it('无答案键（无 correctOptionIds/expectedKeywords）→ 判不了，false', () => {
    expect(isCheckpointAnswerAlreadyGiven(
      { options: [{ id: 'A', text: '很长很长的选项文本' }] },
      [TAUGHT],
    ).recall).toBe(false);
    expect(isCheckpointAnswerAlreadyGiven(
      { expectedKeywords: ['正确答案是很长的结论句'] },
      '',
    ).recall).toBe(false);
  });

  it('迁移新情形（答案键是教师没说过的新情形）→ false', () => {
    const result = isCheckpointAnswerAlreadyGiven(
      { expectedKeywords: ['另一份合同里约定违约金过高的条款'] },
      [TAUGHT],
    );
    expect(result.recall).toBe(false);
  });
});

/* ────────────── 引擎出题门槛：连续复述抑制 ────────────── */

/** 教师已说过的口径（MESSAGES_WITH_ANALYSIS 里的教学内容，候选答案键据此判定复述） */
const TAUGHT_PHRASE = '先把无法指认的口径拆成两步讲清楚';

const MESSAGES_WITH_ANALYSIS = [
  { role: 'assistant', content: '我们开始吧', timestamp: new Date().toISOString(), analysis: { understanding: 0.8, engagement: 0.7 } },
  { role: 'assistant', content: `${TAUGHT_PHRASE}，然后逐条对照。`, timestamp: new Date().toISOString(), analysis: { understanding: 0.75, engagement: 0.7 } },
];

function sessionRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sess-recall',
    userId: 'user-1',
    taskId: 'task-1',
    status: 'active',
    mode: 'tutor',
    messages: [...MESSAGES_WITH_ANALYSIS],
    knowledgeState: [],
    teachingState: {
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

function turnSkillResult(reply: string, control: Record<string, unknown> = {}) {
  return {
    success: true,
    internal: {
      ext: {
        teachingTurnOutcome: {
          artifact: {
            reply,
            analysis: { understanding: 0.8, engagement: 0.7, confusionPoints: [] },
            knowledge: { currentPoint: '无法指认口径', points: [] },
            control,
            pedagogy: { strategies: ['feedback'] },
          },
        },
      },
    },
  };
}

/** 复述型候选：要点词就是教师刚说过的口径（答对只证明记住了口径） */
const RECALL_CANDIDATE = {
  type: 'short_answer' as const,
  question: '我们刚才把口径拆成了哪两步？',
  expectedKeywords: [TAUGHT_PHRASE],
};

/** 迁移型候选：要点词是教师没说过的新情形（把口径用到未贴标签的新条款） */
const TRANSFER_CANDIDATE = {
  type: 'short_answer' as const,
  question: '另一份合同里「货到后六十日内付款」这处，按口径该怎么判？',
  expectedKeywords: ['六十日内付款没有对应验收节点，属于无法指认的新情形'],
};

beforeEach(() => {
  jest.clearAllMocks();
  mockCommitTurnState.mockResolvedValue(undefined);
  mockResolveAnchorTarget.mockResolvedValue(null);
})

/** 一轮新发射：模型输出 control.checkpoint，返回落库状态与回合结果 */
async function emitCandidate(teachingState: Record<string, any>, candidate: Record<string, unknown>, reply = '我们再来练一处新的。') {
  const session = sessionRecord({ teachingState });
  mockClaimOperation.mockResolvedValue(claim(session));
  mockTurnSkill.mockResolvedValue(turnSkillResult(reply, { checkpoint: candidate }));
  const result = await processStudentMessage('sess-recall', '我明白了', {
    operationClaim: claim(session) as never,
  });
  const committed = (mockCommitTurnState.mock.calls[mockCommitTurnState.mock.calls.length - 1][2] as any).teachingState;
  return { committed, result };
}

describe('检查点连续复述问抑制（2026-11-13 修复批 4）', () => {
  it('上一问已复述（history 标记）+ 本问又复述 → 抑制出题 + 遥测，课堂照常回复', async () => {
    const { committed, result } = await emitCandidate(
      {
        checkpointHistory: [{
          checkpointId: 'cp-old', title: '旧题', type: 'short_answer',
          question: '刚才我们核对的是哪一处条款？', passed: true,
          answerAlreadyGiven: true,
        }],
        classroomContext: { stage: { current: 'teaching' } },
        sessionArtifacts: {},
      },
      RECALL_CANDIDATE,
    );

    expect(committed.pendingCheckpoint).toBeUndefined();
    expect(committed.lastCheckpointTurn).toBeUndefined();
    expect(committed.lastCheckpointConcept).toBeUndefined();
    expect(result.checkpoint).toBeNull();
    // 课堂未被阻塞：回合正常产出回复与知识看板
    expect(result.aiResponse).toContain('新的');
    expect(mockRecordDegradation).toHaveBeenCalledWith(expect.objectContaining({
      source: 'ai-teaching/teaching-turn-checkpoint',
      severity: 'P2_DEGRADED',
      mitigationApplied: 'suppress-consecutive-recall-checkpoint',
    }));
  });

  it('首次复述放行，但 pending 留 answerAlreadyGiven 标记（下一题的「上一问」输入）', async () => {
    const { committed, result } = await emitCandidate(
      { checkpointHistory: [], classroomContext: { stage: { current: 'teaching' } }, sessionArtifacts: {} },
      RECALL_CANDIDATE,
    );

    expect(committed.pendingCheckpoint).toEqual(expect.objectContaining({
      question: RECALL_CANDIDATE.question,
      answerAlreadyGiven: true,
    }));
    expect(result.checkpoint?.question).toBe(RECALL_CANDIDATE.question);
    expect(mockRecordDegradation).not.toHaveBeenCalled();
  });

  it('上一问复述 + 本问是迁移新情形 → 放行且不打标', async () => {
    const { committed, result } = await emitCandidate(
      {
        checkpointHistory: [{
          checkpointId: 'cp-old', title: '旧题', type: 'short_answer',
          question: '我们刚才把口径拆成了哪两步？', passed: true,
          answerAlreadyGiven: true,
        }],
        classroomContext: { stage: { current: 'teaching' } },
        sessionArtifacts: {},
      },
      TRANSFER_CANDIDATE,
    );

    expect(committed.pendingCheckpoint).toEqual(expect.objectContaining({
      question: TRANSFER_CANDIDATE.question,
    }));
    expect(committed.pendingCheckpoint.answerAlreadyGiven).toBeUndefined();
    expect(result.checkpoint?.question).toBe(TRANSFER_CANDIDATE.question);
  });

  it('作废行不算「上一问」：history 只有 voided 复述行 → 复述候选照常放行', async () => {
    const { committed } = await emitCandidate(
      {
        checkpointHistory: [{
          checkpointId: 'cp-voided', title: '被作废的题', type: 'short_answer',
          question: '被撤销的题面', passed: false, voided: true,
          answerAlreadyGiven: true,
        }],
        classroomContext: { stage: { current: 'teaching' } },
        sessionArtifacts: {},
      },
      RECALL_CANDIDATE,
    );

    expect(committed.pendingCheckpoint).toEqual(expect.objectContaining({
      question: RECALL_CANDIDATE.question,
      answerAlreadyGiven: true,
    }));
  });

  it('锚题轮豁免：上一问复述 + 本轮锚题（延迟复测本就是复述）→ 照常落库且不打标', async () => {
    mockResolveAnchorTarget.mockResolvedValueOnce({
      conceptKey: 'cpt_anchor', conceptName: '无法指认口径', expected: 'mastered' as const,
    });
    const { committed } = await emitCandidate(
      {
        checkpointHistory: [{
          checkpointId: 'cp-old', title: '旧题', type: 'short_answer',
          question: '刚才我们核对的是哪一处条款？', passed: true,
          answerAlreadyGiven: true,
        }],
        classroomContext: { stage: { current: 'teaching' } },
        sessionArtifacts: {},
      },
      RECALL_CANDIDATE,
    );

    expect(committed.pendingCheckpoint).toEqual(expect.objectContaining({
      purpose: 'anchor',
      anchorConceptKey: 'cpt_anchor',
    }));
    expect(committed.pendingCheckpoint.answerAlreadyGiven).toBeUndefined();
    expect(mockRecordDegradation).not.toHaveBeenCalled();
  });

  it('全链路真值：发射打标 → 作答落 history（标记随行）→ 下一题连击被抑制', async () => {
    // 第 1 轮：首次复述放行 + 打标
    const first = await emitCandidate(
      { checkpointHistory: [], classroomContext: { stage: { current: 'teaching' } }, sessionArtifacts: {} },
      RECALL_CANDIDATE,
      '我们把口径再对一遍。',
    );
    expect(first.committed.pendingCheckpoint.answerAlreadyGiven).toBe(true);

    // 第 2 轮：学员答对 → 消费 pending，标记随行落 history
    const session2 = sessionRecord({
      teachingState: first.committed,
      messages: [...MESSAGES_WITH_ANALYSIS, { role: 'assistant', content: '我们把口径再对一遍。我们刚才把口径拆成了哪两步？', timestamp: new Date().toISOString() }],
    });
    mockClaimOperation.mockResolvedValue(claim(session2));
    mockTurnSkill.mockResolvedValue(turnSkillResult('答对了，就是这两步。'));
    const pending = first.committed.pendingCheckpoint;
    await processStudentMessage('sess-recall', `我的答案：${TAUGHT_PHRASE}，然后逐条对照。`, {
      operationClaim: claim(session2) as never,
      checkpointId: pending.id,
      checkpointJudgement: judgeCheckpointAnswer(pending, { answerText: `${TAUGHT_PHRASE}，然后逐条对照。` }),
      checkpointSubmission: {},
    });
    const afterAnswer = (mockCommitTurnState.mock.calls[mockCommitTurnState.mock.calls.length - 1][2] as any).teachingState;
    expect(afterAnswer.checkpointHistory[0]).toEqual(expect.objectContaining({
      checkpointId: pending.id,
      answerAlreadyGiven: true,
    }));
    expect(afterAnswer.pendingCheckpoint).toBeUndefined();

    // 第 3 轮：模型又出一道复述题 → 连击被抑制
    const third = await emitCandidate(
      afterAnswer,
      { ...RECALL_CANDIDATE, question: '刚才的口径第一步是什么来着？' },
    );
    expect(third.committed.pendingCheckpoint).toBeUndefined();
    expect(third.result.checkpoint).toBeNull();
    expect(mockRecordDegradation).toHaveBeenCalledWith(expect.objectContaining({
      mitigationApplied: 'suppress-consecutive-recall-checkpoint',
    }));
  });

  it('答错换题面：迁移型新题面 → 旧复述标记被剥掉（就地重算，不把失真标记带进 history）', async () => {
    const session = sessionRecord({
      teachingState: {
        pendingCheckpoint: {
          id: 'cp-stale', title: '旧复述题', type: 'short_answer',
          question: '我们刚才把口径拆成了哪两步？',
          expectedKeywords: [TAUGHT_PHRASE],
          answerAlreadyGiven: true,
          allowSkip: true,
        },
        checkpointHistory: [],
        classroomContext: { stage: { current: 'teaching' } },
        sessionArtifacts: {},
      },
    });
    mockClaimOperation.mockResolvedValue(claim(session));
    mockTurnSkill.mockResolvedValue(turnSkillResult('换个角度，我们练一处新条款。', { checkpoint: TRANSFER_CANDIDATE }));
    await processStudentMessage('sess-recall', '我的答案：不记得了。', {
      operationClaim: claim(session) as never,
      checkpointId: 'cp-stale',
      checkpointJudgement: judgeCheckpointAnswer(
        { type: 'short_answer', expectedKeywords: [TAUGHT_PHRASE] } as never,
        { answerText: '不记得了。' },
      ),
      checkpointSubmission: {},
    });

    const committed = (mockCommitTurnState.mock.calls[0][2] as any).teachingState;
    // 答错未到顶 → pending 保留（就地换题面），标记按新题面重算后剥掉
    expect(committed.pendingCheckpoint).toEqual(expect.objectContaining({
      question: TRANSFER_CANDIDATE.question,
    }));
    expect(committed.pendingCheckpoint.answerAlreadyGiven).toBeUndefined();
  });
});
