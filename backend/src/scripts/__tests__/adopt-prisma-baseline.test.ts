import { validateMigrationHistory } from '../adopt-prisma-baseline';

const expected = [
  { name: '20260717000000_main_baseline', checksum: 'baseline-checksum' },
  { name: '20260717010000_blackbox_command_journal', checksum: 'journal-checksum' }
];

const applied = (migration_name: string, checksum: string) => ({
  migration_name,
  checksum,
  finished_at: '2026-07-18T00:00:00.000Z',
  rolled_back_at: null
});

describe('validateMigrationHistory', () => {
  it('接受与仓库一致的完整 migration 历史', () => {
    expect(validateMigrationHistory('main', [
      applied(expected[0].name, expected[0].checksum),
      applied(expected[1].name, expected[1].checksum)
    ], expected)).toEqual({
      appliedMigrations: expected.map(migration => migration.name),
      missingMigrations: []
    });
  });

  it('无历史但结构已是当前版本时要求登记全部仓库 migration', () => {
    expect(validateMigrationHistory('main', [], expected)).toEqual({
      appliedMigrations: [],
      missingMigrations: expected.map(migration => migration.name)
    });
  });

  it('接受合法前缀并只返回后续待登记 migration', () => {
    expect(validateMigrationHistory('main', [
      applied(expected[0].name, expected[0].checksum)
    ], expected)).toEqual({
      appliedMigrations: [expected[0].name],
      missingMigrations: [expected[1].name]
    });
  });

  it('拒绝未知、乱序、失败或 checksum 漂移的 migration 历史', () => {
    expect(() => validateMigrationHistory('main', [
      applied('legacy_migration', 'legacy-checksum')
    ], expected)).toThrow('旧或分叉 migration 历史');

    expect(() => validateMigrationHistory('main', [
      applied(expected[1].name, expected[1].checksum)
    ], expected)).toThrow('旧或分叉 migration 历史');

    expect(() => validateMigrationHistory('main', [{
      ...applied(expected[0].name, expected[0].checksum),
      finished_at: null
    }], expected)).toThrow('失败或回滚 migration');

    expect(() => validateMigrationHistory('main', [
      applied(expected[0].name, 'changed-checksum')
    ], expected)).toThrow('checksum');
  });
});
