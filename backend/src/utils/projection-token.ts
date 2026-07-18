import jwt from 'jsonwebtoken'
import { SESSION_TOKEN_ISSUER } from './session-token'

export type ProjectionScope = 'dashboard' | 'full'

export type ProjectionGrantSource = 'virtual-learner' | 'access-grant' | 'synthetic'

export const SYNTHETIC_CAPABILITIES = [
  'goal:read',
  'goal:write',
  'path:read',
  'teaching:write',
  'task:write',
] as const

export type SyntheticCapability = typeof SYNTHETIC_CAPABILITIES[number]

export type ProjectionTokenPayload = {
  targetUserId: string
  issuedByAdminId: string
  sourceProfileId?: string | null
  grantSource?: ProjectionGrantSource
  grantId?: string | null
  storyId?: string | null
  virtualSessionId?: string | null
  scopeDefinition?: string | null
  capabilities?: SyntheticCapability[]
  experimentId?: string | null
  runId?: string | null
  scope: ProjectionScope
  type: 'projection'
}

const getJwtSecret = (): string => {
  const secret = process.env.JWT_SECRET
  if (!secret) {
    throw new Error('JWT_SECRET 环境变量未设置')
  }
  return secret
}

const JWT_SECRET = getJwtSecret()
const PROJECTION_TOKEN_AUDIENCE = 'wenflow:projection'

export const signProjectionToken = (payload: ProjectionTokenPayload) => {
  return jwt.sign(payload, JWT_SECRET, {
    expiresIn: '30m',
    algorithm: 'HS256',
    issuer: SESSION_TOKEN_ISSUER,
    audience: PROJECTION_TOKEN_AUDIENCE
  })
}

export const verifyProjectionToken = (token: string): ProjectionTokenPayload => {
  let decoded: ProjectionTokenPayload
  try {
    decoded = jwt.verify(token, JWT_SECRET, {
      algorithms: ['HS256'],
      issuer: SESSION_TOKEN_ISSUER,
      audience: PROJECTION_TOKEN_AUDIENCE
    }) as ProjectionTokenPayload
  } catch (strictError) {
    decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] }) as ProjectionTokenPayload
    const claims = decoded as ProjectionTokenPayload & jwt.JwtPayload
    if (claims.iss !== undefined || claims.aud !== undefined) throw strictError
  }
  if (decoded.type !== 'projection' || !decoded.targetUserId || !decoded.issuedByAdminId) {
    throw new Error('无效的投影 token')
  }

  const grantSource = decoded.grantSource || 'virtual-learner'
  if (grantSource === 'virtual-learner' && !decoded.sourceProfileId) {
    throw new Error('无效的投影 token')
  }

  if (grantSource === 'access-grant' && !decoded.grantId) {
    throw new Error('无效的投影 token')
  }

  if (grantSource === 'synthetic') {
    const allowed = new Set<string>(SYNTHETIC_CAPABILITIES)
    if (!decoded.sourceProfileId || !decoded.experimentId || !decoded.runId) {
      throw new Error('无效的合成用户 token')
    }
    if (!Array.isArray(decoded.capabilities) || !decoded.capabilities.length || decoded.capabilities.some(item => !allowed.has(item))) {
      throw new Error('合成用户 token capability 无效')
    }
  }

  return decoded
}
