export {}

const userMocks = {
  findFirst: jest.fn(),
  findUnique: jest.fn(),
  update: jest.fn()
}

const bcryptCompare = jest.fn()
const bcryptHash = jest.fn()
const mockSessionTokenSign = jest.fn(() => 'user-token')
const mockSessionTokenVerify = jest.fn()

jest.mock('../../../config/database', () => ({
  __esModule: true,
  default: {
    users: userMocks
  }
}))

jest.mock('bcryptjs', () => ({
  __esModule: true,
  default: {
    compare: bcryptCompare,
    hash: bcryptHash
  }
}))

jest.mock('../../../utils/session-token', () => ({
  signSessionToken: mockSessionTokenSign,
  verifySessionToken: mockSessionTokenVerify
}))

jest.mock('jsonwebtoken', () => ({
  __esModule: true,
  default: {
    sign: jest.fn(() => 'user-token'),
    verify: jest.fn()
  }
}))

jest.mock('../../../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn()
  }
}))

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-at-least-32-characters'

const { default: authService, InvalidCredentialsError } = require('../auth.service')

describe('AuthService 登录安全边界', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('普通登录查询显式排除管理员账号', async () => {
    userMocks.findFirst.mockResolvedValue(null)
    bcryptCompare.mockResolvedValue(false)

    await expect(authService.login({ name: 'admin', password: 'secret-password' }))
      .rejects.toBeInstanceOf(InvalidCredentialsError)

    expect(userMocks.findFirst).toHaveBeenCalledWith({
      where: {
        OR: [{ name: 'admin' }, { email: 'admin' }],
        isAdmin: false,
        deletedAt: null
      }
    })
  })

  it('账号不存在时仍执行密码哈希比较', async () => {
    userMocks.findFirst.mockResolvedValue(null)
    bcryptCompare.mockResolvedValue(false)

    await expect(authService.login({ name: 'missing', password: 'secret-password' }))
      .rejects.toMatchObject({ status: 401, code: 'INVALID_CREDENTIALS' })

    expect(bcryptCompare).toHaveBeenCalledWith(
      'secret-password',
      expect.stringMatching(/^\$2b\$10\$/)
    )
    expect(userMocks.update).not.toHaveBeenCalled()
  })

  it('测试/审计账号（qa_audit_ 命名）拒绝登录用户侧，返回与凭据错误一致的 401', async () => {
    userMocks.findFirst.mockResolvedValue({
      id: 'qa-1',
      name: 'qa_audit_0821',
      email: 'qa_audit_0821@wenflow.local',
      password: 'test-hash'
    })
    bcryptCompare.mockResolvedValue(true)

    await expect(authService.login({ name: 'qa_audit_0821', password: 'right-password' }))
      .rejects.toBeInstanceOf(InvalidCredentialsError)

    // 仍执行同等成本比较（时序一致），但不写库、不签发令牌
    expect(bcryptCompare).toHaveBeenCalledWith('right-password', 'test-hash')
    expect(userMocks.update).not.toHaveBeenCalled()
  })

  it('测试/审计账号（@test.local 邮箱）拒绝登录用户侧', async () => {
    userMocks.findFirst.mockResolvedValue({
      id: 't-1',
      name: 'probe-user',
      email: 'audit_probe_01@test.local',
      password: 'test-hash'
    })
    bcryptCompare.mockResolvedValue(true)

    await expect(authService.login({ name: 'probe-user', password: 'right-password' }))
      .rejects.toBeInstanceOf(InvalidCredentialsError)
    expect(userMocks.update).not.toHaveBeenCalled()
  })

  it('真实用户登录不受影响（令牌正常签发）', async () => {
    userMocks.findFirst.mockResolvedValue({
      id: 'u-real',
      name: 'real-user',
      email: 'real@example.com',
      password: 'hash',
      tokenVersion: 2
    })
    bcryptCompare.mockResolvedValue(true)
    userMocks.update.mockResolvedValue({ id: 'u-real' })

    const result = await authService.login({ name: 'real-user', password: 'right-password' })

    expect(result.user.name).toBe('real-user')
    expect(userMocks.update).toHaveBeenCalled()
  })
})

describe('AuthService 软删除账号', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('登录查询排除软删账号（deletedAt: null）', async () => {
    userMocks.findFirst.mockResolvedValue(null)
    bcryptCompare.mockResolvedValue(false)

    await expect(authService.login({ name: 'ghost', password: 'secret-password' }))
      .rejects.toMatchObject({ status: 401, code: 'INVALID_CREDENTIALS' })

    expect(userMocks.findFirst).toHaveBeenCalledWith({
      where: {
        OR: [{ name: 'ghost' }, { email: 'ghost' }],
        isAdmin: false,
        deletedAt: null
      }
    })
  })

  it('verifyToken 对软删账号拒绝（查询过滤 deletedAt: null）', async () => {
    mockSessionTokenVerify.mockReturnValue({ userId: 'u1', name: 'u1' })
    userMocks.findFirst.mockResolvedValue(null)

    await expect(authService.verifyToken('any-token')).rejects.toThrow('无效的 Token')

    expect(userMocks.findFirst).toHaveBeenCalledWith({
      where: { id: 'u1', deletedAt: null }
    })
  })

  it('verifyToken 对测试/审计账号存量会话拒绝（用户侧不再展示测试账号）', async () => {
    mockSessionTokenVerify.mockReturnValue({ userId: 'qa-1', name: 'qa_audit_0821' })
    userMocks.findFirst.mockResolvedValue({
      id: 'qa-1',
      name: 'qa_audit_0821',
      email: 'qa_audit_0821@wenflow.local'
    })

    await expect(authService.verifyToken('stale-token')).rejects.toThrow('无效的 Token')
  })

  it('verifyToken 对真实用户正常放行', async () => {
    mockSessionTokenVerify.mockReturnValue({ userId: 'u-real', name: 'real-user' })
    userMocks.findFirst.mockResolvedValue({
      id: 'u-real',
      name: 'real-user',
      email: 'real@example.com'
    })

    const user = await authService.verifyToken('valid-token')
    expect(user.name).toBe('real-user')
  })
})

describe('AuthService 修改密码', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('当前密码错误时拒绝且不写库', async () => {
    userMocks.findFirst.mockResolvedValue({ id: 'u1', name: 'u1', password: 'old-hash' })
    bcryptCompare.mockResolvedValue(false)

    await expect(authService.changePassword('u1', 'wrong-old', 'NewPass123'))
      .rejects.toBeInstanceOf(InvalidCredentialsError)
    expect(userMocks.update).not.toHaveBeenCalled()
  })

  it('用户不存在时也执行比较后拒绝', async () => {
    userMocks.findFirst.mockResolvedValue(null)
    bcryptCompare.mockResolvedValue(false)

    await expect(authService.changePassword('ghost', 'any', 'NewPass123'))
      .rejects.toBeInstanceOf(InvalidCredentialsError)
    expect(bcryptCompare).toHaveBeenCalled()
    expect(userMocks.update).not.toHaveBeenCalled()
  })

  it('校验通过则写入新哈希、递增 tokenVersion 并刷新 updatedAt', async () => {
    userMocks.findFirst.mockResolvedValue({ id: 'u1', name: 'u1', password: 'old-hash' })
    bcryptCompare.mockResolvedValue(true)
    bcryptHash.mockResolvedValue('new-hash')

    await authService.changePassword('u1', 'correct-old', 'NewPass123')

    expect(bcryptHash).toHaveBeenCalledWith('NewPass123', 10)
    expect(userMocks.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: {
        password: 'new-hash',
        tokenVersion: { increment: 1 },
        updatedAt: expect.any(Date)
      }
    })
  })
})
