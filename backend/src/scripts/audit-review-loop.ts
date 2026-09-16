/**
 * 复习闭环参数回看（只读）：每日负担上限、排队消化天数、明日预告、成功率
 *
 * 目的：把"每日负担上限 6.0 是否合适""排队会不会永远消化不完"这类**参数问题**变成可看的数，
 * 同时把"读计划**不写账本**""预算不被突破"等**不变量**钉在真实数据上。
 *
 * 用法：
 *   npx ts-node --transpile-only src/scripts/audit-review-loop.ts --limit=5
 *   npx ts-node --transpile-only src/scripts/audit-review-loop.ts --user=<ID>
 */
import 'dotenv/config';
import prisma from '../config/database';
import { buildReviewPlan } from '../services/memory/review-plan.service';
import { reviewQuotaService, DEFAULT_DAILY_LOAD_LIMIT } from '../services/memory/review-quota.service';

interface LoopAudit {
  userId: string;
  name: string;
  isVirtual: boolean;
  traces: number;
  due: number;
  budget: number;
  pickedCount: number;
  pickedLoad: number;
  backlogCount: number;
  tomorrowCount: number;
  successRate: number | null;
  relearn: number;
  dailyLimit: number;
  dailyRemaining: number;
  digestDays: number | null;
  failures: string[];
}

function parseArgs(argv: string[]): { limit: number; user: string | null } {
  const args = { limit: 5, user: null as string | null };
  for (const arg of argv) {
    if (arg.startsWith('--limit=')) args.limit = Math.max(1, Number(arg.slice(8)) || 5);
    else if (arg.startsWith('--user=')) args.user = arg.slice(7).trim() || null;
    else if (arg) throw new Error(`未知参数：${arg}`);
  }
  return args;
}

async function auditOne(userId: string, name: string, isVirtual: boolean, traces: number, failuresAll: string[]): Promise<LoopAudit> {
  const failures: string[] = [];
  const before = await reviewQuotaService.getDailyState(userId);
  const plan = await buildReviewPlan(userId);
  const after = await reviewQuotaService.getDailyState(userId);

  const pickedLoad = plan.items.reduce((sum, item) => sum + (Number(item.load) || 0), 0);
  const due = plan.backlogCount;

  // 不变量 1：读计划**不写账本**（记账只发生在开课成功后）——否则"看一眼"就会吃掉额度
  if (Math.abs((before?.usedLoad ?? 0) - (after?.usedLoad ?? 0)) > 1e-9) {
    failures.push('读计划改变了当日账本（usedLoad 变化）');
  }
  // 不变量 2：预算不被突破（唯一例外：预算再低也要接一个最急的点）
  if (plan.items.length > 1 && pickedLoad > plan.budget + 1e-9) {
    failures.push(`入选负担 ${pickedLoad} 超出预算 ${plan.budget}`);
  }
  // 不变量 3：不超出当日剩余额度（同样允许"最急的一个"例外）
  if (plan.items.length > 1 && pickedLoad > (plan.daily?.remainingLoad ?? plan.budget) + 1e-9) {
    failures.push(`入选负担 ${pickedLoad} 超出当日剩余额度 ${plan.daily?.remainingLoad}`);
  }
  // 不变量 4：同类点不重复接（族去重）
  const keys = plan.items.map((item) => item.conceptKey);
  if (new Set(keys).size !== keys.length) failures.push('入选项出现重复概念键');

  // 校准视角：按当前参数需要几天消化排队。
  // 注意要乘上"每天能上几节课"：日额度 ÷ 单点平均负担 ≈ 每天能接几个点。
  // （只按"每节入选数"算会偏悲观：一节只接 1 个，不代表一天只接 1 个。）
  const avgLoad = plan.items.length > 0 ? pickedLoad / plan.items.length : 1;
  const limit = plan.daily?.limitLoad ?? DEFAULT_DAILY_LOAD_LIMIT;
  const perDay = Math.max(1, Math.floor(limit / Math.max(0.1, avgLoad)));
  const digestDays = due > 0 ? Math.ceil(due / perDay) : 0;

  failuresAll.push(...failures.map((item) => `${userId.slice(0, 8)}: ${item}`));
  return {
    userId, name, isVirtual, traces, due,
    budget: plan.budget,
    pickedCount: plan.items.length,
    pickedLoad: Math.round(pickedLoad * 100) / 100,
    backlogCount: plan.backlogCount,
    tomorrowCount: plan.tomorrowCount,
    successRate: plan.successRate,
    relearn: plan.relearnSuggestions.length,
    dailyLimit: plan.daily?.limitLoad ?? DEFAULT_DAILY_LOAD_LIMIT,
    dailyRemaining: plan.daily?.remainingLoad ?? plan.budget,
    digestDays,
    failures,
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const targets: Array<{ userId: string; name: string; isVirtual: boolean; traces: number }> = [];

  if (args.user) {
    const user = await prisma.users.findUnique({ where: { id: args.user }, select: { id: true, name: true, isVirtualLearner: true } });
    if (!user) throw new Error(`用户不存在：${args.user}`);
    const traces = await prisma.memory_traces.count({ where: { userId: user.id } });
    targets.push({ userId: user.id, name: user.name || user.id, isVirtual: user.isVirtualLearner, traces });
  } else {
    const grouped = await prisma.memory_traces.groupBy({ by: ['userId'], _count: { _all: true } });
    const top = grouped.sort((a, b) => b._count._all - a._count._all).slice(0, args.limit);
    for (const row of top) {
      const user = await prisma.users.findUnique({ where: { id: row.userId }, select: { name: true, isVirtualLearner: true } });
      targets.push({ userId: row.userId, name: user?.name || row.userId, isVirtual: user?.isVirtualLearner === true, traces: row._count._all });
    }
  }

  const failures: string[] = [];
  const audits: LoopAudit[] = [];
  for (const target of targets) {
    audits.push(await auditOne(target.userId, target.name, target.isVirtual, target.traces, failures));
  }

  console.log(`[audit] 每日负担上限 = ${DEFAULT_DAILY_LOAD_LIMIT}（env 可覆盖，读取时为 ${audits[0]?.dailyLimit ?? '-'}）`);
  console.log('[audit] 学习者｜痕迹｜到期(排队)｜预算｜入选(负担)｜当日剩余｜明日预告｜成功率｜按当前参数需几天消化');
  for (const audit of audits) {
    console.log(`  ${audit.name.slice(0, 14).padEnd(16)}｜${String(audit.traces).padStart(4)}｜`
      + `${String(audit.due).padStart(4)}｜${String(audit.budget).padStart(4)}｜`
      + `${String(audit.pickedCount).padStart(2)}(${String(audit.pickedLoad).padStart(4)})｜`
      + `${String(audit.dailyRemaining).padStart(4)}｜${String(audit.tomorrowCount).padStart(4)}｜`
      + `${audit.successRate == null ? '  -' : audit.successRate.toFixed(2)}｜${audit.digestDays}`
      + `${audit.relearn > 0 ? `  ⚠需回路径重学 ${audit.relearn}` : ''}`);
  }

  console.log(`\n[audit] 不变量检查：${failures.length === 0 ? '全部通过' : `${failures.length} 项失败`}`);
  for (const failure of failures) console.log(`  FAIL ${failure}`);
  if (failures.length > 0) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
