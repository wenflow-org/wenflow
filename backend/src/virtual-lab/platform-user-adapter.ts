import axios, { AxiosInstance } from 'axios'
import type {
  LearnerAction,
  LearnerObservation,
  PlatformInteractionResult,
} from './contracts'

export type PlatformUserCredential =
  | { kind: 'projection'; token: string }
  | { kind: 'bearer'; token: string }

export interface PlatformHttpTransport {
  request<T = any>(config: {
    method: 'GET' | 'POST'
    url: string
    data?: unknown
    headers: Record<string, string>
  }): Promise<{ data: T; headers?: Record<string, unknown> }>
}

export class PlatformAdapterError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly payload?: unknown
  ) {
    super(message)
    this.name = 'PlatformAdapterError'
  }
}

function createAxiosTransport(baseURL: string, timeoutMs: number): PlatformHttpTransport {
  const client: AxiosInstance = axios.create({ baseURL: baseURL.replace(/\/$/, ''), timeout: timeoutMs })
  return {
    async request<T>(config: any) {
      try {
        const response = await client.request<T>(config)
        return { data: response.data, headers: response.headers as any }
      } catch (error: any) {
        const payload = error?.response?.data
        const nested = payload?.error
        const message = typeof nested === 'string'
          ? nested
          : nested?.message || error?.message || '平台请求失败'
        throw new PlatformAdapterError(message, error?.response?.status, payload)
      }
    }
  }
}

function traceIdFrom(headers?: Record<string, unknown>) {
  const value = headers?.['x-trace-id'] || headers?.['X-Trace-Id']
  return typeof value === 'string' ? value : undefined
}

function unwrap<T = any>(response: any): T {
  return response?.data?.data ?? response?.data
}

export class PlatformUserAdapter {
  private readonly transport: PlatformHttpTransport

  constructor(private readonly options: {
    credentialProvider: () => Promise<PlatformUserCredential>
    baseURL?: string
    timeoutMs?: number
    transport?: PlatformHttpTransport
  }) {
    const baseURL = options.baseURL || process.env.PLATFORM_API_BASE_URL || `http://127.0.0.1:${process.env.PORT || 3001}/api`
    this.transport = options.transport || createAxiosTransport(baseURL, options.timeoutMs || 300000)
  }

  private async headers() {
    const credential = await this.options.credentialProvider()
    return {
      'Content-Type': 'application/json; charset=utf-8',
      'X-Source-Entry': 'simulation',
      'X-Caller-Agent': 'virtual-learner-lab',
      ...(credential.kind === 'projection'
        ? { 'X-Projection-Token': credential.token }
        : { Authorization: `Bearer ${credential.token}` })
    }
  }

  async startGoal(text: string): Promise<PlatformInteractionResult> {
    const response = await this.transport.request<any>({
      method: 'POST',
      url: '/goal-conversation/start',
      data: { input: { text }, contextMode: 'recent' },
      headers: await this.headers()
    })
    return this.goalResult(unwrap(response), text, traceIdFrom(response.headers))
  }

  async replyGoal(conversationId: string, action: Extract<LearnerAction, { type: 'chat' | 'confirm_proposal' }>): Promise<PlatformInteractionResult> {
    const response = await this.transport.request<any>({
      method: 'POST',
      url: `/goal-conversation/${encodeURIComponent(conversationId)}/reply`,
      data: {
        input: { text: action.text },
        contextMode: 'recent',
        confirmProposal: action.type === 'confirm_proposal'
      },
      headers: await this.headers()
    })
    return this.goalResult(unwrap(response), action.text, traceIdFrom(response.headers))
  }

  private goalResult(envelope: any, learnerText: string, traceId?: string): PlatformInteractionResult {
    const core = envelope?.control || envelope?.internal?.core || {}
    const platformText = String(envelope?.userVisible || '')
    const visibleChoices = Array.isArray(envelope?.renderHints?.quickReplies)
      ? envelope.renderHints.quickReplies
          .map((item: any) => typeof item === 'string' ? item : item?.text)
          .filter((item: any) => typeof item === 'string' && item.trim())
      : []
    const canConfirm = visibleChoices.some((item: string) => /确认|生成路径|可以|开始/.test(item))
    return {
      observation: {
        stage: core.isCompleted ? 'path' : 'goal',
        visibleMessages: [
          { role: 'learner', content: learnerText },
          ...(platformText ? [{ role: 'platform' as const, content: platformText }] : [])
        ],
        visibleChoices,
        availableActions: core.isCompleted ? [] : canConfirm ? ['chat', 'confirm_proposal'] : ['chat'],
        lastActionResult: { status: 'success', visibleMessage: platformText }
      },
      control: {
        conversationId: core.conversationId || undefined,
        learningPathId: core.learningPath?.id || undefined,
        platformStage: core.stage,
        goalCompleted: !!core.isCompleted,
        rawTraceId: traceId
      },
      diagnostic: {
        schemaVersion: envelope?.schemaVersion,
        renderHints: envelope?.renderHints || null
      }
    }
  }

  async getPath(pathId: string): Promise<PlatformInteractionResult> {
    const response = await this.transport.request<any>({
      method: 'GET',
      url: `/learning/paths/${encodeURIComponent(pathId)}`,
      headers: await this.headers()
    })
    const path = unwrap<any>(response)
    const milestones = Array.isArray(path?.milestones) ? path.milestones : []
    const tasks = milestones.flatMap((item: any) => item.subtasks || [])
    const activeTasks = milestones.find((item: any) => item.status === 'active')?.subtasks || tasks
    const firstTask = activeTasks.find((item: any) => item.status === 'todo')
      || activeTasks.find((item: any) => item.status === 'in_progress')
      || tasks.find((item: any) => item.status !== 'completed')
    const runCompleted = tasks.length > 0 && tasks.every((item: any) => item.status === 'completed')
    const ready = path?.canStartLearning === true && !!firstTask
    const failed = path?.status === 'failed'
    const observation: LearnerObservation = {
      stage: runCompleted ? 'completed' : failed ? 'error' : 'path',
      visibleMessages: [],
      visiblePath: {
        id: pathId,
        title: path?.title || path?.name || '学习路径',
        description: path?.description || path?.summary || null,
        status: path?.status || null,
        milestones: milestones.map((item: any) => ({ title: item.title, description: item.description || null }))
      },
      visibleTask: firstTask ? { id: firstTask.id, title: firstTask.title, description: firstTask.description || null } : undefined,
      availableActions: runCompleted
        ? []
        : ready
        ? ['start_learning']
        : [],
      lastActionResult: {
        status: failed ? 'error' : 'success',
        visibleMessage: runCompleted
          ? '学习路径中的任务已全部完成'
          : failed
            ? path?.learningBlockedReason || '学习路径生成失败'
          : path?.learningBlockedReason || (ready ? '学习路径已就绪' : '学习路径正在生成')
      }
    }
    return {
      observation,
      control: {
        learningPathId: pathId,
        taskId: firstTask?.id || null,
        teachingSessionId: null,
        platformStage: path?.status,
        runCompleted,
        terminalReason: runCompleted ? 'completed' : undefined,
        rawTraceId: traceIdFrom(response.headers)
      },
      diagnostic: { generationStatus: path?.generationStatus || null, canStartLearning: path?.canStartLearning === true }
    }
  }

  async startTeaching(taskId: string): Promise<PlatformInteractionResult> {
    const response = await this.transport.request<any>({
      method: 'POST',
      url: `/ai-teaching/tasks/${encodeURIComponent(taskId)}/session`,
      headers: await this.headers()
    })
    const result = unwrap<any>(response)
    const visibleText = result?.welcomeMessage || ''
    return {
      observation: {
        stage: 'learning',
        visibleMessages: visibleText ? [{ role: 'platform', content: visibleText }] : [],
        visibleTask: { id: taskId, title: result?.topic || result?.subject || '当前任务' },
        availableActions: ['chat', 'request_hint', 'request_example', 'submit_answer', 'submit_code', 'abandon'],
        lastActionResult: { status: 'success', visibleMessage: visibleText }
      },
      control: { teachingSessionId: result?.sessionId, taskId, platformStage: 'learning', rawTraceId: traceIdFrom(response.headers) }
    }
  }

  async sendTeachingMessage(sessionId: string, action: LearnerAction): Promise<PlatformInteractionResult> {
    const message = action.type === 'submit_code' ? action.code
      : action.type === 'submit_answer' ? action.answer
      : 'text' in action ? action.text
      : 'reason' in action ? action.reason
      : action.type
    const response = await this.transport.request<any>({
      method: 'POST',
      url: `/ai-teaching/sessions/${encodeURIComponent(sessionId)}/messages`,
      data: { message },
      headers: await this.headers()
    })
    const result = unwrap<any>(response)
    const platformText = result?.aiResponse || ''
    const shouldConfirmEnd = result?.shouldConfirmEnd === true
    return {
      observation: {
        stage: result?.autoEnded ? 'completed' : 'learning',
        visibleMessages: [
          { role: 'learner', content: message },
          ...(platformText ? [{ role: 'platform' as const, content: platformText }] : [])
        ],
        availableActions: result?.autoEnded
          ? []
          : [
              'chat',
              'request_hint',
              'request_example',
              'submit_answer',
              'submit_code',
              ...(shouldConfirmEnd ? ['confirm_complete' as const] : []),
              'abandon'
            ],
        lastActionResult: { status: 'success', visibleMessage: platformText }
      },
      control: { teachingSessionId: sessionId, platformStage: result?.autoEnded ? 'completed' : 'learning', rawTraceId: traceIdFrom(response.headers) },
      diagnostic: {
        // 旁路裁判可读取，绝不传入下一轮虚拟学习者 Observation。
        analysis: result?.analysis || null,
        state: result?.state || null,
        strategies: result?.strategies || [],
        completionCandidate: result?.isCompletion === true
      }
    }
  }

  async endTeaching(
    sessionId: string,
    terminalReason: 'completed' | 'abandoned' = 'completed',
    learnerReason?: string
  ): Promise<PlatformInteractionResult> {
    const response = await this.transport.request<any>({
      method: 'POST',
      url: `/ai-teaching/sessions/${encodeURIComponent(sessionId)}/end`,
      data: { reason: terminalReason === 'abandoned' ? 'learner-abandoned' : 'task-completed' },
      headers: await this.headers()
    })
    return {
      observation: {
        stage: 'completed',
        visibleMessages: learnerReason ? [{ role: 'learner', content: learnerReason }] : [],
        availableActions: [],
        lastActionResult: {
          status: 'success',
          visibleMessage: terminalReason === 'abandoned' ? '学习者已结束本次学习' : '本次学习已结束'
        }
      },
      control: { teachingSessionId: sessionId, platformStage: 'completed', terminalReason, rawTraceId: traceIdFrom(response.headers) },
      diagnostic: { endResult: unwrap(response) }
    }
  }

  async completeTask(taskId: string): Promise<PlatformInteractionResult> {
    const response = await this.transport.request<any>({
      method: 'POST',
      url: `/learning/tasks/${encodeURIComponent(taskId)}/complete`,
      data: {},
      headers: await this.headers()
    })
    return {
      observation: { stage: 'path', visibleMessages: [], availableActions: [], lastActionResult: { status: 'success', visibleMessage: '当前任务已完成' } },
      control: { taskId, platformStage: 'task-completed', taskCompleted: true, rawTraceId: traceIdFrom(response.headers) },
      diagnostic: { task: unwrap(response) }
    }
  }
}
