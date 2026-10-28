/**
 * 自动驾驶运行面 · 模拟配置与日期推进（2026-10-24 架构优化批 1：assisted-runtime.ts
 * 再拆分迁出，处理器逐字未改）。由 assisted-runtime.ts 按原顺序调用注册。
 */
import type { Router, Request } from 'express';
import { logger } from '../../utils/logger';
import { findProfileJsonById } from '../../services/virtual-lab/virtual-learner-profile.repo';
import { updateSessionStageResults } from '../../services/virtual-lab/virtual-session.repo';
import {
  simulatedDayService,
  resolveSimulationClock,
  planClockAdvance,
  explainPlanFailure,
  resolveDayWindow,
  shouldAdvanceSimulationClock,
} from '../../services/virtual-lab/simulated-day.service';
import { runWithSimulatedClock } from '../../services/virtual-lab/simulation-clock-context';
import { getVirtualLabSettings, DEFAULT_VIRTUAL_LAB_SETTINGS } from '../../services/virtual-lab-settings.service';
import { SIMULATION_FRICTION_BUDGETS, parseJson } from '../../virtual-lab/session-factory';
import type { StageResults } from '../../virtual-lab/vlab-types';
import { sendVirtualSessionError } from './virtual-session-http';
import {
  mergeSessionStageResults,
  runAssistedSessionMutation,
  runDayLearning,
} from './virtual-learners.assisted-shared';

export function registerAssistedSimulationRoutes(router: Router): void {
/**
 * 更新 session 的模拟配置 (目前主要是 frictionBudget)
 * PUT /api/admin/virtual-learners/sessions/:sessionId/simulation-config
 * body: { frictionBudget?: 'none' | 'low' | 'normal' | 'high' | 'stress_test', experimentArm?: 'A' | 'B' | null,
 *         extensionProbe?: boolean, advisoryResponse?: 'keep' | 'later' | 'preview' | 'adopt' | null }
 * experimentArm：冻结考卷双臂协议（#85）的会话级臂标签。A = 护栏前口径（关闭 #84 后续回合
 * 肯定语护栏），B/缺省 = 现行口径；null 清除标签。仅用于对照实验，不改变默认行为。
 * extensionProbe：延伸学探针（2026-10-21）——每会话一次，在正课收束时强制开一节延伸课，
 * 用于验证 #124 链路；null 关闭。advisoryResponse：收束带回重排建议时记账的处置动作（只留痕，不执行重排）。
 */
router.put('/sessions/:sessionId/simulation-config', async (req: Request, res) => {
  try {
    const { sessionId } = req.params;
    const { frictionBudget, model, simulationClock, experimentArm, extensionProbe, advisoryResponse } = req.body || {};

    if (frictionBudget && !SIMULATION_FRICTION_BUDGETS.includes(frictionBudget)) {
      return res.status(400).json({ success: false, error: 'frictionBudget 不合法' });
    }
    if (model !== undefined && model !== null && typeof model !== 'string') {
      return res.status(400).json({ success: false, error: 'model 必须是字符串' });
    }
    if (experimentArm !== undefined && experimentArm !== null
      && !['A', 'B'].includes(String(experimentArm).toUpperCase())) {
      return res.status(400).json({ success: false, error: 'experimentArm 只能是 A/B 或 null' });
    }
    if (extensionProbe !== undefined && extensionProbe !== null && typeof extensionProbe !== 'boolean') {
      return res.status(400).json({ success: false, error: 'extensionProbe 必须是布尔值' });
    }
    if (advisoryResponse !== undefined && advisoryResponse !== null
      && !['keep', 'later', 'preview', 'adopt'].includes(String(advisoryResponse))) {
      return res.status(400).json({ success: false, error: 'advisoryResponse 只能是 keep/later/preview/adopt 或 null' });
    }
    // 日期模拟时钟（配置项）：baseDate=起点（YYYY-MM-DD）、enabled=会话级开关覆盖。
    // dayIndex/history 属推进进度，由 advance-day 写，不在此接受。
    if (simulationClock !== undefined) {
      if (!simulationClock || typeof simulationClock !== 'object') {
        return res.status(400).json({ success: false, error: 'simulationClock 必须是对象' });
      }
      if (simulationClock.baseDate !== undefined && !/^\d{4}-\d{2}-\d{2}/.test(String(simulationClock.baseDate))) {
        return res.status(400).json({ success: false, error: 'simulationClock.baseDate 必须是 YYYY-MM-DD' });
      }
      if (simulationClock.enabled !== undefined && typeof simulationClock.enabled !== 'boolean') {
        return res.status(400).json({ success: false, error: 'simulationClock.enabled 必须是布尔值' });
      }
      if (simulationClock.autoAdvance !== undefined && typeof simulationClock.autoAdvance !== 'boolean') {
        return res.status(400).json({ success: false, error: 'simulationClock.autoAdvance 必须是布尔值' });
      }
    }

    const result = await runAssistedSessionMutation(sessionId, async (session, assertLeaseOwned) => {
      const stageResults = parseJson<StageResults>(session.stageResults, {});
      const nextStageResults = {
        ...stageResults,
        simulationConfig: {
          ...(stageResults.simulationConfig || {}),
          ...(frictionBudget ? { frictionBudget } : {}),
          ...(typeof model === 'string' && model.trim() ? { model: model.trim() } : {}),
          // experimentArm：null = 清除标签（JSON.stringify 时 undefined 键被丢弃）
          ...(experimentArm !== undefined
            ? {
                experimentArm: experimentArm === null
                  ? undefined
                  : String(experimentArm).trim().toUpperCase(),
              }
            : {}),
          // 延伸学探针 / 建议处置（2026-10-21）：null 清除；布尔/枚举写入
          ...(extensionProbe !== undefined
            ? { extensionProbe: extensionProbe === null ? undefined : extensionProbe }
            : {}),
          ...(advisoryResponse !== undefined
            ? { advisoryResponse: advisoryResponse === null ? undefined : String(advisoryResponse) }
            : {}),
        },
        ...(simulationClock ? {
          simulationClock: {
            ...((stageResults as any).simulationClock || {}),
            ...(simulationClock.baseDate ? { baseDate: String(simulationClock.baseDate).slice(0, 10) } : {}),
            ...(typeof simulationClock.enabled === 'boolean' ? { enabled: simulationClock.enabled } : {}),
            ...(typeof simulationClock.autoAdvance === 'boolean' ? { autoAdvance: simulationClock.autoAdvance } : {}),
          }
        } : {})
      };

      await assertLeaseOwned();
      await updateSessionStageResults(sessionId, JSON.stringify(nextStageResults));

      await assertLeaseOwned();
      return nextStageResults;
    });

    res.json({
      success: true,
      data: {
        simulationConfig: result.simulationConfig,
        simulationClock: (result as any).simulationClock ?? null,
      }
    });
  } catch (error) {
    logger.error('更新 simulation-config 失败:', error);
    sendVirtualSessionError(res, error, '更新 simulation-config 失败');
  }
});

/**
 * POST /api/admin/virtual-learners/sessions/:sessionId/simulation-clock/reset
 * 重置日期模拟进度（dayIndex=0、清空 history；可选重设 baseDate）。只对虚拟学习者。
 */
router.post('/sessions/:sessionId/simulation-clock/reset', async (req: Request, res) => {
  try {
    const { sessionId } = req.params;
    const nextBaseDate = req.body?.baseDate;
    if (nextBaseDate !== undefined && !/^\d{4}-\d{2}-\d{2}/.test(String(nextBaseDate))) {
      return res.status(400).json({ success: false, error: 'baseDate 必须是 YYYY-MM-DD' });
    }

    await runAssistedSessionMutation(sessionId, async (session, assertLeaseOwned) => {
      const stageResults = parseJson<StageResults>(session.stageResults, {});
      const prevClock = ((stageResults as any).simulationClock || {}) as Record<string, unknown>;
      const nextClock: Record<string, unknown> = {
        ...prevClock,
        dayIndex: 0,
        simulatedNow: null,
        advancedTimes: 0,
        history: [],
      };
      if (nextBaseDate) nextClock.baseDate = String(nextBaseDate).slice(0, 10);
      const nextStageResults = { ...stageResults, simulationClock: nextClock };

      await assertLeaseOwned();
      await updateSessionStageResults(sessionId, JSON.stringify(nextStageResults));
      await assertLeaseOwned();
      return nextClock;
    });

    const clock = await simulatedDayService.getSimulationClock(sessionId);
    res.json({ success: true, data: clock });
  } catch (error) {
    logger.error('重置模拟时钟失败:', error);
    sendVirtualSessionError(res, error, '重置模拟时钟失败');
  }
});

// ===== 原 virtual-learners.ts L3233–L4101 =====
/**
 * POST /api/admin/virtual-learners/sessions/:sessionId/advance-day
 * 推进日期模拟：按课表向前推进 days 个"上课日"（跳过非上课日）。
 * runTasks=true 时，在**模拟时钟上下文**内真实跑当天的学习（每天最多 lessonsPerDay 节），
 * 课堂/记忆/指标的业务时间戳落在模拟日（无上下文时等价于真墙钟 → 现网不变）。
 */
router.post('/sessions/:sessionId/advance-day', async (req: Request, res) => {
  try {
    const { sessionId } = req.params;
    const days = req.body?.days === undefined ? 1 : Number(req.body.days);
    const runTasks = req.body?.runTasks === true;
    if (!Number.isFinite(days) || days < 1 || days > 60) {
      return res.status(400).json({ success: false, error: 'days 必须是 1..60 的数字' });
    }
    // 跑课只针对"某一天"：days>1 时只会用最后一天的窗口跑课，中间模拟日被静默跳过
    // （18 号报告观察项）。显式拒绝，多天推进请用 runTasks=false（纯记账）。
    if (runTasks && days > 1) {
      return res.status(400).json({
        success: false,
        error: 'runTasks 模式一次只能推进 1 天；如需一次推进多天请用 runTasks=false（仅推进时钟）',
      });
    }

    const result = await runAssistedSessionMutation(sessionId, async (session, assertLeaseOwned) => {
      const settings = await getVirtualLabSettings().catch(() => ({ ...DEFAULT_VIRTUAL_LAB_SETTINGS }));
      const stageResults = parseJson<StageResults>(session.stageResults, {});
      const rawClock = (stageResults as any).simulationClock || {};
      const profile = await findProfileJsonById(session.virtualProfileId)
        .catch(() => null);
      const profileData = parseJson<Record<string, unknown>>(profile?.profile, {});
      const clock = resolveSimulationClock({
        stageResultsClock: rawClock,
        profileClock: (profileData as any)?.simulationClock ?? null,
        settings: settings.dateSimulation,
        sessionCreatedAt: session.createdAt,
      });
      if (!clock.enabled) {
        const err: any = new Error('日期模拟未开启，请先在「日期模拟」设置中开启');
        err.statusCode = 409;
        throw err;
      }
      const plan = planClockAdvance(clock, rawClock, days);
      if (!plan) {
        const why = explainPlanFailure(clock, days);
        const err: any = new Error(why.message);
        err.statusCode = 409;
        err.code = `SIM_DAY_${why.reason.toUpperCase()}`;
        throw err;
      }
      const lastIndex = plan.indexes[plan.indexes.length - 1];
      const dayWindow = resolveDayWindow(clock.baseDate, lastIndex, clock.timezone);
      const nextClock = { ...(rawClock || {}), enabled: true, ...plan.nextClock };
      const nextStageResults = { ...stageResults, simulationClock: nextClock };

      let learning: { started: boolean; chunks: number; error?: string } | null = null;
      if (runTasks) {
        // 模拟日窗口内跑当天学习：写入点（课堂/记忆/指标）用该 asOf，落在模拟日
        learning = await runWithSimulatedClock(dayWindow.asOf, () =>
          runDayLearning(sessionId, {
            lessonsPerDay: clock.lessonsPerDay,
            stageResults: nextStageResults as unknown as Record<string, unknown>,
            profileData: profileData as Record<string, unknown>,
          }),
        );
      }
      // 只有当天确实上了课（或纯记账 runTasks=false）才推进模拟时钟；未推进 = 该模拟日不被消耗、可重试。
      // 不再"先推进再回滚"（跑数观察 #4：回滚只回滚时钟、回滚不了当天已写入的课堂/记忆/锚点）。
      if (!shouldAdvanceSimulationClock({ runTasks, learning })) {
        return { advancedDayIndexes: [], simulatedDay: dayWindow.simulatedDay, learning, reverted: true };
      }
      await assertLeaseOwned();
      // 只有当天确实上了课（或纯记账 runTasks=false）才推进模拟时钟；原子合并，不整列覆盖。
      await mergeSessionStageResults(sessionId, { simulationClock: nextClock });
      await assertLeaseOwned();
      return { advancedDayIndexes: plan.indexes, simulatedDay: dayWindow.simulatedDay, learning };
    });

    const clock = await simulatedDayService.getSimulationClock(sessionId);
    res.json({ success: true, data: { ...result, clock } });
  } catch (error) {
    logger.error('推进日期模拟失败:', error);
    sendVirtualSessionError(res, error, '推进日期模拟失败');
  }
});
}
