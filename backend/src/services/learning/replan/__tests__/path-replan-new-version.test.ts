/**
 * replan new_version 分支契约（全量测试报告 #34）：
 * `mode:'new_version'` 是「宣言即抛错」的死契约——DB 无该模式数据、前端无入口，
 * 保留分支只为返回 409 PATH_VERSIONING_NOT_SUPPORTED（提示改用覆盖模式）。
 * 本测试固定该契约：服务层抛出的错误形状（status=409 + code）必须能被路由层的
 * isPathMutationConflictError 认出（路由据此回 409 而非 500）。
 */
const mockFindUnique = jest.fn()

jest.mock('../../../../config/database', () => ({
  __esModule: true,
  default: { learning_paths: { findUnique: mockFindUnique } },
}))
jest.mock('../../../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}))

import { requestPathReplan } from '../path-replan.service'
import { isPathMutationConflictError } from '../../path-mutation-safety'

describe('requestPathReplan：new_version 的 409 契约（报告 #34）', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockFindUnique.mockResolvedValue({ id: 'lp-1', userId: 'user-1', milestones: [] })
  })

  it('mode=new_version → 抛 409 PATH_VERSIONING_NOT_SUPPORTED，且可被路由冲突判别器识别', async () => {
    let caught: unknown = null
    await requestPathReplan({
      pathId: 'lp-1',
      userId: 'user-1',
      mode: 'new_version',
    } as never).catch((error) => { caught = error })

    expect(caught).toBeTruthy()
    expect(caught).toMatchObject({
      status: 409,
      code: 'PATH_VERSIONING_NOT_SUPPORTED',
      message: expect.stringContaining('覆盖当前路径'),
    })
    // 路由层 sendPathMutationConflict 的准入判据：认出 → res.status(409).json({..., code})
    expect(isPathMutationConflictError(caught)).toBe(true)
  })

  it('路径不存在 → 普通错误（404 口径），不落入冲突映射', async () => {
    mockFindUnique.mockResolvedValue(null)
    let caught: unknown = null
    await requestPathReplan({ pathId: 'lp-missing', userId: 'user-1', mode: 'new_version' } as never)
      .catch((error) => { caught = error })

    expect(String((caught as Error)?.message)).toContain('学习路径不存在')
    expect(isPathMutationConflictError(caught)).toBe(false)
  })
})
