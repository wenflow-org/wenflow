const profileFindUnique = jest.fn()
const subtaskFindUnique = jest.fn()
const milestoneFindMany = jest.fn()
const outboxFindFirst = jest.fn()
const inboxFindFirst = jest.fn()

interface MemoryRun {
  id: string
  profileId: string
  userId: string
  pathId: string
  taskId: string
  fixtureOfPathId: string | null
  mode: string
  status: string
  maxTurns: number
  turns: number
  teachingSessionId: string | null
  story: string | null
  frictionBudget: string
  progress: string | null
  transcript: string | null
  report: string | null
  error: string | null
  abortRequestedAt: Date | null
  startedAt: Date | null
  completedAt: Date | null
}

let memoryRun: MemoryRun | null = null
let queuedConflict = false

const runsCreate = jest.fn(async ({ data }: any) => {
  memoryRun = {
    id: 'run-1',
    profileId: data.profileId,
    userId: data.userId,
    pathId: data.pathId,
    taskId: data.taskId,
    fixtureOfPathId: data.fixtureOfPathId ?? null,
    mode: data.mode,
    status: data.status,
    maxTurns: data.maxTurns,
    turns: 0,
    teachingSessionId: null,
    story: data.story ?? null,
    frictionBudget: data.frictionBudget ?? 'none',
    progress: null,
    transcript: null,
    report: null,
    error: null,
    abortRequestedAt: null,
    startedAt: null,
    completedAt: null,
  }
  return { id: memoryRun.id }
})
const runsFindUnique = jest.fn(async () => memoryRun)
const runsFindFirst = jest.fn(async () => (queuedConflict ? { id: 'other-run' } : null))
const runsUpdate = jest.fn(async ({ data }: any) => {
  if (!memoryRun) return {}
  Object.assign(memoryRun, data)
  return memoryRun
})
const runsUpdateMany = jest.fn(async () => ({ count: 0 }))

jest.mock('../../../config/database', () => ({
  __esModule: true,
  default: {
    virtual_learner_profiles: { findUnique: profileFindUnique },
    subtasks: { findUnique: subtaskFindUnique },
    milestones: { findMany: milestoneFindMany },
    domain_event_outbox: { findFirst: outboxFindFirst },
    domain_event_inbox: { findFirst: inboxFindFirst },
    virtual_quick_learn_runs: {
      create: runsCreate,
      findUnique: runsFindUnique,
      findFirst: runsFindFirst,
      update: runsUpdate,
      updateMany: runsUpdateMany,
    },
  },
}))

const executeSkillMock = jest.fn()
jest.mock('../../../skills', () => ({
  executeSkill: executeSkillMock,
}))

jest.mock('../../../skills/virtual-learner-learn-turn-simulator', () => ({
  virtualLearnerLearnTurnSimulatorDefinition: { name: 'virtual-learner-learn-turn-simulator' },
}))

const startSessionMock = jest.fn()
const processMessageMock = jest.fn()
const endSessionMock = jest.fn()
jest.mock('../../../services/ai-teaching/AITeachingCoordinator', () => ({
  __esModule: true,
  default: {
    startSession: startSessionMock,
    processStudentMessage: processMessageMock,
    endSession: endSessionMock,
  },
}))

const assertReadyMock = jest.fn()
const completeTaskMock = jest.fn()
jest.mock('../../../services/learning/learning.service', () => ({
  __esModule: true,
  default: {
    assertTaskReadyForLearning: assertReadyMock,
    completeTask: completeTaskMock,
  },
}))

const getSnapshotMock = jest.fn()
jest.mock('../../../services/learner/LearnerSnapshotService', () => ({
  learnerSnapshotService: { getSnapshot: getSnapshotMock },
}))

jest.mock('../../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}))

import { quickLearnService } from '../quick-learn.service'

function buildProfile() {
  return {
    id: 'p1',
    userId: 'u1',
    profile: JSON.stringify({ age: 25 }),
    learningGoal: '学会 SQL',
    knownConcepts: JSON.stringify([]),
    struggleConcepts: JSON.stringify([]),
    personalityTraits: JSON.stringify({}),
  }
}

function buildTask(overrides: Record<string, any> = {}) {
  return {
    id: 't1',
    title: 'SELECT 基础',
    status: 'todo',
    milestones: {
      id: 'ms-1',
      title: '阶段一',
      status: 'active',
      learning_paths: { id: 'path1', userId: 'u1', status: 'active' },
    },
    ...overrides,
  }
}

function buildSnapshot(lss: number) {
  return {
    snapshotVersion: 'learner-snapshot-v1',
    scope: {},
    freshness: { generatedAt: '', confidence: 0.5, basedOn: { latestMetricAt: lss > 5 ? '2026-07-21T00:00:00Z' : null } },
    profile: {},
    dynamicState: { metrics: { lss, ktl: 5, lf: 2, lsb: 6 }, recentTrend: 'stable' },
    learningControlState: { paceMode: lss > 5 ? 'normal' : 'slow' },
    replanSignal: { shouldSuggest: lss > 5, priority: lss > 5 ? 'medium' : 'none', reasonCodes: [] },
    knowledgeMemory: {
      currentPath: null,
      globalSignals: {
        masteredConcepts: lss > 5 ? ['投影'] : [],
        fragileConcepts: [],
        strugglingConcepts: [],
      },
      globalBackground: {
        reusableFoundations: [],
        blockedFoundations: [],
        conceptLedger: lss > 5 ? [{ label: '投影' }] : [],
        recurringConfusions: [],
      },
    },
    teachingHints: { promptEnhancement: '', emphasize: [], avoid: [] },
  }
}

function simulatorOutput(learnerReady: boolean) {
  return {
    reply: '我来试试这个查询',
    emotion: 'neutral',
    learnerState: {
      phaseFocus: learnerReady ? 'ready_to_close' : 'trying',
      taskUnderstanding: 0.8,
      conceptualMastery: 0.7,
      proceduralMastery: 0.7,
      misconceptionRisk: 0.1,
      helpSeekingReadiness: 0.2,
      cognitiveLoad: 0.3,
      wantsHint: false,
      wantsWorkedExample: false,
      readyForNextTask: learnerReady,
      remainingBlockers: [],
    },
    learnerFeedback: {
      selfReportedTaskDone: learnerReady,
      satisfaction: 0.9,
      confidence: 0.8,
      wantsMoreHelp: !learnerReady,
      stopAsking: learnerReady,
      remainingBlockers: [],
      reason: 'test',
    },
  }
}

async function executeRunDirect(runId: string) {
  await (quickLearnService as any).executeRun(runId)
  // executeRun 内部异步执行，等待完成
  for (let i = 0; i < 50 && memoryRun && ['queued', 'running'].includes(memoryRun.status); i += 1) {
    await new Promise((resolve) => setImmediate(resolve))
  }
}

describe('QuickLearnService', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    memoryRun = null
    queuedConflict = false

    profileFindUnique.mockResolvedValue(buildProfile())
    subtaskFindUnique.mockResolvedValue(buildTask())
    milestoneFindMany.mockResolvedValue([
      {
        id: 'ms-1',
        subtasks: [
          { id: 't1', title: 'SELECT 基础', status: 'todo' },
          { id: 't2', title: 'WHERE 过滤', status: 'todo' },
        ],
      },
    ])
    outboxFindFirst.mockResolvedValue({ id: 'evt-1', status: 'processed' })
    inboxFindFirst.mockResolvedValue({ id: 'inbox-1' })

    startSessionMock.mockResolvedValue({
      sessionId: 'ts-1',
      subject: '数据库',
      topic: 'SELECT 基础',
      startTime: new Date(),
      welcomeMessage: '欢迎来到课堂',
      opening: { message: '我们先看一个例子', question: '你觉得这条查询会返回什么？', quickReplies: [], mode: 'example-first' },
      knowledgePoints: [],
      mode: 'new',
      revision: 0,
    })
    endSessionMock.mockResolvedValue({
      status: 'completed',
      operationId: 'op-1',
      wrapup: { summarySource: 'model', stateUpdate: null, duration: 10, evaluationSource: 'model' },
      revision: 2,
    })
    assertReadyMock.mockResolvedValue(undefined)
    completeTaskMock.mockResolvedValue({})

    let snapshotCall = 0
    getSnapshotMock.mockImplementation(async () => {
      snapshotCall += 1
      // 前两次是 pre（主快照 + nextTask 投影），之后是 post
      return buildSnapshot(snapshotCall <= 2 ? 5 : 7)
    })
  })

  describe('startRun 校验', () => {
    it('任务不属于该虚拟学习者时拒绝', async () => {
      subtaskFindUnique.mockResolvedValue(
        buildTask({ milestones: { id: 'ms-1', title: '阶段一', status: 'active', learning_paths: { id: 'path1', userId: 'other-user', status: 'active' } } })
      )
      await expect(quickLearnService.startRun({ profileId: 'p1', taskId: 't1' })).rejects.toMatchObject({
        code: 'QUICK_LEARN_TASK_OWNERSHIP_MISMATCH',
      })
    })

    it('已完成任务拒绝重复代学', async () => {
      subtaskFindUnique.mockResolvedValue(buildTask({ status: 'completed' }))
      await expect(quickLearnService.startRun({ profileId: 'p1', taskId: 't1' })).rejects.toMatchObject({
        code: 'QUICK_LEARN_TASK_ALREADY_COMPLETED',
      })
    })

    it('锁定阶段的任务拒绝', async () => {
      subtaskFindUnique.mockResolvedValue(
        buildTask({ milestones: { id: 'ms-1', title: '阶段二', status: 'locked', learning_paths: { id: 'path1', userId: 'u1', status: 'active' } } })
      )
      await expect(quickLearnService.startRun({ profileId: 'p1', taskId: 't1' })).rejects.toMatchObject({
        code: 'QUICK_LEARN_MILESTONE_LOCKED',
      })
    })

    it('已有进行中运行时冲突', async () => {
      queuedConflict = true
      await expect(quickLearnService.startRun({ profileId: 'p1', taskId: 't1' })).rejects.toMatchObject({
        code: 'QUICK_LEARN_RUN_CONFLICT',
      })
    })

    it('storyId 命中故事池时写入 story，frictionBudget 透传', async () => {
      profileFindUnique.mockResolvedValue({
        ...buildProfile(),
        profile: JSON.stringify({
          age: 25,
          storyPool: [{ id: 'story_a', title: '老板要周报', visibleOpening: '每周五都要交周报' }],
        }),
      })
      await quickLearnService.startRun({ profileId: 'p1', taskId: 't1', storyId: 'story_a', frictionBudget: 'normal' })
      expect(runsCreate).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          frictionBudget: 'normal',
          story: expect.stringContaining('老板要周报'),
        }),
      }))
    })

    it('storyId 未命中故事池时 story 为 null；非法 frictionBudget 回退 none', async () => {
      await quickLearnService.startRun({ profileId: 'p1', taskId: 't1', storyId: 'missing', frictionBudget: 'bogus' })
      expect(runsCreate).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ story: null, frictionBudget: 'none' }),
      }))
    })

    it('不传参数时保持 V1 兼容（story=null, frictionBudget=none）', async () => {
      await quickLearnService.startRun({ profileId: 'p1', taskId: 't1' })
      expect(runsCreate).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ story: null, frictionBudget: 'none' }),
      }))
    })

    it('maxTurns 被限制在硬上限内', async () => {
      await quickLearnService.startRun({ profileId: 'p1', taskId: 't1', maxTurns: 999 })
      expect(memoryRun?.maxTurns).toBe(40)
    })
  })

  describe('完整运行', () => {
    it('双重收束后正常闭合课堂、完成任务并生成传播报告', async () => {
      executeSkillMock.mockResolvedValue(simulatorOutput(true))
      processMessageMock.mockResolvedValue({
        analysis: {},
        aiResponse: '很好，你掌握了',
        strategies: ['feedback'],
        knowledgePoint: '投影',
        knowledgePoints: [{ name: '投影' }],
        isCompletion: true,
        currentState: {},
        peerTriggered: false,
        revision: 1,
      })

      await quickLearnService.startRun({ profileId: 'p1', taskId: 't1' })
      await executeRunDirect('run-1')

      expect(memoryRun?.status).toBe('completed')
      expect(endSessionMock).toHaveBeenCalledWith('ts-1', 'quick-learn-completed', 1)
      expect(completeTaskMock).toHaveBeenCalledWith({ taskId: 't1', userId: 'u1' })

      const report = JSON.parse(memoryRun!.report!)
      expect(report.schemaVersion).toBe('quick-learn-report-v1')
      expect(report.lifecycle.completionReached).toBe(true)
      expect(report.lifecycle.taskCompleted).toBe(true)
      expect(report.lifecycle.wrapupGenerated).toBe(true)
      expect(report.lifecycle.outboxConsumerDone).toBe(true)
      expect(report.transcript).toHaveLength(1)
      // 学习后 lss 变化被记录
      expect(report.learnerDelta.metrics.changed).toContain('lss')
      expect(report.learnerDelta.knowledge.newMastered).toEqual(['投影'])
      // 下一任务探测存在
      expect(report.downstream.nextTask?.taskId).toBe('t2')
      // Goal 静态结论
      expect(report.downstream.goal.consumesLearnerSnapshot).toBe(false)
    })

    it('教师收束但学习者不认可时不完成任务', async () => {
      executeSkillMock.mockResolvedValue(simulatorOutput(false))
      processMessageMock.mockResolvedValue({
        analysis: {},
        aiResponse: '你可以结束了',
        strategies: [],
        knowledgePoint: null,
        knowledgePoints: [],
        isCompletion: true,
        currentState: {},
        peerTriggered: false,
        revision: 1,
      })

      await quickLearnService.startRun({ profileId: 'p1', taskId: 't1' })
      await executeRunDirect('run-1')

      expect(memoryRun?.status).toBe('failed')
      expect(endSessionMock).toHaveBeenCalledWith('ts-1', 'quick-learn-teacher-only-close', 1)
      expect(completeTaskMock).not.toHaveBeenCalled()

      const report = JSON.parse(memoryRun!.report!)
      expect(report.lifecycle.completionReached).toBe(false)
      expect(report.lifecycle.divergence).toBe('teacher_ready_learner_not')
    })

    it('收到中止请求时不完成任务并标记 aborted', async () => {
      executeSkillMock.mockResolvedValue(simulatorOutput(false))
      processMessageMock.mockResolvedValue({
        analysis: {},
        aiResponse: '继续',
        strategies: [],
        knowledgePoint: null,
        knowledgePoints: [],
        isCompletion: false,
        currentState: {},
        peerTriggered: false,
        revision: 1,
      })

      await quickLearnService.startRun({ profileId: 'p1', taskId: 't1' })
      if (memoryRun) memoryRun.abortRequestedAt = new Date()
      await executeRunDirect('run-1')

      expect(memoryRun?.status).toBe('aborted')
      expect(endSessionMock).toHaveBeenCalledWith('ts-1', 'quick-learn-aborted', 0)
      expect(completeTaskMock).not.toHaveBeenCalled()
    })

    it('模拟器连续失败时终止运行', async () => {
      executeSkillMock.mockResolvedValue(null)

      await quickLearnService.startRun({ profileId: 'p1', taskId: 't1' })
      await executeRunDirect('run-1')

      expect(memoryRun?.status).toBe('failed')
      expect(memoryRun?.error).toContain('模拟器连续失败')
      expect(completeTaskMock).not.toHaveBeenCalled()
    })
  })

  describe('recoverInterruptedRuns', () => {
    it('标记超时遗留运行为 interrupted', async () => {
      runsUpdateMany.mockResolvedValueOnce({ count: 2 })
      const count = await quickLearnService.recoverInterruptedRuns()
      expect(count).toBe(2)
      expect(runsUpdateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'interrupted' }),
        })
      )
    })
  })
})
