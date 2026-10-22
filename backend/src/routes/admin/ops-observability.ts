/**
 * 运营可观测读侧（2026-10-21）：把两个原本只在 CLI/日志里的指标接到管理端。
 *
 * - GET /api/admin/ops/throughput?window=60&minRpm=20
 *   批量吞吐 rpm 与「连续低于下限」告警（口径与 scripts/audit-batch-throughput.ts 同一纯函数）。
 * - GET /api/admin/ops/insight-reliability?userId=...&pathId=...
 *   建议归因/状态评审的可证伪断言命中率（insight-calibration 单源，n<5 时 hitRate=null）。
 */
import express from 'express';
import { summarizeThroughput, applyThroughputActivity, BATCH_HEARTBEAT_STALE_MINUTES } from '../../services/ops/throughput';
import {
  loadThroughputSnapshot,
  markBatchHeartbeat,
  stopBatchHeartbeat,
} from '../../services/ops/ops-observability.repo';
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
    const [rows, activeSessions, activeBatches, activeLeases] = await loadThroughputSnapshot(since, now);
    const report = applyThroughputActivity(
      summarizeThroughput(rows, { windowMinutes, minRpm }),
      { activeSessions, activeBatches, activeLeases },
    );
    res.json({ success: true, data: report });
  } catch (error: any) {
    res.status(500).json({ success: false, error: { message: error?.message || '吞吐审计失败' } });
  }
});

/* 跑批心跳：脚本在跑批期间每 30s 调用一次；没有心跳的 running 批次不再算活动信号。
   real-account learn-drive 等不创建 virtual_sessions 的批次也靠这条进入吞吐监控。 */
router.post('/batch-heartbeat', async (req, res) => {
  try {
    const runId = String(req.body?.runId || '').trim();
    if (!runId || runId.length > 120) {
      return res.status(400).json({ success: false, error: { message: 'runId 必填且不超过 120 字符' } });
    }
    const id = `hb:${runId}`;
    await markBatchHeartbeat(id);
    res.json({
      success: true,
      data: { id, runId, staleAfterMinutes: BATCH_HEARTBEAT_STALE_MINUTES },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: { message: error?.message || '心跳写入失败' } });
  }
});

router.post('/batch-heartbeat/stop', async (req, res) => {
  try {
    const runId = String(req.body?.runId || '').trim();
    if (!runId || runId.length > 120) {
      return res.status(400).json({ success: false, error: { message: 'runId 必填且不超过 120 字符' } });
    }
    const stopped = await stopBatchHeartbeat(`hb:${runId}`);
    res.json({ success: true, data: { runId, stopped } });
  } catch (error: any) {
    res.status(500).json({ success: false, error: { message: error?.message || '心跳停止失败' } });
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
