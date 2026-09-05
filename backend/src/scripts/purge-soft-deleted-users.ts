/**
 * 硬清理脚本（用户软删除 Phase 2）：物理删除已软删用户及其关联数据。
 *
 * 软删除只做标记（deletedAt/deletedBy），历史数据长期保留；本脚本用于
 * 满足合规/存储清理需求时的彻底清除。流程：
 *   ① 查目标软删用户（deletedAt 非空，按 --before / --ids 过滤）
 *   ② 清 9 张无 FK 表（memory_traces / learner_evidence / learner_projections /
 *      virtual_quick_learn_runs / goal_scheduling_ledger / agent_call_logs /
 *      prompt_call_logs / llm_execution_attempts / domain_event_outbox 的
 *      userId 匹配行）——这些表没有外键，users 级联不会波及
 *   ③ prisma.users.deleteMany（触发其余带 FK 表的级联删除）
 *   ④ 输出每用户每表统计
 *
 * 虚拟学习者保护：虚拟学习者账号由「虚拟学习者管理」模块维护（Phase 1 起保持
 * 物理删除口径），若目标中含虚拟学习者底层账号则跳过并告警，绝不在此清除。
 *
 * 用法：
 *   npx ts-node --transpile-only src/scripts/purge-soft-deleted-users.ts --dry-run   # 只统计（推荐先跑）
 *   npx ts-node --transpile-only src/scripts/purge-soft-deleted-users.ts --before=2026-01-01T00:00:00Z
 *   npx ts-node --transpile-only src/scripts/purge-soft-deleted-users.ts --ids=u1,u2,u3
 * 参数：
 *   --before=<ISO 日期>  只清 deletedAt < 该时间的用户（默认全部）
 *   --ids=a,b,c          只清指定用户 id（逗号分隔，与 --before 同时生效时取交集）
 *   --dry-run            只统计不删除（默认不传即实际删除，请先 dry-run 确认）
 * 注意：实际删除须在服务停机时执行（避免运行期窗口故障）。
 */
import 'dotenv/config';
import prisma from '../config/database';

/** 9 张无 FK 表：无外键约束，users 级联删除不会波及，必须先手动清 userId 行 */
const FK_LESS_TABLES = [
  'memory_traces',
  'learner_evidence',
  'learner_projections',
  'virtual_quick_learn_runs',
  'goal_scheduling_ledger',
  'agent_call_logs',
  'prompt_call_logs',
  'llm_execution_attempts',
  'domain_event_outbox'
] as const;

type FkLessTable = (typeof FK_LESS_TABLES)[number];

export interface PurgeArgs {
  /** 只清 deletedAt < before 的用户；undefined = 全部 */
  before?: Date;
  /** 只清指定用户 id（空 = 全部） */
  ids: string[];
  /** 只统计不删除 */
  dryRun: boolean;
}

export function parsePurgeArgs(argv: string[]): PurgeArgs {
  const args: PurgeArgs = { ids: [], dryRun: false };

  for (const arg of argv) {
    if (arg === '--dry-run') {
      args.dryRun = true;
    } else if (arg.startsWith('--before=')) {
      const raw = arg.slice('--before='.length);
      if (!raw) throw new Error('--before 需要 ISO 日期值，例如 --before=2026-01-01T00:00:00Z');
      const parsed = new Date(raw);
      if (Number.isNaN(parsed.getTime())) {
        throw new Error(`--before 不是合法日期：${raw}（需 ISO 格式）`);
      }
      args.before = parsed;
    } else if (arg.startsWith('--ids=')) {
      const raw = arg.slice('--ids='.length).trim();
      args.ids = raw ? raw.split(',').map((id) => id.trim()).filter(Boolean) : [];
    } else {
      throw new Error(`未知参数：${arg}`);
    }
  }

  return args;
}

async function main(): Promise<void> {
  const { before, ids, dryRun } = parsePurgeArgs(process.argv.slice(2));

  const where: any = { deletedAt: { not: null } };
  if (before) where.deletedAt = { lt: before };
  if (ids.length > 0) where.id = { in: ids };

  // ① 查目标软删用户
  const targets = await prisma.users.findMany({
    where,
    select: { id: true, email: true, name: true, deletedAt: true, deletedBy: true },
    orderBy: { deletedAt: 'desc' }
  });

  if (targets.length === 0) {
    console.log('[purge] 无匹配的已软删用户（已清理或过滤条件无命中）');
    return;
  }

  // 虚拟学习者保护：跳过并告警，绝不物理清除（虚拟学习者保持物理删除口径，不应出现在软删列表中）
  const virtualProfiles = await prisma.virtual_learner_profiles.findMany({
    where: { userId: { in: targets.map((t) => t.id) } },
    select: { userId: true }
  });
  const virtualIds = new Set(virtualProfiles.map((p) => p.userId));
  const purgeTargets = targets.filter((t) => !virtualIds.has(t.id));
  if (virtualIds.size > 0) {
    console.warn(`[purge] 跳过 ${virtualIds.size} 个虚拟学习者底层账号（由虚拟学习者管理模块维护，不在本脚本清理范围）：${[...virtualIds].join(', ')}`);
  }
  if (purgeTargets.length === 0) {
    console.log('[purge] 目标全部为虚拟学习者账号，无可清理用户');
    return;
  }

  const userIds = purgeTargets.map((t) => t.id);

  // ② 逐表清无 FK 表：先 groupBy 取每用户计数（dry-run 与报告共用），非 dry-run 时再 deleteMany
  const perUser: Record<string, Record<string, number>> = {};
  for (const t of purgeTargets) perUser[t.id] = {};
  const tableTotals: Record<string, number> = {};
  const tableModel = prisma as unknown as Record<FkLessTable, {
    groupBy: (args: unknown) => Promise<Array<{ userId: string; _count: { _all: number } }>>;
    deleteMany: (args: unknown) => Promise<{ count: number }>;
  }>;

  for (const table of FK_LESS_TABLES) {
    const counts = await tableModel[table].groupBy({
      by: ['userId'],
      where: { userId: { in: userIds } },
      _count: { _all: true }
    });
    const tableTotal = counts.reduce((sum, row) => sum + row._count._all, 0);
    tableTotals[table] = tableTotal;
    for (const row of counts) {
      perUser[row.userId][table] = row._count._all;
    }
    if (!dryRun && tableTotal > 0) {
      const deleted = await tableModel[table].deleteMany({ where: { userId: { in: userIds } } });
      if (deleted.count !== tableTotal) {
        console.warn(`[purge] ${table}：预估 ${tableTotal} 行，实际删除 ${deleted.count} 行（并发变化）`);
        tableTotals[table] = deleted.count;
      }
    }
  }

  // ③ 物理删除 users（触发 FK 级联：路径/会话/成就等带外键的子表）
  if (!dryRun) {
    const result = await prisma.users.deleteMany({
      where: { id: { in: userIds }, deletedAt: { not: null } }
    });
    if (result.count !== purgeTargets.length) {
      console.warn(`[purge] users：预估 ${purgeTargets.length} 个，实际删除 ${result.count} 个（并发变化）`);
    }
  }

  // ④ 输出统计
  console.log(
    `[purge] mode=${dryRun ? 'dry-run' : 'apply'}${dryRun ? '（只统计未删除；去掉 --dry-run 执行清除）' : ''}` +
    ` targets=${purgeTargets.length}${before ? ` before=${before.toISOString()}` : ''}${ids.length > 0 ? ` ids=${ids.join(',')}` : ''}`
  );
  console.log('[purge] 按表合计：');
  console.log(JSON.stringify(tableTotals, null, 2));
  console.log('[purge] 按用户统计：');
  for (const t of purgeTargets) {
    const detail = Object.entries(perUser[t.id])
      .filter(([, count]) => count > 0)
      .map(([table, count]) => `${table}=${count}`)
      .join(' ');
    console.log(`  ${t.id}（${t.email || t.name}）deletedAt=${t.deletedAt.toISOString()}${t.deletedBy ? ` deletedBy=${t.deletedBy}` : ''}${detail ? ` · ${detail}` : ''}`);
  }
}

if (require.main === module) {
  main()
    .catch((error) => { console.error(error); process.exit(1); })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
