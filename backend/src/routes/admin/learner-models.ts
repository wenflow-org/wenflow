import express from 'express';
import prisma from '../../config/database';
import { authMiddleware } from '../../middleware/auth.middleware';
import { learnerSnapshotRefreshService } from '../../services/learner/LearnerSnapshotRefreshService';
import { predictionCalibrationService } from '../../services/learner/PredictionCalibrationService';
import learningStateService from '../../services/learning/learning-state.service';

const router = express.Router();
router.use(authMiddleware);

/** 安全解析 JSON 文本（learner_evidence.payload 等），失败返回 null */
function safeJsonParse<T>(raw: string | null | undefined): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function ensureAdmin(userId?: string) {
  if (!userId) return false;
  const operator = await prisma.users.findUnique({
    where: { id: userId },
    select: { isAdmin: true },
  });
  return !!operator?.isAdmin;
}

router.get('/', async (req, res) => {
  try {
    const allowed = await ensureAdmin(req.user?.userId);
    if (!allowed) {
      return res.status(403).json({ success: false, error: { message: '需要管理员权限' } });
    }

    // 默认排除虚拟学习者与测试/审计账号（风险队列只给真实用户看）；
    // includeTest=true 时显式包含（管理需要可查虚拟数据，只改默认视图不删数据）
    const includeTest = String(req.query.includeTest || '') === 'true';
    const excludeTest = includeTest ? false : String(req.query.excludeTest || '') !== 'false';

    const data = await learnerSnapshotRefreshService.listForAdmin({
      userId: req.query.userId as string | undefined,
      pathId: req.query.pathId as string | undefined,
      staleOnly: req.query.staleOnly === 'true',
      riskOnly: req.query.riskOnly === 'true',
      excludeTest,
      page: req.query.page ? Number(req.query.page) : undefined,
      limit: req.query.limit ? Number(req.query.limit) : undefined,
    });

    return res.json({ success: true, data });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: { message: error.message || '获取学习者模型列表失败' } });
  }
});

/** 详情/证据默认视图：虚拟学习者需显式 includeTest=true 才可查（默认 404，不删数据只改默认视图） */
async function ensureVirtualVisible(userId: string, includeTest: boolean): Promise<boolean> {
  if (includeTest) return true;
  const target = await prisma.users.findUnique({
    where: { id: userId },
    select: { isVirtualLearner: true },
  });
  return target ? !target.isVirtualLearner : true;
}

router.get('/:userId', async (req, res) => {
  try {
    const allowed = await ensureAdmin(req.user?.userId);
    if (!allowed) {
      return res.status(403).json({ success: false, error: { message: '需要管理员权限' } });
    }

    const includeTest = String(req.query.includeTest || '') === 'true';
    if (!(await ensureVirtualVisible(req.params.userId, includeTest))) {
      return res.status(404).json({
        success: false,
        error: { message: '虚拟学习者数据需显式包含（includeTest=true 可查）' },
      });
    }

    const pathId = req.query.pathId as string | undefined;
    const snapshot = await learnerSnapshotRefreshService.getLatest({
      userId: req.params.userId,
      pathId,
      scope: pathId ? 'path' : (req.query.mode as 'global' | 'path' | 'teaching' | undefined) || 'global',
    });

    const currentPath = snapshot.knowledgeMemory.currentPath;
    const pathProgress = currentPath?.progress;
    const globalSignals = snapshot.knowledgeMemory.globalSignals;

    return res.json({
      success: true,
      data: {
        ...snapshot,
        progress: pathProgress?.totalTasks
          ? Number(((pathProgress.completedTasks / pathProgress.totalTasks) * 100).toFixed(1))
          : 0,
        concepts: {
          mastered: globalSignals.masteredConcepts,
          struggling: globalSignals.strugglingConcepts,
          fragile: globalSignals.fragileConcepts,
        },
        pathTitle: currentPath?.pathTitle || null,
      },
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: { message: error.message || '获取学习者模型详情失败' } });
  }
});

router.post('/:userId/recompute', async (req, res) => {
  try {
    const allowed = await ensureAdmin(req.user?.userId);
    if (!allowed) {
      return res.status(403).json({ success: false, error: { message: '需要管理员权限' } });
    }

    const pathId = (req.body?.pathId as string | undefined) || (req.query.pathId as string | undefined);
    const snapshot = await learnerSnapshotRefreshService.refresh({
      userId: req.params.userId,
      pathId,
      scope: pathId ? 'path' : req.body?.scope || 'global',
    });

    return res.json({ success: true, data: snapshot, message: '学习者模型已重算' });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: { message: error.message || '重算学习者模型失败' } });
  }
});

router.get('/:userId/evidence', async (req, res) => {
  try {
    const allowed = await ensureAdmin(req.user?.userId);
    if (!allowed) {
      return res.status(403).json({ success: false, error: { message: '需要管理员权限' } });
    }

    const includeTest = String(req.query.includeTest || '') === 'true';
    if (!(await ensureVirtualVisible(req.params.userId, includeTest))) {
      return res.status(404).json({
        success: false,
        error: { message: '虚拟学习者数据需显式包含（includeTest=true 可查）' },
      });
    }

    const snapshot = await learnerSnapshotRefreshService.getLatest({
      userId: req.params.userId,
      pathId: req.query.pathId as string | undefined,
      scope: 'path',
    });

    // 教学域 4 类证据（快照 recentEvidence：task-completed / teaching-session / summary / evaluation）
    const teachingItems = snapshot.knowledgeMemory.currentPath?.recentEvidence || [];

    // 目标/路径域证据：直接从 learner_evidence 表取（goal:understanding:updated / path:created / path:generated / path:adjusted / path:completed），
    // 与教学证据合并为完整时间线（这些事件原本只用于画像聚合，不在时间线展示——调查结论 1）
    const domainItems = await prisma.learner_evidence.findMany({
      where: {
        userId: req.params.userId,
        evidenceType: {
          in: ['goal:understanding:updated', 'path:created', 'path:generated', 'path:adjusted', 'path:completed'],
        },
      },
      orderBy: { occurredAt: 'desc' },
      take: 30,
      select: {
        id: true,
        evidenceType: true,
        confidence: true,
        occurredAt: true,
        pathId: true,
        taskId: true,
        sessionId: true,
        payload: true,
      },
    });

    const domainEvidence = domainItems.map((e) => {
      const payload = safeJsonParse<Record<string, any>>(e.payload) || {};
      // goal/path 域证据语义：置信度表示「事件完成度/理解度」，不是学习成败。
      // 统一用中性 signal 'incomplete'（前端渲染为灰点 + 中文「澄清/创建/生成」等，不误标掌握/未完成）
      const signal: 'mastery' | 'struggle' | 'fatigue' | 'incomplete' = 'incomplete';
      return {
        type: e.evidenceType,
        taskId: e.taskId || undefined,
        sessionId: e.sessionId || undefined,
        conceptKeys: Array.isArray(payload?.conceptKeys) ? payload.conceptKeys.map(String) : [],
        signal,
        score: e.confidence,
        happenedAt: e.occurredAt.toISOString(),
        // 附加域信息：payload 里的关键摘要
        detail: e.evidenceType === 'goal:understanding:updated'
          ? String(payload?.understanding?.surface_goal || payload?.surfaceGoal || '目标澄清对话')
          : String(payload?.pathTitle || payload?.title || ''),
      };
    });

    // 学习压力记录曲线：用系统真实压力指标体系（learning_metrics 的 LSS/KTL/LF/LSB 历史趋势，
    // 与用户侧 /state/trends 同源）——不是学习分钟数，是每次会话/任务完成时 AI 评估的压力记录
    let loadCurve: { date: string; lss: number | null; ktl: number | null; lf: number | null; lsb: number | null }[] = [];
    try {
      const trendWindow = await learningStateService.getStateTrendWindow(req.params.userId, { days: 90, mode: 'recent' });
      loadCurve = trendWindow.trends.map((t) => ({
        date: t.date.toISOString().slice(0, 10),
        lss: t.lss,
        ktl: t.ktl,
        lf: t.lf,
        lsb: t.lsb,
      }));
    } catch {
      // 压力趋势不可用（如用户无任何指标）时返回空数组，前端显示空态
    }

    return res.json({
      success: true,
      data: {
        items: teachingItems,
        domain: domainEvidence,
        loadCurve,
      },
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: { message: error.message || '获取学习证据失败' } });
  }
});

router.get('/:userId/predictions', async (req, res) => {
  try {
    const allowed = await ensureAdmin(req.user?.userId);
    if (!allowed) {
      return res.status(403).json({ success: false, error: { message: '需要管理员权限' } });
    }

    const includeTest = String(req.query.includeTest || '') === 'true';
    if (!(await ensureVirtualVisible(req.params.userId, includeTest))) {
      return res.status(404).json({
        success: false,
        error: { message: '虚拟学习者数据需显式包含（includeTest=true 可查）' },
      });
    }

    // 实证命中率 + 校准桶（预测器可信度的统计口径）
    const stats = await predictionCalibrationService.empiricalStats(req.params.userId);
    // 最近预测记录（含回写结果），供前端展示"预测 vs 实际"
    const recentRows = await prisma.prediction_records.findMany({
      where: { userId: req.params.userId },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: {
        id: true,
        taskId: true,
        stallRisk: true,
        predictedTone: true,
        suggestedDepth: true,
        focusConcepts: true,
        rationale: true,
        outcome: true,
        createdAt: true,
        outcomeAt: true,
      },
    });

    return res.json({
      success: true,
      data: {
        stats,
        recent: recentRows.map((r) => ({
          id: r.id,
          taskId: r.taskId,
          stallRisk: r.stallRisk,
          predictedTone: r.predictedTone,
          suggestedDepth: r.suggestedDepth,
          focusConcepts: safeJsonParse<string[]>(r.focusConcepts) || [],
          rationale: r.rationale,
          outcome: r.outcome,
          createdAt: r.createdAt.toISOString(),
          outcomeAt: r.outcomeAt?.toISOString() || null,
        })),
      },
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: { message: error.message || '获取预测校准数据失败' } });
  }
});

export default router;
