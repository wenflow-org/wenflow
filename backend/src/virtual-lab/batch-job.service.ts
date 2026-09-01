/**
 * 批量新建虚拟学习者后台任务（服务端队列）
 *
 * 解决「批量新建靠前端内存轮询，刷新/切页即中断」的可靠性问题：
 * - 前端只 POST /batch-create 提交任务（同步创建人，秒回 batchId）
 * - 后端后台队列逐个生成身份 + 故事（服务端执行，不受前端影响）
 * - 前端 GET /batch-create/:batchId 轮询进度展示状态条
 *
 * 队列项：{ profileId, name, storyCount, needsPersona }
 * 阶段：身份（persona）→ 故事（scenario），每轮处理 1 项，避免并发打爆 LLM。
 */
import { prisma } from '../config/database';
import { executeSkill } from '../skills';
import { virtualLearnerPersonaDesignerDefinition } from '../skills/virtual-learner-persona-designer';
import { virtualLearnerScenarioDesignerDefinition } from '../skills/virtual-learner-scenario-designer';
import { safeJsonParse } from '../utils/safe-json';
import { logger } from '../utils/logger';
import { randomUUID, randomBytes } from 'crypto';
import bcrypt from 'bcryptjs';

export interface BatchQueueItem {
  profileId: string;
  name: string;
  storyCount: number;
  needsPersona: boolean;
}

const POLL_INTERVAL_MS = 2000;
const runningJobs = new Set<string>();

class BatchJobService {
  /**
   * 提交批量任务：同步创建学习者（秒回），后台异步生成身份 + 故事。
   */
  async submit(input: {
    rows: Array<{ name: string; storyCount: number }>;
    cohort?: string;
    note?: string;
    createdBy?: string;
  }): Promise<{ batchId: string; created: number; totalStories: number }> {
    const rows = (input.rows || []).filter((r) => r.name.trim());
    if (!rows.length) throw new Error('至少需要一个学习者名称');

    // 阶段 1：同步创建学习者（快，不占 LLM）
    const queue: BatchQueueItem[] = [];
    let created = 0;
    let totalStories = 0;
    for (const r of rows) {
      const name = r.name.trim();
      try {
        const story = input.cohort?.trim() || `${name}的人物背景待补充`;
        // 复用创建逻辑：users + virtual_learner_profiles
        const profile = await this.createLearner({ name, cohort: input.cohort?.trim(), note: input.note?.trim(), story });
        if (profile) {
          created++;
          const storyCount = Math.max(0, Math.min(5, Math.round(Number(r.storyCount)) || 0));
          queue.push({ profileId: profile.id, name, storyCount, needsPersona: true });
          totalStories += storyCount;
        }
      } catch (e) {
        logger.error('[batch-job] 创建学习者失败', { name, error: String(e) });
      }
    }
    if (!created) throw new Error('批量创建失败（全部学习者创建失败）');

    // 阶段 2：落库任务记录 + 后台执行
    const job = await prisma.virtual_batch_jobs.create({
      data: {
        status: 'running',
        total: created,
        created,
        totalStories,
        storiesDone: 0,
        personaLeft: queue.length,
        queue: JSON.stringify(queue),
        cohort: input.cohort?.trim() || null,
        note: input.note?.trim() || null,
        createdBy: input.createdBy || null,
        startedAt: new Date(),
      },
    });

    // 后台异步执行（不阻塞响应）
    setImmediate(() => {
      void this.execute(job.id).catch((error) => {
        logger.error('[batch-job] 后台执行异常', { jobId: job.id, error: String(error) });
      });
    });

    return { batchId: job.id, created, totalStories };
  }

  /** 查任务进度 */
  async getJob(batchId: string) {
    const job = await prisma.virtual_batch_jobs.findUnique({ where: { id: batchId } });
    if (!job) return null;
    return {
      id: job.id,
      status: job.status,
      total: job.total,
      created: job.created,
      totalStories: job.totalStories,
      storiesDone: job.storiesDone,
      personaLeft: job.personaLeft,
      failed: safeJsonParse<BatchQueueItem[]>(job.failed, []),
      error: job.error,
      cohort: job.cohort,
      note: job.note,
      createdAt: job.createdAt,
      completedAt: job.completedAt,
    };
  }

  /** 后台队列执行：每轮处理 1 项（身份或故事），完成或失败收尾 */
  private async execute(jobId: string): Promise<void> {
    if (runningJobs.has(jobId)) return;
    runningJobs.add(jobId);
    try {
      for (;;) {
        const job = await prisma.virtual_batch_jobs.findUnique({ where: { id: jobId } });
        if (!job) return;
        const queue = safeJsonParse<BatchQueueItem[]>(job.queue, []);
        if (!queue.length) break;

        const item = queue[0];
        if (item.storyCount <= 0 && !item.needsPersona) {
          queue.shift();
          await prisma.virtual_batch_jobs.update({
            where: { id: jobId },
            data: { queue: JSON.stringify(queue) },
          });
          continue;
        }

        try {
          if (item.needsPersona) {
            // 阶段 1：AI 生成身份（personaSeed → 更新画像）；LLM 偶发缺字段，重试 2 次
            await this.generatePersonaAndUpdate(item, jobId, job.cohort || undefined);
            item.needsPersona = false;
            await prisma.virtual_batch_jobs.update({
              where: { id: jobId },
              data: {
                queue: JSON.stringify(queue),
                personaLeft: Math.max(0, (job.personaLeft || 0) - 1),
              },
            });
          } else if (item.storyCount > 0) {
            // 阶段 2：生成故事（每次 1 个）；LLM 偶发失败，重试 2 次
            await this.generateStory(item, jobId);
            item.storyCount--;
            const storiesDone = (job.storiesDone || 0) + 1;
            await prisma.virtual_batch_jobs.update({
              where: { id: jobId },
              data: {
                queue: JSON.stringify(queue),
                storiesDone,
              },
            });
          } else {
            queue.shift();
            await prisma.virtual_batch_jobs.update({
              where: { id: jobId },
              data: { queue: JSON.stringify(queue) },
            });
          }
        } catch (e) {
          // 单项失败：移出队列 → 记录 failed（可重试），继续下一项
          const failed = safeJsonParse<BatchQueueItem[]>(job.failed, []);
          failed.push({ ...item });
          queue.shift();
          await prisma.virtual_batch_jobs.update({
            where: { id: jobId },
            data: {
              queue: JSON.stringify(queue),
              failed: JSON.stringify(failed),
            },
          });
          logger.error('[batch-job] 单项失败', { jobId, name: item.name, error: String(e) });
        }

        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      }

      // 收尾
      const final = await prisma.virtual_batch_jobs.findUnique({ where: { id: jobId } });
      const failed = safeJsonParse<BatchQueueItem[]>(final?.failed, []);
      await prisma.virtual_batch_jobs.update({
        where: { id: jobId },
        data: {
          status: failed.length ? 'error' : 'done',
          completedAt: new Date(),
          error: failed.length ? `${failed.length} 项生成失败（可重试）` : null,
        },
      });
      logger.info('[batch-job] 批量任务完成', { jobId, status: failed.length ? 'error' : 'done', failed: failed.length });
    } finally {
      runningJobs.delete(jobId);
    }
  }

  /** 重试失败项：失败项放回队首 */
  async retry(batchId: string): Promise<boolean> {
    const job = await prisma.virtual_batch_jobs.findUnique({ where: { id: batchId } });
    if (!job) return false;
    const failed = safeJsonParse<BatchQueueItem[]>(job.failed, []);
    if (!failed.length) return false;
    const queue = safeJsonParse<BatchQueueItem[]>(job.queue, []);
    await prisma.virtual_batch_jobs.update({
      where: { id: batchId },
      data: {
        queue: JSON.stringify([...failed, ...queue]),
        failed: JSON.stringify([]),
        error: null,
        status: 'running',
      },
    });
    // 重启执行
    setImmediate(() => {
      void this.execute(batchId).catch((error) => {
        logger.error('[batch-job] 重试执行异常', { jobId: batchId, error: String(error) });
      });
    });
    return true;
  }

  /** 创建学习者（users + virtual_learner_profiles） */
  private async createLearner(input: { name: string; cohort?: string; note?: string; story: string }) {
    const email = `virtual_${randomUUID().substring(0, 8)}@test.local`;
    const hashedPassword = await bcrypt.hash(randomBytes(32).toString('hex'), 10);
    const user = await prisma.users.create({
      data: {
        id: randomUUID(),
        email,
        name: input.name,
        password: hashedPassword,
        role: 'user',
        currentLevel: 'beginner',
        isAdmin: false,
        isVirtualLearner: true,
        updatedAt: new Date(),
      },
    });
    const profilePayload = input.cohort ? { background: input.cohort } : { background: input.story };
    const profile = await prisma.virtual_learner_profiles.create({
      data: {
        id: randomUUID(),
        userId: user.id,
        profile: JSON.stringify(profilePayload),
        learningGoal: '',
        knowledgeLevel: 'beginner',
        simulationMode: 'manual',
        simulationTemperature: 0.8,
        notes: input.note ? `${input.note} · ${input.story}` : input.story,
      },
    });
    return profile;
  }

  /** 生成身份并更新画像 */
  private async generatePersonaAndUpdate(item: BatchQueueItem, jobId: string, cohort?: string): Promise<void> {
    let seed: Record<string, unknown> | null = null;
    let lastErr: unknown = null;
    for (let attempt = 0; attempt < 3 && !seed; attempt++) {
      try {
        const result = await executeSkill(virtualLearnerPersonaDesignerDefinition, {
          existingPersonaSeed: {
            name: item.name,
            nameHint: item.name,
            ...(cohort ? { notes: cohort, background: cohort } : {}),
          },
        });
        const output = result?.output || {};
        const candidate = (output.personaSeed || output.profile || output) as Record<string, unknown> | null;
        if (candidate && typeof candidate === 'object' && String(candidate.nameHint || '').trim() && String(candidate.background || '').trim()) {
          seed = candidate;
        } else {
          lastErr = new Error('personaSeed 缺 nameHint/background，重试');
        }
      } catch (e) {
        lastErr = e;
        await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
      }
    }
    if (!seed) throw lastErr || new Error('身份生成失败（多次尝试仍缺字段）');

    const nameFromSeed = String(seed.name || seed.nameHint || seed.occupation || '').trim();
    const profilePayload: Record<string, unknown> = { ...seed };
    if (item.name !== nameFromSeed) {
      await prisma.users.update({ where: { id: (await prisma.virtual_learner_profiles.findUnique({ where: { id: item.profileId } }))?.userId || '' }, data: { name: nameFromSeed || item.name } }).catch(() => {});
    }
    const profile = await prisma.virtual_learner_profiles.findUnique({ where: { id: item.profileId } });
    if (!profile) throw new Error('学习者不存在');
    const existing = safeJsonParse<Record<string, unknown>>(profile.profile, {});
    await prisma.virtual_learner_profiles.update({
      where: { id: item.profileId },
      data: { profile: JSON.stringify({ ...existing, ...profilePayload }) },
    });
  }

  /** 生成故事（每次 1 个） */
  private async generateStory(item: BatchQueueItem, jobId: string): Promise<void> {
    let ok = false;
    let lastErr: unknown = null;
    for (let attempt = 0; attempt < 3 && !ok; attempt++) {
      try {
        await this.draftStory(item.profileId);
        ok = true;
      } catch (e) {
        lastErr = e;
        await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
      }
    }
    if (!ok) throw lastErr || new Error('故事生成失败');
  }

  /** 单次故事生成（与 draft-stories 路由同逻辑：existingPersonaSeed 兜底补全） */
  private async draftStory(profileId: string): Promise<void> {
    const profile = await prisma.virtual_learner_profiles.findUnique({ where: { id: profileId } });
    if (!profile) throw new Error('学习者不存在');
    const profileData = safeJsonParse<Record<string, unknown>>(profile.profile, {});
    const existingStoryPool = Array.isArray(profileData.storyPool) ? profileData.storyPool : [];
    // 兜底补全（与 draft-stories 路由一致）：避免身份不完整导致故事失败
    const personaSeedForStory: Record<string, unknown> = { ...profileData };
    if (!String(personaSeedForStory.education || '').trim()) personaSeedForStory.education = '在职学习';
    if (!['reading', 'watching', 'doing', 'listening'].includes(String(personaSeedForStory.learningStyle || ''))) personaSeedForStory.learningStyle = 'doing';
    if (!Number.isFinite(Number(personaSeedForStory.age))) personaSeedForStory.age = 28;
    if (!Array.isArray(personaSeedForStory.knownConcepts) || !personaSeedForStory.knownConcepts.length) personaSeedForStory.knownConcepts = ['基础概念'];
    if (!Array.isArray(personaSeedForStory.struggleConcepts) || !personaSeedForStory.struggleConcepts.length) personaSeedForStory.struggleConcepts = ['方法不清晰'];
    if (!Array.isArray(personaSeedForStory.emotionalTriggers) || !personaSeedForStory.emotionalTriggers.length) personaSeedForStory.emotionalTriggers = ['遇到挫折'];
    if (!Array.isArray(personaSeedForStory.failurePatterns) || !personaSeedForStory.failurePatterns.length) personaSeedForStory.failurePatterns = ['半途而废'];
    if (!['internal', 'external', 'both', 'none'].includes(String(personaSeedForStory.motivationType || ''))) personaSeedForStory.motivationType = 'internal';
    if (!['minimal', 'moderate', 'abundant'].includes(String(personaSeedForStory.availableTime || ''))) personaSeedForStory.availableTime = 'moderate';

    const result = await executeSkill(virtualLearnerScenarioDesignerDefinition, {
      recentScenarioHints: [],
      existingPersonaSeed: personaSeedForStory,
      existingStoryPool,
      targetStoryCount: 1,
    });
    const newStory = result?.output?.story;
    if (!newStory) throw new Error('故事生成未返回 story');
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
  }
}

export const batchJobService = new BatchJobService();
