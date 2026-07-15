import { Request, Response, NextFunction } from 'express'
import type { SyntheticCapability } from '../utils/projection-token'
import prisma from '../config/database'

type RouteRule = {
  method: string
  pattern: RegExp
  capability: SyntheticCapability
}

const ROUTE_RULES: RouteRule[] = [
  { method: 'POST', pattern: /^\/api\/goal-conversation\/start\/?$/, capability: 'goal:write' },
  { method: 'POST', pattern: /^\/api\/goal-conversation\/[^/]+\/(reply|regenerate)\/?$/, capability: 'goal:write' },
  { method: 'GET', pattern: /^\/api\/goal-conversation\/[^/]+\/?$/, capability: 'goal:read' },
  { method: 'GET', pattern: /^\/api\/learning\/paths\/[^/]+\/?$/, capability: 'path:read' },
  { method: 'POST', pattern: /^\/api\/learning\/tasks\/[^/]+\/complete\/?$/, capability: 'task:write' },
  { method: 'POST', pattern: /^\/api\/ai-teaching\/tasks\/[^/]+\/session\/?$/, capability: 'teaching:write' },
  { method: 'POST', pattern: /^\/api\/ai-teaching\/sessions\/[^/]+\/(messages|end)\/?$/, capability: 'teaching:write' },
  { method: 'POST', pattern: /^\/api\/ai-teaching\/sessions\/[^/]+\/checkpoints\/[^/]+\/submit\/?$/, capability: 'teaching:write' },
]

export function getRequiredSyntheticCapability(method: string, originalUrl: string): SyntheticCapability | null {
  const path = originalUrl.split('?')[0]
  return ROUTE_RULES.find(rule => rule.method === method.toUpperCase() && rule.pattern.test(path))?.capability || null
}

function parseJson(value?: string | null) {
  try { return JSON.parse(value || '{}') || {} } catch { return {} }
}

function resourceId(path: string, pattern: RegExp) {
  return path.match(pattern)?.[1] || null
}

export async function enforceSyntheticProjectionAccess(req: Request, res: Response, next: NextFunction) {
  try {
    const projection = req.user?.projection
    if (projection?.grantSource !== 'synthetic') {
      next()
      return
    }

    const required = getRequiredSyntheticCapability(req.method, req.originalUrl)
    if (!required || !projection.capabilities?.includes(required)) {
      res.status(403).json({
        success: false,
        error: { message: required ? `合成用户缺少 capability: ${required}` : '合成用户不允许访问该接口' }
      })
      return
    }

    const virtualSessionId = projection.virtualSessionId
    if (!virtualSessionId) {
      res.status(403).json({ success: false, error: { message: '合成用户 token 未绑定实验会话' } })
      return
    }

    const session = await prisma.virtual_sessions.findUnique({ where: { id: virtualSessionId } })
    const state = parseJson(session?.stageResults)
    if (
      !session
      || session.userId !== projection.targetUserId
      || session.virtualProfileId !== projection.sourceProfileId
      || state.experiment?.mode !== 'blackbox-api'
      || state.experiment?.experimentId !== projection.experimentId
      || state.experiment?.runId !== projection.runId
    ) {
      res.status(403).json({ success: false, error: { message: '合成用户实验绑定已失效' } })
      return
    }

    const path = req.originalUrl.split('?')[0]
    const control = state.blackbox?.control || {}
    const parsedGoalId = resourceId(path, /^\/api\/goal-conversation\/([^/]+)/)
    const goalId = parsedGoalId === 'start' ? null : parsedGoalId
    const learningPathId = resourceId(path, /^\/api\/learning\/paths\/([^/]+)/)
    const taskId = resourceId(path, /^\/api\/(?:learning|ai-teaching)\/tasks\/([^/]+)/)
    const teachingSessionId = resourceId(path, /^\/api\/ai-teaching\/sessions\/([^/]+)/)
    const mismatched = (goalId && goalId !== control.conversationId)
      || (learningPathId && learningPathId !== control.learningPathId)
      || (taskId && taskId !== control.taskId)
      || (teachingSessionId && teachingSessionId !== control.teachingSessionId)

    if (mismatched) {
      res.status(403).json({ success: false, error: { message: '合成用户不能访问当前实验之外的资源' } })
      return
    }

    next()
  } catch (error) {
    next(error)
  }
}
