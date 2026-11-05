/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * 共享白板防复读 · **引擎真实入参**回归（issue #243）。
 *
 * 既有 board-anti-repeat.test.ts 直接喂「带 figures 的数组」测纯函数，因此从未覆盖
 * 引擎实际交给守卫的那份数组：teaching-turn-engine 用 appendTimestamp 组装回合消息快照，
 * 旧实现按白名单重建对象，把 figures/figureSource 整体剥掉 → getLastSentBoardRevision
 * 恒返回 null → 板没变化也每轮重发（真实课堂实测 rev 2 连发 8 次）。
 *
 * 这里走 processStudentMessage 的真实链路（真实 appendTimestamp + 真实 board-state 守卫），
 * 断言三件事：
 *  ① 同一 revision 连续 3 轮只下发 1 次；
 *  ② revision 递增（真的换板）必须照常下发；
 *  ③ 本轮模型自己出了图时不得二次挂板（既有行为，不得修过头）。
 */
const mockClaimOperation = jest.fn()
const mockCommitTurnState = jest.fn()
const mockReleaseOperation = jest.fn()
const mockTurnSkill = jest.fn()
const mockDesignBoard = jest.fn()

jest.mock('../../../config/database', () => ({
  __esModule: true,
  default: { teacher_observations: {}, misconceptions: {}, learner_evidence: {}, teaching_sessions: {} },
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
jest.mock('../board-designer.service', () => ({
  designBoard: (...args: unknown[]) => mockDesignBoard(...args),
}))
jest.mock('../TeachingContextBuilder', () => ({
  buildTeachingScenarioContext: jest.fn(async () => ({
    subject: '生物', topic: '光合作用的两阶段', taskTitle: '说出两阶段各自的作用',
    taskDescription: '读懂材料后复述', taskType: 'acquire',
    taskProfile: { knowledgeType: 'conceptual', cognitiveLevel: 'understand' },
    currentTaskContext: { description: '复述材料', acceptanceCriteria: '能说出两阶段关系' },
    cognitiveFrame: { targetRelation: '结构与功能', transferGoal: null, cognitiveLevel: 'understand' },
    learnerProjection: null,
    pathProgress: { pathTitle: '细胞与能量', pathSummary: null, currentMilestoneTitle: '光合作用', currentStageNumber: 1, currentTaskOrder: 1, totalTasksInMilestone: 3 },
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
// teaching-visual 保留真实实现（board-state 依赖它的脱敏/去注工具），只掐掉 IO/时机两处
jest.mock('../teaching-visual.service', () => {
  const actual = jest.requireActual('../teaching-visual.service')
  return {
    ...actual,
    generateTeachingVisual: jest.fn(async () => null),
    buildVisualOpportunity: jest.fn(() => null),
    detectExerciseLeakInReply: jest.fn(() => false),
  }
})
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
import { openBoard, type BoardState } from '../board-state'

const BOARD_FIGURE = {
  kind: 'concept-map',
  spec: {
    title: '光合作用',
    nodes: [{ id: 'a', label: '光反应' }, { id: 'b', label: '暗反应' }],
    edges: [{ from: 'a', to: 'b', label: '供给 ATP' }],
    takeaway: '光反应造能量，暗反应用能量',
  },
}

/** 板上板面：真实 openBoard 产出（与线上同源），revision 由调用方指定 */
function boardAt(revision: number): BoardState {
  const opened = openBoard('task-1', BOARD_FIGURE, { conceal: 'takeaway' })
  return { ...opened, revision }
}

/** 一条「老师随消息下发过白板」的历史消息（线上落库形态） */
function boardMessage(revision: number) {
  return {
    role: 'assistant' as const,
    content: '先看板上这两块。',
    timestamp: new Date(Date.now() - 60_000).toISOString(),
    analysis: { understanding: 0.5, engagement: 0.6, confusionPoints: [] },
    figures: [{
      engine: 'svg' as const,
      kind: 'concept-map',
      palette: 'indigo',
      spec: { title: '光合作用' },
      caption: null,
      board: true as const,
      boardRevision: revision,
    }],
    figureSource: { trigger: 'board' as const, reason: null, kindHint: 'concept-map', ruleWhy: 'x', matched: [] },
  }
}

function sessionRecord(board: BoardState, messages: any[]) {
  return {
    id: 'sess-board-1',
    userId: 'user-1',
    taskId: 'task-1',
    status: 'active',
    mode: 'tutor',
    subject: '生物',
    topic: '光合作用的两阶段',
    messages,
    knowledgeState: [],
    teachingState: {
      classroomContext: { stage: { current: 'teaching' } },
      sessionArtifacts: { board },
    },
    revision: 5,
    startTime: new Date(),
  }
}

function claim(session: any) {
  return { operationId: 'op-1', session, messagesBaseCount: session.messages.length }
}

/** 老师本轮回复：不含新数字、不含「换成/拿掉」类换例词，避免触发换板重绘 */
function turnSkillResult(reply = '那你先说说，光反应给暗反应送的是什么？') {
  return {
    success: true,
    internal: {
      ext: {
        teachingTurnOutcome: {
          artifact: {
            reply,
            analysis: { understanding: 0.6, engagement: 0.7, confusionPoints: [] },
            knowledge: { currentPoint: '光反应与暗反应', points: [] },
            control: {},
            pedagogy: { strategies: ['questioning'] },
          },
        },
      },
    },
  }
}

/** 跑一轮，返回本轮落库的 assistant 消息（含它实际下发的 figures） */
async function runTurn(session: any, studentText: string) {
  // 同一条用例里连续跑多轮：清掉上一轮的提交痕，下面的断言只读本轮
  mockCommitTurnState.mockClear()
  mockClaimOperation.mockResolvedValue(claim(session))
  await processStudentMessage(session.id, studentText, { operationClaim: claim(session) as never })
  const payload = mockCommitTurnState.mock.calls[0][2] as any
  return {
    persisted: payload.messages as any[],
    assistant: payload.messages[payload.messages.length - 1] as any,
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  mockCommitTurnState.mockResolvedValue(undefined)
  mockReleaseOperation.mockResolvedValue(undefined)
  mockTurnSkill.mockResolvedValue(turnSkillResult())
  mockDesignBoard.mockResolvedValue({ figure: null, reason: 'not-needed' })
})

describe('#243 白板防复读：引擎真实入参下守卫必须生效', () => {
  it('同一 revision 连续 3 轮只下发 1 次（守卫读得到 appendTimestamp 后的历史）', async () => {
    const board = boardAt(1)

    // 第 1 轮：历史里没有白板图 → 首版照常下发
    const first = await runTurn(sessionRecord(board, [
      { role: 'user', content: '开始吧', timestamp: new Date(Date.now() - 120_000).toISOString() },
    ]), '这块板是在讲什么？')
    expect(first.assistant.figures).toHaveLength(1)
    expect(first.assistant.figures[0].board).toBe(true)
    expect(first.assistant.figures[0].boardRevision).toBe(1)

    // 第 2、3 轮：把上一轮真实落库的消息作为历史（板没变）→ 不得重发
    const second = await runTurn(sessionRecord(board, first.persisted), '我还是不太懂。')
    expect(second.assistant.figures).toBeUndefined()

    const third = await runTurn(sessionRecord(board, second.persisted), '再讲一遍。')
    expect(third.assistant.figures).toBeUndefined()

    // 三轮下来只下发了一次同一块板（每轮只看本轮新增的那条 assistant 消息：
    // persisted 是全量快照，直接摊平会把前几轮的同一条消息重复计入）
    const sent = [first, second, third]
      .flatMap((turn) => (Array.isArray(turn.assistant?.figures) ? turn.assistant.figures : []))
      .filter((figure: any) => figure?.board === true)
    expect(sent).toHaveLength(1)
    expect(sent[0].boardRevision).toBe(1)
  })

  it('真的换板（revision 递增）照常下发', async () => {
    const previous: any[] = [
      { role: 'user', content: '开始吧', timestamp: new Date(Date.now() - 120_000).toISOString() },
      boardMessage(1),
      { role: 'user', content: '哦懂了', timestamp: new Date(Date.now() - 30_000).toISOString() },
    ]
    const { assistant } = await runTurn(sessionRecord(boardAt(2), previous), '那下一步呢？')

    expect(assistant.figures).toHaveLength(1)
    expect(assistant.figures[0].boardRevision).toBe(2)
  })

  it('本轮模型自己出了图 → 不得二次挂板（既有行为不变）', async () => {
    const previous: any[] = [
      { role: 'user', content: '开始吧', timestamp: new Date(Date.now() - 120_000).toISOString() },
      boardMessage(1),
      { role: 'user', content: '再说说', timestamp: new Date(Date.now() - 30_000).toISOString() },
    ]
    mockTurnSkill.mockResolvedValue({
      success: true,
      internal: {
        ext: {
          teachingTurnOutcome: {
            artifact: {
              reply: '看我摆的这条位置线。',
              analysis: { understanding: 0.6, engagement: 0.7, confusionPoints: [] },
              knowledge: { currentPoint: '光反应与暗反应', points: [] },
              control: {},
              pedagogy: { strategies: ['modeling'] },
              figure: {
                kind: 'concept-map',
                spec: { title: '本轮新图', nodes: [{ id: 'x', label: '叶绿体' }] },
                caption: null,
              },
            },
          },
        },
      },
    })

    // 用递增的板（若不修过头，本轮「换板」+「模型自出图」很容易挂成两套附件）
    const { assistant } = await runTurn(sessionRecord(boardAt(2), previous), '画一下给我看看')

    // 既有优先级：有板时模型的一次性配图被丢弃，只留白板；一张消息上不得出现第二套图
    expect(assistant.figures).toHaveLength(1)
    expect(assistant.figures[0].board).toBe(true)
    expect(assistant.figures[0].boardRevision).toBe(2)
    expect(assistant.figures[0].spec.title).not.toBe('本轮新图')
  })
})

/**
 * #244：看板指代守卫必须读得到「本轮到底有没有板」。
 *
 * 守卫单测只喂纯函数参数，证明不了引擎真实交给校验器的那份 input。这里抓
 * `executeSkill(teachingTurnAgentDefinition, turnInput, …)` 的实际入参，再用**真实**
 * 校验器（jest.requireActual，模块本身被本文件 mock 成空定义）对它跑一次：
 * 无板回合的 boardContext 是「本任务暂无板书」提示串（非空），旧判据 `!boardContext`
 * 恒为 false → 永不触发；现在靠 boardPresent 结构化信号判定。
 */
describe('#244 看板指代守卫：引擎真实入参', () => {
  const realValidator = jest.requireActual('../../../skills/teaching-turn')
    .validateTeachingTurnOutput as (parsed: any, input: any) => { valid: boolean; failureReason?: string }
  const DEIXIS_REPLY = '左边那栏是你原来的问法，右边第 4 条给了个答案。'

  function capturedTurnInput() {
    const call = mockTurnSkill.mock.calls[0] as unknown as [unknown, any]
    return call[1]
  }

  function artifactWith(reply: string) {
    return {
      reply,
      analysis: { understanding: 0.6, engagement: 0.7, confusionPoints: [] },
      knowledge: { currentPoint: '光反应与暗反应', points: [] },
      control: {},
      pedagogy: { strategies: ['questioning'] },
    }
  }

  it('无板回合：boardPresent=false，且真实校验器对指代 reply 判失败', async () => {
    await runTurn(sessionRecord(null as never, [
      { role: 'user', content: '开始吧', timestamp: new Date(Date.now() - 120_000).toISOString() },
    ]), '这题怎么想？')

    const input = capturedTurnInput()
    expect(input.boardPresent).toBe(false)
    expect(input.boardContext).toContain('本任务暂无板书')

    const verdict = realValidator(artifactWith(DEIXIS_REPLY), input)
    expect(verdict.valid).toBe(false)
    expect(verdict.failureReason).toBe('TEACHING_TURN_BOARD_DEIXIS_WITHOUT_BOARD')
  })

  it('有板回合：boardPresent=true，同样的指代 reply 放行（不得修过头）', async () => {
    await runTurn(sessionRecord(boardAt(1), [
      { role: 'user', content: '开始吧', timestamp: new Date(Date.now() - 120_000).toISOString() },
    ]), '这块板在讲什么？')

    const input = capturedTurnInput()
    expect(input.boardPresent).toBe(true)
    expect(input.boardContext).not.toContain('本任务暂无板书')

    const verdict = realValidator(artifactWith(DEIXIS_REPLY), input)
    expect(verdict.valid).toBe(true)
  })

  it('首版空壳矩阵（degenerate，永不下发）→ boardPresent=false，指代 reply 判失败', async () => {
    // 学生屏幕上没有板，但 board.figure 非空、describeBoardForTeacher 也照常描述它。
    // 若这里算「有板」，模型就会指着不存在的板讲「左边那栏」——与 #244 同一现象。
    const cells: Array<{ r: number; c: number; tone: string }> = []
    for (let r = 0; r < 2; r += 1) for (let c = 0; c < 2; c += 1) cells.push({ r, c, tone: 'hit' })
    const degenerate = openBoard('task-1', {
      kind: 'matrix',
      spec: { title: '全格已标出', rowLabels: ['A', 'B'], colLabels: ['x', 'y'], cells },
    })
    expect(degenerate.figure).not.toBeNull()

    const previous: any[] = [
      { role: 'user', content: '开始吧', timestamp: new Date(Date.now() - 120_000).toISOString() },
    ]
    const { assistant } = await runTurn(sessionRecord(degenerate, previous), '这题怎么想？')

    // 引擎确实没下发这块板
    expect(assistant.figures).toBeUndefined()

    const input = capturedTurnInput()
    expect(input.boardPresent).toBe(false)
    expect(input.boardContext).toContain('本任务暂无板书')

    const verdict = realValidator(artifactWith(DEIXIS_REPLY), input)
    expect(verdict.valid).toBe(false)
    expect(verdict.failureReason).toBe('TEACHING_TURN_BOARD_DEIXIS_WITHOUT_BOARD')
  })
})
