/**
 * 概念负担判定效果评估（LLM 档位 vs 旧正则版）
 *
 * 用途：量化「把单概念负担从正则改成 LLM 档位」到底改变了什么——
 * 1. 两者给同一批概念打的负担是否一致（正则误报 / 漏报各多少）；
 * 2. 对**真实决策**（温故配额选哪几个点）有没有影响：同一用户、同一时刻，跑两次
 *    `buildReviewPlan`（规则版 vs LLM 版）对比入选点与预算占用。
 *
 * 用法：
 *   npx ts-node --transpile-only src/scripts/eval-concept-load.ts --user=<userId|email>
 *   npx ts-node --transpile-only src/scripts/eval-concept-load.ts                       # 默认取痕迹最多的虚拟学习者
 *   npx ts-node --transpile-only src/scripts/eval-concept-load.ts --limit=20 --dry-run   # 只看规则版
 */
import 'dotenv/config';
import prisma from '../config/database';
import { memoryTraceService, normalizeConceptKey } from '../services/memory/memory-trace.service';
import { buildReviewPlan, estimateConceptLoad } from '../services/memory/review-plan.service';
import {
  ConceptLoadService,
  type ConceptLoadProfile,
} from '../services/memory/concept-load.service';

interface Args {
  user: string | null;
  limit: number;
  dryRun: boolean;
}

export function parseArgs(argv: string[]): Args {
  const args: Args = { user: null, limit: 20, dryRun: false };
  for (const arg of argv) {
    if (arg === '--dry-run') args.dryRun = true;
    else if (arg.startsWith('--user=')) args.user = arg.slice('--user='.length).trim() || null;
    else if (arg.startsWith('--limit=')) {
      const value = Number(arg.slice('--limit='.length));
      if (Number.isFinite(value) && value > 0) args.limit = Math.min(Math.floor(value), 60);
    } else {
      throw new Error(`未知参数：${arg}`);
    }
  }
  return args;
}

/** 找一个默认目标：痕迹最多的虚拟学习者（本仓虚拟学习者正好是数据最厚的一批） */
async function resolveDefaultUser(): Promise<{ id: string; name: string } | null> {
  const rows = await prisma.memory_traces.groupBy({
    by: ['userId'],
    _count: { _all: true },
  });
  const ranked = rows.slice().sort((a, b) => b._count._all - a._count._all).map((row) => row.userId);
  for (const userId of ranked) {
    const user = await prisma.users.findUnique({
      where: { id: userId },
      select: { id: true, name: true, isVirtualLearner: true },
    });
    if (user?.isVirtualLearner) return { id: user.id, name: user.name || user.id };
  }
  const first = ranked[0]
    ? await prisma.users.findUnique({ where: { id: ranked[0] }, select: { id: true, name: true } })
    : null;
  return first ? { id: first.id, name: first.name || first.id } : null;
}

async function resolveUser(selector: string | null): Promise<{ id: string; name: string } | null> {
  if (!selector) return resolveDefaultUser();
  const byId = await prisma.users.findUnique({
    where: { id: selector },
    select: { id: true, name: true },
  });
  if (byId) return { id: byId.id, name: byId.name || byId.id };
  const byEmail = await prisma.users.findFirst({
    where: { email: selector },
    select: { id: true, name: true },
  });
  return byEmail ? { id: byEmail.id, name: byEmail.name || byEmail.id } : null;
}

function ruleFlags(trace: { label: string | null; conceptKey: string; masteryScore: number }) {
  return estimateConceptLoad(trace.label || trace.conceptKey, { masteryScore: trace.masteryScore });
}

function llmFlags(trace: { label: string | null; conceptKey: string; masteryScore: number }, profile: ConceptLoadProfile | null) {
  return estimateConceptLoad(trace.label || trace.conceptKey, {
    masteryScore: trace.masteryScore,
    profile,
  });
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const user = await resolveUser(args.user);
  if (!user) {
    console.log('[eval-concept-load] 没找到可评估的用户');
    return;
  }

  const traces = await prisma.memory_traces.findMany({
    where: { userId: user.id, extractionCount: { gt: 0 } },
    orderBy: [{ lastSeenAt: 'desc' }],
    take: args.limit,
    select: { conceptKey: true, label: true, masteryScore: true, extractionCount: true },
  });
  if (traces.length === 0) {
    console.log(`[eval-concept-load] 用户 ${user.name} 没有可评估的活跃概念`);
    return;
  }

  console.log(`[eval-concept-load] 目标用户：${user.name}（${user.id}）｜活跃概念 ${traces.length} 个`);

  // 规则版（永远可算）
  const ruleResults = new Map(traces.map((trace) => [normalizeConceptKey(trace.conceptKey), ruleFlags(trace)]));

  if (args.dryRun) {
    for (const trace of traces) {
      const result = ruleResults.get(normalizeConceptKey(trace.conceptKey))!;
      console.log(`  规则版  load=${result.load.toFixed(2)}  ${result.factors.join(',') || '-'}  ${trace.label || trace.conceptKey}`);
    }
    return;
  }

  // LLM 版：走真实服务（含缓存）；缺档位的会真调一次 LLM
  const service = new ConceptLoadService();
  const resolved = await service.resolveProfiles(user.id, traces.map((trace) => trace.label || trace.conceptKey), { timeoutMs: 180_000 });
  const profiles = resolved.profiles;
  console.log(`[eval-concept-load] 档位来源=${resolved.source}｜新判定 ${resolved.judged} 条｜拿到档位 ${profiles.size} 条`);

  let ruleFlagged = 0;
  let llmFlagged = 0;
  let ruleOnly = 0;
  let llmOnly = 0;
  let same = 0;
  const rows: Array<{ name: string; rule: string; llm: string; verdict: string }> = [];

  for (const trace of traces) {
    const key = normalizeConceptKey(trace.label || trace.conceptKey);
    const rule = ruleResults.get(key)!;
    const profile = profiles.get(key) ?? null;
    const llm = llmFlags(trace, profile);
    const ruleIsHeavy = rule.load > 1;
    const llmIsHeavy = llm.load > 1;
    if (ruleIsHeavy) ruleFlagged += 1;
    if (llmIsHeavy) llmFlagged += 1;
    let verdict = '一致';
    if (ruleIsHeavy && !llmIsHeavy) { ruleOnly += 1; verdict = '正则误报（LLM 判轻）'; }
    else if (!ruleIsHeavy && llmIsHeavy) { llmOnly += 1; verdict = '正则漏报（LLM 判重）'; }
    else if (ruleIsHeavy && llmIsHeavy) same += 1;
    rows.push({
      name: trace.label || trace.conceptKey,
      rule: `${rule.load.toFixed(2)} ${rule.factors.join(',') || '-'}`,
      llm: profile ? `${llm.load.toFixed(2)} ${llm.factors.join(',') || '-'}` : '（无档位→规则）',
      verdict,
    });
  }

  console.log('\n概念 | 规则版 | LLM 版 | 判定');
  for (const row of rows) {
    console.log(`  ${row.name}\n    规则 ${row.rule}\n    LLM  ${row.llm}\n    → ${row.verdict}`);
  }

  console.log('\n[统计]');
  console.log(`  规则版判重 ${ruleFlagged} 条｜LLM 判重 ${llmFlagged} 条`);
  console.log(`  正则误报（规则重 / LLM 轻）${ruleOnly} 条｜正则漏报（规则轻 / LLM 重）${llmOnly} 条｜两边都判重 ${same} 条`);

  // 对真实决策的影响：同一时刻跑两次温故计划（规则版 vs LLM 版）
  const plainDeps = {
    getDueTraces: (userId: string, options: { limit: number; now: Date }) =>
      memoryTraceService.getDueTraces(userId, options) as any,
    findEvidence: (args2: Record<string, unknown>) => prisma.learner_evidence.findMany(args2 as any) as any,
    findSessions: (args2: Record<string, unknown>) => prisma.teaching_sessions.findMany(args2 as any) as any,
    findPaths: (args2: Record<string, unknown>) => prisma.learning_paths.findMany(args2 as any) as any,
  };
  // 规则版：档位来源给空 Map（等价于"还没预热"）
  const rulePlan = await buildReviewPlan(user.id, {
    deps: { ...plainDeps, loadProfiles: async () => new Map() },
  });
  // LLM 版：档位走真实服务（会调一次 LLM，之后命中缓存）
  const llmPlan = await buildReviewPlan(user.id, {
    deps: { ...plainDeps, loadProfiles: async (_uid: string, keys: string[]) => service.resolveProfileMap(user.id, keys, { timeoutMs: 180_000 }) },
  });

  const short = (plan: typeof rulePlan) =>
    plan.items.map((item) => `${item.label}(${item.load.toFixed(2)})`).join(' ｜ ') || '（无）';
  console.log('\n[对温故配额的影响]');
  console.log(`  规则版：预算 ${rulePlan.budget}  占用 ${rulePlan.usedLoad}  入选 ${short(rulePlan)}`);
  console.log(`  LLM 版：预算 ${llmPlan.budget}  占用 ${llmPlan.usedLoad}  入选 ${short(llmPlan)}`);
  const changed = short(rulePlan) !== short(llmPlan);
  console.log(`  入选是否变化：${changed ? '是（这是 LLM 档位的真实影响）' : '否（当前候选集下两者选点相同）'}`);
}

if (require.main === module) {
  main()
    .catch((error) => {
      console.error(error);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
