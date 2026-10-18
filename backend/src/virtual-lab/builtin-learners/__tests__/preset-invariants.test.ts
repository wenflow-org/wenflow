/**
 * 预制虚拟学习者不变量检查器单测（#91 / P-67）。
 *
 * 两个层次：
 * - 合成 fixture 覆盖每条判据的正反例（避免用真实语料测规则细节）；
 * - 真实语料守门：`presets.yaml` 当前必须零 error（夹具文件也必须真实存在），
 *   以后新增条目破坏结构时这里先红，不必等跑批。
 */
import fs from 'node:fs';
import type { BuiltinLearnerPreset } from '../loader';
import { loadBuiltinLearnerPresets } from '../loader';
import {
  buildInvariantReport,
  checkPresetDefinition,
  checkPresetInstances,
  checkPresetSet,
  type PresetInstanceLike,
} from '../preset-invariants';

function makePreset(overrides: Partial<BuiltinLearnerPreset> = {}): BuiltinLearnerPreset {
  return {
    presetKey: 'test-preset',
    presetVersion: 1,
    sourceType: 'study',
    goalType: 'exam_prep',
    scope: 'in_scope',
    coverageAxes: ['study', 'exam_prep', 'mid_time'],
    fixtureMaterials: [],
    personaSeed: {
      nameHint: '测试学生',
      learningStyle: 'reading',
      motivationType: 'necessity',
      availableTime: 'moderate',
      personalityTraits: { verbosity: 'terse' },
      knownConcepts: ['集合'],
      struggleConcepts: ['证明'],
    },
    story: {
      id: 'story_test-preset',
      title: '测试故事',
      visibleOpening: '我想学会做题。',
      goalSeed: { goalType: 'exam_prep', surfaceGoal: '提高成绩' },
    },
    consistencyNotes: [],
    budget: { turnChunkPerLesson: 60, costCeiling: 1500, maxRetriesPerStep: 8, noProgressChunkLimit: 3 },
    contentHash: 'hash-1',
    ...overrides,
  };
}

function codes(preset: BuiltinLearnerPreset): string[] {
  return checkPresetDefinition(preset).map((item) => item.code);
}

describe('checkPresetDefinition', () => {
  it('合法定义零发现', () => {
    expect(checkPresetDefinition(makePreset())).toEqual([]);
  });

  it('键格式与 scope 枚举', () => {
    expect(codes(makePreset({ presetKey: 'Bad_Key' }))).toContain('D-key-format');
    expect(codes(makePreset({ scope: 'somewhere' }))).toContain('D-scope-enum');
  });

  it('覆盖轴：空/重复/非 slug/元数据未入轴', () => {
    expect(codes(makePreset({ coverageAxes: [] }))).toContain('D-coverage-empty');
    expect(codes(makePreset({ coverageAxes: ['study', 'study'] }))).toContain('D-coverage-duplicate');
    expect(codes(makePreset({ coverageAxes: ['study', 'exam_prep', 'Mid-Time'] }))).toContain('D-coverage-slug');
    const mismatched = checkPresetDefinition(makePreset({ coverageAxes: ['study', 'mid_time'] }));
    expect(mismatched.filter((item) => item.code === 'D-metadata-axis-mismatch')).toHaveLength(1);
    expect(mismatched.find((item) => item.code === 'D-metadata-axis-mismatch')!.message).toContain('goalType');
  });

  it('时间轴对齐（v3）：minimal→low_time / moderate→mid_time / abundant→abundant_time', () => {
    const base = { coverageAxes: ['study', 'exam_prep'] };
    const minimal = checkPresetDefinition(makePreset({
      ...base,
      personaSeed: { ...makePreset().personaSeed, availableTime: 'minimal' },
    }));
    expect(minimal.find((item) => item.code === 'D-time-axis-mismatch')!.message).toContain('low_time');
    expect(codes(makePreset({
      ...base,
      personaSeed: { ...makePreset().personaSeed, availableTime: 'whenever' },
    }))).toContain('D-available-time-unknown');
  });

  it('故事：goalType 不一致/缺 surfaceGoal/故事 id 漂移', () => {
    expect(codes(makePreset({ story: { ...makePreset().story, goalSeed: { goalType: 'mastery', surfaceGoal: 'x' } } })))
      .toContain('D-goaltype-mismatch');
    expect(codes(makePreset({ story: { ...makePreset().story, goalSeed: { goalType: 'exam_prep', surfaceGoal: ' ' } } })))
      .toContain('D-story-surfaceGoal-missing');
    expect(codes(makePreset({ story: { ...makePreset().story, id: 'story_other' } }))).toContain('D-story-id-mismatch');
  });

  it('概念矛盾与空白项', () => {
    expect(codes(makePreset({
      personaSeed: { ...makePreset().personaSeed, knownConcepts: ['集合'], struggleConcepts: ['集合'] },
    }))).toContain('D-concept-overlap');
    expect(codes(makePreset({
      personaSeed: { ...makePreset().personaSeed, knownConcepts: ['集合', '  '] },
    }))).toContain('D-concept-blank');
  });

  it('预算：缺失 warn；非正数 error；costCeiling=null 合法', () => {
    expect(codes(makePreset({ budget: null }))).toContain('D-budget-missing');
    expect(codes(makePreset({ budget: { turnChunkPerLesson: 0, maxRetriesPerStep: 8, noProgressChunkLimit: 3, costCeiling: 10 } })))
      .toContain('D-budget-nonpositive');
    expect(codes(makePreset({ budget: { turnChunkPerLesson: 10, maxRetriesPerStep: 1, noProgressChunkLimit: 1, costCeiling: null } })))
      .not.toContain('D-budget-nonpositive');
  });

  it('夹具：绝对路径/越界 error；文件缺失 warn（可选增强 + 可能被 .gitignore 排除）', () => {
    expect(codes(makePreset({ fixtureMaterials: [{ file: '/etc/passwd', note: null }] }))).toContain('D-fixture-path-absolute');
    expect(codes(makePreset({ fixtureMaterials: [{ file: 'text/../secret.pptx', note: null }] }))).toContain('D-fixture-traversal');
    const missing = checkPresetDefinition(
      makePreset({ fixtureMaterials: [{ file: 'text/nope.pptx', note: null }] }),
      { fixtureExists: () => false },
    );
    expect(missing.find((item) => item.code === 'D-fixture-missing')!.severity).toBe('warn');
    const exists = checkPresetDefinition(
      makePreset({ fixtureMaterials: [{ file: 'text/ok.pptx', note: null }] }),
      { fixtureExists: () => true },
    );
    expect(exists.map((item) => item.code)).not.toContain('D-fixture-missing');
  });

  it('答案键字段禁入（递归，设计拍板不做答案键）', () => {
    const preset = makePreset();
    (preset.story.goalSeed as Record<string, unknown>).rubric = ['得分点'];
    expect(codes(preset)).toContain('D-answer-key-field');
  });
});

describe('checkPresetSet', () => {
  it('空语料与重复键', () => {
    expect(checkPresetSet([]).map((item) => item.code)).toContain('S-empty-corpus');
    const dup = checkPresetSet([makePreset(), makePreset()]);
    expect(dup.map((item) => item.code)).toContain('S-duplicate-key');
  });
});

describe('checkPresetInstances', () => {
  const instance = (overrides: Partial<PresetInstanceLike> = {}): PresetInstanceLike => ({
    presetKey: 'test-preset',
    presetVersion: 1,
    tags: JSON.stringify(['builtin', 'hash:hash-1']),
    profile: JSON.stringify({ storyPool: [{ id: 'story_test-preset' }] }),
    ...overrides,
  });

  it('对齐的实例零发现', () => {
    expect(checkPresetInstances([makePreset()], [instance()])).toEqual([]);
  });

  it('漏同步实例 / 孤儿实例均为 info（启动不自动同步 + 退役实例按设计保留）', () => {
    const missing = checkPresetInstances([makePreset()], []);
    expect(missing.find((item) => item.code === 'I-missing-instance')!.severity).toBe('info');
    const orphan = checkPresetInstances([], [instance()]);
    expect(orphan.find((item) => item.code === 'I-orphan-instance')!.severity).toBe('info');
  });

  it('版本超前 error / 滞后 info / 同版本哈希漂移 warn', () => {
    expect(checkPresetInstances([makePreset()], [instance({ presetVersion: 2 })])
      .find((item) => item.code === 'I-version-ahead')!.severity).toBe('error');
    expect(checkPresetInstances([makePreset()], [instance({ presetVersion: 0 })])
      .find((item) => item.code === 'I-version-stale')!.severity).toBe('info');
    const drift = checkPresetInstances([makePreset()], [instance({
      tags: JSON.stringify(['builtin', 'hash:hash-old']),
    })]);
    expect(drift.map((item) => item.code)).toContain('I-hash-drift');
  });

  it('实例 storyPool 缺定义故事 / 升级后 knownConcepts 丢失', () => {
    const missingStory = checkPresetInstances([makePreset()], [instance({ profile: JSON.stringify({ storyPool: [] }) })]);
    expect(missingStory.map((item) => item.code)).toContain('I-story-missing-in-pool');
    const lost = checkPresetInstances([makePreset({ presetVersion: 3 })], [instance({
      presetVersion: 2,
      profile: JSON.stringify({ storyPool: [{ id: 'story_test-preset' }], knownConcepts: [] }),
    })]);
    expect(lost.map((item) => item.code)).toContain('I-known-concepts-missing');
  });
});

describe('真实语料守门（virtual-learners/presets.yaml）', () => {
  const loaded = loadBuiltinLearnerPresets();

  it('可加载且零 error（夹具缺失只 warn：text/ 被 gitignore，CI 工作副本没有该文件）', () => {
    expect(loaded.presets.length).toBeGreaterThan(0);
    expect(loaded.diagnostics).toEqual([]);
    const findings = checkPresetSet(loaded.presets, {
      fixtureExists: (file) => fs.existsSync(`../${file}`), // jest cwd=backend
    });
    const errors = findings.filter((item) => item.severity === 'error');
    expect(errors).toEqual([]);
    const fixtureWarnings = findings.filter((item) => item.code === 'D-fixture-missing');
    expect(fixtureWarnings.every((item) => item.severity === 'warn')).toBe(true);
  });

  it('无夹具的工作副本（CI）下仍零 error——夹具缺失不得让守门变红', () => {
    const findings = checkPresetSet(loaded.presets, { fixtureExists: () => false });
    expect(findings.filter((item) => item.severity === 'error')).toEqual([]);
    expect(findings.some((item) => item.code === 'D-fixture-missing')).toBe(true);
  });

  it('报告含覆盖统计（供人工复核语料分布）', () => {
    const report = buildInvariantReport(loaded.presets, []);
    expect(report.presetCount).toBe(loaded.presets.length);
    expect(report.coverage.sourceTypes).toBeTruthy();
    expect(report.coverage.goalTypes).toBeTruthy();
    expect(Object.keys(report.coverage.availableTime).length).toBeGreaterThan(0);
  });
});
