/**
 * 虚拟学习者会话工厂。
 *
 * 负责"人设 + 故事"的会话启动：选中故事 → 组装 storyContext → 创建 virtual_sessions 行。
 * 同时被 admin 路由与实验矩阵批量运行器复用，保证单一实现。
 */

import { randomUUID as uuidv4 } from 'crypto';
import prisma from '../config/database';
import blackboxVirtualLearnerRunner from './blackbox-runner';

export const SIMULATION_FRICTION_BUDGETS = ['none', 'low', 'normal', 'high', 'stress_test'] as const;
export type SimulationFrictionBudget = typeof SIMULATION_FRICTION_BUDGETS[number];

export function parseJson<T = any>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function normalizeText(value: any) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeStoryId(value: any) {
  return normalizeText(value).toLowerCase();
}

export function normalizeStoryPoolData(profileData: any) {
  const rawStoryPool = Array.isArray(profileData?.storyPool) ? profileData.storyPool : [];
  const usedIds = new Set<string>();
  let changed = false;

  const storyPool = rawStoryPool
    .filter((story: any) => story && typeof story === 'object')
    .map((story: any, index: number) => {
      const nextStory = { ...story };
      const rawId = normalizeStoryId(story.id);

      if (!rawId || usedIds.has(rawId)) {
        nextStory.id = `story_${uuidv4()}`;
        changed = true;
      }

      const nextId = normalizeStoryId(nextStory.id);
      usedIds.add(nextId);

      if (!normalizeText(nextStory.title)) {
        nextStory.title = `故事 ${index + 1}`;
        changed = true;
      }

      return nextStory;
    });

  return {
    changed,
    profileData: {
      ...(profileData && typeof profileData === 'object' ? profileData : {}),
      storyPool,
    },
    storyPool,
  };
}

export async function ensureProfileStoryPool(profile: any) {
  const profileData = parseJson<any>(profile?.profile, {});
  const normalized = normalizeStoryPoolData(profileData);

  if (normalized.changed && profile?.id) {
    await prisma.virtual_learner_profiles.update({
      where: { id: profile.id },
      data: { profile: JSON.stringify(normalized.profileData) },
    });
    profile.profile = JSON.stringify(normalized.profileData);
  }

  return normalized;
}

export function buildStorySignature(story: any) {
  return {
    title: normalizeText(story?.title || story?.storyTitle),
    triggerEvent: normalizeText(story?.storyTriggerEvent || story?.triggerEvent),
  };
}

export function isSameStory(story: any, sessionStory: any) {
  if (!story || !sessionStory) return false;

  const storyId = normalizeStoryId(story.id || story.storyId);
  const sessionStoryId = normalizeStoryId(sessionStory.storyId || sessionStory.id);
  const storySignature = buildStorySignature(story);
  const sessionSignature = buildStorySignature(sessionStory);

  if (storyId && sessionStoryId && storyId === sessionStoryId) {
    if (!storySignature.title || !sessionSignature.title || storySignature.title === sessionSignature.title) {
      if (!storySignature.triggerEvent || !sessionSignature.triggerEvent || storySignature.triggerEvent === sessionSignature.triggerEvent) {
        return true;
      }
    }
  }

  return !!storySignature.title
    && !!storySignature.triggerEvent
    && storySignature.title === sessionSignature.title
    && storySignature.triggerEvent === sessionSignature.triggerEvent;
}

export function getStoryPool(profile: any) {
  const profileData = parseJson<any>(profile?.profile, {});
  return normalizeStoryPoolData(profileData).storyPool;
}

export function pickStoryFromPool(profile: any, storyId?: string, storyIndex?: number) {
  const stories = getStoryPool(profile);
  if (!stories.length) return null;

  if (storyId) {
    const matched = stories.find((story: any) => story.id === storyId);
    if (matched) return matched;
  }

  if (Number.isFinite(storyIndex)) {
    const index = Math.max(0, Math.min(stories.length - 1, Number(storyIndex)));
    return stories[index];
  }

  return stories[0];
}

export function createStorySelectionError(message: string, code: string) {
  const error: any = new Error(message);
  error.status = 400;
  error.code = code;
  return error;
}

export async function createSessionForProfile(
  profileId: string,
  options: {
    storyId?: string;
    storyIndex?: number;
    frictionBudget?: SimulationFrictionBudget;
    blackboxOperatorId?: string;
    experimentId?: string | null;
    parentRunId?: string | null;
    actorProfileOverride?: Record<string, unknown> | null;
    storyContextOverride?: Record<string, unknown> | null;
    hasStoryContextOverride?: boolean;
    experimentSnapshotOverride?: Record<string, any> | null;
  } = {}
): Promise<any | null> {
  const profile = await prisma.virtual_learner_profiles.findUnique({
    where: { id: profileId }
  });
  if (!profile) return null;

  if (!options.hasStoryContextOverride) {
    await ensureProfileStoryPool(profile);
  }

  const hasStoryOverride = options.hasStoryContextOverride === true;
  let selectedStoryId = typeof options.storyId === 'string' && options.storyId.trim()
    ? options.storyId.trim()
    : undefined;
  let selectedStoryIndex = Number.isFinite(options.storyIndex) ? Number(options.storyIndex) : undefined;

  // 顶层模型：虚拟人 → 多故事；每个故事产生学习需求后才与平台交互，并对应一套 Path。
  // 启动会话必须绑定明确故事；仅当故事池只有 1 条时允许自动选中。
  if (!hasStoryOverride) {
    const stories = getStoryPool(profile);
    if (!stories.length) {
      throw createStorySelectionError(
        '请先为该虚拟人生成故事；故事产生学习需求后才能与平台交互',
        'STORY_REQUIRED'
      );
    }
    if (!selectedStoryId && selectedStoryIndex === undefined) {
      if (stories.length === 1) {
        selectedStoryId = stories[0]?.id || undefined;
        selectedStoryIndex = 0;
      } else {
        throw createStorySelectionError(
          '一人多故事时必须指定 storyId：每个故事对应一套学习路径（Path）',
          'STORY_SELECTION_REQUIRED'
        );
      }
    }
  }

  const story = hasStoryOverride
    ? options.storyContextOverride
    : pickStoryFromPool(profile, selectedStoryId, selectedStoryIndex);
  if (!hasStoryOverride && !story) {
    throw createStorySelectionError(
      '指定的故事不存在，请从该虚拟人的故事池中选择',
      'STORY_NOT_FOUND'
    );
  }
  const storyContext = hasStoryOverride ? options.storyContextOverride : (story
    ? {
        storyId: story.id || null,
        title: story.title || '故事',
        sourceType: story.sourceType || null,
        outline: story.storyOutline || story.outline || '',
        triggerEvent: story.triggerEvent || story.storyTriggerEvent || '',
        visibleOpening: story.visibleOpening || '',
        hiddenDetails: Array.isArray(story.hiddenDetails) ? story.hiddenDetails : [],
        misdiagnosis: story.misdiagnosis || '',
        pressurePoints: Array.isArray(story.pressurePoints) ? story.pressurePoints : [],
        behaviorHooks: Array.isArray(story.behaviorHooks) ? story.behaviorHooks : [],
        problemKnowledge: story.problemKnowledge || null,
        goalSeed: story.goalSeed || null,
        disclosurePlan: story.disclosurePlan || null,
      }
    : null);

  const frictionBudget = options.frictionBudget || 'normal';
  const actorProfile = options.actorProfileOverride || {
    profile: parseJson<any>(profile.profile, {}),
    learningGoal: profile.learningGoal,
    knownConcepts: parseJson<any[]>(profile.knownConcepts, []),
    struggleConcepts: parseJson<any[]>(profile.struggleConcepts, []),
    personalityTraits: parseJson<any>(profile.personalityTraits, {})
  };
  const blackboxState = options.blackboxOperatorId
    ? await blackboxVirtualLearnerRunner.createExperimentState({
        operatorId: options.blackboxOperatorId,
        actorProfile,
        story: storyContext,
        frictionBudget,
        experimentId: options.experimentId || null,
        parentRunId: options.parentRunId || null,
        experimentSnapshotOverride: options.experimentSnapshotOverride || null
      })
    : {};
  const stageResultsObject = {
    ...(storyContext ? {
      story: storyContext,
      learnerContext: actorProfile.profile,
    } : {}),
    simulationConfig: { frictionBudget },
    ...blackboxState
  };
  const stageResults = JSON.stringify(stageResultsObject);

  const session = await prisma.virtual_sessions.create({
    data: {
      id: uuidv4(),
      virtualProfileId: profileId,
      userId: profile.userId,
      status: 'created',
      currentStage: 'goal',
      logs: '[]',
      stageResults,
    }
  });

  return { ...session, storyContext, experiment: (stageResultsObject as any).experiment || null };
}
