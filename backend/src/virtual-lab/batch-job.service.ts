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
import { runBackgroundTask } from '../services/background-task-tracker.service';
import {
  provisionVirtualProfile,
  generateAndApplyPersona,
  generateAndApplyStory,
} from './learner-provisioning';
import { safeJsonParse } from '../utils/safe-json';
import { logger } from '../utils/logger';

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

    // 后台异步执行（不阻塞响应）。
    // 必须走 runBackgroundTask：它会在「已剥离请求级 abortSignal」的独立上下文里执行，
    // 否则 HTTP 响应结束（res 'close'）会 abort 请求上下文，正在进行的 LLM 调用被取消
    // → CALLER_ABORTED / "API request canceled"，导致身份/故事生成 100% 失败（QA ISSUE-003）。
    runBackgroundTask('batch-create', () => this.execute(job.id), { jobId: job.id });

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
    // 重启执行（同样必须脱离请求上下文，见 submit 注释）
    runBackgroundTask('batch-create-retry', () => this.execute(batchId), { jobId: batchId });
    return true;
  }

  /** 创建学习者（users + virtual_learner_profiles） */
  private async createLearner(input: { name: string; cohort?: string; note?: string; story: string }) {
    const result = await provisionVirtualProfile({
      name: input.name,
      notes: input.note ? `${input.note} · ${input.story}` : input.story,
    });
    // 初始 profile 写 cohort/background（batch 特有字段，factory 不含）
    if (result.profileId && input.cohort) {
      await prisma.virtual_learner_profiles.update({
        where: { id: result.profileId },
        data: { profile: JSON.stringify({ background: input.cohort }) },
      });
    }
    // 返回兼容结构（保持 submit 调用方不变）
    return { id: result.profileId, userId: result.userId };
  }

  /** 生成身份并更新画像（重试 3 次语义保留在 batch 层） */
  private async generatePersonaAndUpdate(item: BatchQueueItem, jobId: string, cohort?: string): Promise<void> {
    let ok = false;
    let lastErr: unknown = null;
    for (let attempt = 0; attempt < 3 && !ok; attempt++) {
      try {
        // 保留 batch 的既有身份 seed（name + cohort/background），由 factory 统一写回
        await generateAndApplyPersona(item.profileId, {
          existingNameHint: item.name,
          existingBackground: cohort || undefined,
          requireComplete: true,
        });
        ok = true;
      } catch (e) {
        lastErr = e;
        await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
      }
    }
    if (!ok) throw lastErr || new Error('身份生成失败（多次尝试仍缺字段）');
  }

  /** 生成故事（每次 1 个，失败重试 3 次，与 draft-stories 路由逻辑一致） */
  private async generateStory(item: BatchQueueItem, jobId: string): Promise<void> {
    let ok = false;
    let lastErr: unknown = null;
    for (let attempt = 0; attempt < 3 && !ok; attempt++) {
      try {
        const applied = await generateAndApplyStory(item.profileId);
        if (!applied) throw new Error('故事生成未返回 story');
        ok = true;
      } catch (e) {
        lastErr = e;
        await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
      }
    }
    if (!ok) throw lastErr || new Error('故事生成失败');
  }
}

export const batchJobService = new BatchJobService();
