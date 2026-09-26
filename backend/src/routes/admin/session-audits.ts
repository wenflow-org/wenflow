/**
 * 会话评审（裁判）独立面 — 2026-09-27 拍板
 *
 * 裁判（referee 终局评审 + actor-auditor 角色保真审计）从虚拟学习者路由迁出，独立成自己的
 * 挂载面：管理台 VL 页面不再暴露任何评审入口/徽章，仿真核（assisted/blackbox/autopilot/
 * batch/quick-learn）不调用本模块；能否以何种形态合回（独立模型路由？评审真实会话？）
 * 以后再议。评估对象仍是 VL 会话的公开轨迹，报告仍落在 virtual_sessions 的 blackbox JSON
 * （refereeReports / actorAuditReports），数据模型不动——合回时无需迁移。
 *
 * 与原 POST /api/admin/virtual-learners/sessions/:id/blackbox-evaluations 等价（同一 runner
 * 方法、同一租约），仅路径与归属面不同。
 */

import { Router, Request, Response } from 'express';
import { logger } from '../../utils/logger';
import blackboxVirtualLearnerRunner from '../../virtual-lab/blackbox-runner';
import { sendVirtualSessionError } from './virtual-session-http';

const router = Router();

// POST /api/admin/session-audits/sessions/:sessionId/evaluations
// 双评估：platform=referee 终局评审（verdict 平台重算派生）+ actor=角色保真审计（含摩擦校准反馈）。
// 报告按 inputFingerprint 幂等复用，最多保留最近 10 份。
router.post('/sessions/:sessionId/evaluations', async (req: Request, res: Response) => {
  try {
    const result = await blackboxVirtualLearnerRunner.runLeasedExclusive(
      req.params.sessionId,
      async () => ({
        platform: await blackboxVirtualLearnerRunner.referee(req.params.sessionId, req.user.userId),
        actor: await blackboxVirtualLearnerRunner.actorAudit(req.params.sessionId, req.user.userId)
      })
    );
    res.json({ success: true, data: result });
  } catch (error) {
    logger.error('生成黑盒双评估报告失败:', error);
    sendVirtualSessionError(res, error, '生成黑盒双评估报告失败', 502);
  }
});

export default router;
