// 运维脚本测试：只测纯函数 parsePurgeArgs；mock prisma 避免实例化真实客户端
jest.mock('../../config/database', () => ({
  __esModule: true,
  default: { $disconnect: jest.fn() }
}))

import { parsePurgeArgs, purgeSoftDeletedUsers } from '../purge-soft-deleted-users';

describe('parsePurgeArgs（purge-soft-deleted-users）', () => {
  it('默认：全部软删用户、非 dry-run', () => {
    const args = parsePurgeArgs([]);
    expect(args).toEqual({ before: undefined, ids: [], dryRun: false });
  });

  it('--dry-run 置位', () => {
    expect(parsePurgeArgs(['--dry-run']).dryRun).toBe(true);
  });

  it('--before 解析为 Date', () => {
    const args = parsePurgeArgs(['--before=2026-01-01T00:00:00Z']);
    expect(args.before?.toISOString()).toBe('2026-01-01T00:00:00.000Z');
  });

  it('--ids 逗号分隔并去空白', () => {
    const args = parsePurgeArgs(['--ids=u1, u2 ,u3']);
    expect(args.ids).toEqual(['u1', 'u2', 'u3']);
  });

  it('--ids= 空值解析为空数组', () => {
    expect(parsePurgeArgs(['--ids=']).ids).toEqual([]);
  });

  it('非法 --before 抛错', () => {
    expect(() => parsePurgeArgs(['--before=not-a-date'])).toThrow('不是合法日期');
  });

  it('未知参数抛错', () => {
    expect(() => parsePurgeArgs(['--oops'])).toThrow('未知参数');
  });
});

describe('purgeSoftDeletedUsers（无 FK 表删除覆盖）', () => {
  const fkLessTables = [
    'memory_traces',
    'learner_evidence',
    'learner_projections',
    'virtual_quick_learn_runs',
    'goal_scheduling_ledger',
    'agent_call_logs',
    'prompt_call_logs',
    'llm_execution_attempts',
    'domain_event_outbox',
    'prediction_records',
    'misconception_ledger'
  ];

  interface MockTableModel {
    groupBy?: jest.Mock;
    deleteMany?: jest.Mock;
    findMany?: jest.Mock;
  }

  interface MockPurgeDatabase {
    users: { findMany: jest.Mock; deleteMany: jest.Mock };
    virtual_learner_profiles: { findMany: jest.Mock };
    [table: string]: MockTableModel;
  }

  function makeDatabase(): MockPurgeDatabase {
    const tableModels: Record<string, { groupBy: jest.Mock; deleteMany: jest.Mock }> = {};
    for (const table of fkLessTables) {
      tableModels[table] = {
        groupBy: jest.fn().mockResolvedValue([{ userId: 'u1', _count: { _all: 2 } }]),
        deleteMany: jest.fn().mockResolvedValue({ count: 2 })
      };
    }
    return {
      users: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'u1',
            email: 'u1@x.com',
            name: 'u1',
            deletedAt: new Date('2026-01-01T00:00:00Z'),
            deletedBy: null
          }
        ]),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 })
      },
      virtual_learner_profiles: { findMany: jest.fn().mockResolvedValue([]) },
      ...tableModels
    };
  }

  it('prediction_records 与 misconception_ledger 被显式按 userId 删除并计入报告', async () => {
    const database = makeDatabase();

    const result = await purgeSoftDeletedUsers({ ids: [], dryRun: false }, database);

    expect(database.prediction_records.groupBy).toHaveBeenCalledWith({
      by: ['userId'],
      where: { userId: { in: ['u1'] } },
      _count: { _all: true }
    });
    expect(database.misconception_ledger.groupBy).toHaveBeenCalledWith({
      by: ['userId'],
      where: { userId: { in: ['u1'] } },
      _count: { _all: true }
    });
    expect(database.prediction_records.deleteMany).toHaveBeenCalledWith({ where: { userId: { in: ['u1'] } } });
    expect(database.misconception_ledger.deleteMany).toHaveBeenCalledWith({ where: { userId: { in: ['u1'] } } });
    expect(result.tableTotals.prediction_records).toBe(2);
    expect(result.tableTotals.misconception_ledger).toBe(2);
    expect(database.users.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['u1'] }, deletedAt: { not: null } }
    });
  });

  it('dry-run 时仅统计不删除（含两张新表）', async () => {
    const database = makeDatabase();

    await purgeSoftDeletedUsers({ ids: [], dryRun: true }, database);

    expect(database.prediction_records.groupBy).toHaveBeenCalled();
    expect(database.misconception_ledger.groupBy).toHaveBeenCalled();
    expect(database.prediction_records.deleteMany).not.toHaveBeenCalled();
    expect(database.misconception_ledger.deleteMany).not.toHaveBeenCalled();
    expect(database.users.deleteMany).not.toHaveBeenCalled();
  });
});
