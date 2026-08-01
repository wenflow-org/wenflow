import { rejectProjectionAccess } from '../projection-access.middleware'

function createResponse() {
  const response: any = {
    statusCode: 200,
    body: undefined,
    status(code: number) {
      this.statusCode = code
      return this
    },
    json(payload: unknown) {
      this.body = payload
      return this
    }
  }
  return response
}

describe('rejectProjectionAccess', () => {
  const middleware = rejectProjectionAccess('仅允许用户本人访问')

  it.each(['access-grant', 'virtual-learner', 'synthetic'])(
    '拒绝 %s projection',
    (grantSource) => {
      const req: any = {
        user: {
          userId: 'target-user',
          email: 'target-user@projection.local',
          projection: {
            active: true,
            targetUserId: 'target-user',
            grantSource
          }
        }
      }
      const res = createResponse()
      const next = jest.fn()

      middleware(req, res, next)

      expect(res.statusCode).toBe(403)
      expect(res.body).toEqual({
        success: false,
        error: { message: '仅允许用户本人访问' }
      })
      expect(next).not.toHaveBeenCalled()
    }
  )

  it('允许普通 JWT 身份', () => {
    const req: any = {
      user: { userId: 'user-1', email: 'user@example.com', isAdmin: false }
    }
    const res = createResponse()
    const next = jest.fn()

    middleware(req, res, next)

    expect(next).toHaveBeenCalledTimes(1)
    expect(res.statusCode).toBe(200)
  })
})
