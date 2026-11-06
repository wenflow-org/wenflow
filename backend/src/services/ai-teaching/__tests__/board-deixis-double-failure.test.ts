/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * #252：无板任务里的板指代回合——改写重试两次都失败，整轮不得 500，学生这句不得丢。
 *
 * 现象（develop d8160d33 实测，traceId 1793903123327-mkldlqa8g）：守卫触发后走
 * retryStrategy(maxAttempts 2) 改写，两次尝试都仍带板指代时，硬失败让整轮 throw：
 * `POST /api/ai-teaching/sessions/:sid/messages → 500 INTERNAL_ERROR`，而引擎只在成功路径
 * 提交回合状态（teachingSessionRepository.commitTurnState），学生这一轮的 user 消息随之丢失
 * （消息表最后一条还是上一轮，revision 不推进）。
 *
 * 本文件把**真实** prompt-composer（callPrompt）+ **真实** teaching-turn spec/handler
 * （jest.requireActual）+ 假模型（mock 网关）串起来，只把引擎的 skill 调用点接到真实 handler 上，
 * 断言三件事：
 *  ① 假模型连续两次返回同一个无板指代 reply → 整轮 resolve，不抛（= 不再 500）；
 *  ② 改写重试**真的发生**（网关调用 2 次，第 2 次的提示词里带上了点名改写指令）；
 *  ③ commitTurnState 落库的 messages 里含学生这一轮的原文（= 输入不丢）。
 * 单测层面的接线（spec 硬/软校验分工）见 skills/teaching-turn/__tests__/board-deixis-guard.test.ts；
 * 本文件补的是「spec + composer + 引擎」这条真实链路。
 */
const mockClaimOperation = jest.fn()
const mockCommitTurnState = jest.fn()
const mockReleaseOperation = jest.fn()
const mockDesignBoard = jest.fn()
const mockGatewayExecute = jest.fn()
const mockGatewayResolveRoute = jest.fn()
const mockGetActivePrompt = jest.fn()
const mockPromptCallCreate = jest.fn()
const mockExecuteSkill = jest.fn()

jest.mock('../../../config/database', () => ({
  __esModule: true,
  default: {
    teacher_observations: {},
    misconceptions: {},
    learner_evidence: {},
    teaching_sessions: {},
    prompt_call_logs: { create: (...args: unknown[]) => mockPromptCallCreate(...args) },
  },
}))
jest.mock('../../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}))
// 只替换执行器的**入口**：真实 teaching-turn handler（进而真实 composer + 真实 spec）照常执行。
jest.mock('../../../skills', () => {
  const { teachingTurnAgentHandler } = jest.requireActual('../../../skills/teaching-turn')
  return {
    executeSkill: (...args: unknown[]) => mockExecuteSkill(...args),
    executeSkillWithResult: jest.fn(),
    auxSkillDefinitionMap: {},
    peerAgentDefinition: {},
    __teachingTurnAgentHandler: teachingTurnAgentHandler,
  }
})
jest.mock('../../../gateway/api-gateway', () => ({
  getAPIGateway: () => ({ execute: mockGatewayExecute, resolveRoute: mockGatewayResolveRoute }),
}))
jest.mock('../../../services/agentConfig.service', () => ({
  agentConfigService: { getActivePrompt: (...args: unknown[]) => mockGetActivePrompt(...args) },
}))
jest.mock('../board-designer.service', () => ({
  designBoard: (...args: unknown[]) => mockDesignBoard(...args),
}))
jest.mock('../TeachingContextBuilder', () => ({
  buildTeachingScenarioContext: jest.fn(async () => ({
    subject: '心理学', topic: '读懂身边人行为', taskTitle: '把「他为什么这样」改写成能被证据推翻的问法',
    taskDescription: '区分行为描述与可推翻问法', taskType: 'practice',
    taskProfile: { knowledgeType: 'conceptual', cognitiveLevel: 'understand' },
    currentTaskContext: { description: '改写问法', acceptanceCriteria: '能说出可推翻条件' },
    cognitiveFrame: { targetRelation: '证据与结论', transferGoal: null, cognitiveLevel: 'understand' },
    // 生产形态：learner 恒为非空投影（buildPromptInput 直接解构 input.learner）；
    // 本用例只关心 reply 的守卫链路，画像内容取中性值。
    learnerProjection: {
      stableProfile: {
        thinkingStyle: '分析型', preferredStyle: '对话', theoryVsPractice: '偏实践',
        sessionLength: '20-30 分钟', confidenceLevel: '中等',
      },
      liveState: { lss: 5, ktl: 5, lf: 5, lsb: 5, recentTrend: 'stable', recommendedPacing: 'standard', fatigueRisk: 'low' },
      pathContext: {
        pathTitle: '读懂身边人', pathSummary: null, currentMilestoneTitle: '改写问法',
        currentStageNumber: 1, currentTaskOrder: 1, totalTasksInMilestone: 3, completedPrerequisiteTasks: [],
      },
      relevantKnowledge: { mastered: [], fragile: [], struggling: [] },
      backgroundKnowledge: {
        reusableFoundations: [], blockedFoundations: [], recentConceptLedger: [],
        recurringConfusions: [], transferSignals: [],
      },
      learningControlState: { state: 'engaged', suggestedTone: 'warm', suggestedDepth: 'standard' },
      teachingHints: {
        promptEnhancement: '', recommendedApproach: '引导式提问', emphasize: [], avoid: [], riskFactors: [],
      },
    },
    pathProgress: { pathTitle: '读懂身边人', pathSummary: null, currentMilestoneTitle: '改写问法', currentStageNumber: 1, currentTaskOrder: 1, totalTasksInMilestone: 3 },
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
jest.mock('../teaching-visual.service', () => {
  const actual = jest.requireActual('../teaching-visual.service')
  return {
    ...actual,
    generateTeachingVisual: jest.fn(async () => null),
    buildVisualOpportunity: jest.fn(() => null),
    detectExerciseLeakInReply: jest.fn(() => false),
  }
})
jest.mock('../../learning/learning-state.service', () => ({
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
  rerouteMisconceptionConceptKey: jest.fn(() => ''),
}))
jest.mock('../../background-task-tracker.service', () => ({
  runBackgroundTask: jest.fn(async (_name: string, fn: () => Promise<unknown>) => fn()),
}))
jest.mock('../TeachingOperationLeaseGuard', () => ({
  TeachingOperationLeaseGuard: class { start() {} stop() {} },
}))
jest.mock('../TeachingSessionRepository', () => {
  const actual = jest.requireActual('../TeachingSessionRepository')
  return {
    ...actual,
    teachingSessionRepository: {
      claimOperation: (...args: unknown[]) => mockClaimOperation(...args),
      commitTurnState: (...args: unknown[]) => mockCommitTurnState(...args),
      releaseOperation: (...args: unknown[]) => mockReleaseOperation(...args),
      listFigures: jest.fn(async () => []),
    },
  }
})
jest.mock('../teaching-checkpoint', () => {
  const actual = jest.requireActual('../teaching-checkpoint')
  return {
    ...actual,
    recordCheckpointResultEvidence: jest.fn(async () => undefined),
    recordCheckpointAttemptEvidence: jest.fn(async () => undefined),
    recordAnchorProbeResult: jest.fn(async () => undefined),
    resolveAnchorProbeTarget: jest.fn(async () => null),
  }
})

import { processStudentMessage } from '../teaching-turn-engine'
import { describeBoardForTeacher } from '../board-state'

/** 假模型：连续两次返回同一条「无板指代」reply（学生屏幕上并没有那块板） */
const DEIXIS_REPLY =
  '白板上写的是什么？看左边那栏的第 2 条，右边第 4 条其实已经给了个答案。';

const deicticCompletion = JSON.stringify({
  reply: DEIXIS_REPLY,
  analysis: { cognitiveLevel: 'understand', levelScore: 2, engagement: 0.7, emotionalState: 'neutral', loadIndex: 0.4 },
  knowledge: { currentPoint: '把行为描述改写成可推翻问法', points: [] },
  pedagogy: { strategies: ['questioning'] },
  control: { isCompletionCandidate: false, shouldTriggerPeer: false },
});

const STUDENT_MESSAGE = '白板上写的是什么？左边第 2 条怎么改？';

/** 无板任务：teachingState.sessionArtifacts.board 缺席，历史里也没有任何 figure（与实锤会话一致） */
function boardlessSession() {
  return {
    id: 'sess-deixis-1',
    userId: 'user-deixis-1',
    taskId: 'task-1',
    status: 'active',
    mode: 'tutor',
    subject: '心理学',
    topic: '读懂身边人行为',
    messages: [
      { role: 'user' as const, content: '开始吧', timestamp: new Date(Date.now() - 120_000).toISOString() },
      { role: 'assistant' as const, content: '好，先说说你上次遇到的那个例子。', timestamp: new Date(Date.now() - 90_000).toISOString() },
    ],
    knowledgeState: [],
    teachingState: {
      classroomContext: { stage: { current: 'teaching' } },
      sessionArtifacts: { board: null },
    },
    revision: 3,
    startTime: new Date(),
  }
}

function claim(session: any) {
  return { operationId: 'op-1', session, messagesBaseCount: session.messages.length }
}

beforeEach(() => {
  jest.clearAllMocks()
  mockCommitTurnState.mockResolvedValue(undefined)
  mockReleaseOperation.mockResolvedValue(undefined)
  mockDesignBoard.mockResolvedValue({ figure: null, reason: 'not-needed' })
  mockPromptCallCreate.mockResolvedValue({})
  mockGatewayResolveRoute.mockRejectedValue(new Error('no route in test'))

  const { __teachingTurnAgentHandler } = jest.requireMock('../../../skills') as any
  mockExecuteSkill.mockImplementation((_definition: unknown, input: unknown) => __teachingTurnAgentHandler(input))

  // 假模型：两次都返回同一条无板指代 reply（改写指令对假模型无效——这正是要兜住的形态）
  mockGatewayExecute.mockResolvedValue({
    id: 'completion-1',
    model: 'fake-model',
    choices: [{ index: 0, message: { role: 'assistant', content: deicticCompletion }, finish_reason: 'stop' }],
  })
  mockGetActivePrompt.mockResolvedValue({
    systemPrompt: '你是一位循循善诱的老师。请严格按输出契约返回 JSON。',
    version: 1,
  })
})

describe('#252 无板指代两次改写均失败：整轮不 500、学生输入不丢', () => {
  it('假模型连续两次返回无板指代 → 回合正常返回（不再 throw/500）且带回老师回复', async () => {
    const session = boardlessSession()
    mockClaimOperation.mockResolvedValue(claim(session))

    const result = await processStudentMessage(session.id, STUDENT_MESSAGE, {
      operationClaim: claim(session) as never,
    })

    // ① 前置：确实是「无板任务」的生产形态——引擎注入的 boardContext 是「本任务暂无板书」提示串
    // （非空！旧判据 `!input.boardContext` 恒 false，见 #244），boardPresent=false 才让守卫可触发。
    const turnInput = mockExecuteSkill.mock.calls[0][1] as any
    expect(turnInput.boardPresent).toBe(false)
    expect(turnInput.boardContext).toBe(describeBoardForTeacher(null))
    expect(turnInput.boardContext).toContain('本任务暂无板书')

    // ② 不再抛错（旧行为：buildTeachingOutcome 抛 TEACHING_TURN_BOARD_DEIXIS_WITHOUT_BOARD → 路由 500）
    expect(result.aiResponse).toBe(DEIXIS_REPLY)
    // ③ 改写重试真的发生过：两次模型调用，第 2 次带上点名改写的重试指令
    expect(mockGatewayExecute).toHaveBeenCalledTimes(2)
    const secondCall = JSON.stringify(mockGatewayExecute.mock.calls[1][0])
    expect(secondCall).toContain('TEACHING_TURN_BOARD_DEIXIS_WITHOUT_BOARD')
    expect(secondCall).toContain('本轮不要输出 figure/diagram')
  })

  it('学生这一轮的 user 消息随回合一起落库（旧行为：整轮 throw → 该消息不进库）', async () => {
    const session = boardlessSession()
    mockClaimOperation.mockResolvedValue(claim(session))

    const result = await processStudentMessage(session.id, STUDENT_MESSAGE, {
      operationClaim: claim(session) as never,
    })

    expect(mockCommitTurnState).toHaveBeenCalledTimes(1)
    const payload = mockCommitTurnState.mock.calls[0][2] as any
    const messages = payload.messages as any[]
    // ③ 学生原文落库（原文而非围栏后的文本）
    const lastUser = [...messages].reverse().find((message) => message.role === 'user')
    expect(lastUser?.content).toBe(STUDENT_MESSAGE)
    // ④ 老师这一轮也落了库（回合整体提交，不是空提交）；正文里指向「板/图」的那截
    // 会被引擎既有的悬空引用剥离器（D10）删掉，故只断言非空且板指代已被剥。
    const assistant = messages[messages.length - 1]
    expect(assistant.role).toBe('assistant')
    expect(assistant.content.length).toBeGreaterThan(0)
    expect(assistant.content).not.toContain('白板上')
    // ⑤ revision 正常推进（旧行为：整轮 500 时 revision 停在上一轮）
    expect(result.revision).toBe(session.revision + 1)
  })
})
