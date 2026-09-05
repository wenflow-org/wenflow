/**
 * 虚拟学习者级联删除服务（P0-2/R3）
 *
 * 删除虚拟学习者时级联终止并清理其全部虚拟数据，打通此前
 * VIRTUAL_PROFILE_HAS_SESSIONS → VIRTUAL_SESSION_HAS_TEACHING_RECORDS 的双重 409 死锁。
 *
 * 设计决策（VLAB_DATA_SURVEY R3 方案 a：虚拟数据可再生成，级联删除）：
 * - 仅限 isVirtualLearner 用户；真实用户数据一律不触碰（409 保护）。
 * - 显式删除无 users 外键的孤儿表（learner_evidence / learner_projections / memory_traces /
 *   agent_call_logs / prompt_call_logs / llm_execution_attempts / goal_scheduling_ledger /
 *   domain_event_outbox / virtual_quick_learn_runs），避免残留孤儿行。
 * - 有 FK 的表（teaching_sessions / learning_paths / goal_conversations / achievements 等）
 *   同样显式删除，以便在清理清单（admin_audit_logs）中留下可核对的删除量。
 * - 每个级联操作写一条 action=virtual-cascade-delete 的审计记录（before=清理范围，after=删除清单）。
 */

import prisma from '../../config/database';
import type { PrismaClient } from '@prisma/client';
import { logger } from '../../utils/logger';

export interface CascadeDeleteManifest {
  profileId: string;
  userId: string;
  virtualSessions: string[];
  teachingSessions: number;
  learningPaths: number;
  goalConversations: number;
  learningGoals: number;
  learningMetrics: number;
  achievements: number;
  contentFeedback: number;
  projectionAccessGrants: number;
  learnerEvidence: number;
  learnerProjections: number;
  memoryTraces: number;
  quickLearnRuns: number;
  goalSchedulingLedger: number;
  domainEventOutbox: number;
  agentCallLogs: number;
  promptCallLogs: number;
  llmExecutionAttempts: number;
}

/** 业务错误：路由层按 statusCode/code 映射 HTTP 响应 */
export class VirtualCleanupError extends Error {
  readonly statusCode: number;
  readonly code: string;

  constructor(message: string, code: string, statusCode: number) {
    super(message);
    this.name = 'VirtualCleanupError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

interface Operator {
  adminId?: string | null;
  adminName?: string | null;
}

type CleanupDatabase = Pick<
  PrismaClient,
  | 'virtual_learner_profiles'
  | 'virtual_sessions'
  | 'teaching_sessions'
  | 'learning_paths'
  | 'goal_conversations'
  | 'learning_goals'
  | 'learning_metrics'
  | 'achievements'
  | 'content_feedback'
  | 'projection_access_grants'
  | 'learner_evidence'
  | 'learner_projections'
  | 'memory_traces'
  | 'virtual_quick_learn_runs'
  | 'goal_scheduling_ledger'
  | 'domain_event_outbox'
  | 'agent_call_logs'
  | 'prompt_call_logs'
  | 'llm_execution_attempts'
  | 'users'
  | 'admin_audit_logs'
  | '$transaction'
>;

export class VirtualCleanupService {
  private readonly database: CleanupDatabase;

  constructor(options: { database?: CleanupDatabase } = {}) {
    this.database = options.database ?? prisma;
  }

  /**
   * 删除虚拟学习者（profile + user）并级联清理其全部虚拟数据。
   * 返回清理清单（各表删除量 + 会话 id 列表），写审计记录。
   */
  async cascadeDeleteProfile(
    profileId: string,
    operator: Operator = {}
  ): Promise<CascadeDeleteManifest> {
    const profile = await this.database.virtual_learner_profiles.findUnique({
      where: { id: profileId },
      include: { users: { select: { id: true, isVirtualLearner: true, name: true, email: true } } }
    });
    if (!profile) {
      throw new VirtualCleanupError('虚拟用户不存在', 'VIRTUAL_PROFILE_NOT_FOUND', 404);
    }

    const userId = profile.userId;
    const user = profile.users;
    // 硬约束：级联删除仅限 isVirtualLearner，真实用户不可删
    if (!user?.isVirtualLearner) {
      logger.warn('[virtual-cleanup] 拒绝删除非虚拟学习者', {
        profileId,
        userId,
        isVirtualLearner: user?.isVirtualLearner ?? null,
        operatorId: operator.adminId ?? null
      });
      throw new VirtualCleanupError(
        '该账号不是虚拟学习者，禁止级联删除',
        'VIRTUAL_PROFILE_REAL_USER_PROTECTED',
        409
      );
    }

    const before = {
      profileId,
      userId,
      userName: user?.name ?? null,
      userEmail: user?.email ?? null
    };

    const manifest = await this.database.$transaction(async tx => {
      const sessions = await tx.virtual_sessions.findMany({
        where: { virtualProfileId: profileId },
        select: { id: true }
      });

      const result: CascadeDeleteManifest = {
        profileId,
        userId,
        virtualSessions: sessions.map(s => s.id),
        teachingSessions: 0,
        learningPaths: 0,
        goalConversations: 0,
        learningGoals: 0,
        learningMetrics: 0,
        achievements: 0,
        contentFeedback: 0,
        projectionAccessGrants: 0,
        learnerEvidence: 0,
        learnerProjections: 0,
        memoryTraces: 0,
        quickLearnRuns: 0,
        goalSchedulingLedger: 0,
        domainEventOutbox: 0,
        agentCallLogs: 0,
        promptCallLogs: 0,
        llmExecutionAttempts: 0
      };

      // 1) 无 users 外键的孤儿表：按 userId 显式清理
      result.learnerEvidence = (await tx.learner_evidence.deleteMany({ where: { userId } })).count;
      result.learnerProjections = (await tx.learner_projections.deleteMany({ where: { userId } })).count;
      result.memoryTraces = (await tx.memory_traces.deleteMany({ where: { userId } })).count;
      result.quickLearnRuns = (await tx.virtual_quick_learn_runs.deleteMany({ where: { userId } })).count;
      result.goalSchedulingLedger = (await tx.goal_scheduling_ledger.deleteMany({ where: { userId } })).count;
      result.domainEventOutbox = (await tx.domain_event_outbox.deleteMany({ where: { userId } })).count;
      result.agentCallLogs = (await tx.agent_call_logs.deleteMany({ where: { userId } })).count;
      result.promptCallLogs = (await tx.prompt_call_logs.deleteMany({ where: { userId } })).count;
      result.llmExecutionAttempts = (await tx.llm_execution_attempts.deleteMany({ where: { userId } })).count;

      // 2) 虚拟会话（实验租约/命令经 FK 级联一并清除）
      await tx.virtual_sessions.deleteMany({ where: { virtualProfileId: profileId } });

      // 3) 教学会话（虚拟数据无业务保留价值，方案 a 级联删除；finalization 操作经 FK 级联）
      result.teachingSessions = (await tx.teaching_sessions.deleteMany({ where: { userId } })).count;

      // 4) 学习路径（milestones → subtasks / generation runs → stage items 经 FK 级联）
      result.learningPaths = (await tx.learning_paths.deleteMany({ where: { userId } })).count;

      // 5) 其余有 users FK 的学习数据
      result.goalConversations = (await tx.goal_conversations.deleteMany({ where: { userId } })).count;
      result.learningGoals = (await tx.learning_goals.deleteMany({ where: { userId } })).count;
      result.learningMetrics = (await tx.learning_metrics.deleteMany({ where: { userId } })).count;
      result.achievements = (await tx.achievements.deleteMany({ where: { userId } })).count;
      result.contentFeedback = (await tx.content_feedback.deleteMany({ where: { userId } })).count;
      result.projectionAccessGrants = (await tx.projection_access_grants.deleteMany({ where: { userId } })).count;

      // 6) 画像 + 用户本体（subtasks 已随 learning_paths 级联删除，usersId NoAction 外键不残留）
      await tx.virtual_learner_profiles.delete({ where: { id: profileId } });
      await tx.users.delete({ where: { id: userId } });

      return result;
    });

    await this.writeAudit(operator, profileId, before, manifest);
    logger.info('[virtual-cleanup] 虚拟学习者级联删除完成', {
      ...manifest,
      operatorId: operator.adminId ?? null
    });
    return manifest;
  }

  /** 显式写入级联删除审计（before=清理范围，after=清理清单） */
  private async writeAudit(
    operator: Operator,
    targetId: string,
    before: Record<string, unknown>,
    manifest: CascadeDeleteManifest
  ): Promise<void> {
    const after = {
      deletedSessions: manifest.virtualSessions,
      deletedTeachingSessions: manifest.teachingSessions,
      deletedLearningPaths: manifest.learningPaths,
      deletedEvidence: manifest.learnerEvidence,
      deletedProjections: manifest.learnerProjections,
      deletedMemoryTraces: manifest.memoryTraces,
      deletedLogs: manifest.agentCallLogs + manifest.promptCallLogs,
      deletedLlmAttempts: manifest.llmExecutionAttempts
    };
    try {
      await this.database.admin_audit_logs.create({
        data: {
          adminId: operator.adminId ?? null,
          adminName: operator.adminName ?? null,
          action: 'virtual-cascade-delete',
          targetType: 'virtual-learner',
          targetId,
          beforeJson: JSON.stringify(before),
          afterJson: JSON.stringify(after),
          method: 'DELETE',
          path: `/admin/virtual-learners/${targetId}`,
          statusCode: 200,
          success: true,
          durationMs: 0
        }
      });
    } catch (error) {
      // 审计写入失败不阻断删除（与 admin-audit.middleware 同约定：仅告警）
      logger.warn('[virtual-cleanup] 级联删除审计写入失败', {
        error: error instanceof Error ? error.message : String(error),
        profileId: targetId
      });
    }
  }
}

export const virtualCleanupService = new VirtualCleanupService();
