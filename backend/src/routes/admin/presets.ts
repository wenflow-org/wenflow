/**
 * Admin 平台预置（内置 preset）端点（#91 / P-67「管理台一键加载」）
 *
 * - `GET  /api/admin/presets`：只读总览——presets.yaml 逐条定义 + 对齐到的实例状态
 *   （未加载 / 同版 / 待升级 / 定义回退 / 同版哈希漂移）与汇总计数。
 * - `POST /api/admin/presets`：一键加载（幂等同步定义 → 实例；语义 = seeder 的
 *   `runBuiltinVirtualLearnersSeed`，保留运行时产物、绝不删实例），返回同步结果 + 新快照。
 *
 * 为什么单独一个路由文件而没挂进 `admin/virtual-learners.ts`：
 * 该文件正在被并发拆分（纯搬移），本端点属独立域（预置定义同步），
 * 装配点统一留在 `bootstrap/routers.ts`（`/api/admin/presets`）。
 *
 * 分层：本文件不得 import 数据库客户端（`scripts/check-route-db-boundary.mjs` 棘轮），
 * 取数一律走 `services/virtual-lab/builtin-preset-load.service`。
 */
import { Router, type Request, type Response } from 'express';
import {
  getBuiltinPresetOverview,
  loadBuiltinVirtualLearners,
} from '../../services/virtual-lab/builtin-preset-load.service';
import { logger } from '../../utils/logger';

const router = Router();

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

router.get('/', async (_req: Request, res: Response) => {
  try {
    const data = await getBuiltinPresetOverview();
    res.json({ success: true, data });
  } catch (error) {
    logger.error('[admin/presets] 预置总览读取失败', { error: errorMessage(error) });
    res.status(500).json({ success: false, error: `预置总览读取失败：${errorMessage(error)}` });
  }
});

router.post('/', async (_req: Request, res: Response) => {
  try {
    const data = await loadBuiltinVirtualLearners();
    res.json({ success: true, data });
  } catch (error) {
    logger.error('[admin/presets] 预置一键加载失败', { error: errorMessage(error) });
    res.status(500).json({ success: false, error: `预置一键加载失败：${errorMessage(error)}` });
  }
});

export default router;
