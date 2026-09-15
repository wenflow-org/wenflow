/**
 * 预制虚拟学习者启动同步（内置 preset → DB 实例）
 *
 * 语义（与设计稿一致）：
 * - 定义层 = virtual-learners/presets.yaml（进 git，不可变，改内容需升 presetVersion）。
 * - 实例层 = users + virtual_learner_profiles（可被使用/改写，承载故事与会话）。
 * - 幂等锚 = presetKey（唯一）；重复启动不重复建，只按 presetVersion 刷新「定义字段」，
 *   **保留运行时产物**（已加故事、knownConcepts/struggleConcepts 记忆、recentCompleted）。
 *
 * 安全：
 * - 绝不删除实例（virtual_sessions.virtualProfileId 为 onDelete: Cascade，删实例会连带删会话历史）。
 * - 整体 best-effort：单条失败记入 errors，不阻断启动。
 */

import { randomUUID } from 'crypto';
import bcrypt from 'bcryptjs';
import prisma from '../../config/database';
import { logger } from '../../utils/logger';
import {
  loadBuiltinLearnerPresets,
  BUILTIN_LEARNERS_FILE,
  type BuiltinLearnerPreset,
} from './loader';
import {
  presetStory,
  buildTags,
  parseTags,
  jsonOrNull,
  buildCreateProfileData,
  buildMergedProfileData,
} from './profile-data';

type PrismaLike = typeof prisma;

const BUILTIN_EMAIL_DOMAIN = 'preset.local';

export interface EnsureBuiltinLearnersResult {
  mode: 'synced';
  version: number;
  created: string[];
  updated: string[];
  skipped: string[];
  drifted: string[];
  errors: Array<{ presetKey: string; message: string }>;
}

async function findOrCreateBuiltinUser(client: PrismaLike, preset: BuiltinLearnerPreset): Promise<string> {
  const email = `builtin_${preset.presetKey}@${BUILTIN_EMAIL_DOMAIN}`;
  const existing = await client.users.findUnique({ where: { email }, select: { id: true } });
  if (existing) return existing.id;

  const user = await client.users.create({
    data: {
      id: randomUUID(),
      email,
      name: String(preset.personaSeed.nameHint || preset.presetKey),
      password: bcrypt.hashSync(randomUUID(), 10),
      role: 'user',
      currentLevel: 'beginner',
      isAdmin: false,
      isVirtualLearner: true,
      updatedAt: new Date(),
    },
    select: { id: true },
  });
  return user.id;
}

async function syncOnePreset(client: PrismaLike, preset: BuiltinLearnerPreset): Promise<'created' | 'updated' | 'skipped' | 'drifted'> {
  const story = presetStory(preset);
  const learningGoal = String(preset.story?.goalSeed?.surfaceGoal || '').trim();

  const existing = await client.virtual_learner_profiles.findUnique({
    where: { presetKey: preset.presetKey },
  });

  if (!existing) {
    const userId = await findOrCreateBuiltinUser(client, preset);
    const profileData = buildCreateProfileData(preset);
    await client.virtual_learner_profiles.create({
      data: {
        id: randomUUID(),
        userId,
        profile: JSON.stringify(profileData),
        learningGoal,
        knowledgeLevel: 'beginner',
        knownConcepts: jsonOrNull(preset.personaSeed.knownConcepts),
        struggleConcepts: jsonOrNull(preset.personaSeed.struggleConcepts),
        simulationTemperature: 0.8,
        personalityTraits: jsonOrNull(preset.personaSeed.personalityTraits),
        tags: buildTags(preset),
        notes: `预制虚拟学习者 · ${story.title}`,
        source: 'builtin',
        presetKey: preset.presetKey,
        presetVersion: preset.presetVersion,
      },
    });
    return 'created';
  }

  const existingTags = parseTags(existing.tags);
  const existingHash = existingTags.find((t) => t.startsWith('hash:'))?.slice('hash:'.length) || '';
  const versionChanged = (existing.presetVersion ?? 0) !== preset.presetVersion;
  const contentChanged = Boolean(existingHash) && existingHash !== preset.contentHash;

  const existingProfile = (() => {
    try {
      return JSON.parse(existing.profile || '{}');
    } catch {
      return {};
    }
  })() as Record<string, any>;

  if (!versionChanged) {
    // 内容变了但版本没升：告警漂移，不自动覆盖，避免悄悄改动已存在的实例
    if (contentChanged) {
      logger.warn('[builtin-learners] 预制内容已变更但 presetVersion 未递增，跳过刷新（请升版本）', {
        presetKey: preset.presetKey,
        presetVersion: preset.presetVersion,
      });
      return 'drifted';
    }
    // 预算回填：老实例（创建时尚无 budget）在版本未变时也补齐预算定义（纯追加，不动其他字段）
    if (preset.budget && !(existingProfile.simulationBudget && typeof existingProfile.simulationBudget === 'object')) {
      await client.virtual_learner_profiles.update({
        where: { id: existing.id },
        data: {
          profile: JSON.stringify({ ...existingProfile, simulationBudget: { ...preset.budget } }),
          updatedAt: new Date(),
        },
      });
      return 'updated';
    }
    return 'skipped';
  }

  const merged = buildMergedProfileData(preset, existingProfile);

  await client.virtual_learner_profiles.update({
    where: { id: existing.id },
    data: {
      profile: JSON.stringify(merged),
      learningGoal,
      knownConcepts: jsonOrNull(merged.knownConcepts),
      struggleConcepts: jsonOrNull(merged.struggleConcepts),
      personalityTraits: jsonOrNull(preset.personaSeed.personalityTraits),
      tags: buildTags(preset),
      notes: `预制虚拟学习者 · ${story.title}`,
      source: 'builtin',
      presetVersion: preset.presetVersion,
      updatedAt: new Date(),
    },
  });
  return 'updated';
}

/**
 * 启动时同步内置预制虚拟学习者。可注入 prisma（测试用），默认使用主库实例。
 */
export async function ensureBuiltinVirtualLearners(
  client: PrismaLike = prisma,
): Promise<EnsureBuiltinLearnersResult> {
  const loaded = loadBuiltinLearnerPresets();
  const result: EnsureBuiltinLearnersResult = {
    mode: 'synced',
    version: loaded.version,
    created: [],
    updated: [],
    skipped: [],
    drifted: [],
    errors: [],
  };

  if (loaded.presets.length === 0) {
    logger.warn('[builtin-learners] 无可同步的预制条目', {
      file: BUILTIN_LEARNERS_FILE,
      diagnostics: loaded.diagnostics.length,
    });
    return result;
  }

  for (const preset of loaded.presets) {
    try {
      const outcome = await syncOnePreset(client, preset);
      if (outcome === 'created') result.created.push(preset.presetKey);
      else if (outcome === 'updated') result.updated.push(preset.presetKey);
      else if (outcome === 'drifted') result.drifted.push(preset.presetKey);
      else result.skipped.push(preset.presetKey);
    } catch (error) {
      result.errors.push({
        presetKey: preset.presetKey,
        message: error instanceof Error ? error.message : String(error),
      });
      logger.warn('[builtin-learners] 预制同步失败，跳过', {
        presetKey: preset.presetKey,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  logger.info('[builtin-learners] 预制虚拟学习者同步完成', {
    version: result.version,
    created: result.created.length,
    updated: result.updated.length,
    skipped: result.skipped.length,
    drifted: result.drifted.length,
    errors: result.errors.length,
  });

  return result;
}

// 供测试覆盖：内部纯函数
export const __internal = {
  buildCreateProfileData,
  buildMergedProfileData,
  buildTags,
  parseTags,
};
