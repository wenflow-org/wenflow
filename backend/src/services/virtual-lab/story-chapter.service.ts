/**
 * 多故事续章生长（2026-10-11，人物立体化接线）
 *
 * 背景（story-extensibility-diagnosis.md）：顶层模型「虚拟人 → 多故事；每个故事产生学习需求
 * 后与平台交互，并对应一套 Path」已在 session-factory 落地（故事池 >1 时启动会话强制选故事），
 * 故事本体也是完整戏剧引擎（明线/暗线/误诊/揭示计划）；但 storyPool 只在创建期注水一次
 * （91/98 单故事）、学习闭环零回写 → 人物扁平。本服务补齐「完课 → 续章」这根线：
 * 一节真课完课后，为当前故事生成一条承接其学习成果的下一章故事，池随学习生长。
 *
 * 语义：
 * - 触发 = 真课完课（wrapup 可靠），同一故事只长一次续章（幂等键 = progressesFrom）。
 * - 续章生成复用 scenario-designer：注入「已掌握 / 近期完成事项成果物 / 仍在学习的点」记忆 hints
 *   （与 routes 的 draft-stories 同源），并显式给出「前一章结局」，让新故事承接而非重放。
 * - 生命周期字段：status（pending/active/completed）、progressesFrom（承接哪条故事）、
 *   chapterIndex（第几章）。旧故事无字段视为 legacy，不改写。
 */

import { randomUUID } from 'node:crypto';
import { prisma } from '../../config/database';
import { executeSkill } from '../../skills';
import { virtualLearnerScenarioDesignerDefinition } from '../../skills/virtual-learner-scenario-designer';
import { buildLearnerMemorySnapshot } from '../../virtual-lab/learner-memory';
import { logger } from '../../utils/logger';

/** 故事池上限：防止一夜之间无限生长（每章需一节真课才长出）。 */
export const STORY_POOL_MAX = 8;

export type StoryStatus = 'pending' | 'active' | 'completed';

export interface StoryLifecycle {
  status?: StoryStatus;
  progressesFrom?: string | null;
  chapterIndex?: number;
  generatedAt?: string;
  generatedReason?: string;
}

export interface StoryChapterResult {
  added: boolean;
  storyId?: string;
  title?: string;
  reason?: string;
}

/**
 * storyPool 条目：生命周期字段（见 {@link StoryLifecycle}）+ 故事自带字段。
 * id/title/storyOutline 由 scenario-designer 产出、形状内在动态，故留索引签名承接未列字段，
 * 已声明字段只用于取用处的取值安全（不再退化成 any）。
 */
export type StoryPoolEntry = StoryLifecycle & {
  id?: string;
  storyId?: string;
  title?: string;
  storyOutline?: string;
  [key: string]: unknown;
};

/**
 * 学习史 → 故事 hints（从 routes/admin/virtual-learners.ts buildLearnerMemoryStoryHints 提取共享，
 * 两处（手动补生成 / 自动续章）同一份口径，避免漂移）。
 */
export async function buildLearnerStoryHints(userId: string, opts: { limit?: number } = {}): Promise<string[]> {
  try {
    const memory = await buildLearnerMemorySnapshot(userId, { limit: opts.limit ?? 6 });
    const hints: string[] = [];
    if (memory.mastered.length > 0) {
      hints.push(`此人在过往学习中已掌握：${memory.mastered.map((m) => m.name).join('、')}。新故事可自然承接这些基础，不要让他完全从头开始。`);
    }
    if (memory.recentCompleted.length > 0) {
      const items = memory.recentCompleted
        .map((item) => (item.deliverable ? `${item.title}（成果：${item.deliverable}）` : item.title))
        .join('；');
      hints.push(`此人在近期完成了这些事：${items}。新故事可以在这些成果的基础上展开（如后续任务、复盘、被他人看到等），让故事有连续性。`);
    }
    if (memory.struggling.length > 0) {
      hints.push(`此人仍在学习的点：${memory.struggling.map((s) => s.name).join('、')}。新故事可以包含相关但不重复的挑战。`);
    }
    return hints;
  } catch {
    return [];
  }
}

function parseProfilePool(profile: { profile: string | null }): {
  profileData: Record<string, unknown>;
  pool: StoryPoolEntry[];
} {
  let profileData: Record<string, unknown> = {};
  try {
    profileData = JSON.parse(profile.profile || '{}') as Record<string, unknown>;
  } catch {
    profileData = {};
  }
  const pool = Array.isArray(profileData.storyPool) ? (profileData.storyPool as StoryPoolEntry[]) : [];
  return { profileData, pool };
}

/**
 * 为指定故事生成一条承接其学习成果的下一章故事并写回 storyPool。
 * 幂等：同一 predecessorStoryId 已有续章（progressesFrom 命中）则跳过。
 */
export async function growStoryChapter(input: {
  profileId: string;
  predecessorStoryId: string;
  predecessorTitle?: string | null;
  predecessorOutline?: string | null;
  reason?: string;
}): Promise<StoryChapterResult> {
  const profile = await prisma.virtual_learner_profiles.findUnique({ where: { id: input.profileId } });
  if (!profile) return { added: false, reason: 'profile-not-found' };

  const { profileData, pool } = parseProfilePool(profile);
  if (pool.length === 0) return { added: false, reason: 'empty-pool' };
  if (pool.length >= STORY_POOL_MAX) return { added: false, reason: 'pool-max' };

  const predecessor = pool.find((s) => (s?.id || s?.storyId) === input.predecessorStoryId);
  if (!predecessor) return { added: false, reason: 'predecessor-not-in-pool' };

  // 幂等：同一故事只长一次续章
  if (pool.some((s) => s?.progressesFrom === input.predecessorStoryId)) {
    return { added: false, reason: 'successor-exists' };
  }

  const memoryHints = await buildLearnerStoryHints(profile.userId);
  const prevTitle = input.predecessorTitle || String(predecessor.title || '').trim();
  const prevOutline = input.predecessorOutline || String(predecessor.storyOutline || '').trim();
  const continuationHint = `这是为同一个虚拟人续写的「下一章」故事（前一章：${prevTitle || '上一段经历'}${prevOutline ? `；梗概：${prevOutline.slice(0, 160)}` : ''}）。` +
    `前一章的学习需求已经被这一阶段的真实学习推进（见下方记忆），新故事必须是**承接**：同一个人的下一段生活场景/新触发事件，` +
    `可换场景域（工作/学习/生活/人际），但**不要重放**前一章的情绪、开场或同一处境。`;

  const personaSeed = {
    ...profileData,
  } as Record<string, unknown>;

  let result: { story?: Record<string, unknown>; output?: { story?: Record<string, unknown> } } | undefined;
  try {
    result = await executeSkill(virtualLearnerScenarioDesignerDefinition, {
      preferredMotivations: profileData?.motivationType ? [String(profileData.motivationType)] : undefined,
      recentScenarioHints: [continuationHint, ...memoryHints],
      existingPersonaSeed: personaSeed,
      existingStoryPool: pool.slice(-2),
      targetStoryCount: 1,
    });
  } catch (error) {
    logger.warn('[story-chapter] 续章生成调用失败', {
      profileId: input.profileId,
      error: error instanceof Error ? error.message : String(error),
    });
    return { added: false, reason: 'skill-error' };
  }

  const newStory = (result?.story ?? result?.output?.story) as StoryPoolEntry | undefined;
  if (!newStory || typeof newStory !== 'object' || !String(newStory.title || '').trim()) {
    logger.warn('[story-chapter] 续章生成无有效产出', { profileId: input.profileId });
    return { added: false, reason: 'no-story' };
  }

  const prevChapterIndex = Number.isFinite(Number(predecessor.chapterIndex)) ? Number(predecessor.chapterIndex) : 1;
  const successor: StoryPoolEntry = {
    ...newStory,
    id: newStory.id || `story_${randomUUID().slice(0, 8)}`,
    // 生命周期
    status: 'pending' as StoryStatus,
    progressesFrom: input.predecessorStoryId,
    chapterIndex: prevChapterIndex + 1,
    generatedAt: new Date().toISOString(),
    generatedReason: input.reason || 'lesson-completed',
  };

  // 前一章标记 completed（其学习需求已被真实学习推进）；旧故事无 status 视为 legacy，此处补写。
  const nextPool: StoryPoolEntry[] = pool.map((s) =>
    (s?.id || s?.storyId) === input.predecessorStoryId
      ? { ...s, status: 'completed' as StoryStatus, chapterIndex: Number.isFinite(Number(s.chapterIndex)) ? Number(s.chapterIndex) : 1 }
      : s
  );
  nextPool.push(successor);

  await prisma.virtual_learner_profiles.update({
    where: { id: input.profileId },
    data: {
      profile: JSON.stringify({ ...profileData, storyPool: nextPool }),
      updatedAt: new Date(),
    },
  });

  logger.info('[story-chapter] 续章已生长', {
    profileId: input.profileId,
    predecessor: input.predecessorStoryId,
    successorId: successor.id,
    chapterIndex: successor.chapterIndex,
    title: String(successor.title).slice(0, 40),
  });

  return { added: true, storyId: String(successor.id), title: String(successor.title) };
}

/**
 * 完课钩子：解析「这节课属于哪个故事」，并生长其下一章。
 * 非虚拟学习者 / 无虚拟会话 / wrapup 不可靠 → 静默跳过（best-effort，绝不阻断课堂收尾）。
 */
export async function onTeachingSessionCompleted(input: {
  userId: string;
  learningPathId?: string | null;
  wrapupReliable?: boolean;
}): Promise<void> {
  try {
    if (!input.userId) return;
    if (input.wrapupReliable === false) return; // 无可靠学习证据不生长（避免假课长出假章）

    const user = await prisma.users.findUnique({ where: { id: input.userId }, select: { isVirtualLearner: true } });
    if (!user?.isVirtualLearner) return;

    const profile = await prisma.virtual_learner_profiles.findUnique({
      where: { userId: input.userId },
      select: { id: true, profile: true },
    });
    if (!profile) return;
    const { pool } = parseProfilePool(profile);
    if (pool.length === 0) return;

    // 解析这节课背后的故事：虚拟会话 stageResults.story.storyId（按路径优先，回退最近会话）
    let storyId: string | null = null;
    let storyTitle: string | null = null;
    let storyOutline: string | null = null;
    const vsRows = await prisma.virtual_sessions.findMany({
      where: {
        userId: input.userId,
        ...(input.learningPathId ? { learningPathId: input.learningPathId } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 3,
      select: { stageResults: true },
    });
    for (const vs of vsRows) {
      let sr: unknown = vs.stageResults;
      if (typeof sr === 'string') {
        try {
          sr = JSON.parse(sr);
        } catch {
          sr = null;
        }
      }
      const story = (sr as { story?: { storyId?: string; id?: string; title?: string; outline?: string } } | null)?.story;
      const sid = story?.storyId || story?.id;
      if (sid) {
        storyId = String(sid);
        storyTitle = story?.title ? String(story.title) : null;
        storyOutline = story?.outline ? String(story.outline) : null;
        break;
      }
    }
    // 回退：故事池里第一条「未完结」（无续章）的故事
    if (!storyId) {
      const withSuccessor = new Set(pool.map((s) => s?.progressesFrom).filter(Boolean));
      const head = pool.find((s) => !withSuccessor.has(s?.id || s?.storyId));
      if (head) {
        storyId = String(head.id || head.storyId);
        storyTitle = head.title ? String(head.title) : null;
        storyOutline = head.storyOutline ? String(head.storyOutline) : null;
      }
    }
    if (!storyId) return;

    await growStoryChapter({
      profileId: profile.id,
      predecessorStoryId: storyId,
      predecessorTitle: storyTitle,
      predecessorOutline: storyOutline,
      reason: 'lesson-completed',
    });
  } catch (error) {
    logger.warn('[story-chapter] 完课续章钩子失败', {
      userId: input.userId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
