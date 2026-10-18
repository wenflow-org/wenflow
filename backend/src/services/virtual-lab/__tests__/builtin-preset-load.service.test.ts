/**
 * 平台预置总览映射（#91 / P-67）
 *
 * 锁 `getBuiltinPresetOverview` 的定义↔实例状态映射：未加载 / 定义领先=upgradable /
 * 实例领先=rolled-back / 同版哈希漂移=drifted / 同版一致=current，以及汇总计数。
 * 纯映射测试：DB 以注入 fake client 代替，定义语料用真实 presets.yaml。
 */
import prisma from '../../../config/database';
import { getBuiltinPresetOverview } from '../builtin-preset-load.service';
import { loadBuiltinLearnerPresets } from '../../../virtual-lab/builtin-learners/loader';

const loaded = loadBuiltinLearnerPresets();
const target = loaded.presets[0];
/** 与定义同版且哈希一致的 tags */
const matchingTags = JSON.stringify(['builtin', `preset:${target.presetKey}`, `hash:${target.contentHash}`]);

function clientWith(rows: Array<Record<string, unknown>>) {
  return {
    virtual_learner_profiles: {
      findMany: async () => rows,
    },
  } as unknown as typeof prisma;
}

function row(presetKey: string, presetVersion: number | null, tags: string | null) {
  return {
    id: `p-${presetKey}`,
    userId: `u-${presetKey}`,
    presetKey,
    presetVersion,
    tags,
    updatedAt: new Date('2026-10-19T00:00:00Z'),
  };
}

describe('getBuiltinPresetOverview', () => {
  it('空库：全部 not-loaded，summary.missing = 定义条数', async () => {
    const overview = await getBuiltinPresetOverview(clientWith([]), loaded);

    expect(overview.summary.definitions).toBe(loaded.presets.length);
    expect(overview.summary.loaded).toBe(0);
    expect(overview.summary.missing).toBe(loaded.presets.length);
    expect(overview.presets.every((p) => p.state === 'not-loaded' && p.instance === null)).toBe(true);
    expect(overview.fileVersion).toBe(loaded.version);
  });

  it('同版 + 哈希一致 → current；同版 + 哈希不符 → drifted；定义领先 → upgradable；实例领先 → rolled-back', async () => {
    const others = loaded.presets.slice(1);
    const rows = [
      // 0: 同版哈希一致
      row(target.presetKey, target.presetVersion, matchingTags),
      // 1: 同版哈希不符
      { ...row(others[0].presetKey, others[0].presetVersion, JSON.stringify(['builtin', 'hash:deadbeef'])), id: 'p-drift' },
      // 2: 定义领先（实例落后一版）
      { ...row(others[1].presetKey, others[1].presetVersion - 1, null), id: 'p-behind' },
      // 3: 实例领先（定义回退）
      { ...row(others[2].presetKey, others[2].presetVersion + 1, null), id: 'p-ahead' },
    ];
    const overview = await getBuiltinPresetOverview(clientWith(rows as never[]), loaded);
    const byKey = new Map(overview.presets.map((p) => [p.presetKey, p]));

    expect(byKey.get(target.presetKey)!.state).toBe('current');
    expect(byKey.get(others[0].presetKey)!.state).toBe('drifted');
    expect(byKey.get(others[0].presetKey)!.instance!.contentDrifted).toBe(true);
    expect(byKey.get(others[1].presetKey)!.state).toBe('upgradable');
    expect(byKey.get(others[1].presetKey)!.instance!.relation).toBe('definition-ahead');
    expect(byKey.get(others[2].presetKey)!.state).toBe('rolled-back');
    expect(byKey.get(others[2].presetKey)!.instance!.relation).toBe('instance-ahead');
    // 版本不同时不算「哈希漂移」（差异由 relation 表达）
    expect(byKey.get(others[1].presetKey)!.instance!.contentDrifted).toBe(false);

    expect(overview.summary).toEqual({
      definitions: loaded.presets.length,
      loaded: 4,
      missing: loaded.presets.length - 4,
      upgradable: 1,
      rolledBack: 1,
      drifted: 1,
    });
  });
});
