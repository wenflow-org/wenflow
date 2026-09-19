// 运维脚本测试：只测纯函数与可注入的入库逻辑；mock system-database 避免实例化真实客户端
jest.mock('../../config/system-database', () => ({
  __esModule: true,
  default: { $disconnect: jest.fn() },
}))

import {
  parseClearPromptModelArgs,
  isDeprecatedPromptModelRow,
  collectDeprecatedPromptModelRows,
  groupModelDistribution,
  isRetryableDbError,
  clearDeprecatedPromptModel,
  type PromptModelDatabase,
  type PromptModelRow,
} from '../clear-deprecated-prompt-model';

describe('parseClearPromptModelArgs（clear-deprecated-prompt-model）', () => {
  it('默认 dry-run（apply=false）', () => {
    expect(parseClearPromptModelArgs([])).toEqual({ apply: false });
  });

  it('--apply 置位', () => {
    expect(parseClearPromptModelArgs(['--apply']).apply).toBe(true);
  });

  it('--dry-run 可与 --apply 抵消', () => {
    expect(parseClearPromptModelArgs(['--apply', '--dry-run']).apply).toBe(false);
  });

  it('未知参数抛错', () => {
    expect(() => parseClearPromptModelArgs(['--oops'])).toThrow('未知参数');
  });
});

describe('collectDeprecatedPromptModelRows（清理判定口径）', () => {
  it('只选 ACTIVE 且 model 非空的行', () => {
    const rows: PromptModelRow[] = [
      { agentId: 'a', version: 1, status: 'ACTIVE', model: 'deepseek-v4-flash' },
      { agentId: 'b', version: 1, status: 'ACTIVE', model: null },
      { agentId: 'c', version: 1, status: 'ARCHIVED', model: 'deepseek-v4-flash' },
    ];
    expect(collectDeprecatedPromptModelRows(rows).map((row) => row.agentId)).toEqual(['a']);
  });

  it('空字符串 model 视为非空（与 SQL model IS NOT NULL 对齐）', () => {
    expect(isDeprecatedPromptModelRow({ status: 'ACTIVE', model: '' })).toBe(true);
  });

  it('按旧值分组计数', () => {
    const rows: PromptModelRow[] = [
      { agentId: 'a', version: 1, status: 'ACTIVE', model: 'deepseek-v4-flash' },
      { agentId: 'b', version: 1, status: 'ACTIVE', model: 'deepseek-v4-flash' },
      { agentId: 'c', version: 1, status: 'ACTIVE', model: 'deepseek-chat' },
    ];
    expect(groupModelDistribution(rows)).toEqual({ 'deepseek-v4-flash': 2, 'deepseek-chat': 1 });
  });
});

describe('isRetryableDbError', () => {
  it('识别 SQLite 瞬时错误', () => {
    expect(isRetryableDbError(new Error('disk I/O error'))).toBe(true);
    expect(isRetryableDbError(new Error('database is locked'))).toBe(true);
  });

  it('普通错误不重试', () => {
    expect(isRetryableDbError(new Error('UNIQUE constraint failed'))).toBe(false);
  });
});

function makeDatabase(options: { rows: PromptModelRow[] }): {
  database: PromptModelDatabase;
  updateMany: jest.Mock;
} {
  let rows = options.rows.map((row) => ({ ...row }));
  const updateMany = jest.fn(async () => {
    let count = 0;
    rows = rows.map((row) => {
      if (row.status === 'ACTIVE' && row.model !== null) {
        count += 1;
        return { ...row, model: null };
      }
      return row;
    });
    return { count };
  });
  const database: PromptModelDatabase = {
    agent_prompts: {
      findMany: jest.fn(async () => rows.map((row) => ({ ...row }))),
      count: jest.fn(async (args: unknown) => {
        const where = (args as { where?: { status?: string; NOT?: { model: null } } }).where ?? {};
        return rows.filter((row) => {
          if (where.status && row.status !== where.status) return false;
          if (where.NOT?.model === null && row.model === null) return false;
          return true;
        }).length;
      }),
      updateMany,
    },
    skill_model_configs: {
      count: jest.fn(async () => 18),
    },
  };
  return { database, updateMany };
}

describe('clearDeprecatedPromptModel（入库逻辑）', () => {
  const rows: PromptModelRow[] = [
    { agentId: 'a', version: 1, status: 'ACTIVE', model: 'deepseek-v4-flash' },
    { agentId: 'b', version: 2, status: 'ACTIVE', model: 'deepseek-v4-flash' },
    { agentId: 'c', version: 1, status: 'ARCHIVED', model: 'deepseek-v4-flash' },
  ];

  it('dry-run 只统计不写库', async () => {
    const { database, updateMany } = makeDatabase({ rows });

    const result = await clearDeprecatedPromptModel({ apply: false }, database);

    expect(updateMany).not.toHaveBeenCalled();
    expect(result.withModelBefore).toBe(2);
    expect(result.updated).toBe(0);
    expect(result.withModelAfter).toBe(2);
    expect(result.activeTotalAfter).toBe(2);
    expect(result.skillModelRowsAfter).toBe(18);
  });

  it('apply 清理后再次运行为 0 行（幂等）', async () => {
    const { database, updateMany } = makeDatabase({ rows });

    const first = await clearDeprecatedPromptModel({ apply: true }, database);
    expect(updateMany).toHaveBeenCalledWith({
      where: { status: 'ACTIVE', NOT: { model: null } },
      data: { model: null },
    });
    expect(first.updated).toBe(2);
    expect(first.withModelAfter).toBe(0);
    expect(first.activeTotalAfter).toBe(2);

    const second = await clearDeprecatedPromptModel({ apply: true }, database);
    expect(second.withModelBefore).toBe(0);
    expect(second.updated).toBe(0);
    // 归档行不受影响
    expect(second.activeTotalAfter).toBe(2);
  });
});
