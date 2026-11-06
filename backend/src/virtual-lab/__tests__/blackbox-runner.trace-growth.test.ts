/**
 * #176-1 回归：黑盒 stageResults 的增长治理。
 *
 * 现状（修复前）：publicTrace/refereeTrace 无上限追加，且每条命令都对整列
 * JSON.stringify(nextState) 重写 → 单行随命令数无界增长 + O(n²) 写放大。
 * 本文件锁四件事：
 *  1. 跑 N 条命令后 stageResults 序列化**字节** < 单行护栏阈值，且首条观测被保留；
 *  2. 轨迹序号（publicTraceSequence / learnerPrivateStateTrace.sequence）单调不回绕；
 *  3. 写入侧就做 sanitizeObservation，visiblePath/visibleTask 有长度上限，
 *     且下游依赖的 visibleCheckpoint 不被裁掉；
 *  4. 超过字节护栏时压缩轨迹并 warn 留痕。
 */
import prisma from '../../config/database'
import {
  BlackboxVirtualLearnerRunner,
  DEFAULT_BLACKBOX_STAGE_RESULTS_MAX_BYTES,
  resolveBlackboxStageResultsMaxBytes
} from '../blackbox-runner'
import { logger } from '../../utils/logger'

jest.mock('../../utils/projection-token', () => ({
  signProjectionToken: jest.fn(() => 'token'),
  SYNTHETIC_CAPABILITIES: []
}))
jest.mock('../../skills', () => ({
  executeSkill: jest.fn(),
  virtualLearnerGoalDialogueSimulatorDefinition: { name: 'virtual-learner-goal-dialogue-simulator', version: '1.0.0' },
  virtualLearnerLearnTurnSimulatorDefinition: { name: 'virtual-learner-learn-turn-simulator', version: '1.0.0' },
  VIRTUAL_LEARNER_GOAL_DIALOGUE_SIMULATOR_PROMPT: 'goal prompt',
  VIRTUAL_LEARNER_GOAL_DIALOGUE_SIMULATOR_MAX_TOKENS: 1200,
  VIRTUAL_LEARNER_GOAL_DIALOGUE_SIMULATOR_TEMPERATURE: 0.8,
  VIRTUAL_LEARNER_LEARN_TURN_SIMULATOR_PROMPT: 'learn prompt',
  VIRTUAL_LEARNER_LEARN_TURN_SIMULATOR_MAX_TOKENS: 800,
  VIRTUAL_LEARNER_LEARN_TURN_SIMULATOR_TEMPERATURE: 0.7,
  virtualLearnerRefereeDefinition: { name: 'virtual-learner-referee', version: '1.0.0' },
  virtualLearnerActorAuditorDefinition: { name: 'virtual-learner-actor-auditor', version: '1.0.0' }
}))
jest.mock('../../config/database', () => ({
  __esModule: true,
  default: {
    virtual_sessions: {
      findUnique: jest.fn(),
      update: jest.fn()
    },
    virtual_learner_profiles: {
      findUnique: jest.fn(),
      update: jest.fn()
    },
    virtual_experiment_commands: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn()
    },
    virtual_experiment_leases: {
      updateMany: jest.fn(),
      create: jest.fn(),
      deleteMany: jest.fn()
    }
  }
}))
jest.mock('../../services/agentConfig.service', () => ({
  agentConfigService: { getActivePrompt: jest.fn().mockResolvedValue(null) }
}))
jest.mock('../../gateway/api-gateway', () => ({
  getAPIGateway: jest.fn(() => ({ resolveRoute: jest.fn() }))
}))
jest.mock('../../services/learning/learning-state.service', () => ({
  learningStateService: { getSessionStateTimeline: jest.fn() }
}))
jest.mock('../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }
}))

type Trace = {
  timestamp: string
  observation: Record<string, unknown>
  control: Record<string, unknown>
}

function makeSession(publicTrace: Trace[] = [], refereeTrace: unknown[] = []) {
  const state = {
    experiment: { mode: 'blackbox-api', experimentId: 'exp1', runId: 'run1' },
    blackbox: {
      control: { conversationId: 'g1' },
      learnerPrivateState: {},
      learnerPrivateStateTrace: [],
      publicTrace,
      refereeTrace
    }
  }
  return {
    id: 'vs1',
    userId: 'u1',
    virtualProfileId: 'vp1',
    goalConversationId: 'g1',
    learningPathId: 'p1',
    currentTaskId: null,
    status: 'running',
    currentStage: 'teaching',
    stageResults: JSON.stringify(state)
  }
}

/** 一条"正常大小"的教学观测（含路径/任务/检查点），单条约 4 KB */
function observation(index: number, contentLength = 900) {
  return {
    stage: 'teaching',
    visibleMessages: Array.from({ length: 4 }, (_, i) => ({
      role: i % 2 === 0 ? 'learner' : 'platform',
      content: `第${index}条观测消息${i}-` + 'x'.repeat(contentLength)
    })),
    visibleChoices: ['继续', '再讲讲'],
    visiblePath: {
      id: 'p1',
      title: '路径标题',
      description: '路径描述',
      status: 'active',
      milestones: [{ title: '里程碑一' }, { title: '里程碑二' }]
    },
    visibleTask: { id: 'task-1', title: '任务标题', description: '任务描述', linkedConcept: 'c1' },
    visibleCheckpoint: {
      id: `ck-${index}`,
      type: 'single_choice' as const,
      question: '这道题选哪个？',
      options: [{ id: 'a', text: '选项A' }, { id: 'b', text: '选项B' }],
      allowSkip: true
    },
    availableActions: ['chat', 'request_hint', 'submit_answer', 'abandon'],
    lastActionResult: { status: 'success' as const, visibleMessage: '已收到' }
  }
}

function installSession(runner: any, session: ReturnType<typeof makeSession>) {
  let current = session
  runner.getSession = jest.fn(async () => current)
  ;(prisma.virtual_sessions.update as jest.Mock).mockImplementation(async ({ data }: any) => {
    current = { ...current, ...data }
    return current
  })
  return {
    get current() {
      return current
    },
    setStageResults(stageResults: string) {
      current = { ...current, stageResults }
    }
  }
}

/** 直接驱动写路径：persist 是 append 轨迹的唯一落点 */
async function persistOnce(
  runner: any,
  holder: { current: any; setStageResults: (value: string) => void },
  index: number,
  options: { resetPrivateState?: boolean } = {}
) {
  await runner.persist(holder.current, JSON.parse(holder.current.stageResults), {
    observation: observation(index),
    control: { conversationId: 'g1', taskId: `task-${index}` },
    diagnostic: {
      rawTraceId: `trace-${index}`,
      ...(options.resetPrivateState ? { resetLearningPrivateState: true } : {})
    }
  })
  return holder.current.stageResults as string
}

describe('#176-1 黑盒轨迹增长治理', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(prisma.virtual_sessions.update as jest.Mock).mockReset()
  })

  it('跑 N 条命令后 stageResults 字节低于护栏阈值，且首条观测与最新观测都在', async () => {
    const runner: any = new BlackboxVirtualLearnerRunner()
    // 造一段"历史遗留"的大轨迹：老实现下会一路追加到无界（> 2 MB）
    const legacy: Trace[] = Array.from({ length: 400 }, (_, i) => ({
      timestamp: `2026-07-14T10:00:${String(i % 60).padStart(2, '0')}.000Z`,
      observation: observation(i) as unknown as Record<string, unknown>,
      control: { conversationId: 'g1', taskId: `task-${i}` }
    }))
    const headTimestamp = legacy[0].timestamp
    const holder = installSession(runner, makeSession(legacy))

    const commands = 200
    let serialized = ''
    for (let i = 0; i < commands; i += 1) {
      serialized = await persistOnce(runner, holder, 1000 + i)
    }

    const bytes = Buffer.byteLength(serialized, 'utf8')
    const state = JSON.parse(serialized)
    expect(bytes).toBeLessThan(DEFAULT_BLACKBOX_STAGE_RESULTS_MAX_BYTES)
    // 首尾保留：头部第 0 条仍在（Goal/Path 起步证据），尾部是刚写进去的那条
    expect(state.blackbox.publicTrace).toHaveLength(200)
    expect(state.blackbox.publicTrace[0].timestamp).toBe(headTimestamp)
    expect(state.blackbox.publicTrace.at(-1).timestamp).not.toBe(headTimestamp)
    expect(state.blackbox.publicTrace.at(-1).observation.visibleMessages.at(-1).content)
      .toContain(`第${1000 + commands - 1}条观测消息`)
    // 不压缩时这行会是 400 legacy + 200 新写 = 600 条，超过单行护栏
    const unBoundedTrace = legacy.concat(
      Array.from({ length: commands }, (_, i) => ({
        timestamp: '2026-07-14T11:00:00.000Z',
        observation: observation(1000 + i),
        control: { conversationId: 'g1' }
      }))
    )
    expect(Buffer.byteLength(JSON.stringify({ blackbox: { publicTrace: unBoundedTrace } }), 'utf8'))
      .toBeGreaterThan(DEFAULT_BLACKBOX_STAGE_RESULTS_MAX_BYTES)
  }, 120000)

  it('轨迹封顶后序号仍单调递增（不回绕、不重复）', async () => {
    const runner: any = new BlackboxVirtualLearnerRunner()
    const holder = installSession(runner, makeSession())

    const commands = 260
    const sequences: number[] = []
    for (let i = 0; i < commands; i += 1) {
      // 触发私有状态归档分支：它此前用 publicTrace.length 当 sequence
      const state = JSON.parse(holder.current.stageResults)
      state.blackbox.learnerPrivateState = { teaching: { phaseFocus: 'explain', turn: i } }
      holder.setStageResults(JSON.stringify(state))
      await persistOnce(runner, holder, i, { resetPrivateState: true })
      const stored = JSON.parse(holder.current.stageResults)
      expect(stored.blackbox.publicTraceSequence).toBe(i + 1)
      const trace = stored.blackbox.learnerPrivateStateTrace
      sequences.push(trace[trace.length - 1].sequence)
    }

    // 私有状态轨迹本身封顶 120 条，但序号必须继续往前走
    expect(sequences.length).toBe(commands)
    for (let i = 1; i < sequences.length; i += 1) {
      expect(sequences[i]).toBe(sequences[i - 1] + 1)
    }
    expect(new Set(sequences).size).toBe(sequences.length)
    expect(sequences.at(-1)).toBe(commands)
    const stored = JSON.parse(holder.current.stageResults)
    expect(stored.blackbox.learnerPrivateStateTrace).toHaveLength(120)
  }, 120000)

  it('私有状态轨迹的序号也走单调计数器（不再取 publicTrace.length）', async () => {
    const runner: any = new BlackboxVirtualLearnerRunner()
    const legacy: Trace[] = Array.from({ length: 400 }, (_, i) => ({
      timestamp: '2026-07-14T10:00:00.000Z',
      observation: observation(i) as unknown as Record<string, unknown>,
      control: { conversationId: 'g1' }
    }))
    const holder = installSession(runner, makeSession(legacy))

    for (let i = 0; i < 5; i += 1) await persistOnce(runner, holder, i)
    const afterCommands = JSON.parse(holder.current.stageResults)
    // 轨迹已封顶：此时长度恒为 200，旧实现会把序号也钉死在 200
    const sequenceBase = afterCommands.blackbox.publicTraceSequence

    const sequences: number[] = []
    for (let i = 0; i < 10; i += 1) {
      // 真实链路是「先写私有状态、再由命令追加公开轨迹」：序号要跟着计数器走
      await runner.persistPrivateState(
        holder.current,
        JSON.parse(holder.current.stageResults),
        'teaching',
        { phaseFocus: 'explain', turn: i },
        {}
      )
      const trace = JSON.parse(holder.current.stageResults).blackbox.learnerPrivateStateTrace
      sequences.push(trace[trace.length - 1].sequence)
      await persistOnce(runner, holder, i)
    }

    expect(afterCommands.blackbox.publicTrace).toHaveLength(200)
    expect(new Set(sequences).size).toBe(sequences.length)
    expect(sequences[0]).toBe(sequenceBase)
    for (let i = 1; i < sequences.length; i += 1) {
      expect(sequences[i]).toBe(sequences[i - 1] + 1)
    }
  })

  it('写入侧就做 sanitize：visiblePath/visibleTask 有上限，visibleCheckpoint 不被裁掉', async () => {
    const runner: any = new BlackboxVirtualLearnerRunner()
    const holder = installSession(runner, makeSession())

    const huge = {
      stage: 'teaching',
      visibleMessages: Array.from({ length: 60 }, () => ({ role: 'platform', content: 'm'.repeat(5000) })),
      visiblePath: {
        id: 'p'.repeat(500),
        title: 't'.repeat(500),
        description: 'd'.repeat(5000),
        status: 's'.repeat(500),
        milestones: Array.from({ length: 80 }, () => ({ title: 'm'.repeat(500), description: 'x'.repeat(5000) }))
      },
      visibleTask: {
        id: 'k'.repeat(500),
        title: 't'.repeat(500),
        description: 'd'.repeat(5000),
        linkedConcept: 'c'.repeat(500)
      },
      visibleCheckpoint: {
        id: 'ck-1',
        type: 'single_choice',
        question: 'q'.repeat(5000),
        options: [{ id: 'a', text: 'o'.repeat(2000) }],
        allowSkip: true
      },
      availableActions: ['chat', 'submit_answer'],
      lastActionResult: { status: 'success', visibleMessage: 'v'.repeat(5000) }
    }

    await runner.persist(holder.current, JSON.parse(holder.current.stageResults), {
      observation: huge,
      control: { conversationId: 'g1', taskId: 'task-1' }
    })

    const stored = JSON.parse(holder.current.stageResults)
      .blackbox.publicTrace.at(-1).observation
    expect(stored.visibleMessages).toHaveLength(30)
    expect(stored.visibleMessages[0].content).toHaveLength(1200)
    expect(stored.visiblePath.id).toHaveLength(120)
    expect(stored.visiblePath.title).toHaveLength(200)
    expect(stored.visiblePath.description).toHaveLength(600)
    expect(stored.visiblePath.milestones).toHaveLength(20)
    expect(stored.visiblePath.milestones[0].title).toHaveLength(200)
    expect(stored.visibleTask.title).toHaveLength(200)
    expect(stored.visibleTask.description).toHaveLength(600)
    expect(stored.visibleTask.linkedConcept).toHaveLength(200)
    expect(stored.lastActionResult.visibleMessage).toHaveLength(1200)
    // 下游 autoStep 靠 visibleCheckpoint 出作答动作，写入侧不能丢
    expect(stored.visibleCheckpoint.id).toBe('ck-1')
    expect(stored.visibleCheckpoint.type).toBe('single_choice')
    expect(stored.visibleCheckpoint.question).toHaveLength(1200)
    expect(stored.visibleCheckpoint.options).toEqual([{ id: 'a', text: 'o'.repeat(300) }])
    expect(stored.visibleCheckpoint.allowSkip).toBe(true)
  })

  it('整行超过字节护栏时压缩轨迹并 warn 留痕', async () => {
    const runner: any = new BlackboxVirtualLearnerRunner()
    runner.stageResultsMaxBytes = 64 * 1024
    const legacy: Trace[] = Array.from({ length: 60 }, (_, i) => ({
      timestamp: `2026-07-14T10:00:00.000Z`,
      observation: observation(i) as unknown as Record<string, unknown>,
      control: { conversationId: 'g1' }
    }))
    const holder = installSession(runner, makeSession(legacy))

    const serialized = await persistOnce(runner, holder, 1)

    expect(Buffer.byteLength(serialized, 'utf8')).toBeLessThanOrEqual(64 * 1024)
    const state = JSON.parse(serialized)
    expect(state.blackbox.publicTrace.length).toBeLessThan(60)
    expect(logger.warn).toHaveBeenCalledWith(
      '[Blackbox] stageResults 超过单行字节护栏，已压缩轨迹后落库',
      expect.objectContaining({ sessionId: 'vs1', budget: 64 * 1024 })
    )
    // 收紧后仍保留头部起步观测
    expect(state.blackbox.publicTrace[0].timestamp).toBe('2026-07-14T10:00:00.000Z')
  })

  it('字节护栏阈值可配置且有下限', () => {
    expect(resolveBlackboxStageResultsMaxBytes({})).toBe(DEFAULT_BLACKBOX_STAGE_RESULTS_MAX_BYTES)
    expect(resolveBlackboxStageResultsMaxBytes({ BLACKBOX_STAGE_RESULTS_MAX_BYTES: 'not-a-number' }))
      .toBe(DEFAULT_BLACKBOX_STAGE_RESULTS_MAX_BYTES)
    expect(resolveBlackboxStageResultsMaxBytes({ BLACKBOX_STAGE_RESULTS_MAX_BYTES: '4096' }))
      .toBe(DEFAULT_BLACKBOX_STAGE_RESULTS_MAX_BYTES)
    expect(resolveBlackboxStageResultsMaxBytes({ BLACKBOX_STAGE_RESULTS_MAX_BYTES: '1048576' }))
      .toBe(1024 * 1024)
  })
})
