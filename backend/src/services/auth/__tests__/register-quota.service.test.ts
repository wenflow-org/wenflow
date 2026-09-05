/**
 * 注册治理（R6）：单 IP 每日注册数量上限服务单测。
 */

const mockCount = jest.fn()
const mockCreate = jest.fn()

jest.mock('../../../config/database', () => ({
  __esModule: true,
  default: {
    login_attempts: { count: mockCount, create: mockCreate }
  }
}))

import {
  RegisterQuotaService,
  IpRegisterQuotaExceededError,
  resolveIpDailyQuota,
  DEFAULT_IP_DAILY_QUOTA,
  REGISTER_QUOTA_WINDOW_MS
} from '../register-quota.service'

const service = new RegisterQuotaService()

describe('resolveIpDailyQuota', () => {
  it('默认关（0 = 不限制），未配置 env 不再隐式开启 5 个限制', () => {
    expect(DEFAULT_IP_DAILY_QUOTA).toBe(5)
    expect(resolveIpDailyQuota(undefined)).toBe(0)
    expect(resolveIpDailyQuota('')).toBe(0)
  })

  it('合法 1-100 生效，0/非法值视为关闭（不限制）', () => {
    expect(resolveIpDailyQuota('3')).toBe(3)
    expect(resolveIpDailyQuota('100')).toBe(100)
    expect(resolveIpDailyQuota('0')).toBe(0)
    expect(resolveIpDailyQuota('-1')).toBe(0)
    expect(resolveIpDailyQuota('101')).toBe(0)
    expect(resolveIpDailyQuota('abc')).toBe(0)
  })
})

describe('RegisterQuotaService', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('24h 窗口内按 IP 统计成功注册数', async () => {
    mockCount.mockResolvedValue(3)
    const now = new Date('2026-08-15T12:00:00Z')
    const used = await service.countRecentRegistrations('1.2.3.4', now)
    expect(used).toBe(3)
    expect(mockCount).toHaveBeenCalledWith({
      where: {
        scope: 'register',
        ip: '1.2.3.4',
        success: true,
        createdAt: { gte: new Date(now.getTime() - REGISTER_QUOTA_WINDOW_MS) }
      }
    })
  })

  it('未达配额时放行并返回剩余额度', async () => {
    mockCount.mockResolvedValue(2)
    await expect(service.assertWithinDailyQuota('1.2.3.4', 5)).resolves.toBe(3)
  })

  it('达到配额时抛 429 配额超限错误', async () => {
    mockCount.mockResolvedValue(5)
    await expect(service.assertWithinDailyQuota('1.2.3.4', 5)).rejects.toThrow(IpRegisterQuotaExceededError)
    await expect(service.assertWithinDailyQuota('1.2.3.4', 5)).rejects.toMatchObject({
      code: 'REGISTER_IP_QUOTA_EXCEEDED',
      status: 429
    })
  })

  it('配额为 0（后台关闭）时不查询 DB、直接放行', async () => {
    mockCount.mockResolvedValue(999)
    await expect(service.assertWithinDailyQuota('1.2.3.4', 0)).resolves.toBe(Number.POSITIVE_INFINITY)
    expect(mockCount).not.toHaveBeenCalled()
  })

  it('注册成功后落库配额记录（用户名截断 64 字符）', async () => {
    mockCreate.mockResolvedValue({ id: '1' })
    await service.recordSuccessfulRegistration('1.2.3.4', 'alice')
    expect(mockCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        scope: 'register',
        ip: '1.2.3.4',
        username: 'alice',
        success: true,
        reason: 'registration_ok'
      })
    })
  })

  it('配额记录写入失败不抛错（不阻断注册主流程）', async () => {
    mockCreate.mockRejectedValue(new Error('database is locked'))
    await expect(service.recordSuccessfulRegistration('1.2.3.4', 'alice')).resolves.toBeUndefined()
  })
})
