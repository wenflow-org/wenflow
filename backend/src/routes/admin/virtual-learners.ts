/**
 * Admin Virtual Learners API
 * 
 * 虚拟用户模拟管理接口
 *
 * 2026-10-19（issue #76）：原 4102 行单文件按声明簇纯搬移拆为四个同目录子模块，
 * 本文件只保留入口装配（同一 router 实例 + sessionId param 注入 + 按原顺序注册各簇）：
 *   - virtual-learners.projections.ts       读侧投影（记忆 / 故事 / 授课详情）与投影构造 helper
 *   - virtual-learners.story-drafts.ts      人设与故事草稿（候选池常量 / 故事提示 helper / 故事池增删改）
 *   - virtual-learners.session-lifecycle.ts 学习者与会话生命周期（CRUD / 统计 / 设置 / 会话详情与投影 token）
 *   - virtual-learners.assisted-runtime.ts  自动驾驶运行面（step/auto/blackbox/autopilot/路径与教学驱动/日期推进/回归与批量）
 * 注册顺序 = 原文件声明顺序，不得调整（Express 顺序匹配：静态段必须先于 /:id 类参数段）。
 */

import express from 'express';
import { setRequestContext, getRequestContext } from '../../gateway/api-gateway/context';
import { registerProjectionRoutes } from './virtual-learners.projections';
import { registerStoryDraftRoutes } from './virtual-learners.story-drafts';
import { registerSessionLifecycleRoutes } from './virtual-learners.session-lifecycle';
import { registerAssistedRuntimeRoutes } from './virtual-learners.assisted-runtime';

export {
  DEFAULT_SCENARIO_CANDIDATE_DOMAINS,
  DEFAULT_SCENARIO_CANDIDATE_PERSONAS,
} from './virtual-learners.story-drafts';

const router = express.Router();

/** 模拟会话操作统一注入 sessionId：执行日志/瀑布可按模拟会话归组追溯。
 *  sourceEntry 用 'simulation'（非 'platform'）：出站 LLM 调用由此计入虚拟学习者专属 RPM 通道
 *  （api-gateway 按 sourceEntry==='simulation' 选 virtualLearnerRpmLimiter），与真实用户流量分流。 */
router.param('sessionId', (req, _res, next, sessionId) => {
  setRequestContext({ ...getRequestContext(), sessionId, sourceEntry: 'simulation' });
  next();
});

registerProjectionRoutes(router);
registerStoryDraftRoutes(router);
registerSessionLifecycleRoutes(router);
registerAssistedRuntimeRoutes(router);

export default router;
