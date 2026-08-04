export {}

const userMocks = {
  findFirst: jest.fn(),
  findUnique: jest.fn(),
  update: jest.fn()
}

const bcryptCompare = jest.fn()
const bcryptHash = jest.fn()

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
        isAdmin: false
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
})

describe('AuthService 修改密码', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('当前密码错误时拒绝且不写库', async () => {
    userMocks.findUnique.mockResolvedValue({ id: 'u1', name: 'u1', password: 'old-hash' })
    bcryptCompare.mockResolvedValue(false)

    await expect(authService.changePassword('u1', 'wrong-old', 'NewPass123'))
      .rejects.toBeInstanceOf(InvalidCredentialsError)
    expect(userMocks.update).not.toHaveBeenCalled()
  })

  it('用户不存在时也执行比较后拒绝', async () => {
    userMocks.findUnique.mockResolvedValue(null)
    bcryptCompare.mockResolvedValue(false)

    await expect(authService.changePassword('ghost', 'any', 'NewPass123'))
      .rejects.toBeInstanceOf(InvalidCredentialsError)
    expect(bcryptCompare).toHaveBeenCalled()
    expect(userMocks.update).not.toHaveBeenCalled()
  })

  it('校验通过则写入新哈希并刷新 updatedAt', async () => {
    userMocks.findUnique.mockResolvedValue({ id: 'u1', name: 'u1', password: 'old-hash' })
    bcryptCompare.mockResolvedValue(true)
    bcryptHash.mockResolvedValue('new-hash')

    await authService.changePassword('u1', 'correct-old', 'NewPass123')

    expect(bcryptHash).toHaveBeenCalledWith('NewPass123', 10)
    expect(userMocks.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { password: 'new-hash', updatedAt: expect.any(Date) }
    })
  })
})
