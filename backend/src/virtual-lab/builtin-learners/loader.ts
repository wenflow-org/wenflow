/**
 * 预制虚拟学习者加载器（File-as-Truth）
 *
 * 真源：仓库根目录 virtual-learners/presets.yaml（与 prompts/ 同级，进 git，部署时随代码发布）。
 * 目标：把「固定人物 + 故事」读进内存，供启动同步（seeder）幂等写入 DB。
 *
 * 边界（与设计稿一致）：
 * - 一条 preset = 一个 personaSeed + 一个 story（+ 元数据/一致性说明），不含任何下游行为与期望结论。
 * - 坏条目跳过并告警，不阻断启动（与 prompt 文件加载器同风格）。
 * - 内容哈希用于「改了内容但没升 version」的漂移告警，不自动覆盖已存在实例。
 */

import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import yaml from 'js-yaml';
import { logger } from '../../utils/logger';

export interface BuiltinLearnerPreset {
  presetKey: string;
  presetVersion: number;
  sourceType: string;
  goalType: string;
  scope: string;
  coverageAxes: string[];
  /**
   * 该预制学习者自带的**附件夹具**（可选）：VL 跑批时在起 Goal 之前注入为「已上传资料」，
   * 用于覆盖「附件 → 路径 → 任务 → 课堂（materialRefs）」这条链。
   * 形状：`[{ file: 'text/xxx.pptx', note?: '...' }]`（file 为仓库内相对路径）。
   */
  fixtureMaterials: Array<{ file: string; note: string | null }>;
  personaSeed: Record<string, any>;
  story: Record<string, any>;
  consistencyNotes: string[];
  /** 会话预算（成本护栏/分片回合/重试），随定义同步进 profile.simulationBudget */
  budget: Record<string, any> | null;
  /** 定义内容哈希（不含 presetVersion），用于漂移检测 */
  contentHash: string;
}

export interface BuiltinLearnerPresetLoadResult {
  version: number;
  presets: BuiltinLearnerPreset[];
  diagnostics: Array<{ presetKey: string | null; code: string; message: string }>;
}

/** 真源文件路径；可通过 VIRTUAL_LEARNER_PRESETS_FILE 覆盖（测试/自定义部署用） */
export const BUILTIN_LEARNERS_FILE = process.env.VIRTUAL_LEARNER_PRESETS_FILE
  ? path.resolve(process.env.VIRTUAL_LEARNER_PRESETS_FILE)
  : path.resolve(__dirname, '../../../../virtual-learners/presets.yaml');

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.keys(value as Record<string, unknown>)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify((value as Record<string, unknown>)[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

/** 定义哈希：覆盖 persona/story/一致性说明/预算与元数据，不含 presetVersion（版本号本身不改变内容） */
export function computePresetContentHash(
  preset: Pick<BuiltinLearnerPreset, 'sourceType' | 'goalType' | 'scope' | 'coverageAxes' | 'fixtureMaterials' | 'personaSeed' | 'story' | 'consistencyNotes' | 'budget'>
): string {
  return createHash('sha256')
    .update(stableStringify({
      sourceType: preset.sourceType,
      goalType: preset.goalType,
      scope: preset.scope,
      coverageAxes: preset.coverageAxes,
      fixtureMaterials: preset.fixtureMaterials,
      personaSeed: preset.personaSeed,
      story: preset.story,
      consistencyNotes: preset.consistencyNotes,
      budget: preset.budget ?? null,
    }))
    .digest('hex');
}

function asNonBlankString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizePreset(
  raw: unknown,
  defaultBudget: Record<string, any> | null
): { preset?: BuiltinLearnerPreset; diagnostics: BuiltinLearnerPresetLoadResult['diagnostics'] } {
  const diagnostics: BuiltinLearnerPresetLoadResult['diagnostics'] = [];
  if (!isRecord(raw)) {
    diagnostics.push({ presetKey: null, code: 'not-an-object', message: 'preset 条目不是对象' });
    return { diagnostics };
  }

  const presetKey = asNonBlankString(raw.presetKey);
  if (!presetKey) {
    diagnostics.push({ presetKey: null, code: 'missing-presetKey', message: '缺少 presetKey' });
    return { diagnostics };
  }

  const presetVersion = Number(raw.presetVersion);
  if (!Number.isFinite(presetVersion) || presetVersion < 1) {
    diagnostics.push({ presetKey, code: 'invalid-presetVersion', message: 'presetVersion 必须是 >=1 的整数' });
    return { diagnostics };
  }

  if (!isRecord(raw.personaSeed) || !asNonBlankString(raw.personaSeed.nameHint)) {
    diagnostics.push({ presetKey, code: 'missing-personaSeed', message: '缺少 personaSeed.nameHint' });
    return { diagnostics };
  }
  if (!isRecord(raw.story) || !asNonBlankString(raw.story.title)) {
    diagnostics.push({ presetKey, code: 'missing-story', message: '缺少 story.title' });
    return { diagnostics };
  }
  if (!asNonBlankString(raw.story.visibleOpening)) {
    diagnostics.push({ presetKey, code: 'missing-visibleOpening', message: '缺少 story.visibleOpening（Goal 开场依赖）' });
    return { diagnostics };
  }

  const fixtureMaterials = (Array.isArray(raw.fixtureMaterials) ? raw.fixtureMaterials : [])
    .map((item: unknown) => {
      if (!isRecord(item)) return null;
      const file = asNonBlankString(item.file);
      if (!file) return null;
      return { file, note: asNonBlankString(item.note) || null };
    })
    .filter((item): item is { file: string; note: string | null } => !!item);

  const preset: BuiltinLearnerPreset = {
    presetKey,
    presetVersion: Math.round(presetVersion),
    sourceType: asNonBlankString(raw.sourceType) || 'work',
    goalType: asNonBlankString(raw.goalType) || 'problem_driven',
    scope: asNonBlankString(raw.scope) || 'in_scope',
    coverageAxes: Array.isArray(raw.coverageAxes) ? raw.coverageAxes.map((v: unknown) => String(v)) : [],
    fixtureMaterials,
    personaSeed: raw.personaSeed,
    story: raw.story,
    consistencyNotes: Array.isArray(raw.consistencyNotes) ? raw.consistencyNotes.map((v: unknown) => String(v)) : [],
    budget: isRecord(raw.budget) ? raw.budget : defaultBudget,
    contentHash: '',
  };
  preset.contentHash = computePresetContentHash(preset);
  return { preset, diagnostics };
}

/**
 * 读取并校验真源文件。文件缺失/解析失败返回空集合与诊断（不抛，避免阻断启动）。
 */
export function loadBuiltinLearnerPresets(): BuiltinLearnerPresetLoadResult {
  if (!fs.existsSync(BUILTIN_LEARNERS_FILE)) {
    return {
      version: 0,
      presets: [],
      diagnostics: [{ presetKey: null, code: 'file-not-found', message: `未找到预制文件：${BUILTIN_LEARNERS_FILE}` }],
    };
  }

  let doc: any;
  try {
    doc = yaml.load(fs.readFileSync(BUILTIN_LEARNERS_FILE, 'utf8'));
  } catch (error) {
    return {
      version: 0,
      presets: [],
      diagnostics: [{ presetKey: null, code: 'yaml-parse-error', message: error instanceof Error ? error.message : String(error) }],
    };
  }

  const diagnostics: BuiltinLearnerPresetLoadResult['diagnostics'] = [];
  const rawPresets = Array.isArray(doc?.presets) ? doc.presets : [];
  const presets: BuiltinLearnerPreset[] = [];
  const seen = new Set<string>();
  const defaultBudget = isRecord(doc?.defaultBudget) ? (doc.defaultBudget as Record<string, any>) : null;

  for (const raw of rawPresets) {
    const parsed = normalizePreset(raw, defaultBudget);
    diagnostics.push(...parsed.diagnostics);
    if (!parsed.preset) continue;
    if (seen.has(parsed.preset.presetKey)) {
      diagnostics.push({ presetKey: parsed.preset.presetKey, code: 'duplicate-presetKey', message: 'presetKey 重复，已跳过后者' });
      continue;
    }
    seen.add(parsed.preset.presetKey);
    presets.push(parsed.preset);
  }

  for (const d of diagnostics) {
    logger.warn('[builtin-learners] 预制条目校验告警', d);
  }

  return { version: Number(doc?.version) || 1, presets, diagnostics };
}
