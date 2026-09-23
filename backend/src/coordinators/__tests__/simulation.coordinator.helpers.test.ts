/**
 * SimulationOrchestrator 纯工具函数特征化测试（抽离后直接覆盖 simulation.helpers.ts）。
 *
 * 这些函数不依赖 this / prisma / LLM，是模拟协调器抽离线的行为契约。
 */
import {
  sanitizeVisibleDialogue,
  inferLearningPhase,
  getRunnableTasks,
  countTaskProgress,
  findTaskInPath,
  buildProgressAfterTaskCompletion,
  buildDefaultLearnerState,
  buildStoryBehaviorBias,
  mergeLearnerState,
  buildGoalConcernPool,
  flattenGoalConcernPool,
  resolveLearnTurnBudget,
  isGoalConverged,
  mapGoalStageToLearnerPhase,
  parseStageResultsPayload,
  parseStoryContextFromStageResults,
  resolveSimLearnerState,
  isRetryableLearnUpstreamError,
  boundTaskCompletionError,
  isAbortLikeLearnError,
  isTransientUpstreamLearnError,
  isPathReviewAlreadyAcceptedForCurrentPath,
  parseProfileData
} from '../simulation.helpers'
import type { VirtualLearnerProfile } from '../simulation.types'
import type { VirtualLearnerProfileRow } from '../../virtual-lab/vlab-types'

type Milestone = { title?: string; subtasks: Array<{ id: string; title?: string; status?: string }> }

const baseProfile = (over: Partial<VirtualLearnerProfile> = {}): VirtualLearnerProfile => ({
  id: 'p1',
  userId: 'u1',
  learningGoal: 'learn',
  profile: {},
  knowledgeLevel: 'beginner',
  knownConcepts: [],
  struggleConcepts: [],
  personalityTraits: {},
  ...over
})

const milestones: Milestone[] = [
  {
    title: 'M1',
    subtasks: [
      { id: 't1', title: 'T1', status: 'completed' },
      { id: 't2', title: 'T2', status: 'pending' }
    ]
  },
  {
    title: 'M2',
    subtasks: [
      { id: 't3', title: 'T3', status: 'pending' },
      { id: 't4', title: 'T4', status: 'completed' }
    ]
  }
]

describe('inferLearningPhase thresholds', () => {
  it('defaults to trying', () => {
    expect(inferLearningPhase(undefined)).toBe('trying')
    expect(inferLearningPhase({})).toBe('trying')
  })

  it('readyForNextTask wins over every blocker', () => {
    expect(inferLearningPhase({ readyForNextTask: true })).toBe('ready_to_close')
    expect(inferLearningPhase({ readyForNextTask: true, remainingBlockers: ['x'], cognitiveLoad: 0.9 })).toBe('ready_to_close')
  })

  it('blocked on blocker count / cognitiveLoad >= 0.72 / misconceptionRisk >= 0.7', () => {
    expect(inferLearningPhase({ remainingBlockers: ['x'] })).toBe('blocked')
    expect(inferLearningPhase({ cognitiveLoad: 0.72 })).toBe('blocked')
    expect(inferLearningPhase({ cognitiveLoad: 0.719 })).toBe('trying')
    expect(inferLearningPhase({ misconceptionRisk: 0.7 })).toBe('blocked')
    expect(inferLearningPhase({ misconceptionRisk: 0.699 })).toBe('trying')
    expect(inferLearningPhase({ remainingBlockers: ['x'], taskUnderstanding: 0.95 })).toBe('blocked')
  })

  it('verifying at taskUnderstanding >= 0.7', () => {
    expect(inferLearningPhase({ taskUnderstanding: 0.7 })).toBe('verifying')
    expect(inferLearningPhase({ taskUnderstanding: 0.699 })).toBe('trying')
  })
})

describe('sanitizeVisibleDialogue', () => {
  it('strips tags, normalizes newlines/spaces and trims', () => {
    expect(sanitizeVisibleDialogue('')).toBe('')
    expect(sanitizeVisibleDialogue('a <b>c</b> d')).toBe('a c d')
    expect(sanitizeVisibleDialogue('hello\r\nworld')).toBe('hello\nworld')
    expect(sanitizeVisibleDialogue('a\n\n\n\nb')).toBe('a\n\nb')
    expect(sanitizeVisibleDialogue('a    b')).toBe('a b')
    expect(sanitizeVisibleDialogue('  hi  ')).toBe('hi')
  })
})

describe('getRunnableTasks / countTaskProgress', () => {
  it('getRunnableTasks keeps every non-completed task (missing status is runnable)', () => {
    const tasks = [
      { id: 'a', status: 'completed' },
      { id: 'b', status: 'pending' },
      { id: 'c' }
    ]
    expect(getRunnableTasks(tasks).map((t: { id: string }) => t.id)).toEqual(['b', 'c'])
    expect(getRunnableTasks()).toEqual([])
  })

  it('counts flattened tasks and treats completedTaskId as completed', () => {
    expect(countTaskProgress(milestones)).toEqual({ totalTasks: 4, completedTasks: 2 })
    expect(countTaskProgress(milestones, 't2')).toEqual({ totalTasks: 4, completedTasks: 3 })
    expect(countTaskProgress(milestones, 't1')).toEqual({ totalTasks: 4, completedTasks: 2 })
    expect(countTaskProgress(milestones, null)).toEqual({ totalTasks: 4, completedTasks: 2 })
  })
})

describe('findTaskInPath', () => {
  it('returns milestone/task coordinates or null', () => {
    const found = findTaskInPath(milestones, 't3')
    expect(found).toEqual({
      milestone: milestones[1],
      milestoneIdx: 1,
      task: milestones[1].subtasks[0],
      taskIdx: 0
    })
    expect(findTaskInPath(milestones, 'nope')).toBeNull()
    expect(findTaskInPath(milestones, null)).toBeNull()
    expect(findTaskInPath(milestones, undefined)).toBeNull()
  })
})

describe('buildProgressAfterTaskCompletion', () => {
  it('advances to the next runnable task', () => {
    expect(buildProgressAfterTaskCompletion(milestones, 't1')).toEqual({
      isPathCompleted: false,
      currentTask: milestones[0].subtasks[1],
      progress: {
        currentMilestone: 0,
        currentMilestoneTitle: 'M1',
        currentTaskIdx: 0,
        currentTaskId: 't2',
        currentTaskTitle: 'T2',
        totalMilestones: 2
      }
    })
  })

  it('crosses into the next milestone', () => {
    expect(buildProgressAfterTaskCompletion(milestones, 't2')).toEqual({
      isPathCompleted: false,
      currentTask: milestones[1].subtasks[0],
      progress: {
        currentMilestone: 1,
        currentMilestoneTitle: 'M2',
        currentTaskIdx: 0,
        currentTaskId: 't3',
        currentTaskTitle: 'T3',
        totalMilestones: 2
      }
    })
  })

  it('falls back to the first remaining runnable task when completing a later milestone', () => {
    const result = buildProgressAfterTaskCompletion(milestones, 't4')
    expect(result.isPathCompleted).toBe(false)
    expect(result.currentTask.id).toBe('t2')
  })

  it('reports path completion when nothing runnable remains', () => {
    const done: Milestone[] = [{ title: 'M', subtasks: [{ id: 'a', title: 'A', status: 'completed' }] }]
    expect(buildProgressAfterTaskCompletion(done, 'a')).toEqual({
      isPathCompleted: true,
      currentTask: null,
      progress: {
        currentMilestone: 1,
        currentMilestoneTitle: null,
        currentTaskIdx: 0,
        currentTaskId: null,
        currentTaskTitle: null,
        totalMilestones: 1
      }
    })
  })
})

describe('buildDefaultLearnerState', () => {
  it('derives goal-stage defaults from an empty beginner profile', () => {
    const state = buildDefaultLearnerState(baseProfile(), 'goal')
    expect(state).toEqual({
      motivationLevel: 0.58,
      attentionLevel: 0.58,
      persistenceLevel: 0.58,
      confusionLevel: 0.48,
      frustrationLevel: 0.18,
      goalReadiness: 0.28,
      wantsClarification: false,
      readyToAdvance: false,
      selfPerceivedMastery: 0.24,
      actualMastery: 0.2,
      memoryStrength: 0.5,
      remainingUnknowns: ['真实问题还没有完全说清', '还不确定哪种方式真正适合自己'],
      stableErrorStyle: undefined
    })
  })

  it('shifts defaults per stage and knowledge level', () => {
    const pathState = buildDefaultLearnerState(baseProfile(), 'path')
    expect(pathState.confusionLevel).toBe(0.32)
    expect(pathState.goalReadiness).toBe(0.6)
    expect(pathState.readyToAdvance).toBeUndefined()

    const advanced = buildDefaultLearnerState(baseProfile({ knowledgeLevel: 'advanced' }), 'teaching')
    expect(advanced.selfPerceivedMastery).toBe(0.72)
    expect(advanced.actualMastery).toBe(0.75)
    expect(advanced.goalReadiness).toBeUndefined()
    expect(advanced.remainingUnknowns).toBeUndefined()
  })

  it('applies personality traits and emotional background', () => {
    const state = buildDefaultLearnerState(baseProfile({
      profile: { emotionalBaseline: '容易焦虑' },
      personalityTraits: { patience: 'low', enthusiasm: 'high', questionStyle: 'clarifying' }
    }), 'goal')
    expect(state.motivationLevel).toBe(0.76)
    expect(state.persistenceLevel).toBe(0.35)
    expect(state.attentionLevel).toBe(0.35)
    expect(state.frustrationLevel).toBe(0.26)
    expect(state.wantsClarification).toBe(true)
  })
})

describe('buildStoryBehaviorBias', () => {
  it('returns nothing without a story context', () => {
    expect(buildStoryBehaviorBias(undefined)).toEqual({})
  })

  it('maps pressure/behavior signals', () => {
    expect(buildStoryBehaviorBias({ pressurePoints: ['有点焦虑'], behaviorHooks: [] }))
      .toEqual({ frustrationLevel: 0.34, confusionLevel: 0.54 })
    expect(buildStoryBehaviorBias({ behaviorHooks: ['我会追问细节'] }))
      .toEqual({ wantsClarification: true })
    expect(buildStoryBehaviorBias({ behaviorHooks: ['先保留意见'] }))
      .toEqual({ readyToAdvance: false })
    expect(buildStoryBehaviorBias({ behaviorHooks: ['装懂'] }))
      .toEqual({ selfPerceivedMastery: 0.58, actualMastery: 0.38 })
  })

  it('merges every matched signal', () => {
    expect(buildStoryBehaviorBias({
      pressurePoints: ['紧张', '追问', '质疑', '先猜'],
      behaviorHooks: []
    })).toEqual({
      frustrationLevel: 0.34,
      confusionLevel: 0.54,
      wantsClarification: true,
      readyToAdvance: false,
      selfPerceivedMastery: 0.58,
      actualMastery: 0.38
    })
  })
})

describe('mergeLearnerState goal clamps', () => {
  it('keeps readyToAdvance once goalReadiness >= 0.78 and no clarification need', () => {
    const state = mergeLearnerState(
      baseProfile(),
      { goalReadiness: 0.9, wantsClarification: false, readyToAdvance: true },
      'goal'
    )
    expect(state.goalReadiness).toBe(0.9)
    expect(state.readyToAdvance).toBe(true)
  })

  it('forces readyToAdvance=false when goalReadiness < 0.55', () => {
    const state = mergeLearnerState(
      baseProfile(),
      { goalReadiness: 0.4, readyToAdvance: true },
      'goal'
    )
    expect(state.readyToAdvance).toBe(false)
  })

  it('does not force readyToAdvance=true when clarification is still wanted', () => {
    const state = mergeLearnerState(
      baseProfile(),
      { goalReadiness: 0.9, wantsClarification: true, readyToAdvance: true },
      'goal'
    )
    expect(state.readyToAdvance).toBe(true)
  })

  it('restores a non-finite goalReadiness to the stage default', () => {
    const state = mergeLearnerState(baseProfile(), { goalReadiness: NaN }, 'goal')
    expect(state.goalReadiness).toBe(0.28)
  })
})

describe('mergeLearnerState teaching clamps', () => {
  it('derives readyForNextTask from taskUnderstanding and misconceptionRisk', () => {
    const ready = mergeLearnerState(
      baseProfile(),
      { taskUnderstanding: 0.8, misconceptionRisk: 0.3 },
      'teaching'
    )
    expect(ready.readyForNextTask).toBe(true)

    const risky = mergeLearnerState(
      baseProfile(),
      { taskUnderstanding: 0.8, misconceptionRisk: 0.5 },
      'teaching'
    )
    expect(risky.readyForNextTask).toBe(false)

    const unknownRisk = mergeLearnerState(baseProfile(), { taskUnderstanding: 0.8 }, 'teaching')
    expect(unknownRisk.readyForNextTask).toBe(false)
  })

  it('derives helpSeekingReadiness from wantsClarification', () => {
    const seeks = mergeLearnerState(baseProfile(), { wantsClarification: true }, 'teaching')
    expect(seeks.helpSeekingReadiness).toBe(0.7)
    const quiet = mergeLearnerState(baseProfile(), {}, 'teaching')
    expect(quiet.helpSeekingReadiness).toBe(0.35)
  })

  it('falls back taskUnderstanding to understandingLevel', () => {
    const state = mergeLearnerState(baseProfile(), { understandingLevel: 0.65 }, 'teaching')
    expect(state.taskUnderstanding).toBe(0.65)
  })
})

describe('buildGoalConcernPool / flattenGoalConcernPool', () => {
  it('always seeds one primary concern and adds baseline concerns by profile', () => {
    const pool = buildGoalConcernPool(baseProfile(), undefined)
    expect(pool.primary).toEqual(['我真正想解决的问题可能和表面目标不完全一样'])
    expect(pool.secondary).toEqual(['我担心自己基础不够，容易跟不上'])
    expect(pool.hidden).toEqual([])
    expect(flattenGoalConcernPool(pool)).toHaveLength(2)
  })

  it('routes every profile signal into primary/secondary/hidden', () => {
    const profile = baseProfile({
      profile: {
        priorAttempts: '试过',
        availableTime: 'minimal',
        motivationType: 'career',
        emotionalBaseline: '焦虑',
        emotionalTriggers: ['a', 'b', 'c'],
        helpSeekingPattern: '习惯',
        adversarialPattern: '质疑',
        // 2026-09-21 字段分工：等级枚举给机器、行为散文给模拟器表现层（这里两者都测）
        cognitiveLoadTolerance: '低',
        overloadReaction: '信息一多就容易乱，需要把任务拆小',
        metacognitiveProfile: '弱',
        memoryRepairPattern: '遗忘'
      },
      struggleConcepts: ['A', 'B', 'C'],
      personalityTraits: { questionStyle: 'none', patience: 'low' }
    })
    const pool = buildGoalConcernPool(profile, undefined)
    expect(pool.primary).toHaveLength(3)
    expect(pool.secondary).toHaveLength(5)
    expect(pool.hidden).toHaveLength(7)
    expect(pool.primary).toContain('我对某些关键点长期卡住，比如：A、B')
    expect(pool.secondary).toContain('我的时间可能不稳定，担心学不完或者坚持不下去')
    // 行为描述来自 overloadReaction（散文），不是 cognitiveLoadTolerance（枚举）
    expect(pool.secondary).toContain('我的信息承载方式有边界：信息一多就容易乱，需要把任务拆小')
    expect(pool.hidden).toContain('这件事会牵动我的情绪底色：焦虑')
    expect(pool.hidden).toContain('有些情境会明显放大我的压力，比如：a、b')
    expect(pool.hidden).toContain('即使我忘了或没真懂，也可能先按自己的习惯处理：遗忘')
    expect(flattenGoalConcernPool(pool)).toHaveLength(15)
  })

  it('认知负荷等级枚举不进入行为描述（只吃 overloadReaction 散文）', () => {
    const profile = baseProfile({
      profile: { cognitiveLoadTolerance: 'low' },
      struggleConcepts: [],
      personalityTraits: { questionStyle: 'none', patience: 'low' }
    })
    const pool = buildGoalConcernPool(profile, undefined)
    expect(pool.secondary.some((line) => line.includes('我的信息承载方式有边界'))).toBe(false)
    // 老数据兼容：散文写在 cognitiveLoadTolerance 里时仍然当行为描述用
    const legacy = buildGoalConcernPool(
      baseProfile({ profile: { cognitiveLoadTolerance: '信息一多就乱，需要把任务拆小' }, struggleConcepts: [], personalityTraits: { questionStyle: 'none', patience: 'low' } }),
      undefined
    )
    expect(legacy.secondary.some((line) => line.includes('我的信息承载方式有边界'))).toBe(true)
  })
})

describe('resolveLearnTurnBudget', () => {
  it('falls back to the default budget', () => {
    expect(resolveLearnTurnBudget({})).toBe(40)
  })

  it('takes the max of default / authorized / session cap', () => {
    expect(resolveLearnTurnBudget({}, 70)).toBe(70)
    expect(resolveLearnTurnBudget({ simulationConfig: { turnCapPerLesson: 60 } })).toBe(60)
    expect(resolveLearnTurnBudget({ autopilot: { maxTurns: 55 } })).toBe(55)
    expect(resolveLearnTurnBudget({ simulationConfig: { turnCapPerLesson: 50 } }, 30)).toBe(50)
  })

  it('ignores non-positive / non-finite sources', () => {
    expect(resolveLearnTurnBudget({}, 0)).toBe(40)
    expect(resolveLearnTurnBudget({ simulationConfig: { turnCapPerLesson: -5 } }, -1)).toBe(40)
    expect(resolveLearnTurnBudget({}, NaN)).toBe(40)
  })

  it('caps each authorized/session source at 100', () => {
    expect(resolveLearnTurnBudget({}, 150)).toBe(100)
    expect(resolveLearnTurnBudget({ simulationConfig: { turnCapPerLesson: 150 } })).toBe(100)
    expect(resolveLearnTurnBudget(
      { simulationConfig: { turnCapPerLesson: 120 }, autopilot: { maxTurns: 90 } },
      95
    )).toBe(95)
  })
})

describe('misc pure helpers', () => {
  it('isGoalConverged', () => {
    expect(isGoalConverged('ready')).toBe(true)
    expect(isGoalConverged('completed')).toBe(true)
    expect(isGoalConverged('active')).toBe(false)
    expect(isGoalConverged(null)).toBe(false)
    expect(isGoalConverged(undefined)).toBe(false)
  })

  it('mapGoalStageToLearnerPhase', () => {
    expect(mapGoalStageToLearnerPhase('proposing')).toBe('proposal_evaluation')
    expect(mapGoalStageToLearnerPhase('ready')).toBe('proposal_evaluation')
    expect(mapGoalStageToLearnerPhase('completed')).toBe('proposal_evaluation')
    expect(mapGoalStageToLearnerPhase('READY')).toBe('proposal_evaluation')
    expect(mapGoalStageToLearnerPhase('clarifying')).toBe('understanding')
    expect(mapGoalStageToLearnerPhase(null)).toBe('understanding')
  })

  it('parseStageResultsPayload', () => {
    expect(parseStageResultsPayload('{"goal":{"stage":"ready"}}')).toEqual({ goal: { stage: 'ready' } })
    expect(parseStageResultsPayload('not-json')).toEqual({})
    expect(parseStageResultsPayload(null)).toEqual({})
    expect(parseStageResultsPayload('')).toEqual({})
  })

  it('parseStoryContextFromStageResults', () => {
    expect(parseStoryContextFromStageResults({ story: { title: 'S' } })).toEqual({ title: 'S' })
    expect(parseStoryContextFromStageResults({})).toBeNull()
  })

  it('resolveSimLearnerState prefers envelope nextState, then learnerState, then fallback', () => {
    const fromEnvelope = { taskUnderstanding: 0.9 }
    expect(resolveSimLearnerState({ runtimeEnvelope: { contextUpdate: { nextState: fromEnvelope } } }, {}))
      .toBe(fromEnvelope)
    const direct = { taskUnderstanding: 0.5 }
    expect(resolveSimLearnerState({ learnerState: direct }, {})).toBe(direct)
    const fallback = { taskUnderstanding: 0.1 }
    expect(resolveSimLearnerState({}, fallback)).toBe(fallback)
    expect(resolveSimLearnerState({})).toEqual({})
  })

  it('isRetryableLearnUpstreamError', () => {
    expect(isRetryableLearnUpstreamError(new Error('connection timeout'))).toBe(true)
    expect(isRetryableLearnUpstreamError('rate limit exceeded')).toBe(true)
    expect(isRetryableLearnUpstreamError('HTTP 503')).toBe(true)
    expect(isRetryableLearnUpstreamError('structured_output_invalid: bad payload')).toBe(true)
    expect(isRetryableLearnUpstreamError('response does not contain valid json')).toBe(false)
    expect(isRetryableLearnUpstreamError('retry_budget_exhausted')).toBe(false)
    expect(isRetryableLearnUpstreamError('random domain failure')).toBe(false)
  })

  it('isAbortLikeLearnError：中止类（客户端断开/进程重启取消）非终局，可续跑', () => {
    // 中止类（跑数观察 #3 的三种实况）
    expect(isAbortLikeLearnError(new Error('API request canceled'))).toBe(true)
    expect(isAbortLikeLearnError(new Error('request_aborted：请求已取消，停止 Learn 上游调用'))).toBe(true)
    const econnreset = Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' })
    expect(isAbortLikeLearnError(econnreset)).toBe(true)
    // 真正的中止 ≠ 上游重试耗尽：可重试（isRetryable）但语义是"中止"
    expect(isRetryableLearnUpstreamError(new Error('API request canceled'))).toBe(true)
    // 非中止：应走终局 failed
    expect(isAbortLikeLearnError(new Error('Learn 上游调用重试耗尽：timeout'))).toBe(false)
    expect(isAbortLikeLearnError(new Error('structured_output_invalid'))).toBe(false)
    expect(isAbortLikeLearnError(null)).toBe(false)
  })

  it('isTransientUpstreamLearnError：上游突发（会话级）非终局；硬失败仍终局（I-1）', () => {
    // 网关预算耗尽会继承最后一次真实失败的 category
    expect(isTransientUpstreamLearnError(Object.assign(new Error('Provider request retry budget exhausted'), { code: 'RETRY_BUDGET_EXHAUSTED', category: 'provider_timeout' }))).toBe(true)
    expect(isTransientUpstreamLearnError(Object.assign(new Error('Provider request retry budget exhausted'), { code: 'RETRY_BUDGET_EXHAUSTED', category: 'provider_http', statusCode: 502 }))).toBe(true)
    // category=internal（平台自身问题）不当成上游突发
    expect(isTransientUpstreamLearnError(Object.assign(new Error('Provider request retry budget exhausted'), { code: 'RETRY_BUDGET_EXHAUSTED', category: 'internal' }))).toBe(false)
    // 包装丢了 category：靠 statusCode / 文案兜底
    expect(isTransientUpstreamLearnError(Object.assign(new Error('boom'), { statusCode: 503 }))).toBe(true)
    expect(isTransientUpstreamLearnError(new Error('Provider request retry budget exhausted'))).toBe(true)
    expect(isTransientUpstreamLearnError(new Error('connection timeout'))).toBe(true)
    // 硬失败：业务/契约类不该被当成"再跑一次就好"
    expect(isTransientUpstreamLearnError(new Error('业务校验失败：缺少必填字段'))).toBe(false)
    expect(isTransientUpstreamLearnError(new Error('当前 Learn 没有绑定教学会话'))).toBe(false)
  })

  it('isPathReviewAlreadyAcceptedForCurrentPath：已接受的当前 Path 才短路（换版需重评）', () => {
    const accepted = { path_review: { status: 'accepted', reviewedPathId: 'lp_1' } }
    expect(isPathReviewAlreadyAcceptedForCurrentPath(accepted, 'lp_1')).toBe(true)
    // Path 换版（评审针对旧版）→ 不短路
    expect(isPathReviewAlreadyAcceptedForCurrentPath(accepted, 'lp_2')).toBe(false)
    // 未接受 / 缺字段
    expect(isPathReviewAlreadyAcceptedForCurrentPath({ path_review: { status: 'pending', reviewedPathId: 'lp_1' } }, 'lp_1')).toBe(false)
    expect(isPathReviewAlreadyAcceptedForCurrentPath({ path_review: { status: 'accepted' } }, 'lp_1')).toBe(false)
    expect(isPathReviewAlreadyAcceptedForCurrentPath({}, 'lp_1')).toBe(false)
    expect(isPathReviewAlreadyAcceptedForCurrentPath(accepted, null)).toBe(false)
    expect(isPathReviewAlreadyAcceptedForCurrentPath(null, 'lp_1')).toBe(false)
  })

  it('boundTaskCompletionError truncates over 1000 chars', () => {
    expect(boundTaskCompletionError(new Error('boom'))).toBe('boom')
    expect(boundTaskCompletionError('plain')).toBe('plain')
    expect(boundTaskCompletionError(null)).toBe('任务完成失败')
    const long = 'x'.repeat(1001)
    const bounded = boundTaskCompletionError(new Error(long))
    expect(bounded).toHaveLength(1000)
    expect(bounded.endsWith('...')).toBe(true)
  })

  it('parseProfileData parses JSON columns with defaults', () => {
    const row = {
      id: 'p1',
      userId: 'u1',
      profile: '{"age":30}',
      learningGoal: 'learn',
      knowledgeLevel: 'intermediate',
      knownConcepts: '["a"]',
      struggleConcepts: '["b"]',
      personalityTraits: '{"patience":"high"}',
      simulationPrompt: 'sp',
      simulationModel: 'm',
      simulationTemperature: 0.5
    } as unknown as VirtualLearnerProfileRow
    expect(parseProfileData(row)).toEqual({
      id: 'p1',
      userId: 'u1',
      profile: { age: 30 },
      learningGoal: 'learn',
      knowledgeLevel: 'intermediate',
      knownConcepts: ['a'],
      struggleConcepts: ['b'],
      personalityTraits: { patience: 'high' },
      simulationPrompt: 'sp',
      simulationModel: 'm',
      simulationTemperature: 0.5
    })

    const defaults = parseProfileData({
      id: 'p2',
      userId: 'u2',
      profile: 'bad-json',
      learningGoal: 'learn'
    } as unknown as VirtualLearnerProfileRow)
    expect(defaults).toMatchObject({
      profile: {},
      knownConcepts: [],
      struggleConcepts: [],
      personalityTraits: {},
      knowledgeLevel: 'beginner'
    })
  })
})
