/**
 * 预制虚拟学习者：profile JSON 组装（纯函数，无 DB 依赖，便于测试）。
 *
 * 定义字段（personaSeed / story）来自 presets.yaml；
 * 运行时产物（记忆概念、追加故事、已完成事项、运行偏好）在版本升级时必须保留。
 */

import type { BuiltinLearnerPreset } from './loader';

export function presetStory(preset: BuiltinLearnerPreset): Record<string, any> {
  return { ...preset.story, id: preset.story.id || `story_${preset.presetKey}` };
}

export function buildTags(preset: BuiltinLearnerPreset): string {
  return JSON.stringify([
    'builtin',
    `preset:${preset.presetKey}`,
    `v${preset.presetVersion}`,
    `hash:${preset.contentHash}`,
    preset.sourceType,
    preset.goalType,
    preset.scope,
  ]);
}

export function parseTags(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map((v) => String(v)) : [];
  } catch {
    return [];
  }
}

export function jsonOrNull(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  return JSON.stringify(value);
}

export function unionStrings(a: unknown, b: unknown): string[] {
  const set = new Set<string>();
  for (const list of [a, b]) {
    if (Array.isArray(list)) {
      for (const item of list) {
        const text = typeof item === 'string' ? item.trim() : '';
        if (text) set.add(text);
      }
    }
  }
  return Array.from(set);
}

/** 首次创建：定义字段全量落库 */
export function buildCreateProfileData(preset: BuiltinLearnerPreset): Record<string, any> {
  return {
    ...preset.personaSeed,
    ...(preset.budget ? { simulationBudget: { ...preset.budget } } : {}),
    ...(preset.fixtureMaterials?.length ? { fixtureMaterials: preset.fixtureMaterials.map((item) => ({ ...item })) } : {}),
    storyPool: [presetStory(preset)],
  };
}

/** 版本升级：以定义覆盖 persona，同时保留运行时产物（记忆 / 追加故事 / 已完成事项） */
export function buildMergedProfileData(
  preset: BuiltinLearnerPreset,
  existing: Record<string, any>,
): Record<string, any> {
  const story = presetStory(preset);
  const existingPool = Array.isArray(existing.storyPool) ? existing.storyPool : [];
  const runtimeStories = existingPool.filter((s: any) => String(s?.id || '') !== String(story.id));

  return {
    ...preset.personaSeed,
    knownConcepts: unionStrings(preset.personaSeed.knownConcepts, existing.knownConcepts),
    struggleConcepts: unionStrings(preset.personaSeed.struggleConcepts, existing.struggleConcepts),
    recentCompleted: Array.isArray(existing.recentCompleted) ? existing.recentCompleted : [],
    ...(existing.runtimePrefs ? { runtimePrefs: existing.runtimePrefs } : {}),
    // 附件夹具属定义字段：随版本刷新；未声明则清掉（避免旧夹具残留误导跑批）
    fixtureMaterials: preset.fixtureMaterials?.length ? preset.fixtureMaterials.map((item) => ({ ...item })) : undefined,
    ...(existing.selfAssessmentAccuracy ? { selfAssessmentAccuracy: existing.selfAssessmentAccuracy } : {}),
    ...(preset.budget
      ? { simulationBudget: { ...(existing.simulationBudget && typeof existing.simulationBudget === 'object' ? existing.simulationBudget : {}), ...preset.budget } }
      : {}),
    storyPool: [story, ...runtimeStories],
  };
}
