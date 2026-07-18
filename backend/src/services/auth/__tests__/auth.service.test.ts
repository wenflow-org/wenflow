export {}

const userMocks = {
  findFirst: jest.fn(),
  update: jest.fn()
}

const bcryptCompare = jest.fn()

jest.mock('../../../config/database', () => ({
  __esModule: true,
  default: {
    users: userMocks
  }
}))

jest.mock('bcrypt', () => ({
  __esModule: true,
  default: {
    compare: bcryptCompare,
    hash: jest.fn()
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
