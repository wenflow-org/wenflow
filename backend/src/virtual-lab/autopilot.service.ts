/**
 * Autopilot 全自动模式：一次启动，以「整个 Goal 的 Path 全部完成」为唯一终点。
 *
 * 与「一键全流程」(run-full) 的区别：
 *  - 脱离 HTTP 请求上下文执行（runWithContext 无 abortSignal），浏览器切走/超时不会取消 LLM；
 *  - 内部循环持续推进，不再依赖前端反复点击；
 *  - Goal 未收敛、Path 生成中、单课超预算等可恢复情形自动重试/续跑；
 *  - 显式 stopRequested 停止（可随时手动接管）。
 *
 * 状态持久化在 stageResults.autopilot（前端驾驶舱直接读取展示）。
 */
import prisma from '../config/database'
import { logger } from '../utils/logger'
import { runWithContext } from '../gateway/api-gateway/context'
import { asErrorLike } from './vlab-types'
import simulationCoordinator from '../coordinators/simulation.coordinator'
import blackboxVirtualLearnerRunner from './blackbox-runner'
import { safeJsonParse } from '../utils/safe-json'
import type { VirtualSessionWithProfile } from './vlab-types'

const AUTOPILOT_GOAL_MAX_ROUNDS = 20
/** Goal 阶段反复不收敛的自动重试上限 */
const AUTOPILOT_GOAL_RETRIES = 3
/** 每课可恢复失败的自动恢复上限（restart-learning 续跑） */
const AUTOPILOT_LESSON_RECOVERY_LIMIT = 3
/** 黑盒 step 可恢复失败的同 key 重试上限 */
const AUTOPILOT_BLACKBOX_STEP_RETRIES = 3
/** 黑盒 waitingForObservation（path 生成中等）连续空等上限：超过判定死等退出 */
const AUTOPILOT_WAIT_OBSERVATION_LIMIT_MS = 10 * 60 * 1000
/** 迭代间最小间隔（防止热循环打满数据库） */
const AUTOPILOT_LOOP_PAUSE_MS = 1500

export type AutopilotMode = 'assisted' | 'blackbox'

/** 自动运行目标：stage=推进完当前阶段即停；final=直达最终目标（Path 全部完成） */
export type AutopilotTarget = 'stage' | 'final'

export type AutopilotState = {
  status: 'idle' | 'running' | 'completed' | 'failed' | 'stopped'
  mode?: AutopilotMode
  /** 本次运行目标：stage（阶段级） / final（全局级） */
  target?: AutopilotTarget
  /** 阶段级目标达成时记录已达成的阶段（goal / path / teaching） */
  completedStage?: string | null
  startedAt?: string
  completedAt?: string
  steps?: number
  lastStage?: string | null
  lastError?: string | null
  stopRequested?: boolean
  lessonRecoveries?: number
  waitingSince?: string | null
}

export class AutopilotConflictError extends Error {
  readonly code = 'AUTOPILOT_ALREADY_RUNNING'
  readonly statusCode = 409

  constructor(sessionId: string) {
    super(`该虚拟会话已有全自动运行在进行中：${sessionId}`)
    this.name = 'AutopilotConflictError'
  }
}

export class AutopilotTerminalError extends Error {
  readonly code = 'AUTOPILOT_TERMINAL'
  readonly statusCode = 409

  constructor() {
    super('会话已处于终态，无需启动全自动')
    this.name = 'AutopilotTerminalError'
  }
}

const TERMINAL_STATUSES = new Set(['completed', 'failed', 'abandoned'])

/** stageResults JSON 解析（带类型参数的 safeJsonParse，fallback 缺省空对象） */
function parseStageResults(value: string | null | undefined): StageResults {
  return safeJsonParse<StageResults>(value, {})
}

export type StageResults = {
  autopilot?: Partial<AutopilotState>
  experiment?: { mode?: string }
  story?: unknown
  simulationConfig?: { frictionBudget?: string }
  blackbox?: {
    control?: Record<string, unknown>
    publicTrace?: Array<{ observation?: { stage?: string; availableActions?: string[] } }>
  }
  teaching?: Record<string, unknown>
  [key: string]: unknown
}

export class AutopilotService {
  /** 进程内并发锁：同一会话只允许一个全自动运行 */
  private readonly runningSessions = new Set<string>()

  /** 读取会话的 autopilot 状态（stageResults.autopilot） */
  static readState(session: { stageResults: string | null }): AutopilotState {
    const stageResults = parseStageResults(session.stageResults)
    const state = (stageResults.autopilot || {}) as AutopilotState
    return { status: 'idle', ...state }
  }

  private async writeState(
    sessionId: string,
    patch: Partial<AutopilotState>,
    base?: AutopilotState
  ): Promise<void> {
    const session = await prisma.virtual_sessions.findUnique({ where: { id: sessionId } })
    if (!session) return
    const stageResults = parseStageResults(session.stageResults)
    stageResults.autopilot = {
      ...(base || (stageResults.autopilot as AutopilotState | undefined) || {}),
      ...patch
    }
    await prisma.virtual_sessions.update({
      where: { id: sessionId },
      data: { stageResults: JSON.stringify(stageResults), updatedAt: new Date() }
    })
  }

  private resolveMode(session: VirtualSessionWithProfile): AutopilotMode {
    const stageResults = parseStageResults(session.stageResults)
    return stageResults.experiment?.mode === 'blackbox-api' ? 'blackbox' : 'assisted'
  }

  /**
   * 启动全自动运行（异步后台执行，立即返回）。
   * target='stage'：推进完当前阶段即停（阶段级）；
   * target='final'：直达最终目标（Path 全部完成，全局级，默认）。
   */
  async start(sessionId: string, options: { target?: AutopilotTarget } = {}): Promise<{ runId: string; mode: AutopilotMode; target: AutopilotTarget }> {
    const target = options.target === 'stage' ? 'stage' : 'final'
    const session = await prisma.virtual_sessions.findUnique({
      where: { id: sessionId },
      include: { virtual_learner_profiles: true }
    })
    if (!session) throw new Error('模拟会话不存在')
    if (TERMINAL_STATUSES.has(session.status)) throw new AutopilotTerminalError()

    const mode = this.resolveMode(session)
    const current = AutopilotService.readState(session)
    if (this.runningSessions.has(sessionId) || current.status === 'running') {
      throw new AutopilotConflictError(sessionId)
    }

    const runId = `autopilot_${sessionId.slice(0, 8)}_${Date.now()}`
    this.runningSessions.add(sessionId)
    await this.writeState(sessionId, {
      status: 'running',
      mode,
      target,
      completedStage: null,
      startedAt: new Date().toISOString(),
      completedAt: null as unknown as string,
      steps: 0,
      lastStage: session.currentStage,
      lastError: null,
      stopRequested: false,
      lessonRecoveries: 0,
      waitingSince: null
    })

    logger.info('[autopilot] 启动全自动运行', { sessionId, runId, mode, target, stage: session.currentStage })

    setImmediate(() => {
      void this.execute(sessionId, mode, runId, target).catch(async (error) => {
        logger.error('[autopilot] 运行未捕获异常', {
          sessionId,
          runId,
          error: error instanceof Error ? error.message : String(error)
        })
        await this.writeState(sessionId, {
          status: 'failed',
          completedAt: new Date().toISOString(),
          lastError: String(error instanceof Error ? error.message : error).slice(0, 500)
        }).catch(() => undefined)
      }).finally(() => {
        this.runningSessions.delete(sessionId)
      })
    })

    return { runId, mode, target }
  }

  /**
   * 请求停止：写入 stopRequested 标志，循环在下一个安全点退出。
   */
  async stop(sessionId: string): Promise<{ accepted: boolean; reason?: string }> {
    const session = await prisma.virtual_sessions.findUnique({ where: { id: sessionId } })
    if (!session) throw new Error('模拟会话不存在')
    const state = AutopilotService.readState(session)
    if (state.status !== 'running') {
      return { accepted: false, reason: `当前没有运行中的全自动（状态：${state.status}）` }
    }
    await this.writeState(sessionId, { stopRequested: true })
    logger.info('[autopilot] 请求停止全自动', { sessionId })
    return { accepted: true }
  }

  // ---------------------------------------------------------------------------
  // 后台执行主体
  // ---------------------------------------------------------------------------

  private pause(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, AUTOPILOT_LOOP_PAUSE_MS))
  }

  private async execute(sessionId: string, mode: AutopilotMode, runId: string, target: AutopilotTarget): Promise<void> {
    const session = await prisma.virtual_sessions.findUnique({
      where: { id: sessionId },
      include: { virtual_learner_profiles: true }
    })
    if (!session) throw new Error('模拟会话不存在')
    try {
      await runWithContext(
        {
          userId: session.userId,
          sourceEntry: 'simulation',
          callerAgent: 'simulation-agent',
          sessionId,
          runId
        },
        () => {
          if (target === 'stage') {
            return mode === 'blackbox'
              ? this.executeBlackboxStageLoop(sessionId, runId)
              : this.executeAssistedStageLoop(sessionId, runId)
          }
          return mode === 'blackbox'
            ? this.executeBlackboxLoop(sessionId, runId)
            : this.executeAssistedLoop(sessionId, runId)
        }
      )
    } finally {
      this.runningSessions.delete(sessionId)
    }
  }

  private async isStopRequested(sessionId: string): Promise<boolean> {
    const session = await prisma.virtual_sessions.findUnique({ where: { id: sessionId } })
    if (!session) return true
    const state = AutopilotService.readState(session)
    const stageResults = parseStageResults(session.stageResults)
    const teaching = (stageResults.teaching || {}) as Record<string, unknown>
    return state.stopRequested === true || teaching.paused === true || teaching.manualStop === true
  }

  private async markStopped(sessionId: string, reason: string) {
    await this.writeState(sessionId, {
      status: 'stopped',
      completedAt: new Date().toISOString(),
      lastError: reason
    })
    logger.info('[autopilot] 全自动已停止', { sessionId, reason })
  }

  // ---------------------------------------------------------------------------
  // assisted 循环：goal → path(等待生成) → 逐课推进，直至 session=completed
  // ---------------------------------------------------------------------------

  /** 逐单步推进 Goal 阶段（轮间检查停止，可随时安全退出）；返回是否收敛 */
  private async advanceGoalRoundByRound(sessionId: string, userId: string): Promise<{
    converged: boolean
    stopped: boolean
    lastError?: string
  }> {
    for (let round = 0; round < AUTOPILOT_GOAL_MAX_ROUNDS; round += 1) {
      if (await this.isStopRequested(sessionId)) {
        await this.markStopped(sessionId, 'stopRequested / 已暂停 / 手动停止')
        return { converged: false, stopped: true }
      }
      const step = await simulationCoordinator.runLeasedExclusive(sessionId, () =>
        simulationCoordinator.executeSingleStep({ sessionId, userId, mode: 'auto-loop' })
      )
      await this.countStep(sessionId)
      if (step.goalReady) return { converged: true, stopped: false }
      if (!step.success) return { converged: false, stopped: false, lastError: step.error }
      await this.pause()
    }
    return { converged: false, stopped: false }
  }

  private async executeAssistedLoop(sessionId: string, runId: string): Promise<void> {
    let lessonRecoveries = 0
    let goalRetries = 0

    // eslint-disable-next-line no-constant-condition`n    while (true) {
      if (await this.isStopRequested(sessionId)) {
        await this.markStopped(sessionId, 'stopRequested / 已暂停 / 手动停止')
        return
      }
      const session = await prisma.virtual_sessions.findUnique({
        where: { id: sessionId },
        include: { virtual_learner_profiles: true }
      })
      if (!session) return
      if (TERMINAL_STATUSES.has(session.status)) {
        const completed = session.status === 'completed'
        if (completed) await this.notifyGoalReached(sessionId, 'assisted')
        await this.writeState(sessionId, {
          status: completed ? 'completed' : 'failed',
          completedAt: new Date().toISOString(),
          lastStage: session.currentStage,
          lastError: completed ? null : `会话进入终态：${session.status}`
        })
        logger.info('[autopilot] 全自动结束', { sessionId, runId, status: session.status })
        return
      }

      const stage = session.currentStage
      logger.info('[autopilot] assisted 循环推进', { sessionId, runId, stage, steps: AutopilotService.readState(session).steps })
      await this.writeState(sessionId, { lastStage: stage })

      // ---- Goal 阶段：跑到收敛（自动转 Path）----
      if (stage === 'goal') {
        const result = await this.advanceGoalRoundByRound(sessionId, session.userId)
        if (result.stopped) return
        if (result.converged) {
          goalRetries = 0
          continue
        }
        goalRetries += 1
        if (goalRetries >= AUTOPILOT_GOAL_RETRIES) {
          await this.writeState(sessionId, {
            status: 'failed',
            completedAt: new Date().toISOString(),
            lastError: result.lastError || `Goal 阶段 ${AUTOPILOT_GOAL_RETRIES} 次尝试后仍未收敛`
          })
          return
        }
        logger.warn('[autopilot] Goal 未收敛，自动重试', { sessionId, goalRetries })
        await this.pause()
        continue
      }

      // ---- Path 阶段：等待生成就绪并启动 Learn ----
      if (stage === 'path') {
        const waitResult = await simulationCoordinator.waitForPathReady(sessionId, session.learningPathId)
        if (!waitResult.ready) {
          await this.writeState(sessionId, {
            status: 'failed',
            completedAt: new Date().toISOString(),
            lastError: waitResult.reason || 'Path 未就绪'
          })
          return
        }
        try {
          const review = await simulationCoordinator.runLeasedExclusive(sessionId, async () =>
            simulationCoordinator.resolvePathReview(sessionId, { startLearning: true })
          )
          if (!review.success) {
            await this.writeState(sessionId, {
              status: 'failed',
              completedAt: new Date().toISOString(),
              lastError: review.error || 'Path 评审失败'
            })
            return
          }
        } catch (error: unknown) {
          await this.writeState(sessionId, {
            status: 'failed',
            completedAt: new Date().toISOString(),
            lastError: `启动 Learn 失败：${asErrorLike(error).message || '未知'}`
          })
          return
        }
        await this.countStep(sessionId)
        continue
      }

      // ---- Teaching 阶段：逐课推进 ----
      const learnResult = await simulationCoordinator.runLeasedExclusive(sessionId, () =>
        simulationCoordinator.executeAutoLearning(sessionId, { maxMilestones: 20, maxTurns: 50 })
      )
      await this.countStep(sessionId)

      const after = await prisma.virtual_sessions.findUnique({ where: { id: sessionId } })
      if (after) {
        if (after.status === 'completed') {
          await this.notifyGoalReached(sessionId, 'assisted')
          await this.writeState(sessionId, {
            status: 'completed',
            completedAt: new Date().toISOString(),
            lastStage: after.currentStage,
            lastError: null
          })
          logger.info('[autopilot] 目标达成：Path 全部完成', { sessionId, runId })
          return
        }
        if (TERMINAL_STATUSES.has(after.status)) {
          await this.writeState(sessionId, {
            status: 'failed',
            completedAt: new Date().toISOString(),
            lastError: learnResult.error || `会话进入终态：${after.status}`
          })
          return
        }
      }

      // 单课失败：可恢复（provider 瞬时）→ restart-learning 续跑，有上限
      if (!learnResult.success) {
        const errMsg = String(learnResult.error || '').toLowerCase()
        const recoverable = /provider|timeout|timed out|fetch failed|network|rate.?limit|503|502|budget|invalid json|does not contain valid json|retry/i.test(errMsg)
        if (!recoverable) {
          await this.writeState(sessionId, {
            status: 'failed',
            completedAt: new Date().toISOString(),
            lastError: learnResult.error || '自动学习失败'
          })
          return
        }
        if (lessonRecoveries >= AUTOPILOT_LESSON_RECOVERY_LIMIT) {
          await this.writeState(sessionId, {
            status: 'failed',
            completedAt: new Date().toISOString(),
            lastError: `单课恢复上限（${AUTOPILOT_LESSON_RECOVERY_LIMIT} 次）已达：${learnResult.error || '未知'}`
          })
          return
        }
        lessonRecoveries += 1
        logger.warn('[autopilot] 单课失败，restart-learning 续跑', {
          sessionId,
          lessonRecoveries,
          error: learnResult.error
        })
        await this.writeState(sessionId, { lessonRecoveries })
        try {
          await simulationCoordinator.runLeasedExclusive(sessionId, () =>
            simulationCoordinator.restartLearningPhase(sessionId)
          )
        } catch (error: unknown) {
          await this.writeState(sessionId, {
            status: 'failed',
            completedAt: new Date().toISOString(),
            lastError: `重启 Learn 失败：${asErrorLike(error).message || '未知'}`
          })
          return
        }
        await this.pause()
        continue
      }

      await this.pause()
    }
  }

  // ---------------------------------------------------------------------------
  // blackbox 循环：逐 autoStep 推进（commandId 单调递增，可恢复失败同 key 续跑）
  // ---------------------------------------------------------------------------

  /** 黑盒推进一步（含可恢复失败同 key 续跑）；返回该步观察的 stage，失败时返回 null */
  private async blackboxAdvance(sessionId: string, stepIndex: number): Promise<{ stage?: string } | null> {
    const session = await prisma.virtual_sessions.findUnique({ where: { id: sessionId } })
    if (!session) return null
    const stageResults = parseStageResults(session.stageResults)
    const trace = Array.isArray(stageResults.blackbox?.publicTrace) ? stageResults.blackbox.publicTrace : []
    const commandId = `autopilot-${stepIndex}`
    const expectedTraceCount = trace.length
    let attempt = 0
    let result: { stage?: string } | null = null
    while (attempt < AUTOPILOT_BLACKBOX_STEP_RETRIES) {
      try {
        const command = await blackboxVirtualLearnerRunner.runCommand({
          sessionId,
          operatorId: 'autopilot',
          commandId,
          kind: 'step',
          request: {},
          expectedTraceCount
        }, () => blackboxVirtualLearnerRunner.autoStep(sessionId, 'autopilot'))
        result = command.result as { stage?: string }
        break
      } catch (error: unknown) {
        const transient = /timeout|timed out|fetch failed|network|rate.?limit|5\d\d|canceled|missing reply|missing learnerstate|does not contain valid json|simulation failed|动作生成失败/i.test(
          String(asErrorLike(error).message || '')
        )
        if (!transient) throw error
        attempt += 1
        logger.warn('[autopilot] 黑盒 step 可恢复失败，同 key 续跑', {
          sessionId,
          commandId,
          attempt,
          error: asErrorLike(error).message
        })
        await this.pause()
      }
    }
    if (!result) return null
    await this.countStep(sessionId)
    if (result.stage === 'completed' || result.stage === 'error') {
      logger.info('[autopilot] 黑盒步进到达终态观察', { sessionId, stage: result.stage })
    }
    return result
  }

  /** 读取黑盒会话当前观察（stage / availableActions / control.taskId） */
  private async readBlackboxObservation(sessionId: string) {
    const session = await prisma.virtual_sessions.findUnique({ where: { id: sessionId } })
    if (!session) return null
    const stageResults = parseStageResults(session.stageResults)
    const trace = Array.isArray(stageResults.blackbox?.publicTrace) ? stageResults.blackbox.publicTrace : []
    const latest = trace[trace.length - 1]?.observation as
      | { stage?: string; availableActions?: string[] } | undefined
    const control = (stageResults.blackbox?.control || {}) as Record<string, unknown>
    return {
      session,
      stage: latest?.stage || session.currentStage,
      availableActions: latest?.availableActions || [],
      taskId: typeof control.taskId === 'string' ? control.taskId : null,
      runCompleted: control.runCompleted === true,
      status: session.status
    }
  }

  /** 黑盒终态收口：completed（runCompleted/会话完成）或 failed，并落状态 */
  private async settleBlackboxTerminal(sessionId: string, runId: string, completedStage?: string | null) {
    const session = await prisma.virtual_sessions.findUnique({ where: { id: sessionId } })
    if (!session) return
    const stageResults = parseStageResults(session.stageResults)
    const control = (stageResults.blackbox?.control || {}) as Record<string, unknown>
    const completed = session.status === 'completed' || control.runCompleted === true
    if (completed) await this.notifyGoalReached(sessionId, 'blackbox')
    await this.writeState(sessionId, {
      status: completed ? 'completed' : 'failed',
      completedStage: completed ? completedStage ?? null : null,
      completedAt: new Date().toISOString(),
      lastStage: session.currentStage,
      lastError: completed ? null : `黑盒实验进入终态：${session.status}`
    })
    logger.info('[autopilot] 黑盒自动运行结束', { sessionId, runId, status: session.status })
  }

  private async executeBlackboxLoop(sessionId: string, runId: string): Promise<void> {
    let stepIndex = 0
    let waitingSince: number | null = null

    // eslint-disable-next-line no-constant-condition`n    while (true) {
      if (await this.isStopRequested(sessionId)) {
        await this.markStopped(sessionId, 'stopRequested / 已暂停 / 手动停止')
        return
      }
      const obs = await this.readBlackboxObservation(sessionId)
      if (!obs) return

      if (TERMINAL_STATUSES.has(obs.status)) {
        await this.settleBlackboxTerminal(sessionId, runId)
        return
      }

      const stage = obs.stage
      await this.writeState(sessionId, { lastStage: stage, waitingSince: null })

      // Path 生成等待态：自动等待（替代人工反复点击空转）
      const isWaiting = stage === 'path' && !obs.availableActions.includes('start_learning')
      if (isWaiting) {
        waitingSince = waitingSince ?? Date.now()
        if (Date.now() - waitingSince > AUTOPILOT_WAIT_OBSERVATION_LIMIT_MS) {
          await this.writeState(sessionId, {
            status: 'failed',
            completedAt: new Date().toISOString(),
            lastError: 'Path 生成等待超时（10 分钟无进展）'
          })
          return
        }
        await this.pause()
        continue
      }
      waitingSince = null

      stepIndex += 1
      const result = await this.blackboxAdvance(sessionId, stepIndex)
      if (!result) {
        await this.writeState(sessionId, {
          status: 'failed',
          completedAt: new Date().toISOString(),
          lastError: `黑盒 step 连续失败（${AUTOPILOT_BLACKBOX_STEP_RETRIES} 次）`
        })
        return
      }
      await this.pause()
    }
  }

  // ---------------------------------------------------------------------------
  // 阶段级（target='stage'）：推进完当前阶段即停，不越过阶段边界
  // ---------------------------------------------------------------------------

  /** 阶段级目标达成：写 completed + completedStage */
  private async markStageReached(sessionId: string, stage: string) {
    await this.writeState(sessionId, {
      status: 'completed',
      completedStage: stage,
      completedAt: new Date().toISOString(),
      lastError: null
    })
    logger.info('[autopilot] 阶段级目标达成', { sessionId, stage })
  }

  private async executeAssistedStageLoop(sessionId: string, runId: string): Promise<void> {
    let goalRetries = 0
    let lessonRecoveries = 0

    // eslint-disable-next-line no-constant-condition`n    while (true) {
      if (await this.isStopRequested(sessionId)) {
        await this.markStopped(sessionId, 'stopRequested / 已暂停 / 手动停止')
        return
      }
      const session = await prisma.virtual_sessions.findUnique({
        where: { id: sessionId },
        include: { virtual_learner_profiles: true }
      })
      if (!session) return

      if (TERMINAL_STATUSES.has(session.status)) {
        const completed = session.status === 'completed'
        if (completed) await this.notifyGoalReached(sessionId, 'assisted')
        await this.writeState(sessionId, {
          status: completed ? 'completed' : 'failed',
          completedStage: completed ? 'teaching' : null,
          completedAt: new Date().toISOString(),
          lastStage: session.currentStage,
          lastError: completed ? null : `会话进入终态：${session.status}`
        })
        logger.info('[autopilot] 阶段级结束（终态）', { sessionId, runId, status: session.status })
        return
      }

      const stage = session.currentStage
      await this.writeState(sessionId, { lastStage: stage })

      // ---- Goal：逐单步推进到收敛（轮间可停止）即停 ----
      if (stage === 'goal') {
        const result = await this.advanceGoalRoundByRound(sessionId, session.userId)
        if (result.stopped) return
        if (result.converged) {
          await this.markStageReached(sessionId, 'goal')
          return
        }
        goalRetries += 1
        if (goalRetries >= AUTOPILOT_GOAL_RETRIES) {
          await this.writeState(sessionId, {
            status: 'failed',
            completedAt: new Date().toISOString(),
            lastError: result.lastError || `Goal 阶段 ${AUTOPILOT_GOAL_RETRIES} 次尝试后仍未收敛`
          })
          return
        }
        await this.pause()
        continue
      }

      // ---- Path：等待生成就绪即停（不自动进入 Learn） ----
      if (stage === 'path') {
        const waitResult = await simulationCoordinator.waitForPathReady(sessionId, session.learningPathId)
        if (!waitResult.ready) {
          await this.writeState(sessionId, {
            status: 'failed',
            completedAt: new Date().toISOString(),
            lastError: waitResult.reason || 'Path 未就绪'
          })
          return
        }
        await this.markStageReached(sessionId, 'path')
        return
      }

      // ---- Teaching：完成本课即停（executeAutoLearning 以课界为终点） ----
      const learnResult = await simulationCoordinator.runLeasedExclusive(sessionId, () =>
        simulationCoordinator.executeAutoLearning(sessionId, { maxMilestones: 20, maxTurns: 50 })
      )
      const after = await prisma.virtual_sessions.findUnique({ where: { id: sessionId } })
      if (after) {
        if (after.status === 'completed') {
          await this.notifyGoalReached(sessionId, 'assisted')
          await this.writeState(sessionId, {
            status: 'completed',
            completedStage: 'teaching',
            completedAt: new Date().toISOString(),
            lastStage: after.currentStage,
            lastError: null
          })
          logger.info('[autopilot] 阶段级完成（恰为本课即最后一课）', { sessionId, runId })
          return
        }
        if (TERMINAL_STATUSES.has(after.status)) {
          await this.writeState(sessionId, {
            status: 'failed',
            completedAt: new Date().toISOString(),
            lastError: learnResult.error || `会话进入终态：${after.status}`
          })
          return
        }
      }

      if (!learnResult.success) {
        const errMsg = String(learnResult.error || '').toLowerCase()
        const recoverable = /provider|timeout|timed out|fetch failed|network|rate.?limit|503|502|budget|invalid json|does not contain valid json|retry/i.test(errMsg)
        if (!recoverable || lessonRecoveries >= AUTOPILOT_LESSON_RECOVERY_LIMIT) {
          await this.writeState(sessionId, {
            status: 'failed',
            completedAt: new Date().toISOString(),
            lastError: learnResult.error || `自动学习失败（恢复上限 ${lessonRecoveries}/${AUTOPILOT_LESSON_RECOVERY_LIMIT}）`
          })
          return
        }
        lessonRecoveries += 1
        logger.warn('[autopilot] 阶段级单课失败，restart-learning 续跑', { sessionId, lessonRecoveries, error: learnResult.error })
        await this.writeState(sessionId, { lessonRecoveries })
        try {
          await simulationCoordinator.runLeasedExclusive(sessionId, () =>
            simulationCoordinator.restartLearningPhase(sessionId)
          )
        } catch (error: unknown) {
          await this.writeState(sessionId, {
            status: 'failed',
            completedAt: new Date().toISOString(),
            lastError: `重启 Learn 失败：${asErrorLike(error).message || '未知'}`
          })
          return
        }
        await this.pause()
        continue
      }

      // 一课完成（或已收束）→ 阶段级目标达成
      await this.markStageReached(sessionId, 'teaching')
      return
    }
  }

  private async executeBlackboxStageLoop(sessionId: string, runId: string): Promise<void> {
    let stepIndex = 0
    let waitingSince: number | null = null
    let baselineTaskId: string | null = null

    // eslint-disable-next-line no-constant-condition`n    while (true) {
      if (await this.isStopRequested(sessionId)) {
        await this.markStopped(sessionId, 'stopRequested / 已暂停 / 手动停止')
        return
      }
      const obs = await this.readBlackboxObservation(sessionId)
      if (!obs) return

      if (TERMINAL_STATUSES.has(obs.status)) {
        await this.settleBlackboxTerminal(sessionId, runId, 'teaching')
        return
      }
      if (obs.runCompleted) {
        await this.settleBlackboxTerminal(sessionId, runId, 'teaching')
        return
      }

      const base = baselineTaskId ?? obs.taskId
      const stage = obs.stage
      await this.writeState(sessionId, { lastStage: stage, waitingSince: null })

      // ---- Teaching 阶段级：本课完成（taskId 推进）即停 ----
      if (stage === 'teaching') {
        baselineTaskId = base
        stepIndex += 1
        const result = await this.blackboxAdvance(sessionId, stepIndex)
        if (!result) {
          await this.writeState(sessionId, {
            status: 'failed',
            completedAt: new Date().toISOString(),
            lastError: `黑盒 step 连续失败（${AUTOPILOT_BLACKBOX_STEP_RETRIES} 次）`
          })
          return
        }
        const after = await this.readBlackboxObservation(sessionId)
        if (!after) return
        if (after.runCompleted || TERMINAL_STATUSES.has(after.status)) {
          await this.settleBlackboxTerminal(sessionId, runId, 'teaching')
          return
        }
        if (after.taskId !== null && after.taskId !== baselineTaskId) {
          await this.markStageReached(sessionId, 'teaching')
          return
        }
        await this.pause()
        continue
      }

      // ---- Path：等生成就绪或推进到可学习即停 ----
      if (stage === 'path') {
        const isWaiting = !obs.availableActions.includes('start_learning')
        if (isWaiting) {
          waitingSince = waitingSince ?? Date.now()
          if (Date.now() - waitingSince > AUTOPILOT_WAIT_OBSERVATION_LIMIT_MS) {
            await this.writeState(sessionId, {
              status: 'failed',
              completedAt: new Date().toISOString(),
              lastError: 'Path 生成等待超时（10 分钟无进展）'
            })
            return
          }
          await this.pause()
          continue
        }
        await this.markStageReached(sessionId, 'path')
        return
      }

      // ---- Goal 或其他阶段：推进到阶段边界变化即停 ----
      stepIndex += 1
      const result = await this.blackboxAdvance(sessionId, stepIndex)
      if (!result) {
        await this.writeState(sessionId, {
          status: 'failed',
          completedAt: new Date().toISOString(),
          lastError: `黑盒 step 连续失败（${AUTOPILOT_BLACKBOX_STEP_RETRIES} 次）`
        })
        return
      }
      const after = await this.readBlackboxObservation(sessionId)
      if (!after) return
      if (after.runCompleted || TERMINAL_STATUSES.has(after.status)) {
        await this.settleBlackboxTerminal(sessionId, runId, stage === 'goal' ? 'goal' : null)
        return
      }
      if (after.stage !== stage) {
        // goal → path 即阶段级达成
        await this.markStageReached(sessionId, stage)
        return
      }
      await this.pause()
    }
  }

  private async countStep(sessionId: string) {
    const session = await prisma.virtual_sessions.findUnique({ where: { id: sessionId } })
    if (!session) return
    const state = AutopilotService.readState(session)
    await this.writeState(sessionId, { steps: (state.steps || 0) + 1 }, state)
  }

  /** 到达最终目标的落点日志（供驾驶舱/审计可见） */
  private async notifyGoalReached(sessionId: string, mode: AutopilotMode) {
    logger.info('[autopilot] 目标达成（最终目标 = Path 全部完成）', { sessionId, mode })
  }
}

export const autopilotService = new AutopilotService()