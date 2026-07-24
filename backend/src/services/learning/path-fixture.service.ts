/**
 * Path Fixture Service
 *
 * 把一条已有学习路径（含 milestones / subtasks 及全部教学标注字段）确定性地
 * 克隆到指定用户名下，作为虚拟学习者账号自动学习的测试路径。
 *
 * 设计文档：doc/VIRTUAL_LEARNER_QUICK_LEARN_DESIGN_2026-07-21_091152.md 第 6.1 节
 *
 * 关键约束（来自 schema 与学习门禁）：
 * - learning_paths.activeGenerationRunId 有 @unique，克隆必须置 null
 * - subtasks.userId 是冗余索引列，subtasks.usersId 才是外键，两列都要写目标用户
 * - milestones @@unique([learningPathId, stageNumber])，新 pathId 下原样复制不冲突
 * - aiPromptTemplate 原样复制：其内 _generation.stageDesign==='succeeded' 可直接
 *   通过 getPathLearningAccessState 门禁（learning.service.ts）
 */

import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import prisma from '../../config/database';
import { logger } from '../../utils/logger';

export interface ClonePathFixtureOptions {
  titlePrefix?: string;
}

export interface ClonePathFixtureResult {
  fixturePathId: string;
  sourcePathId: string;
  targetUserId: string;
  title: string;
  milestoneCount: number;
  taskCount: number;
}

const DEFAULT_TITLE_PREFIX = '[Fixture] ';

export class PathFixtureService {
  /**
   * 克隆一条路径到目标用户名下。源路径只读，产物完全独立。
   * 单个事务完成，失败整体回滚。
   */
  async clonePathToUser(
    sourcePathId: string,
    targetUserId: string,
    options: ClonePathFixtureOptions = {}
  ): Promise<ClonePathFixtureResult> {
    const source = await prisma.learning_paths.findUnique({
      where: { id: sourcePathId },
      include: {
        milestones: {
          orderBy: { order: 'asc' },
          include: { subtasks: { orderBy: { order: 'asc' } } },
        },
      },
    });
    if (!source) {
      throw new Error('源学习路径不存在');
    }
    if (!Array.isArray(source.milestones) || source.milestones.length === 0) {
      throw new Error('源学习路径没有任何阶段，无法作为测试夹具');
    }

    const targetUser = await prisma.users.findUnique({
      where: { id: targetUserId },
      select: { id: true },
    });
    if (!targetUser) {
      throw new Error('目标用户不存在');
    }

    const titlePrefix = options.titlePrefix !== undefined ? options.titlePrefix : DEFAULT_TITLE_PREFIX;
    const title = `${titlePrefix}${source.title}`.slice(0, 200);
    let taskCount = 0;

    const fixturePathId = await prisma.$transaction(async (tx) => {
      const now = new Date();
      const pathData: Prisma.learning_pathsUncheckedCreateInput = {
        id: randomUUID(),
        userId: targetUserId,
        title,
        name: source.name,
        description: source.description,
        subject: source.subject,
        status: 'active',
        difficulty: source.difficulty,
        estimatedHours: source.estimatedHours,
        totalMilestones: source.totalMilestones,
        completedMilestones: 0,
        aiGenerated: source.aiGenerated,
        // 原样复制：内含 _generation.stageDesign==='succeeded' 时可通过学习门禁
        aiPromptTemplate: source.aiPromptTemplate,
        deadline: source.deadline,
        deadlineText: source.deadlineText,
        // 血缘：记录夹具来源
        sourcePathId: source.id,
        replanMode: null,
        replanReason: null,
        replanTriggerSource: null,
        // @unique 约束，绝不能照抄
        activeGenerationRunId: null,
        updatedAt: now,
      };
      const fixturePath = await tx.learning_paths.create({ data: pathData });

      for (const [index, milestone] of source.milestones.entries()) {
        const milestoneData: Prisma.milestonesUncheckedCreateInput = {
          id: randomUUID(),
          learningPathId: fixturePath.id,
          stageNumber: milestone.stageNumber,
          title: milestone.title,
          description: milestone.description,
          goal: milestone.goal,
          estimatedHours: milestone.estimatedHours,
          // 与生成器行为一致：第一个阶段可学，其余锁定
          status: index === 0 ? 'active' : 'locked',
          unlockedAt: null,
          startedAt: null,
          completedAt: null,
          order: milestone.order,
          coreConceptId: milestone.coreConceptId,
          coreConceptName: milestone.coreConceptName,
          updatedAt: now,
        };
        const fixtureMilestone = await tx.milestones.create({ data: milestoneData });

        for (const task of milestone.subtasks) {
          taskCount += 1;
          const taskData: Prisma.subtasksUncheckedCreateInput = {
            id: randomUUID(),
            milestoneId: fixtureMilestone.id,
            // userId 是冗余索引列，usersId 才是外键，两列都必须写目标用户
            userId: targetUserId,
            usersId: targetUserId,
            title: task.title,
            description: task.description,
            taskType: task.taskType,
            estimatedMinutes: task.estimatedMinutes,
            acceptanceCriteria: task.acceptanceCriteria,
            order: task.order,
            status: 'todo',
            completedAt: null,
            rating: null,
            feedback: null,
            cognitiveLoad: task.cognitiveLoad,
            annotationConfidence: task.annotationConfidence,
            cognitiveLevel: task.cognitiveLevel,
            coreConcept: task.coreConcept,
            displayLabel: task.displayLabel,
            knowledgeType: task.knowledgeType,
            learningObjectives: task.learningObjectives,
            transferable: task.transferable,
            linkedConceptId: task.linkedConceptId,
            linkedConceptName: task.linkedConceptName,
            updatedAt: now,
          };
          await tx.subtasks.create({ data: taskData });
        }
      }

      return fixturePath.id;
    });

    logger.info('[PathFixture] 克隆学习路径夹具成功', {
      sourcePathId,
      fixturePathId,
      targetUserId,
      milestoneCount: source.milestones.length,
      taskCount,
    });

    return {
      fixturePathId,
      sourcePathId,
      targetUserId,
      title,
      milestoneCount: source.milestones.length,
      taskCount,
    };
  }
}

export const pathFixtureService = new PathFixtureService();
export default pathFixtureService;
