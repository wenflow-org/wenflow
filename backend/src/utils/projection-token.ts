import jwt from 'jsonwebtoken'

export type ProjectionScope = 'dashboard' | 'full'

export type ProjectionGrantSource = 'virtual-learner' | 'access-grant'

export type ProjectionTokenPayload = {
  targetUserId: string
  issuedByAdminId: string
  sourceProfileId?: string | null
  grantSource?: ProjectionGrantSource
  grantId?: string | null
  storyId?: string | null
  virtualSessionId?: string | null
  scopeDefinition?: string | null
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

export const signProjectionToken = (payload: ProjectionTokenPayload) => {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '30m' })
}

export const verifyProjectionToken = (token: string): ProjectionTokenPayload => {
  const decoded = jwt.verify(token, JWT_SECRET) as ProjectionTokenPayload
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

  return decoded
}
