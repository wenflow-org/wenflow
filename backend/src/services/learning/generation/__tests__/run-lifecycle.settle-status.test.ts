/**
 * #238 收尾复位原语：stageDesign / replan 接管被抢占的 core 后，必须把陈旧的 'generating' 复位。
 *
 * 判例：regenerate（core run，status=generating）被 1.5s 后的 replan（stageDesign run）抢占，
 * 被抢占的 core 必撞 GENERATION_RUN_FENCED 不再写回 active —— 唯一能兜住的就是接管者的收尾。
 * 这里锁住两件事：① 复位只在 activeGenerationRunId 与 status 都对得上时发生；
 * ② 只从 'generating' 复位（archived/completed 等治理/结业态不被后台写翻）。
 */
jest.mock('../../../../config/database', () => ({ __esModule: true, default: {} }))
jest.mock('../../../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }
}))

import { restorePathStatusAfterRunSettled } from '../run-lifecycle'

describe('#238 收尾复位', () => {
  it('只对命中 (id, activeGenerationRunId, status=generating) 的行写回', async () => {
    const tx = { learning_paths: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) } }

    await restorePathStatusAfterRunSettled(tx, 'path-1', 'run-2', 'active')

    expect(tx.learning_paths.updateMany).toHaveBeenCalledWith({
      where: { id: 'path-1', activeGenerationRunId: 'run-2', status: 'generating' },
      data: { status: 'active', updatedAt: expect.any(Date) }
    })
  })

  it('失败收尾可写 failed（空壳场景）', async () => {
    const tx = { learning_paths: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) } }

    await restorePathStatusAfterRunSettled(tx, 'path-1', 'run-2', 'failed')

    expect(tx.learning_paths.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'failed', updatedAt: expect.any(Date) } })
    )
  })

  it('不吞异常：DB 失败向上抛（由调用方所在事务决定回滚）', async () => {
    const tx = { learning_paths: { updateMany: jest.fn().mockRejectedValue(new Error('boom')) } }

    await expect(restorePathStatusAfterRunSettled(tx, 'path-1', 'run-2', 'active')).rejects.toThrow('boom')
  })
})
