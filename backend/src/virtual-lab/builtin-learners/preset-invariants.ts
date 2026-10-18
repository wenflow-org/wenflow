/**
 * 预制虚拟学习者不变量检查器（#91 / P-67「判据·不变量检查器」，只读、无副作用）
 *
 * 设计稿 `doc/VIRTUAL_LEARNER_PRESET_DESIGN.md §四` 的遗留项：定义（presets.yaml）与实例
 * （virtual_learner_profiles）之间缺一组可复核的判据。本模块只检查**结构自洽与定义→实例
 * 一致性**，不冻结任何期望结论（「不做答案键」）——因此没有任何学习结果/答案类断言。
 *
 * 三层判据：
 * - 单条定义 `checkPresetDefinition`：键/枚举/覆盖轴/人物与故事必填、概念矛盾、预算合法性、
 *   夹具路径安全与存在性、答案键字段禁入；
 * - 语料集合 `checkPresetSet`：重复键、空语料、覆盖统计；
 * - 定义↔实例 `checkPresetInstances`：孤儿实例、漏同步实例、版本超前/滞后、同版本哈希漂移、
 *   运行时产物（storyPool / knownConcepts）保留。
 *
 * 严重度：error=必须修（本判据破坏即数据/同步链出错）；warn=可疑需人看；info=运行时现状。
 */

import type { BuiltinLearnerPreset } from './loader';

export type InvariantSeverity = 'error' | 'warn' | 'info';

export interface InvariantFinding {
  code: string;
  severity: InvariantSeverity;
  /** null = 语料集合级问题（与具体 preset 无关） */
  presetKey: string | null;
  message: string;
}

/** 定义侧检查的注入项（保持纯函数：文件存在性由调用方决定） */
export interface DefinitionCheckOptions {
  /** 夹具文件是否存在于仓库内；不传则跳过存在性检查 */
  fixtureExists?: (relativeFile: string) => boolean;
}

export interface PresetInstanceLike {
  presetKey: string | null;
  presetVersion: number | null;
  tags: string | null;
  profile: string | null;
}

/** availableTime → 时间轴覆盖轴（v3 拍板的对齐关系） */
export const AVAILABLE_TIME_AXIS: Record<string, string> = {
  minimal: 'low_time',
  moderate: 'mid_time',
  abundant: 'abundant_time',
};

/** 答案键字段禁入（设计拍板「不做答案键」；字段名命中即判） */
const FORBIDDEN_ANSWER_KEYS = [/^(answerKey|goldenAnswer|rubric)$/i, /expected(Answer|Conclusion)s?$/i];

const PRESET_KEY_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const AXIS_PATTERN = /^[a-z0-9_]+$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function blank(value: unknown): boolean {
  return typeof value !== 'string' || !value.trim();
}

function findAnswerKeyPath(value: unknown, path: string[] = []): string | null {
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      const hit = findAnswerKeyPath(value[i], [...path, String(i)]);
      if (hit) return hit;
    }
    return null;
  }
  if (!isRecord(value)) return null;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_ANSWER_KEYS.some((pattern) => pattern.test(key))) {
      return [...path, key].join('.');
    }
    const hit = findAnswerKeyPath(child, [...path, key]);
    if (hit) return hit;
  }
  return null;
}

function finding(code: string, severity: InvariantSeverity, presetKey: string | null, message: string): InvariantFinding {
  return { code, severity, presetKey, message };
}

/** 单条定义的结构自洽检查 */
export function checkPresetDefinition(
  preset: BuiltinLearnerPreset,
  options: DefinitionCheckOptions = {},
): InvariantFinding[] {
  const findings: InvariantFinding[] = [];
  const key = preset.presetKey;

  if (!PRESET_KEY_PATTERN.test(key)) {
    findings.push(finding('D-key-format', 'error', key, 'presetKey 必须是 kebab-case（小写字母/数字/连字符）'));
  }
  if (preset.scope !== 'in_scope' && preset.scope !== 'out_of_scope') {
    findings.push(finding('D-scope-enum', 'error', key, `scope 非法：${preset.scope}`));
  }

  const axes = asStringArray(preset.coverageAxes);
  if (axes.length === 0) {
    findings.push(finding('D-coverage-empty', 'error', key, 'coverageAxes 为空：该条不覆盖任何评审轴'));
  }
  if (new Set(axes).size !== axes.length) {
    findings.push(finding('D-coverage-duplicate', 'error', key, 'coverageAxes 存在重复项'));
  }
  for (const axis of axes) {
    if (!AXIS_PATTERN.test(axis)) {
      findings.push(finding('D-coverage-slug', 'warn', key, `coverageAxes 项不是下划线 slug：${axis}`));
    }
  }
  // 元数据必须体现在覆盖轴里（否则按轴筛语料会漏）
  if (!axes.includes(preset.sourceType)) {
    findings.push(finding('D-metadata-axis-mismatch', 'warn', key, `sourceType=${preset.sourceType} 未出现在 coverageAxes`));
  }
  if (!axes.includes(preset.goalType)) {
    findings.push(finding('D-metadata-axis-mismatch', 'warn', key, `goalType=${preset.goalType} 未出现在 coverageAxes`));
  }

  const availableTime = String(preset.personaSeed?.availableTime || '').trim();
  const expectedTimeAxis = AVAILABLE_TIME_AXIS[availableTime];
  if (!expectedTimeAxis) {
    findings.push(finding('D-available-time-unknown', 'warn', key, `availableTime 不在 low/mid/abundant 映射内：${availableTime || '(空)'}`));
  } else if (!axes.includes(expectedTimeAxis)) {
    findings.push(finding(
      'D-time-axis-mismatch',
      'warn',
      key,
      `availableTime=${availableTime} 应覆盖 ${expectedTimeAxis}，实际缺该轴（v3 对齐关系）`,
    ));
  }

  const story = isRecord(preset.story) ? preset.story : null;
  const goalSeed = story && isRecord(story.goalSeed) ? story.goalSeed : null;
  if (!goalSeed) {
    findings.push(finding('D-story-goalSeed-missing', 'error', key, 'story.goalSeed 缺失'));
  } else if (String(goalSeed.goalType || '') !== preset.goalType) {
    findings.push(finding(
      'D-goaltype-mismatch',
      'warn',
      key,
      `顶层 goalType=${preset.goalType} 与 story.goalSeed.goalType=${String(goalSeed.goalType)} 不一致`,
    ));
  }
  if (story && !blank(story.id) && story.id !== `story_${key}`) {
    findings.push(finding('D-story-id-mismatch', 'info', key, `story.id=${String(story.id)} 与 story_${key} 不一致（presetStory 会保留显式 id）`));
  }
  if (!goalSeed || blank(goalSeed.surfaceGoal)) {
    findings.push(finding('D-story-surfaceGoal-missing', 'error', key, 'story.goalSeed.surfaceGoal 为空（实例 learningGoal 依赖）'));
  }

  const known = asStringArray(preset.personaSeed?.knownConcepts);
  const struggle = asStringArray(preset.personaSeed?.struggleConcepts);
  const overlap = known.filter((concept) => struggle.includes(concept));
  if (overlap.length) {
    findings.push(finding('D-concept-overlap', 'error', key, `knownConcepts 与 struggleConcepts 冲突：${overlap.join('、')}`));
  }
  for (const [field, list] of [['knownConcepts', known], ['struggleConcepts', struggle]] as const) {
    if (list.some((item) => !item.trim())) {
      findings.push(finding('D-concept-blank', 'warn', key, `${field} 含空白项`));
    }
  }
  for (const field of ['nameHint', 'learningStyle', 'motivationType', 'availableTime']) {
    if (blank(preset.personaSeed?.[field])) {
      findings.push(finding('D-persona-required', 'warn', key, `personaSeed.${field} 缺失或为空`));
    }
  }
  if (!isRecord(preset.personaSeed?.personalityTraits)) {
    findings.push(finding('D-persona-required', 'warn', key, 'personaSeed.personalityTraits 缺失（实例落库依赖）'));
  }

  if (!preset.budget) {
    findings.push(finding('D-budget-missing', 'warn', key, '无会话预算（自身与 defaultBudget 都缺）：跑批不可复现'));
  } else {
    for (const field of ['turnChunkPerLesson', 'maxRetriesPerStep', 'noProgressChunkLimit']) {
      const value = Number(preset.budget[field]);
      if (!Number.isFinite(value) || value <= 0) {
        findings.push(finding('D-budget-nonpositive', 'error', key, `budget.${field} 必须为正数（实际 ${String(preset.budget[field])}）`));
      }
    }
    const ceiling = preset.budget.costCeiling;
    if (ceiling !== null && ceiling !== undefined) {
      const value = Number(ceiling);
      if (!Number.isFinite(value) || value <= 0) {
        findings.push(finding('D-budget-nonpositive', 'error', key, `budget.costCeiling 必须为正数或 null（实际 ${String(ceiling)}）`));
      }
    }
  }

  for (const material of preset.fixtureMaterials ?? []) {
    const file = String(material.file || '').replace(/\\/g, '/');
    if (!file) continue;
    if (/^([a-zA-Z]:)?\//.test(file)) {
      findings.push(finding('D-fixture-path-absolute', 'error', key, `夹具必须是仓库内相对路径：${file}`));
      continue;
    }
    if (file.split('/').includes('..')) {
      findings.push(finding('D-fixture-traversal', 'error', key, `夹具路径不得含 ..：${file}`));
      continue;
    }
    if (options.fixtureExists && !options.fixtureExists(file)) {
      findings.push(finding('D-fixture-missing', 'error', key, `夹具文件不存在：${file}`));
    }
  }

  const answerKeyPath = findAnswerKeyPath(preset);
  if (answerKeyPath) {
    findings.push(finding('D-answer-key-field', 'error', key, `定义中出现答案键字段（设计禁止）：${answerKeyPath}`));
  }

  return findings;
}

/** 语料集合级检查（重复键/空语料） */
export function checkPresetSet(presets: BuiltinLearnerPreset[], options: DefinitionCheckOptions = {}): InvariantFinding[] {
  const findings: InvariantFinding[] = [];
  if (presets.length === 0) {
    findings.push(finding('S-empty-corpus', 'error', null, '语料为空：检查 presets.yaml 是否可读'));
    return findings;
  }
  const seen = new Set<string>();
  for (const preset of presets) {
    if (seen.has(preset.presetKey)) {
      findings.push(finding('S-duplicate-key', 'error', preset.presetKey, 'presetKey 重复'));
    }
    seen.add(preset.presetKey);
    findings.push(...checkPresetDefinition(preset, options));
  }
  return findings;
}

function parseTags(tags: string | null): string[] {
  if (!tags) return [];
  try {
    const parsed = JSON.parse(tags);
    return Array.isArray(parsed) ? parsed.map((value) => String(value)) : [];
  } catch {
    return [];
  }
}

function parseJsonRecord(value: string | null): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * 定义↔实例一致性。实例按 presetKey 对齐；`presets` 为当前文件定义，
 * `instances` 为 `virtual_learner_profiles` 中 source='builtin' 的行。
 */
export function checkPresetInstances(
  presets: BuiltinLearnerPreset[],
  instances: PresetInstanceLike[],
): InvariantFinding[] {
  const findings: InvariantFinding[] = [];
  const byKey = new Map<string, PresetInstanceLike>();
  for (const instance of instances) {
    const key = String(instance.presetKey || '');
    if (!key) {
      findings.push(finding('I-instance-key-missing', 'error', null, 'builtin 实例缺少 presetKey'));
      continue;
    }
    if (byKey.has(key)) {
      findings.push(finding('I-duplicate-instance', 'error', key, '同一 presetKey 存在多个实例'));
      continue;
    }
    byKey.set(key, instance);
  }

  const definitionKeys = new Set(presets.map((preset) => preset.presetKey));
  for (const key of byKey.keys()) {
    if (!definitionKeys.has(key)) {
      findings.push(finding(
        'I-orphan-instance',
        'info',
        key,
        '实例存在但定义已下线（按设计「删条目不自动删实例」保留，多为退役语料）',
      ));
    }
  }

  for (const preset of presets) {
    const instance = byKey.get(preset.presetKey);
    if (!instance) {
      // 2026-10-09 起启动不再自动同步（卡库选角，空白项目零 VL 起步），
      // 未实例化属预期状态；显式入口 runBuiltinVirtualLearnersSeed / 管理台一键加载。
      findings.push(finding(
        'I-missing-instance',
        'info',
        preset.presetKey,
        '定义未实例化（启动不自动同步：需显式 runBuiltinVirtualLearnersSeed 或管理台加载）',
      ));
      continue;
    }
    const version = Number(instance.presetVersion ?? 0);
    if (version > preset.presetVersion) {
      findings.push(finding(
        'I-version-ahead',
        'error',
        preset.presetKey,
        `实例版本 ${version} 高于定义 ${preset.presetVersion}（定义被回退？）`,
      ));
    } else if (version < preset.presetVersion) {
      findings.push(finding(
        'I-version-stale',
        'info',
        preset.presetKey,
        `实例版本 ${version} 落后定义 ${preset.presetVersion}（重启后同步刷新；运行时产物会保留）`,
      ));
    }

    const tags = parseTags(instance.tags);
    const instanceHash = tags.find((tag) => tag.startsWith('hash:'))?.slice('hash:'.length) || '';
    if (version === preset.presetVersion && instanceHash && instanceHash !== preset.contentHash) {
      findings.push(finding(
        'I-hash-drift',
        'warn',
        preset.presetKey,
        '同版本下实例内容哈希与定义不一致（改内容未升 presetVersion，实例仍是旧定义）',
      ));
    }

    const profile = parseJsonRecord(instance.profile);
    const storyId = String(preset.story?.id || `story_${preset.presetKey}`);
    const storyPool = Array.isArray(profile.storyPool) ? profile.storyPool : [];
    if (!storyPool.some((story) => String((story as { id?: unknown })?.id || '') === storyId)) {
      findings.push(finding('I-story-missing-in-pool', 'warn', preset.presetKey, `实例 storyPool 缺少定义故事 ${storyId}`));
    }
    if (version < preset.presetVersion) {
      const instanceKnown = asStringArray(profile.knownConcepts);
      const lost = asStringArray(preset.personaSeed?.knownConcepts).filter((concept) => !instanceKnown.includes(concept));
      if (lost.length) {
        findings.push(finding(
          'I-known-concepts-missing',
          'warn',
          preset.presetKey,
          `升级合并后实例缺定义概念（应取并集）：${lost.join('、')}`,
        ));
      }
    }
  }

  return findings;
}

export interface InvariantReport {
  findings: InvariantFinding[];
  counts: { error: number; warn: number; info: number };
  presetCount: number;
  coverage: {
    sourceTypes: Record<string, number>;
    goalTypes: Record<string, number>;
    axes: Record<string, number>;
    availableTime: Record<string, number>;
  };
}

/** 汇总报告（CLI/测试共用） */
export function buildInvariantReport(
  presets: BuiltinLearnerPreset[],
  findings: InvariantFinding[],
): InvariantReport {
  const counts = { error: 0, warn: 0, info: 0 };
  for (const item of findings) counts[item.severity] += 1;
  const tally = (values: string[]): Record<string, number> => {
    const out: Record<string, number> = {};
    for (const value of values) out[value] = (out[value] || 0) + 1;
    return out;
  };
  return {
    findings,
    counts,
    presetCount: presets.length,
    coverage: {
      sourceTypes: tally(presets.map((preset) => preset.sourceType)),
      goalTypes: tally(presets.map((preset) => preset.goalType)),
      axes: tally(presets.flatMap((preset) => asStringArray(preset.coverageAxes))),
      availableTime: tally(presets.map((preset) => String(preset.personaSeed?.availableTime || '(空)'))),
    },
  };
}
