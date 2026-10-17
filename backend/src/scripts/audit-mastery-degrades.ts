/**
 * 掌握下降事件可观测指标（#48 P-22）。
 *
 * 背景：F1 修复给了「code 负证据 → mastered 降级」的分支，但活体课堂是否真的走到该分支
 * 一直不可见。只升不降若仍是常态，难度控制与完课判定的输入就不可信。
 *
 * 口径：
 * - 分子 = 最近 N 节 completed 会话的 `teachingState.masteryDegradeCount` 之和
 *   （回合引擎每轮用 KnowledgeStateService.diffMastery 统计：进度回落或 mastered 撤销）；
 * - 分母 = 同一批会话数；
 * - 指标 = 分子 / 分母 × 100 = 「每百课掌握下降事件数」；
 * - 另报「有下降的课占比」与「带该字段的课占比」——后者说明观测是何时开始生效的，
 *   覆盖率低时不要把 0 直接解读成「分支不可达」。
 *
 * 用法：npm run mastery:degrade-audit [-- --limit 500] [-- --json]
 * 退出码：0 = 正常输出（指标为 0 也是正常读数）；1 = 查询失败。
 */
import prisma from '../config/database';

function argValue(name: string, fallback: number): number {
  const index = process.argv.indexOf(`--${name}`);
  if (index < 0) return fallback;
  const value = Number(process.argv[index + 1]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

interface SessionRow {
  id: string;
  endTime: Date | null;
  teachingState: string | null;
}

function parseState(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function main() {
  const limit = argValue('limit', 500);

  const sessions = await prisma.teaching_sessions.findMany({
    where: { status: 'completed' },
    orderBy: { endTime: 'desc' },
    take: limit,
    select: { id: true, endTime: true, teachingState: true },
  }) as SessionRow[];

  if (sessions.length === 0) {
    console.log('[mastery:degrade] 窗口内没有 completed 会话，无读数');
    return;
  }

  let withField = 0;
  let sessionsWithDegrade = 0;
  let degradeEvents = 0;
  const samples: Array<{ sessionId: string; count: number; concepts: unknown }> = [];

  for (const session of sessions) {
    const state = parseState(session.teachingState);
    if (!state) continue;
    const rawCount = Number(state.masteryDegradeCount);
    if (Number.isFinite(rawCount)) withField += 1;
    const count = Number.isFinite(rawCount) && rawCount > 0 ? rawCount : 0;
    if (count > 0) {
      sessionsWithDegrade += 1;
      degradeEvents += count;
      if (samples.length < 5) {
        samples.push({ sessionId: session.id, count, concepts: state.lastMasteryDegrades ?? null });
      }
    }
  }

  const per100 = (degradeEvents / sessions.length) * 100;
  const result = {
    windowSessions: sessions.length,
    sessionsWithObservedField: withField,
    observationCoverage: Number((withField / sessions.length).toFixed(3)),
    sessionsWithDegrade,
    degradeEvents,
    degradeEventsPer100Lessons: Number(per100.toFixed(1)),
    samples,
  };

  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`[mastery:degrade] 最近 ${result.windowSessions} 节 completed 课`);
    console.log(`  每百课掌握下降事件数：${result.degradeEventsPer100Lessons}`);
    console.log(`  有下降的课：${result.sessionsWithDegrade}（${(result.sessionsWithDegrade / result.windowSessions * 100).toFixed(1)}%）`);
    console.log(`  带观测字段的课：${result.sessionsWithObservedField}（覆盖率 ${(result.observationCoverage * 100).toFixed(1)}%）`);
    if (result.observationCoverage < 0.5) {
      console.log('  ! 覆盖率不足 50%：先积累新课堂，0 读数不能直接解读为「降级分支不可达」');
    }
    if (result.samples.length > 0) {
      console.log('  样本：');
      for (const sample of result.samples) {
        console.log(`    ${sample.sessionId} ×${sample.count} ${JSON.stringify(sample.concepts)}`);
      }
    }
  }
}

main()
  .catch((error) => {
    console.error('[mastery:degrade] 查询失败', error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => undefined);
  });
