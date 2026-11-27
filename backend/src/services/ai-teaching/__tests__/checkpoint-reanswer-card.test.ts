/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * 答错重答卡断链修复（2026-11-22 链路#1 真实课堂走查实锤）：
 * 答错后引擎就地换题面重答（#50，同 cpId 保留 pendingCheckpoint），回合结果里带着
 * 剥过答案键的 checkpoint（checkpointForMessageResult）——但 buildCheckpointSubmitResult
 * 白名单漏了这个字段，提交响应永远不带回新卡。前端收掉旧卡后新题只剩正文文本：
 * 学员要么抄题手打答案（绕开代码裁决），要么刷新页面等 /detail 恢复。
 * 钉住：答错（同题重答与换题面同型）→ result.checkpoint 在场；答对消费 → 键缺席；
 * 幂等结算走同一组装函数，重放形状一致。
 */
const mockClaimOperation = jest.fn()
const mockCommitTurnState = jest.fn()
const mockReleaseOperation = jest.fn()
const mockProcessStudentMessage = jest.fn()

jest.mock('../../../config/database', () => ({
  __esModule: true,
  default: {},
}))
jest.mock('../../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}))
jest.mock('../../../skills', () => ({
  executeSkill: jest.fn(),
  peerAgentDefinition: {},
  auxSkillDefinitionMap: {},
}))
jest.mock('../teaching-turn-engine', () => ({ processStudentMessage: (...args: unknown[]) => mockProcessStudentMessage(...args) }))
jest.mock('../warmup-writeback', () => ({ applyWarmupExtractionForSession: jest.fn(async () => undefined) }))
jest.mock('../TeachingOperationLeaseGuard', () => ({
  TeachingOperationLeaseGuard: class {
    start() {}
    stop() {}
  },
}))
jest.mock('../teaching-classroom-flow', () => ({
  buildTeachingStateWithArtifacts: (state: unknown) => state,
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

import { buildCheckpointSubmitResult, submitCheckpoint } from '../teaching-session-ops'

const CHECKPOINT = {
  id: 'cp-1',
  title: '理解检查',
  type: 'single_choice' as const,
  question: '要让第3行当列名，header 应该写几？',
  options: [
    { id: 'A', text: 'header=0' },
    { id: 'B', text: 'header=2' },
    { id: 'C', text: 'header=3' },
  ],
  correctOptionIds: ['B'],
  allowSkip: false,
}

/** 换题面重答后的待答卡（同 cpId、答案键已由引擎剥离） */
const REARMED = {
  id: 'cp-1',
  title: '理解检查',
  type: 'single_choice' as const,
  question: '要让第1行当列名，header 填几？',
  options: [
    { id: 'A', text: 'header=1' },
    { id: 'B', text: 'header=0' },
    { id: 'C', text: 'header=2' },
  ],
  allowSkip: false,
}

function makeSession() {
  return {
    id: 'sess-1',
    userId: 'user-1',
    taskId: 'task-1',
    learningPathId: 'path-1',
    status: 'active',
    revision: 5,
    messages: [],
    knowledgeState: [],
    teachingState: {
      pendingCheckpoint: { ...CHECKPOINT },
      checkpointHistory: [],
      sessionArtifacts: {},
    },
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  mockCommitTurnState.mockResolvedValue(undefined)
})

describe('buildCheckpointSubmitResult：重答卡随提交响应带回', () => {
  it('回合结果带 checkpoint → 原样透传（含换题面后的新题面）', () => {
    const result = buildCheckpointSubmitResult({
      aiResponse: '这道没对上……',
      revision: 6,
      checkpointResolution: { passed: false },
      checkpoint: REARMED,
    })
    expect(result.passed).toBe(false)
    expect(result.checkpoint).toEqual(REARMED)
    expect(result.checkpoint?.question).toBe('要让第1行当列名，header 填几？')
  })

  it('答对消费（checkpoint 为 null）→ 键缺席，前端保持收卡', () => {
    const result = buildCheckpointSubmitResult({
      aiResponse: '对，header 从 0 数起。',
      revision: 6,
      checkpointResolution: { passed: true },
      checkpoint: null,
    })
    expect(result.passed).toBe(true)
    expect('checkpoint' in result).toBe(false)
  })

  it('契约四件套随提交响应带回（小测是拿证据的主通道，契约卡据此实时跳变）', () => {
    const contract = { coreKcs: [{ name: '调用read_excel读表' }], minIndependentEvidence: 1 };
    const report = { met: false, independentCount: 1, requiredIndependent: 1, coveredKcs: ['调用read_excel读表'] };
    const result = buildCheckpointSubmitResult({
      aiResponse: '对。',
      revision: 8,
      checkpointResolution: { passed: true },
      checkpoint: null,
      lessonContract: { ...contract, correctOptionIds: ['B'] } as any,
      lessonReport: report as any,
      exitTicket: { asked: false } as any,
      branch: { kind: 'spine', active: false } as any,
    });
    expect(result.lessonContract?.coreKcs).toEqual(contract.coreKcs);
    // 契约载荷里混进的答案键在出站被同一把深剥离剥掉
    expect('correctOptionIds' in (result.lessonContract as any)).toBe(false);
    expect(result.lessonReport?.independentCount).toBe(1);
    expect(result.exitTicket).toEqual({ asked: false });
    expect(result.branch).toEqual({ kind: 'spine', active: false });
  });

  it('幂等结算共用同一组装：重放形状与首跑一致', () => {
    const turn = { aiResponse: '讲解', revision: 7, checkpointResolution: { passed: false }, checkpoint: REARMED }
    // settlementResult 把回合载荷转成账本结果；重放直接返回同一形状
    const settled = buildCheckpointSubmitResult(turn as any)
    expect(settled).toEqual(buildCheckpointSubmitResult(turn as any))
    expect(settled.checkpoint?.id).toBe('cp-1')
  })

  // 2026-11-26 真课实录：作答后的响应不带 lessonPhase，前端阶段条从「整合/迁移」
  // 直接回落到「协议未生效」——阶段机在跑，读数却断了。
  it('提交回合必须带回阶段摘要（缺了阶段条会回落「协议未生效」）', () => {
    const lessonPhase = {
      phase: 'transfer', profile: 'full', label: '迁移', segment: 3, segmentCount: 3,
      emitCheckpoint: true, checkKind: 'transfer', revealLevel: 3, boardReveal: 'full',
      passedPhases: [], challengesUpheld: 0,
    }
    const result = buildCheckpointSubmitResult({
      aiResponse: '这块还没对上。',
      revision: 9,
      checkpointResolution: { passed: false },
      checkpoint: null,
      lessonPhase,
    })
    expect(result.lessonPhase).toEqual(lessonPhase)
    // 协议未生效（旧课堂/杀开关）→ 键缺席，前端保持原读数不动
    expect('lessonPhase' in buildCheckpointSubmitResult({ aiResponse: '好。', revision: 2 })).toBe(false)
  })

  it('提交回合同步透传板书/配图/知识点/伴学与完课信号（缺席时不补空键）', () => {
    const bare = buildCheckpointSubmitResult({ aiResponse: '好。', revision: 2 })
    expect('figures' in bare).toBe(false)
    expect('knowledgePoints' in bare).toBe(false)
    expect('peerTriggered' in bare).toBe(false)
    expect('isCompletion' in bare).toBe(false)

    const result = buildCheckpointSubmitResult({
      aiResponse: '理解得很准，板书已更新。',
      revision: 10,
      checkpointResolution: { passed: true },
      checkpoint: null,
      figures: [{ engine: 'svg', kind: 'concept-map', board: true, boardRevision: 2 } as any],
      diagrams: [{ engine: 'mermaid', code: 'graph LR; A-->B;' }],
      knowledgePoint: '作用域查找链',
      knowledgePoints: [{ name: '作用域查找链', status: 'mastered', progress: 100 }],
      confirmCheck: { prompt: '要继续吗', actions: [{ label: '继续', message: '继续' }] },
      peerTriggered: true,
      peerMessage: '这块顺手举个反例试试？',
      peerStrategy: 'counterexample',
      peerFollowUpQuestions: ['换成闭包还成立吗？'],
      isCompletion: true,
    })

    expect(result.figures).toHaveLength(1)
    expect(result.diagrams).toHaveLength(1)
    expect(result.knowledgePoint).toBe('作用域查找链')
    expect(result.knowledgePoints).toEqual([{ name: '作用域查找链', status: 'mastered', progress: 100 }])
    expect(result.confirmCheck?.actions).toHaveLength(1)
    expect(result.peerTriggered).toBe(true)
    expect(result.peerMessage).toBe('这块顺手举个反例试试？')
    expect(result.peerStrategy).toBe('counterexample')
    expect(result.peerFollowUpQuestions).toEqual(['换成闭包还成立吗？'])
    expect(result.isCompletion).toBe(true)
  })
})

describe('submitCheckpoint 答错链路：响应带回重答卡', () => {
  it('答错（换题面重答）→ result.checkpoint 在场且无答案键', async () => {
    const session = makeSession()
    mockClaimOperation.mockResolvedValue({ operationId: 'op-1', session, messagesBaseCount: 0 })
    mockProcessStudentMessage.mockResolvedValue({
      aiResponse: '这道没对上——header 要写 2…… 下面这道按同样的口径判：……',
      revision: 6,
      checkpointResolution: { passed: false, judgedBy: 'code' },
      checkpoint: REARMED,
    })

    const result = await submitCheckpoint('sess-1', 'cp-1', { selectedOptionIds: ['A'] }, 5)

    expect(result.passed).toBe(false)
    expect(result.checkpoint).toEqual(REARMED)
    // 答案键绝不随行（引擎侧已剥，组装层不再补回）
    expect(result.checkpoint && 'correctOptionIds' in result.checkpoint).toBe(false)
    expect(result.checkpoint && 'expectedKeywords' in result.checkpoint).toBe(false)
  })

  it('答对消费 → result 无 checkpoint 键', async () => {
    const session = makeSession()
    mockClaimOperation.mockResolvedValue({ operationId: 'op-1', session, messagesBaseCount: 0 })
    mockProcessStudentMessage.mockResolvedValue({
      aiResponse: '对。',
      revision: 6,
      checkpointResolution: { passed: true, judgedBy: 'code' },
      checkpoint: null,
    })

    const result = await submitCheckpoint('sess-1', 'cp-1', { selectedOptionIds: ['B'] }, 5)

    expect(result.passed).toBe(true)
    expect('checkpoint' in result).toBe(false)
  })
})
