const mockSystemPrisma: any = {
  platform_settings: {
    findUnique: jest.fn(),
    upsert: jest.fn()
  }
}
const readFile = jest.fn()

jest.mock('../../config/system-database', () => ({ __esModule: true, default: mockSystemPrisma }))
jest.mock('fs/promises', () => ({
  __esModule: true,
  default: { readFile },
  readFile
}))

import {
  getPlatformSettings,
  PlatformSettingsUnavailableError,
  updatePlatformSettings
} from '../platform-settings.service'

describe('platform settings service', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('优先从 System DB 读取注册开关', async () => {
    mockSystemPrisma.platform_settings.findUnique.mockResolvedValue({ value: 'false' })

    await expect(getPlatformSettings()).resolves.toEqual({ registrationEnabled: false })
    expect(readFile).not.toHaveBeenCalled()
  })

  it('首次读取时迁移旧 JSON 设置', async () => {
    mockSystemPrisma.platform_settings.findUnique.mockResolvedValue(null)
    readFile.mockResolvedValue(JSON.stringify({ registrationEnabled: true }))
    mockSystemPrisma.platform_settings.upsert.mockResolvedValue({})

    await expect(getPlatformSettings()).resolves.toEqual({ registrationEnabled: true })
    expect(mockSystemPrisma.platform_settings.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { key: 'registrationEnabled' },
      create: expect.objectContaining({ value: 'true' })
    }))
  })

  it('设置存储不可用时失败关闭，不默认开放注册', async () => {
    mockSystemPrisma.platform_settings.findUnique.mockRejectedValue(new Error('database unavailable'))

    await expect(getPlatformSettings()).rejects.toBeInstanceOf(PlatformSettingsUnavailableError)
  })

  it('更新注册开关写入 System DB', async () => {
    mockSystemPrisma.platform_settings.upsert.mockResolvedValue({})

    await expect(updatePlatformSettings({ registrationEnabled: false })).resolves.toEqual({ registrationEnabled: false })
    expect(mockSystemPrisma.platform_settings.upsert).toHaveBeenCalledWith(expect.objectContaining({
      update: { value: 'false' }
    }))
  })
})
