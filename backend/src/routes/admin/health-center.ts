/**
 * 健康中心（基准体系版，DRIFT_BASELINE_SURVEY.md §4/§5）
 *
 * GET  /api/admin/health-center         统一状态清单（三分语义 + 基准元数据；60s 缓存；?refresh=1 强制重算）
 * GET  /api/admin/health-center/summary 巡检聚合（G1：健康 13 项 + 漂移摘要 + 对账摘要 + 完成度分布 + 全局统计；60s 缓存）
 * POST /api/admin/health-center/fix     一键修复（body: { id }；仅 semantics='baseline-drift' 且 action='fixable'）
 *
 * 实现全部在 services/health-center.service.ts 与 services/health-center-summary.service.ts
 * （复用既有纯函数，禁止复制逻辑；两聚合端点共用同一单次扫描层）。
 */

import { Router, Request, Response } from 'express';
import systemPrisma from '../../config/system-database';
import prisma from '../../config/database';
import {
  getHealthCenterReport,
  runHealthCenterFix,
  type HealthCenterDbAdapter,
  type HealthCenterFixDeps,
} from '../../services/health-center.service';
import { getHealthCenterSummaryReport } from '../../services/health-center-summary.service';
import { compileAllCorePromptFiles } from '../../scripts/compile-core-files';
import { ensureCoreAgentPrompts } from '../../scripts/seed-core-agent-prompts';
import { syncStageFieldRoutingsFromFile } from '../../services/field-routing-bootstrap.service';
import { loadOrchestrationFiles } from '../../services/field-routing/orchestration-file';
import {
  AGENT_SNAPSHOTS_TARGET,
  generateAgentSnapshotsContent,
} from '../../scripts/generate-agent-snapshots';
import * as fs from 'fs';

const router = Router();

// 系统库三表 + 主库 prompt_call_logs（运行时 promptDrift 遥测）
const db = Object.assign(
  Object.create(systemPrisma),
  systemPrisma,
  { prompt_call_logs: prisma.prompt_call_logs },
) as unknown as HealthCenterDbAdapter;

// ============================================================
// GET /api/admin/health-center
// 统一状态清单：{ success, data: { generatedAt, summary, items[] } }
// 60s 内存缓存（服务内），?refresh=1 时总是重算（按需正确性优先）。
// ============================================================
router.get('/', async (req: Request, res: Response) => {
  try {
    const refresh = req.query.refresh === '1' || req.query.refresh === 'true';
    const report = await getHealthCenterReport(db, { skipCache: refresh });
    res.json({ success: true, data: report });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: { message: error?.message || 'health center check failed' },
    });
  }
});

// ============================================================
// GET /api/admin/health-center/summary
// 巡检聚合（G1 一页式工作台）：一次请求返回健康 13 项 + 漂移摘要 + 对账摘要 +
// 完成度分布 + 全局统计。与 /health-center 共用同一单次扫描与 60s 缓存策略。
// ============================================================
router.get('/summary', async (req: Request, res: Response) => {
  try {
    const refresh = req.query.refresh === '1' || req.query.refresh === 'true';
    const report = await getHealthCenterSummaryReport(db, { skipCache: refresh });
    res.json({ success: true, data: report });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: { message: error?.message || 'health center summary failed' },
    });
  }
});

function buildFixDeps(): HealthCenterFixDeps {
  return {
    compileAllCorePromptFiles: () => compileAllCorePromptFiles(),
    ensureCoreAgentPromptsSync: () => ensureCoreAgentPrompts(systemPrisma as any, 'sync'),
    syncAllFieldRoutings: async () => {
      const reports = [];
      for (const stage of loadOrchestrationFiles()) {
        reports.push(await syncStageFieldRoutingsFromFile(systemPrisma as any, stage));
      }
      return reports;
    },
    renderAgentSnapshots: () => generateAgentSnapshotsContent(),
    writeAgentSnapshots: async (content) => {
      await fs.promises.writeFile(AGENT_SNAPSHOTS_TARGET, content, 'utf-8');
      return AGENT_SNAPSHOTS_TARGET;
    },
  };
}

// ============================================================
// POST /api/admin/health-center/fix
// body: { id: 'w4-corehash' | 'field-routing' | 'field-routing-contract' | 'snapshots' }
// - fixable 类：备份 → 执行 → 复检 → 审计（node_config_changes, changeType='health-fix'）
// - manual/readonly 类：409 + 指引（consistency 项一律 409 + 人工指引）
// ============================================================
router.post('/fix', async (req: Request, res: Response) => {
  try {
    const id = String((req.body || {}).id || '').trim();
    if (!id) {
      return res.status(400).json({ success: false, error: { message: 'id（检查项）必填' } });
    }

    const actorId = (req as Request & { user?: { userId?: string } }).user?.userId || 'admin';
    const result = await runHealthCenterFix({ db, id, deps: buildFixDeps(), actorId });

    if (result.ok === false) {
      return res.status(result.status).json({
        success: false,
        error: { message: result.error, fixHint: result.fixHint },
      });
    }

    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: { message: error?.message || 'health fix failed' },
    });
  }
});

export default router;
