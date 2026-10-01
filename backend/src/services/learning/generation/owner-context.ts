/**
 * 后台任务的归属者 context 判定（RPM 标签链，2026-10-01）。
 *
 * 调度器/恢复循环/fire-and-forget 发起的后台任务没有请求上下文可继承
 * （runBackgroundTask 捕获为空 → 出站调用落 platform 通道）。
 * 路径归属者是虚拟学习者时补 sourceEntry:'simulation'，让这些调用
 * 计入虚拟学习者 RPM 通道（api-gateway 按 sourceEntry 选限流器）。
 */
import prisma from '../../../config/database';

export async function ownerContextOverride(userId: string | undefined | null): Promise<Record<string, unknown>> {
  if (!userId) return {};
  try {
    const u = await prisma.users.findUnique({ where: { id: userId }, select: { isVirtualLearner: true } });
    return u?.isVirtualLearner ? { sourceEntry: 'simulation' } : {};
  } catch {
    return {};
  }
}
