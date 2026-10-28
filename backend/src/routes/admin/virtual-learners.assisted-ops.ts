/**
 * 自动驾驶运行面 · 日志 / 删除 / 回归 / 批量 / 卡库（2026-10-24 架构优化批 1：
 * assisted-runtime.ts 再拆分迁出，处理器逐字未改）。由 assisted-runtime.ts 按原顺序调用注册。
 */
import type { Router, Request } from 'express';
import type { Prisma } from '../../services/prisma-client-types';
import { logger } from '../../utils/logger';
import { withTransaction } from '../../utils/with-transaction';
import simulationCoordinator from '../../coordinators/simulation.coordinator';
import { assertPathMutationSafe } from '../../services/learning/path-mutation-safety';
import { findProfileById } from '../../services/virtual-lab/virtual-learner-profile.repo';
import { findSessionById, findSessionsByIdPair, overwriteSessionStageResults, createAdminAuditLog } from '../../services/virtual-lab/virtual-session.repo';
import { hydrateSessionLogsField as hydrateVirtualSessionLogsField } from '../../services/virtual-lab/virtual-session-log-store';
import { virtualCleanupService } from '../../services/virtual-lab/virtual-cleanup.service';
import { validateCards as validateCardDocument, importCards as importCardDocument, exportCards as exportCardLibrary, getCardWallIndex, getCardDetail, getCardTaskGroups, cloneCardsToLearners, CLONE_MAX_ITEMS } from '../../services/virtual-lab/card-import.service';
import { sendVirtualSessionError } from './virtual-session-http';
import type { VirtualSessionRow } from '../../virtual-lab/vlab-types';
import { createSessionForProfile, parseJson } from '../../virtual-lab/session-factory';
import { regenerateWrapup } from '../../services/ai-teaching/teaching-wrapup-regen';
import { parseLearningProgress, parseStageResults } from './virtual-learners.projections';
import { parseSimulationLimit, runAssistedSessionMutation } from './virtual-learners.assisted-shared';

export function registerAssistedOpsRoutes(router: Router): void {
/**
 * 获取模拟会话日志
 * GET /api/admin/virtual-sessions/:sessionId/logs
 */
router.get('/sessions/:sessionId/logs', async (req: Request, res) => {
  try {
    const { sessionId } = req.params;

    const session = await findSessionById(sessionId);

    if (!session) {
      return res.status(404).json({
        success: false,
        error: '模拟会话不存在'
      });
    }

    // 日志子表水合（侧表权威则覆写内存 logs 字段）
    await hydrateVirtualSessionLogsField(session);

    let logs: unknown[] = [];
    try {
      logs = JSON.parse(session.logs || '[]');
    } catch {
      // ignore malformed logs payload
    }

    res.json({
      success: true,
      data: {
        logs,
        totalLogs: logs.length
      }
    });
  } catch (error) {
    logger.error('获取模拟会话日志失败:', error);
    res.status(500).json({
      success: false,
      error: error.message || '获取模拟会话日志失败'
    });
  }
});

/**
 * 删除模拟会话
 * DELETE /api/admin/virtual-sessions/:sessionId
 */
router.delete('/sessions/:sessionId', async (req: Request, res) => {
  try {
    const { sessionId } = req.params;

    const existingSession = await findSessionById(sessionId);

    if (!existingSession) {
      return res.status(404).json({
        success: false,
        error: '模拟会话不存在'
      });
    }

    const session = await simulationCoordinator.runLeasedExclusive(sessionId, async assertLeaseOwned => {
      const leasedSession = await findSessionById(sessionId);
      if (!leasedSession) throw new Error('模拟会话不存在');

      let deletedTeachingCount = 0;
      let deletedEvidenceCount = 0;
      let deletedPredictionCount = 0;
      const teachingSessionIds: string[] = [];
      await assertLeaseOwned();
      await withTransaction(async tx => {
        await assertLeaseOwned(tx);
        const teachingSessionScopes: Prisma.teaching_sessionsWhereInput[] = [];
        const teachingSessionId = parseLearningProgress(leasedSession).teachingSessionId;
        if (teachingSessionId) teachingSessionScopes.push({ id: String(teachingSessionId) });

        if (leasedSession.learningPathId) {
          const learningPath = await tx.learning_paths.findFirst({
            where: {
              id: leasedSession.learningPathId,
              userId: leasedSession.userId
            },
            select: { id: true }
          });
          if (!learningPath) {
            throw Object.assign(new Error('学习路径不属于当前虚拟学习者'), {
              code: 'VIRTUAL_SESSION_PATH_OWNERSHIP_MISMATCH',
              statusCode: 409
            });
          }

          await assertPathMutationSafe(tx, learningPath.id, 'delete-path');

          const pathTasks = await tx.subtasks.findMany({
            where: { milestones: { learningPathId: learningPath.id } },
            select: { id: true }
          });
          const taskIds = pathTasks.map((task: { id: string }) => task.id);
          teachingSessionScopes.push(
            { learningPathId: learningPath.id },
            ...(taskIds.length > 0 ? [{ taskId: { in: taskIds } }] : [])
          );
        }

        if (teachingSessionScopes.length > 0) {
          const associatedTeachingSessions = await tx.teaching_sessions.findMany({
            where: { OR: teachingSessionScopes },
            select: { id: true }
          });
          // F22：教学会话 id 留给下面的会话级残留级联（learner_evidence/prediction_records）
          teachingSessionIds.push(...associatedTeachingSessions.map((s: { id: string }) => s.id));
          if (associatedTeachingSessions.length > 0) {
            // R3 级联：虚拟学习者会话允许级联删除关联教学记录（虚拟数据可再生成）；
            // 真实用户会话仍保持原 409 保护，不触碰真实教学数据。
            const owner = await tx.users.findUnique({
              where: { id: leasedSession.userId },
              select: { isVirtualLearner: true }
            });
            if (!owner?.isVirtualLearner) {
              throw Object.assign(new Error('模拟会话仍有关联课堂记录，不能删除'), {
                code: 'VIRTUAL_SESSION_HAS_TEACHING_RECORDS',
                statusCode: 409
              });
            }
            deletedTeachingCount = (await tx.teaching_sessions.deleteMany({
              where: { OR: teachingSessionScopes }
            })).count;
          }
        }

        if (leasedSession.goalConversationId) {
          await tx.goal_conversations.deleteMany({
            where: {
              id: leasedSession.goalConversationId,
              userId: leasedSession.userId
            }
          });
        }
        if (leasedSession.learningPathId) {
          await tx.learning_paths.deleteMany({
            where: {
              id: leasedSession.learningPathId,
              userId: leasedSession.userId
            }
          });
        }
        /* F22 级联收口（2026-10-15）：会话键的会话级残留随删——证据流与预测记录。
           两表的 sessionId 两套 id 空间都出现过（教学会话 id：teaching-checkpoint 等写入；
           虚拟会话 UUID：churn/投影等按虚拟会话记），一并删除。
           agent_call_logs 是成本/调用遥测（排查上游超时/失败的唯一回看面），保留不删；
           memory_traces/learner_projections/misconception_ledger 按 userId 键控，
           是画像跨会话资产，不随单个会话删除（确认框文案写明保留范围）。 */
        const evidenceSessionIds = [...teachingSessionIds, sessionId];
        deletedEvidenceCount = (await tx.learner_evidence.deleteMany({ where: { sessionId: { in: evidenceSessionIds } } })).count;
        deletedPredictionCount = (await tx.prediction_records.deleteMany({ where: { sessionId: { in: evidenceSessionIds } } })).count;
        await tx.virtual_sessions.delete({
          where: { id: sessionId }
        });
      }, { label: 'virtual-learners.cascadeDeleteSession' });

      return { session: leasedSession, deletedTeachingCount, deletedEvidenceCount, deletedPredictionCount };
    }, { skipFinalLeaseCheck: true });

    if (session.deletedTeachingCount > 0 || session.deletedEvidenceCount > 0 || session.deletedPredictionCount > 0) {
      try {
        await createAdminAuditLog({
          data: {
            adminId: req.user?.userId ?? null,
            adminName: req.user?.email ?? null,
            action: 'virtual-cascade-delete',
            targetType: 'virtual-session',
            targetId: sessionId,
            beforeJson: JSON.stringify({ userId: session.session.userId }),
            afterJson: JSON.stringify({
              deletedTeachingSessions: session.deletedTeachingCount,
              deletedEvidence: session.deletedEvidenceCount,
              deletedPredictions: session.deletedPredictionCount
            }),
            method: 'DELETE',
            path: `/admin/virtual-learners/sessions/${sessionId}`,
            statusCode: 200,
            success: true,
            durationMs: 0
          }
        }).catch((error: Error) => {
          logger.warn('[virtual-learners] 会话级联删除审计写入失败', {
            error: error?.message || String(error),
            sessionId
          });
        });
      } catch (error) {
        logger.warn('[virtual-learners] 会话级联删除审计写入失败', {
          error: error?.message || String(error),
          sessionId
        });
      }
    }

    logger.info('删除模拟会话成功', {
      sessionId,
      userId: session.session.userId,
      deletedTeachingCount: session.deletedTeachingCount,
      deletedEvidenceCount: session.deletedEvidenceCount,
      deletedPredictionCount: session.deletedPredictionCount
    });

    res.json({
      success: true,
      message: '模拟会话已删除',
      ...(session.deletedTeachingCount > 0 || session.deletedEvidenceCount > 0 || session.deletedPredictionCount > 0
        ? {
            data: {
              cleanup: {
                deletedTeachingSessions: session.deletedTeachingCount,
                deletedEvidence: session.deletedEvidenceCount,
                deletedPredictions: session.deletedPredictionCount
              }
            }
          }
        : {})
    });
  } catch (error) {
    logger.error('删除模拟会话失败:', error);
    sendVirtualSessionError(res, error, '删除模拟会话失败');
  }
});

/**
 * 回归测试: 跑一个完整的 Goal→Path 流程, 可指定 prompt 版本 override
 * POST /api/admin/virtual-learners/:profileId/regression-run
 */
router.post('/:profileId/regression-run', async (req: Request, res) => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({ success: false, error: '未登录' });
    }

    const { profileId } = req.params;
    const { storyId, storyIndex, maxGoalRounds: requestedMaxGoalRounds, systemPromptOverrides } = req.body || {};
    const maxGoalRounds = parseSimulationLimit(requestedMaxGoalRounds, 20, 50, 'maxGoalRounds');

    const profile = await findProfileById(profileId);
    if (!profile) {
      return res.status(404).json({ success: false, error: '虚拟用户不存在' });
    }

    // 1. 创建新 session
    const session = await createSessionForProfile(profileId, { storyId, storyIndex });
    if (!session) {
      return res.status(404).json({ success: false, error: '虚拟用户不存在或故事池为空' });
    }
    const sessionId = session.id;

    // 2. 执行全自动 (Goal→Path→Learn 一条龙, 受 maxGoalRounds 限制)
    const result = await runAssistedSessionMutation(sessionId, async (leasedSession, assertLeaseOwned) => {
      if (systemPromptOverrides && typeof systemPromptOverrides === 'object') {
        const goalAgent = typeof systemPromptOverrides.goalAgent === 'string' ? systemPromptOverrides.goalAgent.trim() : '';
        const pathAgent = typeof systemPromptOverrides.pathAgent === 'string' ? systemPromptOverrides.pathAgent.trim() : '';
        if (goalAgent || pathAgent) {
          await assertLeaseOwned();
          await overwriteSessionStageResults(sessionId, JSON.stringify({
            ...parseJson(leasedSession.stageResults, {}),
            systemPromptOverrides: { goalAgent: goalAgent || undefined, pathAgent: pathAgent || undefined }
          }));
          await assertLeaseOwned();
        }
      }

      return simulationCoordinator.executeFullSession(sessionId, {
        maxRounds: maxGoalRounds,
        maxMilestones: 5,
        continueOnTaskComplete: false, // 回归测试只跑首个 task
        autoAdvanceToPath: true,
        autoAdvanceToLearning: false  // 回归测试主要看 Goal+Path, 不跑完整 Learn
      });
    });

    res.json({
      success: result.success,
      data: {
        sessionId,
        ...result,
      },
      error: result.error
    });
  } catch (error) {
    logger.error('回归测试失败:', error);
    sendVirtualSessionError(res, error, '回归测试失败');
  }
});

/**
 * 回归对比: 对比两个 session 的关键运行结果
 * GET /api/admin/virtual-learners/regression/compare-sessions?sessionA=&sessionB=
 */
router.get('/regression/compare-sessions', async (req: Request, res) => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({ success: false, error: '未登录' });
    }

    const sessionA = String(req.query.sessionA || '');
    const sessionB = String(req.query.sessionB || '');
    if (!sessionA || !sessionB) {
      return res.status(400).json({ success: false, error: '需要提供 sessionA 与 sessionB' });
    }

    const [a, b] = await findSessionsByIdPair(sessionA, sessionB);

    if (!a || !b) {
      return res.status(404).json({
        success: false,
        error: '至少一个 session 不存在'
      });
    }

    const summarize = (s: VirtualSessionRow) => {
      const stageResults = parseStageResults(s);
      return {
        id: s.id,
        status: s.status,
        currentStage: s.currentStage,
        goalConversationId: s.goalConversationId,
        learningPathId: s.learningPathId,
        currentTaskId: s.currentTaskId,
        completedTasks: s.completedTasks,
        totalTasks: s.totalTasks,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
        goalStage: stageResults?.goal?.finalStage || stageResults?.goal?.stage || null,
        pathReady: !!stageResults?.path?.success,
        learnerStateSnapshot: stageResults?.teaching?.learnerState || stageResults?.goal?.learnerState || null,
        wrapup: stageResults?.teaching?.wrapup || null,
        rounds: {
          goal: Array.isArray(stageResults?.goal?.conversationHistory) ? stageResults.goal.conversationHistory.length : 0,
          learning: Array.isArray(stageResults?.teaching?.conversationHistory) ? stageResults.teaching.conversationHistory.length : 0,
        }
      };
    };

    res.json({
      success: true,
      data: {
        sessionA: summarize(a),
        sessionB: summarize(b),
      }
    });
  } catch (error) {
    logger.error('对比 session 失败:', error);
    res.status(500).json({
      success: false,
      error: error.message || '对比 session 失败'
    });
  }
});

/**
 * 降级 wrapup 重生成（2026-10-11 补轮）：仅完结且 wrapup 退化为 summary-only 的会话可重跑
 * wrapup 技能并回写产物 + 补写 learning_metrics。POST /api/admin/virtual-learners/sessions/:sessionId/regenerate-wrapup
 */
router.post('/sessions/:sessionId/regenerate-wrapup', async (req: Request, res) => {
  try {
    const result = await regenerateWrapup(req.params.sessionId, {
      adminId: req.user?.userId ?? null,
      adminName: req.user?.email ?? null
    });
    if (result.error) {
      return res.status(409).json({ success: false, error: result.error });
    }
    res.json({ success: true, data: result });
  } catch (error) {
    logger.error('wrapup 重生成失败:', error);
    res.status(500).json({ success: false, error: (error as Error).message || 'wrapup 重生成失败' });
  }
});

/**
 * 批量删除虚拟学习者（A3）：级联删除 profile + user + 全部虚拟数据。
 * 后端已通过 virtualCleanupService.cascadeDeleteProfile 打通 409 死锁。
 * POST /api/admin/virtual-learners/batch-delete  body: { profileIds: string[] }
 */
router.post('/batch-delete', async (req: Request, res) => {
  try {
    const profileIds: string[] = Array.isArray(req.body?.profileIds)
      ? (req.body.profileIds as unknown[]).map(String).filter(Boolean)
      : [];
    if (!profileIds.length) {
      return res.status(400).json({ success: false, error: 'profileIds 至少提供一个' });
    }
    // 每个 id 触发一个大级联事务，串行执行；不设上限的批次会拖垮请求与数据库
    if (profileIds.length > 100) {
      return res.status(400).json({ success: false, error: '单批最多删除 100 个，请分批操作' });
    }

    const deleted: string[] = [];
    const skipped: string[] = [];
    const errors: Array<{ id: string; error: string }> = [];

    for (const id of profileIds) {
      try {
        await virtualCleanupService.cascadeDeleteProfile(id, {
          adminId: req.user?.userId ?? null,
          adminName: req.user?.email ?? null
        });
        deleted.push(id);
      } catch (error) {
        if (error?.code === 'VIRTUAL_PROFILE_REAL_USER_PROTECTED') {
          skipped.push(id);
        } else if (error?.code === 'VIRTUAL_PROFILE_NOT_FOUND') {
          // 不存在属于「无需处理」而非失败，归入 skipped 保持语义一致
          skipped.push(id);
        } else {
          errors.push({ id, error: error.message || '删除失败' });
        }
      }
    }

    logger.info('批量删除虚拟学习者完成', {
      total: profileIds.length,
      deleted: deleted.length,
      skipped: skipped.length,
      errors: errors.length,
      operatorId: req.user?.userId ?? null
    });

    res.json({
      success: errors.length === 0,
      data: { deleted, skipped, errors }
    });
  } catch (error) {
    logger.error('批量删除虚拟学习者失败:', error);
    res.status(500).json({ success: false, error: error?.message || '批量删除失败' });
  }
});

/**
 * 学习者卡库：校验（不落库）
 * POST /api/admin/virtual-learners/cards/validate
 * body: { content: string, format?: 'yaml' | 'json' }
 */
router.post('/cards/validate', async (req: Request, res) => {
  try {
    const content = typeof req.body?.content === 'string' ? req.body.content : '';
    if (!content.trim()) {
      return res.status(400).json({ success: false, error: 'content 不能为空' });
    }
    const format = req.body?.format === 'json' ? 'json' : 'yaml';
    const result = await validateCardDocument(content, format);
    if (result.parseError) {
      return res.status(400).json({ success: false, error: result.parseError });
    }
    res.json({ success: true, data: result });
  } catch (error) {
    logger.error('学习者卡校验失败:', error);
    res.status(500).json({ success: false, error: (error as Error).message || '学习者卡校验失败' });
  }
});

/**
 * 学习者卡库：导入（一张卡 = 账号 + 档案 + 故事池，结构化落库，不经编译链）
 * POST /api/admin/virtual-learners/cards/import
 * body: { content: string, format?: 'yaml' | 'json', enrich?: boolean, update?: boolean }
 */
router.post('/cards/import', async (req: Request, res) => {
  try {
    const content = typeof req.body?.content === 'string' ? req.body.content : '';
    if (!content.trim()) {
      return res.status(400).json({ success: false, error: 'content 不能为空' });
    }
    const format = req.body?.format === 'json' ? 'json' : 'yaml';
    const enrich = req.body?.enrich === true;
    const update = req.body?.update === true;
    const result = await importCardDocument(content, format, { enrich, update });
    if (result.parseError) {
      return res.status(400).json({ success: false, error: result.parseError });
    }
    res.json({ success: true, data: result });
  } catch (error) {
    logger.error('学习者卡导入失败:', error);
    res.status(500).json({ success: false, error: (error as Error).message || '学习者卡导入失败' });
  }
});

/**
 * 学习者卡库：导出全部自建卡（yaml 文本）
 * GET /api/admin/virtual-learners/cards/export
 */
router.get('/cards/export', async (_req: Request, res) => {
  try {
    const result = await exportCardLibrary();
    res.json({ success: true, data: result });
  } catch (error) {
    logger.error('学习者卡导出失败:', error);
    res.status(500).json({ success: false, error: (error as Error).message || '学习者卡导出失败' });
  }
});

/**
 * 卡墙索引（2026-10-05 卡库改版）：全部卡（预置+自建）的展示摘要。
 * 卡=账号拍板不变；「从卡库选人」= openSubPage('virtual', userId) 直达该学习者画像。
 * GET /api/admin/virtual-learners/cards/index
 */
router.get('/cards/index', async (_req: Request, res) => {
  try {
    const data = await getCardWallIndex();
    res.json({ success: true, data });
  } catch (error) {
    logger.error('卡墙索引失败:', error);
    res.status(500).json({ success: false, error: (error as Error).message || '卡墙索引失败' });
  }
});

/**
 * 卡详情（2026-10-05 卡库改版二）：卡墙点卡抽屉的全字段数据源——
 * 人设键值面 / 故事池（开场白+追问+预算）/ 自带资料 / 来源 / 账号 / 标签。
 * GET /api/admin/virtual-learners/cards/:profileId/detail
 */
router.get('/cards/:profileId/detail', async (req: Request, res) => {
  try {
    const detail = await getCardDetail(String(req.params.profileId || ''));
    if (!detail) {
      return res.status(404).json({ success: false, error: '卡不存在' });
    }
    res.json({ success: true, data: detail });
  } catch (error) {
    logger.error('卡详情失败:', error);
    res.status(500).json({ success: false, error: (error as Error).message || '卡详情失败' });
  }
});

/**
 * 卡的任务清单（2026-10-16「卡 → 虚拟学习者」创建面板的数据源）：逐卡给故事池任务
 * （id + 标题 + 开场白）。读档案原始 storyPool——卡详情的展示映射会丢 goalSeed /
 * problemKnowledge，照它勾选再克隆，派生实例的任务会残。
 * GET /api/admin/virtual-learners/cards/tasks?ids=<profileId,profileId>
 */
router.get('/cards/tasks', async (req: Request, res) => {
  try {
    const ids = String(req.query.ids || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (!ids.length) {
      return res.status(400).json({ success: false, error: '缺少 ids（卡 id 列表）' });
    }
    const groups = await getCardTaskGroups(ids);
    res.json({ success: true, data: { groups } });
  } catch (error) {
    logger.error('卡任务清单失败:', error);
    res.status(500).json({ success: false, error: (error as Error).message || '卡任务清单失败' });
  }
});

/**
 * 卡 → 虚拟学习者（2026-10-16 用户拍板「卡库是身份池，选卡 + 勾任务 → 创建虚拟学习者」）。
 * 派生语义 = 身份克隆：新账号 + 新档案，人设整体带走，故事池只带勾选的任务，卡号重算。
 * 批量：一次 1..CLONE_MAX_ITEMS 张卡；逐项返回结果（部分失败不整体回滚，投产半成不报成整单失败）。
 * POST /api/admin/virtual-learners/cards/clone
 */
router.post('/cards/clone', async (req: Request, res) => {
  try {
    const rawItems = Array.isArray(req.body?.items) ? req.body.items : [];
    const items = rawItems
      .map((it: unknown) => {
        const o = (it || {}) as Record<string, unknown>;
        return {
          profileId: String(o.profileId || '').trim(),
          storyIds: Array.isArray(o.storyIds) ? o.storyIds.map(String) : undefined,
        };
      })
      .filter((it: { profileId: string }) => it.profileId);
    if (!items.length) {
      return res.status(400).json({ success: false, error: '请先选择要派生的卡' });
    }
    if (items.length > CLONE_MAX_ITEMS) {
      return res.status(400).json({ success: false, error: `一次最多派生 ${CLONE_MAX_ITEMS} 张卡` });
    }
    const note = typeof req.body?.note === 'string' ? req.body.note.trim() : undefined;
    const data = await cloneCardsToLearners(items, note || undefined);
    logger.info('卡派生虚拟学习者', {
      requested: items.length,
      created: data.created.length,
      failed: data.failed.length,
      createdBy: req.user?.userId,
    });
    res.json({ success: true, data });
  } catch (error) {
    logger.error('卡派生失败:', error);
    res.status(500).json({ success: false, error: (error as Error).message || '卡派生失败' });
  }
});
}
