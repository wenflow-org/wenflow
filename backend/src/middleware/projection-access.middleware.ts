import { Request, Response, NextFunction } from 'express'
import { logger } from '../utils/logger'

type ProjectionAccessMode = 'read-only' | 'write-enabled'

type ProjectionScopeDefinition = {
  accessMode?: ProjectionAccessMode
  entryScope?: 'dashboard' | 'full'
  resources?: string[]
}

type ProjectionAccessPolicyOptions = {
  dashboardReadPaths?: string[]
  denyAccessGrant?: boolean
  denyMessage?: string
}

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

export const rejectProjectionAccess = (message = '投影视角不允许访问该接口') => {
  return (req: Request, res: Response, next: NextFunction) => {
    if (req.user?.projection?.active) {
      res.status(403).json({
        success: false,
        error: { message }
      })
      return
    }

    next()
  }
}

function parseScopeDefinition(raw?: string | null): ProjectionScopeDefinition {
  if (!raw) return { accessMode: 'read-only' }
  try {
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object') {
      return {
        accessMode: parsed.accessMode === 'write-enabled' ? 'write-enabled' : 'read-only',
        entryScope: parsed.entryScope === 'full' ? 'full' : 'dashboard',
        resources: Array.isArray(parsed.resources)
          ? parsed.resources.filter((item: unknown) => typeof item === 'string')
          : undefined,
      }
    }
  } catch {
    // 忽略，按只读默认处理
  }
  return { accessMode: 'read-only' }
}

function normalizePath(path: string) {
  if (!path) return '/'
  const trimmed = path.trim()
  if (!trimmed) return '/'
  return trimmed.endsWith('/') && trimmed !== '/' ? trimmed.slice(0, -1) : trimmed
}

function matchPath(pattern: string, actual: string) {
  const normalizedPattern = normalizePath(pattern)
  const normalizedActual = normalizePath(actual)

  if (normalizedPattern === normalizedActual) return true

  if (normalizedPattern.endsWith('/*')) {
    const prefix = normalizedPattern.slice(0, -2)
    return normalizedActual === prefix || normalizedActual.startsWith(`${prefix}/`)
  }

  const patternSegments = normalizedPattern.split('/').filter(Boolean)
  const actualSegments = normalizedActual.split('/').filter(Boolean)
  if (patternSegments.length !== actualSegments.length) return false

  return patternSegments.every((segment, index) => {
    if (segment === '*') return true
    if (segment.startsWith(':')) return actualSegments[index].length > 0
    return segment === actualSegments[index]
  })
}

function matchesAnyPath(patterns: string[], actual: string) {
  return patterns.some((pattern) => matchPath(pattern, actual))
}

export const projectionAccessPolicy = (options: ProjectionAccessPolicyOptions = {}) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const projection = req.user?.projection
    if (!projection?.active || projection.grantSource !== 'access-grant') {
      next()
      return
    }

    if (options.denyAccessGrant) {
      logger.warn('[projection-access] 访问授权视角被拒', { reason: 'access_grant_denied', method: req.method, path: req.path })
      res.status(403).json({
        success: false,
        error: {
          message: options.denyMessage || '当前开发视角许可不允许访问该能力'
        }
      })
      return
    }

    const scopeDefinition = parseScopeDefinition(projection.scopeDefinition)
    const accessMode = scopeDefinition.accessMode || 'read-only'
    const isReadMethod = READ_METHODS.has(req.method.toUpperCase())

    if (!isReadMethod && accessMode !== 'write-enabled') {
      logger.warn('[projection-access] 只读视角写请求被拒', { reason: 'read_only_write', method: req.method, path: req.path })
      res.status(403).json({
        success: false,
        error: {
          message: '当前开发视角许可为只读协助，不允许修改用户数据'
        }
      })
      return
    }

    if (projection.scope === 'dashboard') {
      const allowedPaths = options.dashboardReadPaths || []
      if (!isReadMethod || !matchesAnyPath(allowedPaths, req.path)) {
        // 2026-10-22（机械过滤审计 A 类）：dashboardReadPaths 漏配一条路径=该功能对投影视角静默 403，
        // 日志带上命中失败的 path 与名单规模，漏配第一次发生时即可见。
        logger.warn('[projection-access] 学习台视角路径白名单拒绝', {
          reason: 'dashboard_path_not_allowed',
          method: req.method,
          path: req.path,
          allowedPathCount: allowedPaths.length,
        })
        res.status(403).json({
          success: false,
          error: {
            message: '当前开发视角许可仅开放学习台视角，请让用户升级许可范围'
          }
        })
        return
      }
    }

    next()
  }
}
