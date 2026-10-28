/**
 * 自动驾驶运行面：租约 / 黑盒 / 模拟钟 helper + step、auto、blackbox、autopilot、路径与教学驱动、日期推进、回归与批量
 *
 * 由 routes/admin/virtual-learners.ts 于 2026-10-19（issue #76）按声明簇纯搬移拆出；
 * 2026-10-24 架构优化批 1 再按处理器簇第二次拆分（共享 helper + 七个注册模块）：
 * - virtual-learners.assisted-shared.ts      租约/模拟钟/终止/原子合并/当天学习 helper
 * - virtual-learners.assisted-blackbox.ts    黑盒实验 / autopilot / 僵尸回收 / 批量终止
 * - virtual-learners.assisted-path.ts        Path 评审 / path-status / 生成重试
 * - virtual-learners.assisted-teaching.ts    开课 / 教学步 / 自动学习 / 全流程 / wrapup / 暂停恢复 hold
 * - virtual-learners.assisted-simulation.ts  模拟配置 / 时钟重置 / advance-day
 * - virtual-learners.assisted-ops.ts         日志 / 级联删除 / 回归 / 批量 / 卡库
 * 契约不变：路由路径、注册顺序、中间件与处理器代码逐字未改；本文件只导出注册函数，
 * 由 virtual-learners.ts 在**同一个** router 实例上按原顺序调用（Express 顺序匹配语义与拆分前一致）。
 */

import type { Router } from 'express';
import simulationCoordinator from '../../coordinators/simulation.coordinator';
import { logger } from '../../utils/logger';
import { sendVirtualSessionError } from './virtual-session-http';
import {
  parseSimulationLimit,
  runAssistedSessionMutationWithSimClock,
} from './virtual-learners.assisted-shared';
import { registerAssistedBlackboxRoutes } from './virtual-learners.assisted-blackbox';
import { registerAssistedPathRoutes } from './virtual-learners.assisted-path';
import { registerAssistedTeachingRoutes } from './virtual-learners.assisted-teaching';
import { registerAssistedSimulationRoutes } from './virtual-learners.assisted-simulation';
import { registerAssistedOpsRoutes } from './virtual-learners.assisted-ops';

export function registerAssistedRuntimeRoutes(router: Router): void {
// ===== 基础驾驶（step / auto / advance-path） =====
/**
 * 获取模拟会话上下文
 * GET /api/admin/virtual-learners/sessions/:sessionId/context 已删
 * （SessionCockpit 用 session 详情 + logs + path-status + teaching-detail 四请求替代）
 */

/**
 * 单步模拟（手动模式）
 * POST /api/admin/virtual-sessions/:sessionId/step
 */
router.post('/sessions/:sessionId/step', async (req: import('express').Request, res) => {
  try {
    const { sessionId } = req.params;
    const result = await runAssistedSessionMutationWithSimClock(sessionId, session =>
      simulationCoordinator.executeSingleStep({
        sessionId,
        userId: session.userId,
        mode: 'single-step'
      })
    );

    res.json({
      success: result.success,
      data: result,
      error: result.error
    });
  } catch (error) {
    logger.error('单步模拟失败:', error);
    sendVirtualSessionError(res, error, '单步模拟失败');
  }
});

/**
 * 自动循环模拟
 * POST /api/admin/virtual-sessions/:sessionId/auto
 */
router.post('/sessions/:sessionId/auto', async (req: import('express').Request, res) => {
  try {
    const { sessionId } = req.params;
    const maxRounds = parseSimulationLimit(req.body?.maxRounds, 20, 50, 'maxRounds');

    const results = await runAssistedSessionMutationWithSimClock(sessionId, session =>
      simulationCoordinator.executeAutoLoop(
        {
          sessionId,
          userId: session.userId,
          mode: 'auto-loop'
        },
        { maxRounds }
      )
    );

    res.json({
      success: true,
      data: {
        results,
        totalRounds: results.length,
        lastResult: results[results.length - 1]
      }
    });
  } catch (error) {
    logger.error('自动循环模拟失败:', error);
    sendVirtualSessionError(res, error, '自动循环模拟失败');
  }
});

/**
 * 兜底重试：推进到路径生成阶段
 * 仅在 goalConversationService 自动触发的 path 生成失败时由前端调用
 * POST /api/admin/virtual-sessions/:sessionId/advance-path
 */
router.post('/sessions/:sessionId/advance-path', async (req: import('express').Request, res) => {
  try {
    const { sessionId } = req.params;
    const result = await runAssistedSessionMutationWithSimClock(sessionId, () =>
      simulationCoordinator.advanceToPathGeneration(sessionId)
    );

    res.json({
      success: result.success,
      data: result,
      error: result.error
    });
  } catch (error) {
    logger.error('推进路径生成失败:', error);
    sendVirtualSessionError(res, error, '推进路径生成失败');
  }
});

// ===== 黑盒 / autopilot / 回收 / 批量终止 =====
registerAssistedBlackboxRoutes(router);

// ===== Path 评审 / 状态 / 重试 =====
registerAssistedPathRoutes(router);

// ===== 教学驱动与生命周期控制 =====
registerAssistedTeachingRoutes(router);

// ===== 模拟配置 / 时钟 / advance-day =====
registerAssistedSimulationRoutes(router);

// ===== 日志 / 删除 / 回归 / 批量 / 卡库 =====
registerAssistedOpsRoutes(router);
}
