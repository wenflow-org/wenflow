import jwt from 'jsonwebtoken'

export type ProjectionScope = 'dashboard' | 'full'

export type ProjectionTokenPayload = {
  targetUserId: string
  sourceProfileId: string
  issuedByAdminId: string
  storyId?: string | null
  virtualSessionId?: string | null
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
  if (decoded.type !== 'projection' || !decoded.targetUserId || !decoded.sourceProfileId || !decoded.issuedByAdminId) {
    throw new Error('无效的投影 token')
  }
  return decoded
}
