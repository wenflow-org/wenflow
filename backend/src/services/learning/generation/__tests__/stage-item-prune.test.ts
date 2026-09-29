/**
 * 重试不留脏行：pruneSupersededStageItems 契约锁定。
 * 背景见函数注释——重复 stage item 行曾致 74 个「路径×阶段」组合出现互相矛盾的状态。
 */
import { pruneSupersededStageItems } from '../stage-enrichment';

function fakeClient(count: number | null = 3) {
  const deleteMany = jest.fn(async (_args: unknown) => (count === null ? {} : { count }));
  return { client: { path_generation_stage_items: { deleteMany } }, deleteMany };
}

describe('pruneSupersededStageItems', () => {
  it('replace 模式：按 路径 + 非本轮 run 清理，并回传删除行数', async () => {
    const { client, deleteMany } = fakeClient(7);
    const removed = await pruneSupersededStageItems(client, 'lp_1', 'run_new');
    expect(removed).toBe(7);
    expect(deleteMany).toHaveBeenCalledTimes(1);
    expect(deleteMany).toHaveBeenCalledWith({
      where: { run: { learningPathId: 'lp_1' }, runId: { not: 'run_new' } },
    });
  });

  it('append 模式：一行都不动（既有行是追加记录，不是被取代的尝试）', async () => {
    const { client, deleteMany } = fakeClient();
    const removed = await pruneSupersededStageItems(client, 'lp_1', 'run_new', { appendOnly: true });
    expect(removed).toBe(0);
    expect(deleteMany).not.toHaveBeenCalled();
  });

  it('count 缺失时回传 0（不因适配器形状差异抛错）', async () => {
    const { client } = fakeClient(null);
    await expect(pruneSupersededStageItems(client, 'lp_1', 'run_new')).resolves.toBe(0);
  });

  it('清理条件必须排除本轮 run（否则会删掉正在写的行）', async () => {
    const { client, deleteMany } = fakeClient(0);
    await pruneSupersededStageItems(client, 'lp_2', 'run_keep');
    type PruneArgs = { where: { run: { learningPathId: string }; runId: { not: string } } };
    const args = deleteMany.mock.calls[0][0] as PruneArgs;
    expect(args.where.runId.not).toBe('run_keep');
    expect(args.where.run.learningPathId).toBe('lp_2');
  });
});
