/**
 * 虚拟学习者 · 日期模拟「自动推进」调度
 *
 * 与 `simulated-day.service` 分离：后者被 `simulation.coordinator` 引用，若此处直接 import
 * coordinator 会形成循环依赖。本模块只被 `index.ts`（启动）与测试引用。
 *
 * 关键（P0 修复）：每个会话的推进都在**会话租约**内进行（`runLeasedExclusive`），
 * 与座舱 / autopilot 的 stageResults 写入互斥，消除并发覆盖。
 * 仅做时钟簿记；"当天任务重放"由手动 `advance-day runTasks` 触发（避免无监督的 LLM 成本）。
 */
import prisma from '../../config/database';
import { logger } from '../../utils/logger';
import { safeJsonParse } from '../../utils/safe-json';
import simulationCoordinator from '../../coordinators/simulation.coordinator';
import { getVirtualLabSettings, DEFAULT_VIRTUAL_LAB_SETTINGS } from '../virtual-lab-settings.service';
import { resolveSimulationClock, planClockAdvance } from './simulated-day.service';

/** 在会话租约内推进单个会话 1 个上课日；返回是否推进成功。 */
async function advanceOne(sessionId: string, now: Date): Promise<boolean> {
  return simulationCoordinator.runLeasedExclusive(sessionId, async () => {
    const session = await prisma.virtual_sessions.findUnique({
      where: { id: sessionId },
      select: { id: true, status: true, stageResults: true, createdAt: true, virtualProfileId: true },
    });
    if (!session || !['running', 'created'].includes(session.status)) return false;
    const stageResults = safeJsonParse<Record<string, any>>(session.stageResults, {});
    const rawClock = stageResults?.simulationClock;
    if (rawClock?.enabled !== true || rawClock?.autoAdvance !== true) return false;

    const settings = await getVirtualLabSettings().catch(() => ({ ...DEFAULT_VIRTUAL_LAB_SETTINGS }));
    const profile = await prisma.virtual_learner_profiles
      .findUnique({ where: { id: session.virtualProfileId }, select: { profile: true } })
      .catch(() => null);
    const profileData = safeJsonParse<Record<string, any>>(profile?.profile, {});
    const clock = resolveSimulationClock({
      stageResultsClock: rawClock,
      profileClock: profileData?.simulationClock ?? null,
      settings: settings.dateSimulation,
      sessionCreatedAt: session.createdAt,
    });
    const plan = planClockAdvance(clock, rawClock, 1, now);
    if (!plan) return false;

    await prisma.virtual_sessions.update({
      where: { id: session.id },
      data: {
        stageResults: JSON.stringify({ ...stageResults, simulationClock: { ...rawClock, ...plan.nextClock } }),
        updatedAt: new Date(),
      },
    });
    return true;
  });
}

/** 自动推进（一次性扫描）：对开启日期模拟且 `autoAdvance=true` 的非终态会话，各推进 1 个上课日。 */
export async function advanceAutoSessionsOnce(now: Date = new Date()): Promise<{ scanned: number; advanced: string[] }> {
  const settings = await getVirtualLabSettings().catch(() => ({ ...DEFAULT_VIRTUAL_LAB_SETTINGS }));
  if (!settings.dateSimulation.enabled || !settings.dateSimulation.autoAdvanceEnabled) {
    return { scanned: 0, advanced: [] };
  }
  const sessions = await prisma.virtual_sessions.findMany({
    where: { status: { in: ['running', 'created'] } },
    orderBy: { updatedAt: 'desc' },
    take: 50,
    select: { id: true },
  });
  const advanced: string[] = [];
  for (const session of sessions) {
    try {
      if (await advanceOne(session.id, now)) advanced.push(session.id);
    } catch (error) {
      // 租约被占用等：跳过本会话，下次 tick 再试（不阻断其它会话）
      logger.warn('[simulated-day] 自动推进单个会话失败（跳过）', {
        sessionId: session.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return { scanned: sessions.length, advanced };
}

let simDaySchedulerStarted = false;

/** 注册自动推进调度（默认 5min 一次；env `VLAB_DAY_ADVANCE_TICK_MS`，最小 10s）。默认关。 */
export function startSimulatedDayScheduler(): void {
  if (simDaySchedulerStarted) return;
  simDaySchedulerStarted = true;
  const raw = Number(process.env.VLAB_DAY_ADVANCE_TICK_MS);
  const tickMs = Number.isFinite(raw) && raw >= 10_000 ? raw : 300_000;
  setInterval(() => {
    advanceAutoSessionsOnce().catch((error) => {
      logger.warn('[simulated-day] 自动推进失败', { error: error instanceof Error ? error.message : String(error) });
    });
  }, tickMs);
  logger.info('[simulated-day] 自动推进调度已启动', { tickMs });
}
