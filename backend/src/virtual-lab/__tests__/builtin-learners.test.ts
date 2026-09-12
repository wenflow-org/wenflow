import {
  loadBuiltinLearnerPresets,
  computePresetContentHash,
  type BuiltinLearnerPreset,
} from '../builtin-learners/loader';
import {
  buildCreateProfileData,
  buildMergedProfileData,
  buildTags,
  parseTags,
} from '../builtin-learners/profile-data';

describe('builtin-learners 预制虚拟学习者', () => {
  const loaded = loadBuiltinLearnerPresets();

  it('预制文件加载成功且无校验诊断', () => {
    expect(loaded.presets.length).toBe(14);
    expect(loaded.diagnostics).toEqual([]);
  });

  it('presetKey 唯一，且每条含 personaSeed.nameHint 与 story.visibleOpening', () => {
    const keys = loaded.presets.map((p) => p.presetKey);
    expect(new Set(keys).size).toBe(keys.length);
    for (const p of loaded.presets) {
      expect(typeof p.personaSeed.nameHint).toBe('string');
      expect(p.personaSeed.nameHint.length).toBeGreaterThan(0);
      expect(typeof p.story.visibleOpening).toBe('string');
      expect(p.story.visibleOpening.length).toBeGreaterThan(0);
    }
  });

  it('覆盖四类 sourceType 与五个 goalType', () => {
    const sourceTypes = new Set(loaded.presets.map((p) => p.sourceType));
    const goalTypes = new Set(loaded.presets.map((p) => p.goalType));
    expect(sourceTypes).toEqual(new Set(['work', 'life', 'study', 'self_management']));
    expect(goalTypes).toEqual(
      new Set(['problem_driven', 'foundation_building', 'project_based', 'exam_prep', 'interest_exploration'])
    );
  });

  it('内容哈希稳定，且随内容变化', () => {
    const base = loaded.presets[0];
    const recalc = computePresetContentHash(base);
    expect(recalc).toBe(base.contentHash);

    const mutated = computePresetContentHash({
      ...base,
      story: { ...base.story, visibleOpening: `${base.story.visibleOpening}（改）` },
    });
    expect(mutated).not.toBe(base.contentHash);
  });

  it('首次创建：profile 含 persona 字段与单条 storyPool', () => {
    const preset = loaded.presets[0];
    const data = buildCreateProfileData(preset);
    expect(data.nameHint).toBe(preset.personaSeed.nameHint);
    expect(Array.isArray(data.storyPool)).toBe(true);
    expect(data.storyPool).toHaveLength(1);
    expect(data.storyPool[0].visibleOpening).toBe(preset.story.visibleOpening);
  });

  it('版本升级：以定义覆盖 persona，但保留运行时记忆、追加故事与已完成事项', () => {
    const preset = loaded.presets[0];
    const existing = {
      // 运行时记忆（非定义）
      knownConcepts: ['运行时新增概念'],
      struggleConcepts: ['运行时卡点'],
      recentCompleted: [{ taskId: 't1', title: '已完成的任务' }],
      runtimePrefs: { frictionBudget: 'high' },
      selfAssessmentAccuracy: 'overconfident',
      // 运行时追加的故事（非本 preset）
      storyPool: [
        { id: `story_${preset.presetKey}`, title: '旧版预制故事' },
        { id: 'story_runtime_added', title: '运行时追加的故事' },
      ],
    };

    const merged = buildMergedProfileData(preset, existing);

    // 定义字段来自 preset
    expect(merged.nameHint).toBe(preset.personaSeed.nameHint);
    // 运行时记忆被保留（并集）
    expect(merged.knownConcepts).toContain('运行时新增概念');
    expect(merged.struggleConcepts).toContain('运行时卡点');
    expect(merged.recentCompleted).toEqual(existing.recentCompleted);
    expect(merged.runtimePrefs).toEqual({ frictionBudget: 'high' });
    expect(merged.selfAssessmentAccuracy).toBe('overconfident');
    // 预制故事被刷新，运行时追加的故事保留
    const poolIds = merged.storyPool.map((s: any) => s.id);
    expect(poolIds).toContain(`story_${preset.presetKey}`);
    expect(poolIds).toContain('story_runtime_added');
  });

  it('tags 记录来源/键/版本/哈希，可被 parseTags 还原', () => {
    const preset: BuiltinLearnerPreset = loaded.presets[0];
    const tags = parseTags(buildTags(preset));
    expect(tags).toContain('builtin');
    expect(tags).toContain(`preset:${preset.presetKey}`);
    expect(tags).toContain(`v${preset.presetVersion}`);
    expect(tags.some((t) => t.startsWith('hash:'))).toBe(true);
  });

  it('预制携带会话预算（可复现运行条件）', () => {
    for (const preset of loaded.presets) {
      expect(preset.budget).toBeTruthy();
      expect(preset.budget?.turnChunkPerLesson).toBeGreaterThan(0);
    }
    const data = buildCreateProfileData(loaded.presets[0]);
    expect(data.simulationBudget).toBeTruthy();
    expect(data.simulationBudget.turnChunkPerLesson).toBeGreaterThan(0);
  });
});
