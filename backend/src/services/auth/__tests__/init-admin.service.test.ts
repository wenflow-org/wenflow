jest.mock('bcryptjs', () => ({
  __esModule: true,
  default: { hash: jest.fn().mockResolvedValue('hashed-password') }
}))

import bcrypt from 'bcryptjs'
import { initializeAdmin } from '../init-admin.service'

function database(existing: any = null) {
  return {
    users: {
      findFirst: jest.fn()
        .mockResolvedValueOnce(existing?.isAdmin || existing?.role === 'admin' ? existing : null)
        .mockResolvedValueOnce(existing?.isAdmin || existing?.role === 'admin' ? null : existing),
      create: jest.fn().mockResolvedValue({ id: 'created' })
    }
  }
}

describe('initializeAdmin', () => {
  // bcrypt.hash 是模块级 mock，调用历史会跨用例累积 —— 不清会让「未被调用」类断言假红。
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('development 环境未配置密码时使用内置默认密码创建', async () => {
    const db = database()
    const result = await initializeAdmin(db, { NODE_ENV: 'development' })
    expect(bcrypt.hash).toHaveBeenCalledWith('ChangeMe_2026_Admin', 10)
    expect(db.users.create).toHaveBeenCalled()
    expect(result.status).toBe('created')
  })

  it('test 环境未配置密码时同样允许默认口令（本机测试）', async () => {
    const db = database()
    await expect(initializeAdmin(db, { NODE_ENV: 'test' })).resolves.toMatchObject({ status: 'created' })
  })

  it('生产环境未配置密码时安全跳过', async () => {
    const db = database()
    await expect(initializeAdmin(db, { NODE_ENV: 'production' })).resolves.toEqual({ status: 'skipped_not_configured' })
    expect(db.users.create).not.toHaveBeenCalled()
  })

  // 2026-10-17 收紧：白名单判定。此前 `NODE_ENV` 漏配 / 写作 prod / Production 都会回退公开默认口令；
  // 实测 9 种取值里 8 种泄漏，故逐值钉住「非 development/test 一律拒绝」。
  it.each([
    ['Production（大小写）', 'Production'],
    ['prod（常见简写）', 'prod'],
    ['staging', 'staging'],
    ['空字符串', ''],
    ['中文值', '生产'],
    ['未设置', undefined],
  ])('非本机环境 %s 未配置密码时安全跳过（不回退默认口令）', async (_label, nodeEnv) => {
    const db = database()
    const env = nodeEnv === undefined ? {} : { NODE_ENV: nodeEnv }
    await expect(initializeAdmin(db, env as NodeJS.ProcessEnv)).resolves.toEqual({ status: 'skipped_not_configured' })
    expect(bcrypt.hash).not.toHaveBeenCalled()
    expect(db.users.create).not.toHaveBeenCalled()
  })

  it('生产环境未配置密码时不因普通用户占用默认身份而阻止启动', async () => {
    const db = database({ id: 'user-1', role: 'user', isAdmin: false })
    await expect(initializeAdmin(db, { NODE_ENV: 'production' })).resolves.toEqual({ status: 'skipped_not_configured' })
    expect(db.users.findFirst).toHaveBeenCalledTimes(1)
  })

  it('已有真实管理员时返回 existing', async () => {
    const db = database({ id: 'admin-1', role: 'admin', isAdmin: true })
    await expect(initializeAdmin(db, {})).resolves.toEqual({ status: 'existing', adminId: 'admin-1' })
  })

  it('已有其他管理员时不受初始身份冲突影响', async () => {
    const db = database({ id: 'admin-2', role: 'admin', isAdmin: true })
    await expect(initializeAdmin(db, {
      INIT_ADMIN_NAME: 'occupied-name',
      INIT_ADMIN_EMAIL: 'occupied@example.com'
    })).resolves.toEqual({ status: 'existing', adminId: 'admin-2' })
    expect(db.users.findFirst).toHaveBeenCalledTimes(1)
  })

  it('普通用户占用初始身份时拒绝自动提升', async () => {
    const db = database({ id: 'user-1', role: 'user', isAdmin: false })
    await expect(initializeAdmin(db, { INIT_ADMIN_PASSWORD: 'StrongPassword123' }))
      .rejects.toThrow('普通用户占用')
    expect(db.users.create).not.toHaveBeenCalled()
  })

  it('创建管理员时使用哈希密码并返回结果', async () => {
    const db = database()
    const result = await initializeAdmin(db, {
      INIT_ADMIN_NAME: 'root-admin',
      INIT_ADMIN_EMAIL: 'root@example.com',
      INIT_ADMIN_PASSWORD: 'StrongPassword123'
    })

    expect(bcrypt.hash).toHaveBeenCalledWith('StrongPassword123', 10)
    expect(db.users.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        email: 'root@example.com',
        name: 'root-admin',
        password: 'hashed-password',
        role: 'admin',
        isAdmin: true
      })
    }))
    expect(result.status).toBe('created')
  })

  it('弱密码和数据库错误均传播给启动调用方', async () => {
    await expect(initializeAdmin(database(), { INIT_ADMIN_PASSWORD: 'admin123' }))
      .rejects.toThrow('INIT_ADMIN_PASSWORD')
    const db = database()
    db.users.findFirst.mockReset().mockRejectedValue(new Error('database unavailable'))
    await expect(initializeAdmin(db, {})).rejects.toThrow('database unavailable')
  })
})
