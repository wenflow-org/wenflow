/**
 * 实例级「当前模拟钟时刻」解析（服务层公共 helper，夜间审计 M-15）
 *
 * 背景：模拟钟 AsyncLocalStorage（simulation-clock-context）此前只绑在两个 HTTP 入口
 * ——assisted-shared 的 runAssistedSessionMutationWithSimClock 与 advance-day 的 runTasks
 * 分支——后台执行链（autopilot 执行主体、outbox 消费者）里的写入点 simulatedNowOr()
 * 恒回落真实墙钟，同一张 memory_traces 出现双钟口径（M-15）。
 *
 * 这里把「会话级 clock > 画像级 clock > 全局 settings」的解析链（与
 * virtual-learners.assisted-shared / routes/admin/virtual-learners.projections 的同式实现
 * 同口径）下沉为服务层 helper，供后台执行入口绑钟。路由层文件不得反向 import
 * （layering 规则 A），故 projections 的同式实现保持独立、未做合并。
 *
 * 行为零变化承诺：未启用日期模拟（settings 默认 enabled=false）、未启用来源缺位或解析
 * 失败一律返回 null——调用方不建模拟钟上下文、维持真实墙钟。
 */
import prisma from '../../config/database';
import { logger } from '../../utils/logger';
import { safeJsonParse } from '../../utils/safe-json';
import { resolveSimulationClock } from './simulated-day.service';
import { findLatestSessionForProfile } from './virtual-session.repo';
import { getVirtualLabSettings, DEFAULT_VIRTUAL_LAB_SETTINGS } from '../virtual-lab-settings.service';

async function resolveSimulatedNowFromParts(parts: {
  stageResultsClock: unknown;
  profileClock: unknown;
  sessionCreatedAt: Date;
}): Promise<Date | null> {
  const settings = await getVirtualLabSettings().catch(() => ({ ...DEFAULT_VIRTUAL_LAB_SETTINGS }));
  const clock = resolveSimulationClock({
    stageResultsClock: (parts.stageResultsClock ?? null) as Parameters<typeof resolveSimulationClock>[0]['stageResultsClock'],
    profileClock: (parts.profileClock ?? null) as Parameters<typeof resolveSimulationClock>[0]['profileClock'],
    settings: settings.dateSimulation,
    sessionCreatedAt: parts.sessionCreatedAt,
  });
  if (!clock.enabled) return null;
  const asOf = new Date(clock.simulatedNow);
  return Number.isNaN(asOf.getTime()) ? null : asOf;
}

/**
 * 会话执行入口用（如 autopilot execute）：从虚拟会话行（+可选画像行）解析该会话当前
 * 模拟时刻。会话行自身就是时钟锚点，比按画像回查最近会话更准。
 */
export async function resolveSessionSimulatedNow(
  session: { stageResults: string | null; createdAt: Date },
  profile?: { profile: string | null } | null,
): Promise<Date | null> {
  try {
    const stageResults = safeJsonParse<Record<string, unknown>>(session.stageResults ?? null, {});
    const profileData = profile
      ? safeJsonParse<Record<string, unknown>>(profile.profile ?? null, {})
      : {};
    return await resolveSimulatedNowFromParts({
      stageResultsClock: stageResults?.simulationClock ?? null,
      profileClock: profileData?.simulationClock ?? null,
      sessionCreatedAt: session.createdAt,
    });
  } catch (error) {
    logger.warn('[simulation-clock] 会话模拟钟解析失败（回退真实墙钟）', {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * 后台消费者用（如 review:completed 消费者）：按 VL 实例（userId）当前模拟时刻解析。
 * 与 routes/admin/virtual-learners.projections.ts resolveInstanceSimulatedNow 同链路：
 * 画像级最近一条会话作会话级时钟锚点（会话级 clock > 画像级 > 全局 settings）。
 * 非 VL 用户 / 未启用日期模拟 / 解析失败 → null（调用方维持真实墙钟，行为零变化）。
 */
export async function resolveUserSimulatedNow(userId: string): Promise<Date | null> {
  try {
    const profile = await prisma.virtual_learner_profiles.findUnique({
      where: { userId },
      select: { id: true, profile: true, createdAt: true },
    });
    if (!profile) return null;
    const latest = await findLatestSessionForProfile(profile.id).catch(() => null);
    const stageResults = safeJsonParse<Record<string, unknown>>(latest?.stageResults ?? null, {});
    const profileData = safeJsonParse<Record<string, unknown>>(profile.profile ?? null, {});
    return await resolveSimulatedNowFromParts({
      stageResultsClock: stageResults?.simulationClock ?? null,
      profileClock: profileData?.simulationClock ?? null,
      sessionCreatedAt: latest?.createdAt ?? profile.createdAt,
    });
  } catch (error) {
    logger.warn('[simulation-clock] 实例模拟钟解析失败（回退真实墙钟）', {
      userId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}
