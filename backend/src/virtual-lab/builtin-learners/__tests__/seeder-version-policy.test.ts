/**
 * 预制定义 → 实例的版本关系策略（#91 / P-67「升级语义收尾」）
 *
 * 判据表见 seeder.ts 文件头：instance<definition 升级覆盖；== 不写库（哈希漂移只告警）；
 * > 跳过不覆盖（定义回退不得静默降级实例）。本文件锁死这三条分支的行为，
 * 防止 `!==` 式的"任何差异都覆盖"回归。
 */
import prisma from '../../../config/database';
import {
  classifyPresetVersion,
  ensureBuiltinVirtualLearners,
  type EnsureBuiltinLearnersResult,
} from '../seeder';
import { loadBuiltinLearnerPresets } from '../loader';

type Row = {
  id: string;
  userId: string;
  presetKey: string;
  presetVersion: number | null;
  tags: string | null;
  profile: string | null;
};

/** update/create 的入参（只用到这些字段；其余字段透传不校验） */
type WriteArgs = { where?: { id: string }; data: { presetVersion?: number; [key: string]: unknown } };

function fakeClient(rows: Row[]) {
  const updates: WriteArgs[] = [];
  const creates: Array<Record<string, unknown>> = [];
  const client = {
    users: {
      findUnique: async () => ({ id: 'u-existing' }),
      create: async (args: Record<string, unknown>) => {
        creates.push(args);
        return { id: 'u-created' };
      },
    },
    virtual_learner_profiles: {
      findUnique: async ({ where }: { where: { presetKey: string } }) =>
        rows.find((row) => row.presetKey === where.presetKey) ?? null,
      update: async (args: WriteArgs) => {
        updates.push(args);
        return args;
      },
      create: async (args: Record<string, unknown>) => {
        creates.push(args);
        return args;
      },
    },
  } as unknown as typeof prisma;
  return { client, updates, creates };
}

const loaded = loadBuiltinLearnerPresets();
const target = loaded.presets[0];

/** 为全部定义铺实例行（默认同版、带预算、无哈希 → 'skipped'），再按 presetKey 打补丁 */
function baselineRows(patch: Partial<Row> & { presetKey: string }): Row[] {
  return loaded.presets.map((preset, index) => ({
    id: `profile-${index}`,
    userId: `user-${index}`,
    presetKey: preset.presetKey,
    presetVersion: preset.presetVersion,
    tags: null,
    // 带预算：否则同版行会走「预算回填」分支被记成 updated，混淆本文件的版本分支断言
    profile: JSON.stringify({ nameHint: preset.personaSeed.nameHint, simulationBudget: { ...(preset.budget ?? {}) } }),
    ...(preset.presetKey === patch.presetKey ? patch : {}),
  }));
}

describe('classifyPresetVersion（版本关系判据）', () => {
  it('实例版本缺失按 0 处理；小于定义=定义领先；相等=同版；大于定义=实例领先', () => {
    expect(classifyPresetVersion(null, 3)).toBe('definition-ahead');
    expect(classifyPresetVersion(undefined, 3)).toBe('definition-ahead');
    expect(classifyPresetVersion(2, 3)).toBe('definition-ahead');
    expect(classifyPresetVersion(3, 3)).toBe('same');
    expect(classifyPresetVersion(4, 3)).toBe('instance-ahead');
  });
});

describe('syncOnePreset 版本分支（经 ensureBuiltinVirtualLearners 端到端）', () => {
  it('实例落后 → 升级：update 覆盖定义字段，记入 updated', async () => {
    const { client, updates } = fakeClient(
      baselineRows({ presetKey: target.presetKey, presetVersion: target.presetVersion - 1 }),
    );
    const result: EnsureBuiltinLearnersResult = await ensureBuiltinVirtualLearners(client);

    expect(result.updated).toEqual([target.presetKey]);
    expect(result.versionAhead).toEqual([]);
    expect(updates).toHaveLength(1);
    expect(updates[0].data.presetVersion).toBe(target.presetVersion);
  });

  it('实例领先（定义回退）→ 跳过：不写库、记入 versionAhead、updated 为空', async () => {
    const { client, updates, creates } = fakeClient(
      baselineRows({
        presetKey: target.presetKey,
        presetVersion: target.presetVersion + 1,
        tags: JSON.stringify(['builtin', `hash:${target.contentHash}`]),
      }),
    );
    const result = await ensureBuiltinVirtualLearners(client);

    expect(result.versionAhead).toEqual([target.presetKey]);
    expect(result.updated).toEqual([]);
    expect(result.created).toEqual([]);
    expect(updates).toHaveLength(0);
    expect(creates).toHaveLength(0);
  });

  it('同版且内容哈希未变 → 不写库，记入 skipped', async () => {
    const { client, updates } = fakeClient(
      baselineRows({ presetKey: target.presetKey, presetVersion: target.presetVersion, tags: null }),
    );
    const result = await ensureBuiltinVirtualLearners(client);

    expect(result.skipped).toContain(target.presetKey);
    expect(result.updated).toEqual([]);
    expect(result.versionAhead).toEqual([]);
    expect(updates).toHaveLength(0);
  });

  it('同版但内容哈希漂移（改内容未升版本）→ 记入 drifted，不覆盖', async () => {
    const { client, updates } = fakeClient(
      baselineRows({
        presetKey: target.presetKey,
        presetVersion: target.presetVersion,
        tags: JSON.stringify(['builtin', 'hash:0000000000000000000000000000000000000000000000000000000000000000']),
      }),
    );
    const result = await ensureBuiltinVirtualLearners(client);

    expect(result.drifted).toEqual([target.presetKey]);
    expect(result.updated).toEqual([]);
    expect(updates).toHaveLength(0);
  });

  it('同版但实例缺预算 → 只回填预算，记入 updated（不动其他字段）', async () => {
    const { client, updates } = fakeClient(
      baselineRows({
        presetKey: target.presetKey,
        presetVersion: target.presetVersion,
        profile: JSON.stringify({ nameHint: target.personaSeed.nameHint }),
      }),
    );
    const result = await ensureBuiltinVirtualLearners(client);

    expect(result.updated).toEqual([target.presetKey]);
    expect(updates).toHaveLength(1);
    const profile = JSON.parse(String(updates[0].data.profile));
    expect(profile.simulationBudget).toBeDefined();
    expect(profile.nameHint).toBe(target.personaSeed.nameHint);
  });

  it('历史行 presetVersion=null → 按 0 走升级，补齐定义字段', async () => {
    const { client, updates } = fakeClient(
      baselineRows({ presetKey: target.presetKey, presetVersion: null }),
    );
    const result = await ensureBuiltinVirtualLearners(client);

    expect(result.updated).toEqual([target.presetKey]);
    expect(updates).toHaveLength(1);
    expect(updates[0].data.presetVersion).toBe(target.presetVersion);
  });

  it('升级时保留运行时产物：追加故事/记忆/已完成事项不被定义覆盖', async () => {
    const runtimeStory = { id: 'story_runtime_1', title: '运行时追加的故事' };
    const { client, updates } = fakeClient(
      baselineRows({
        presetKey: target.presetKey,
        presetVersion: target.presetVersion - 1,
        profile: JSON.stringify({
          knownConcepts: ['运行时已知概念'],
          struggleConcepts: ['运行时薄弱概念'],
          recentCompleted: ['task-runtime-1'],
          runtimePrefs: { pacing: 'fast' },
          storyPool: [runtimeStory],
          simulationBudget: { ...(target.budget ?? {}) },
        }),
      }),
    );
    await ensureBuiltinVirtualLearners(client);

    const merged = JSON.parse(String(updates[0].data.profile));
    expect(merged.recentCompleted).toEqual(['task-runtime-1']);
    expect(merged.runtimePrefs).toEqual({ pacing: 'fast' });
    expect(merged.storyPool.map((story: { id?: string }) => story.id)).toContain('story_runtime_1');
    expect(merged.knownConcepts).toEqual(expect.arrayContaining(['运行时已知概念']));
    expect(merged.struggleConcepts).toEqual(expect.arrayContaining(['运行时薄弱概念']));
  });
});
