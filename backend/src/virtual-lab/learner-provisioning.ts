/**
 * 虚拟学习者创建/身份生成/故事生成的共享工厂
 *
 * 职责（从 batch-job / batch-experiment / routes 三处重复逻辑提取）：
 * 1. 创建 users + virtual_learner_profiles 骨架
 * 2. 兜底补全 personaSeed（scenario designer 必填字段）
 * 3. 调 persona designer 生成人设并写回 profile
 * 4. 调 scenario designer 生成故事并写回 storyPool
 *
 * 不含：
 * - builtin-learners/seeder（presetKey 幂等、特殊 email，保持独立）
 * - routes 的 draft-profile（返回结果不写库，由前端 PUT，不在此收敛）
 */
import { randomUUID as uuid } from 'node:crypto';
import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { prisma } from '../config/database';
import { executeSkill } from '../skills';
import { virtualLearnerPersonaDesignerDefinition } from '../skills/virtual-learner-persona-designer';
import { virtualLearnerScenarioDesignerDefinition } from '../skills/virtual-learner-scenario-designer';
import { logger } from '../utils/logger';

// -------------------------------------------------------
// 1. 创建学习者（users + profile）
// -------------------------------------------------------

export interface ProvisionInput {
  name: string;
  learningGoal?: string;
  knowledgeLevel?: string;
  profile?: Record<string, unknown>;
  knownConcepts?: string[];
  struggleConcepts?: string[];
  personalityTraits?: Record<string, unknown>;
  tags?: string[];
  notes?: string;
}

export interface ProvisionResult {
  userId: string;
  profileId: string;
  email: string;
}

export async function provisionVirtualProfile(input: ProvisionInput): Promise<ProvisionResult> {
  const email = `virtual_${uuid().substring(0, 8)}@test.local`;
  const hashedPassword = await bcrypt.hash(randomBytes(32).toString('hex'), 10);

  const user = await prisma.users.create({
    data: {
      id: uuid(),
      email,
      name: input.name,
      password: hashedPassword,
      role: 'user',
      currentLevel: input.knowledgeLevel || 'beginner',
      isAdmin: false,
      isVirtualLearner: true,
      updatedAt: new Date(),
    },
  });

  const profile = await prisma.virtual_learner_profiles.create({
    data: {
      id: uuid(),
      userId: user.id,
      profile: JSON.stringify(input.profile || {}),
      learningGoal: input.learningGoal || '',
      knowledgeLevel: input.knowledgeLevel || 'beginner',
      knownConcepts: input.knownConcepts ? JSON.stringify(input.knownConcepts) : null,
      struggleConcepts: input.struggleConcepts ? JSON.stringify(input.struggleConcepts) : null,
      simulationTemperature: 0.8,
      personalityTraits: input.personalityTraits ? JSON.stringify(input.personalityTraits) : null,
      tags: input.tags ? JSON.stringify(input.tags) : null,
      notes: input.notes || null,
    },
  });

  logger.info('[learner-provisioning] profile created', {
    userId: user.id,
    email,
    name: input.name,
  });

  return { userId: user.id, profileId: profile.id, email };
}

// -------------------------------------------------------
// 2. Persona seed 兜底补全（scenario designer 必填字段）
// -------------------------------------------------------
// 从 routes L1064-1073 / batch-job L320-329 提取，消除重复

export function ensurePersonaFallbacks(
  profileData: Record<string, unknown>,
  learningGoal?: string,
): Record<string, unknown> {
  const seed = { ...profileData };

  if (!String(seed.education || '').trim()) seed.education = learningGoal ? '在职学习' : '自学';
  if (!['reading', 'watching', 'doing', 'listening'].includes(String(seed.learningStyle || ''))) seed.learningStyle = 'doing';
  if (!Number.isFinite(Number(seed.age))) seed.age = 28;
  if (!Array.isArray(seed.knownConcepts) || !seed.knownConcepts.length) seed.knownConcepts = ['基础概念'];
  if (!Array.isArray(seed.struggleConcepts) || !seed.struggleConcepts.length) seed.struggleConcepts = ['方法不清晰'];
  if (!Array.isArray(seed.emotionalTriggers) || !seed.emotionalTriggers.length) seed.emotionalTriggers = ['遇到挫折'];
  if (!Array.isArray(seed.failurePatterns) || !seed.failurePatterns.length) seed.failurePatterns = ['半途而废'];
  if (!['internal', 'external', 'both', 'none'].includes(String(seed.motivationType || ''))) seed.motivationType = 'internal';
  if (!['minimal', 'moderate', 'abundant'].includes(String(seed.availableTime || ''))) seed.availableTime = 'moderate';

  return seed;
}

// -------------------------------------------------------
// 3. 生成人设（persona designer）并写回 profile
// -------------------------------------------------------

export interface GeneratePersonaOptions {
  /** preferredLevels 透传（通常 null，seeder 传 profile.knowledgeLevel） */
  preferredLevels?: string[];
  /** 保留式调用：已有人设则跳过（batch-job 的 generatePersonaAndUpdate） */
  skipIfPresent?: boolean;
  /** 学生样本提示（batch-experiment / routes 的 student mode） */
  studentHints?: string[];
  /** batch 语义：要求 nameHint/background 完整，否则抛出（让调用方重试） */
  requireComplete?: boolean;
  /** 覆盖 existingPersonaSeed 的 nameHint（batch-job 传 name，此时 profile JSON 里可能没有） */
  existingNameHint?: string;
  /** 覆盖 existingPersonaSeed 的 background/notes（batch-job 传 cohort） */
  existingBackground?: string;
}

export async function generateAndApplyPersona(
  profileId: string,
  opts: GeneratePersonaOptions = {},
): Promise<void> {
  const profile = await prisma.virtual_learner_profiles.findUnique({ where: { id: profileId } });
  if (!profile) throw new Error('学习者不存在');

  const profileData = JSON.parse(profile.profile || '{}') as Record<string, unknown>;
  if (opts.skipIfPresent && String(profileData.nameHint || '').trim() && String(profileData.background || '').trim()) {
    return; // 已有完整人设
  }

  // 合并：DB profile + 调用方覆盖（batch-job 传 nameHint/cohort）
  const existingPersonaSeed = {
    ...profileData,
    ...(opts.existingNameHint ? { nameHint: opts.existingNameHint, name: opts.existingNameHint } : {}),
    ...(opts.existingBackground ? { background: opts.existingBackground, notes: opts.existingBackground } : {}),
  };

  const result = await executeSkill(virtualLearnerPersonaDesignerDefinition, {
    preferredLevels: opts.preferredLevels || (profile.knowledgeLevel ? [profile.knowledgeLevel] : undefined),
    existingPersonaSeed,
    ...(opts.studentHints?.length ? { recentScenarioHints: opts.studentHints } : {}),
  });

  const personaSeed = result?.personaSeed || result?.profile || result;
  if (!personaSeed || typeof personaSeed !== 'object' || !String(personaSeed.nameHint || '').trim()) {
    if (opts.requireComplete) {
      throw new Error('personaSeed 缺 nameHint/background，重试');
    }
    logger.warn('[learner-provisioning] persona generation failed or missing fields', { profileId });
    return; // 不阻断（batch-experiment 语义）
  }

  // nameHint 变了 → 同步 users.name
  const userName = await prisma.users.findUnique({ where: { id: profile.userId }, select: { name: true } });
  const nameFromSeed = String(personaSeed.name || personaSeed.nameHint || '').trim();
  if (nameFromSeed && userName && nameFromSeed !== userName.name) {
    await prisma.users.update({ where: { id: profile.userId }, data: { name: nameFromSeed } }).catch(() => {});
  }

  await prisma.virtual_learner_profiles.update({
    where: { id: profileId },
    data: { profile: JSON.stringify({ ...profileData, ...personaSeed }) },
  });

  logger.info('[learner-provisioning] persona applied', { profileId, nameHint: String(personaSeed.nameHint || '').slice(0, 20) });
}

// -------------------------------------------------------
// 4. 生成故事（scenario designer）并写回 storyPool
// -------------------------------------------------------

export interface GenerateStoryOptions {
  /** 额外 hints（student 样本 / recent hints / learner memory） */
  extraHints?: string[];
  /** preferredMotivations 透传 */
  preferredMotivations?: string[];
  /** 已有故事池计数（日志用） */
  existingStoryCount?: number;
}

export async function generateAndApplyStory(
  profileId: string,
  opts: GenerateStoryOptions = {},
): Promise<boolean> {
  const profile = await prisma.virtual_learner_profiles.findUnique({ where: { id: profileId } });
  if (!profile) return false;

  const profileData = JSON.parse(profile.profile || '{}') as Record<string, unknown>;
  const existingStoryPool: any[] = Array.isArray(profileData.storyPool) ? profileData.storyPool : [];

  // 兜底补全（与 routes 和 batch-job 共用）
  const personaSeedForStory = ensurePersonaFallbacks(profileData, profile.learningGoal);

  const result = await executeSkill(virtualLearnerScenarioDesignerDefinition, {
    preferredMotivations: opts.preferredMotivations || (profileData.motivationType ? [profileData.motivationType] : undefined),
    recentScenarioHints: opts.extraHints || [],
    existingPersonaSeed: personaSeedForStory,
    existingStoryPool,
    targetStoryCount: 1,
  });

  const newStory = result?.story ?? result?.output?.story;
  if (!newStory) {
    logger.warn('[learner-provisioning] story generation returned no story', { profileId });
    return false;
  }

  const storyWithStatus = { ...newStory, createdAt: new Date().toISOString() };
  await prisma.virtual_learner_profiles.update({
    where: { id: profileId },
    data: {
      profile: JSON.stringify({
        ...profileData,
        storyPool: [...existingStoryPool, storyWithStatus],
      }),
    },
  });

  logger.info('[learner-provisioning] story applied', { profileId, title: String(newStory.title || '').slice(0, 30) });
  return true;
}
