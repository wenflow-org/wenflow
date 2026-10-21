/**
 * 运营可观测读侧（2026-10-21）：把两个原本只在 CLI/日志里的指标接到管理端。
 *
 * - GET /api/admin/ops/throughput?window=60&minRpm=20
 *   批量吞吐 rpm 与「连续低于下限」告警（口径与 scripts/audit-batch-throughput.ts 同一纯函数）。
 * - GET /api/admin/ops/insight-reliability?userId=...&pathId=...
 *   建议归因/状态评审的可证伪断言命中率（insight-calibration 单源，n<5 时 hitRate=null）。
 */
import express from 'express';
import prisma from '../../config/database';
import { summarizeThroughput, applyThroughputActivity, ACTIVE_SESSION_STALE_MINUTES } from '../../services/ops/throughput';
import { insightCalibrationService } from '../../services/learner/insight-calibration.service';

const router = express.Router();

function clampInt(raw: unknown, fallback: number, min: number, max: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

router.get('/throughput', async (req, res) => {
  try {
    const windowMinutes = clampInt(req.query.window, 60, 5, 1440);
    const minRpm = clampInt(req.query.minRpm, 20, 1, 10000);
    const since = new Date(Date.now() - windowMinutes * 60 * 1000);
    const now = new Date();
    const [rows, activeSessions, activeBatches, activeLeases] = await Promise.all([
      prisma.llm_execution_attempts.findMany({
        where: { startedAt: { gte: since } },
        select: { startedAt: true, success: true, errorCategory: true },
      }),
      prisma.virtual_sessions.count({
        where: {
          status: 'running',
          updatedAt: { gte: new Date(now.getTime() - ACTIVE_SESSION_STALE_MINUTES * 60_000) },
        },
      }),
      prisma.virtual_batch_jobs.count({ where: { status: { in: ['running', 'pending'] } } }),
      prisma.virtual_experiment_leases.count({ where: { expiresAt: { gt: now } } }),
    ]);
    const report = applyThroughputActivity(
      summarizeThroughput(rows, { windowMinutes, minRpm }),
      { activeSessions, activeBatches, activeLeases },
    );
    res.json({ success: true, data: report });
  } catch (error: any) {
    res.status(500).json({ success: false, error: { message: error?.message || '吞吐审计失败' } });
  }
});

router.get('/insight-reliability', async (req, res) => {
  try {
    const userId = String(req.query.userId || '');
    if (!userId) {
      return res.status(400).json({ success: false, error: { message: '缺少 userId' } });
    }
    const pathId = typeof req.query.pathId === 'string' && req.query.pathId ? req.query.pathId : null;
    const reliability = await insightCalibrationService.getReliability(userId, pathId);
    res.json({ success: true, data: reliability });
  } catch (error: any) {
    res.status(500).json({ success: false, error: { message: error?.message || '读取洞察可靠性失败' } });
  }
});

export default router;
