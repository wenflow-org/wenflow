// 运维脚本测试：只测纯函数 parsePurgeArgs；mock prisma 避免实例化真实客户端
jest.mock('../../config/database', () => ({
  __esModule: true,
  default: { $disconnect: jest.fn() }
}))

import { parsePurgeArgs } from '../purge-soft-deleted-users';

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
