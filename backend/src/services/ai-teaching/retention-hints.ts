/**
 * FSRS 保持率提示（记忆层出口）。
 *
 * 2026-11-21 从 teaching-session-lifecycle 抽出为独立模块：开课/wrapup（原有读方）与
 * TeachingContextBuilder（2026-11-21 起预测器硬证据注入的新读方）都要用；
 * 直接放 lifecycle 会与 TeachingContextBuilder 形成 import 环（lifecycle ↔ context builder）。
 */
import prisma from '../../config/database';
import { fsrsRetrievability, type FsrsMemoryState } from '../memory/fsrs';
import { simulatedNowOr } from '../virtual-lab/simulation-clock-context';

export async function loadRetrievabilityHints(userId: string): Promise<Array<{ concept: string; retrievability: number }>> {
  try {
    const traces = await prisma.memory_traces.findMany({
      where: { userId, fsrsStability: { not: null }, lastSeenAt: { not: null } },
      orderBy: { dueAt: 'asc' },
      take: 20,
      select: {
        label: true,
        conceptKey: true,
        fsrsStability: true,
        fsrsDifficulty: true,
        fsrsLapses: true,
        fsrsReps: true,
        extractionCount: true,
        lastSeenAt: true,
      },
    });
    // 模拟钟单点（#68 P-43）：开课时的保持率提示必须与复习计划/到期判定同一时间基准
    const now = simulatedNowOr();
    return traces
      .map((t) => {
        const state: FsrsMemoryState = {
          stability: t.fsrsStability as number,
          difficulty: t.fsrsDifficulty ?? 5,
          reps: t.fsrsReps ?? t.extractionCount,
          lapses: t.fsrsLapses ?? 0,
          lastReviewAt: t.lastSeenAt as Date,
        };
        return {
          concept: t.label || t.conceptKey,
          retrievability: Math.round(fsrsRetrievability(state, now) * 100) / 100,
        };
      })
      .filter((h) => h.retrievability < 0.8)
      .slice(0, 5);
  } catch {
    return [];
  }
}
