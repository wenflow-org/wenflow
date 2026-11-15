import pathCoordinator from '../path.coordinator';
import prisma from '../../config/database';

jest.mock('../../config/database', () => ({
  __esModule: true,
  default: {
    $transaction: jest.fn(async (ops: any[]) => Promise.all(ops.map((op: any) => op))),
    learning_paths: { updateMany: jest.fn(async (args: any) => ({ count: 1 })) },
    path_generation_runs: { updateMany: jest.fn(async (args: any) => ({ count: 1 })) },
  },
}));

/**
 * 瞬态重试的围栏解除（修复批 35-①，u19 reeval29 快败实证）：首次瞬态失败把
 * path_generation_runs 行写成 failed 终态后，延迟重试在 normalize 处被自家围栏
 * 拦死（GENERATION_RUN_FENCED）——批 11-① 的重试对该失败族结构性失效。
 * resetFencedGenerationRun 在重试前复位行状态（processing + active 指针回挂）。
 */
describe('resetFencedGenerationRun（瞬态重试围栏解除）', () => {
  const coordinator = pathCoordinator as any;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('失败终态行复位：status→processing + 清错误字段 + active 指针回挂', async () => {
    await coordinator.resetFencedGenerationRun({
      existingPathId: 'lp_1',
      generationRunId: 'run_1',
      userId: 'u1',
    });

    const runsOp = (prisma.path_generation_runs.updateMany as jest.Mock).mock.calls[0][0];
    expect(runsOp.where).toEqual({ id: 'run_1', learningPathId: 'lp_1', status: { not: 'processing' } });
    expect(runsOp.data).toEqual(expect.objectContaining({ status: 'processing', finishedAt: null, errorCode: null, errorMessage: null }));
    const pathsOp = (prisma.learning_paths.updateMany as jest.Mock).mock.calls[0][0];
    expect(pathsOp.where).toEqual({ id: 'lp_1', activeGenerationRunId: null });
    expect(pathsOp.data).toEqual({ activeGenerationRunId: 'run_1' });
  });

  it('缺 pathId 或 runId → 直接返回不写库', async () => {
    await coordinator.resetFencedGenerationRun({ existingPathId: null, generationRunId: 'run_1' });
    await coordinator.resetFencedGenerationRun({ existingPathId: 'lp_1', generationRunId: undefined });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('复位失败（DB 错误）→ 不抛出（重试按原链路继续，不阻断）', async () => {
    (prisma.$transaction as jest.Mock).mockRejectedValueOnce(new Error('db busy'));
    await expect(coordinator.resetFencedGenerationRun({
      existingPathId: 'lp_1',
      generationRunId: 'run_1',
    })).resolves.toBeUndefined();
  });
});
