/**
 * 按会话核算 token / 调用成本（**只读**，不写任何库）
 *
 * 背景（审计 §5.2 P2）：`agent_call_logs.sessionId` 此前只躺在 `metadata` JSON 里，
 * 既不能索引也不能聚合 ⇒ "这节课花了多少 token、哪个 skill 最贵"无法回答。
 * 2026-09-17 升为真列（迁移 `20260917020000_agent_call_log_session_id`）并回填历史行。
 *
 * 口径：
 * - **只统计 `agent_call_logs`**（api-gateway 每次 LLM 调用的汇总行，含 prompt/completion tokens）。
 *   `llm_execution_attempts` 是同一调用的重试明细，计入会重复。
 * - 金额不换算：缺"按模型单价"的权威表；本脚本只给 token 与调用数（要金额请接单价表后再乘）。
 * - 会话归属按 `sessionId`；无会话的调用（路径生成、画像等）单独列在"无会话"一栏。
 *
 * 用法：
 *   npx ts-node --transpile-only src/scripts/audit-session-cost.ts --session=<sessionId>
 *   npx ts-node --transpile-only src/scripts/audit-session-cost.ts --user=<userId> [--days=7]
 *   npx ts-node --transpile-only src/scripts/audit-session-cost.ts --top=10 [--days=7]
 */
import 'dotenv/config';
import prisma from '../config/database';

interface Args {
  session: string | null;
  user: string | null;
  top: number;
  days: number;
}

export function parseArgs(argv: string[]): Args {
  const args: Args = { session: null, user: null, top: 5, days: 7 };
  for (const raw of argv) {
    const [key, value] = raw.split('=');
    if (key === '--session' && value) args.session = value;
    if (key === '--user' && value) args.user = value;
    if (key === '--top' && value) args.top = Math.max(1, Number(value) || 5);
    if (key === '--days' && value) args.days = Math.max(1, Number(value) || 7);
  }
  return args;
}

interface SessionRow {
  sessionId: string;
  calls: number;
  promptTokens: number;
  completionTokens: number;
  tokens: number;
  durationMs: number;
  failures: number;
}

function toRow(sessionId: string | null, rows: Array<{ promptTokens: number | null; completionTokens: number | null; tokensUsed: number | null; durationMs: number; success: boolean }>): SessionRow {
  let promptTokens = 0;
  let completionTokens = 0;
  let tokens = 0;
  let durationMs = 0;
  let failures = 0;
  for (const row of rows) {
    promptTokens += row.promptTokens ?? 0;
    completionTokens += row.completionTokens ?? 0;
    tokens += row.tokensUsed ?? ((row.promptTokens ?? 0) + (row.completionTokens ?? 0));
    durationMs += row.durationMs ?? 0;
    if (!row.success) failures += 1;
  }
  return { sessionId: sessionId ?? '(无会话)', calls: rows.length, promptTokens, completionTokens, tokens, durationMs, failures };
}

function printSession(row: SessionRow, indent = '  ') {
  console.log(
    `${indent}${row.sessionId}  调用 ${String(row.calls).padStart(3)} 次 | prompt ${String(row.promptTokens).padStart(7)} | completion ${String(row.completionTokens).padStart(6)} | 合计 ${String(row.tokens).padStart(7)} tokens | 累计 ${(row.durationMs / 1000).toFixed(1)}s${row.failures ? ` | 失败 ${row.failures}` : ''}`,
  );
}

async function breakdownByActor(sessionId: string) {
  const rows = await prisma.agent_call_logs.groupBy({
    by: ['actorId', 'actorType'],
    where: { sessionId },
    _count: { _all: true },
    _sum: { promptTokens: true, completionTokens: true, tokensUsed: true },
  });
  const sorted = rows
    .map((row) => ({
      actor: row.actorId || '(未知)',
      actorType: row.actorType || '-',
      calls: row._count._all,
      tokens: (row._sum.tokensUsed ?? 0) || ((row._sum.promptTokens ?? 0) + (row._sum.completionTokens ?? 0)),
    }))
    .sort((a, b) => b.tokens - a.tokens);
  for (const row of sorted) {
    console.log(`      · ${row.actor.padEnd(34)} ${row.actorType.padEnd(7)} 调用 ${String(row.calls).padStart(3)} 次 | ${String(row.tokens).padStart(7)} tokens`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const since = new Date(Date.now() - args.days * 24 * 60 * 60 * 1000);

  if (args.session) {
    const rows = await prisma.agent_call_logs.findMany({
      where: { sessionId: args.session },
      select: { promptTokens: true, completionTokens: true, tokensUsed: true, durationMs: true, success: true },
    });
    if (rows.length === 0) {
      console.log(`[cost] 会话 ${args.session} 没有调用记录（或 sessionId 尚未写入）`);
      return;
    }
    console.log(`[cost] 会话 ${args.session}`);
    printSession(toRow(args.session, rows));
    console.log('  按 skill/agent 分解：');
    await breakdownByActor(args.session);
    return;
  }

  const where: Record<string, unknown> = { calledAt: { gte: since } };
  if (args.user) where.userId = args.user;
  const rows = await prisma.agent_call_logs.findMany({
    where,
    select: { sessionId: true, promptTokens: true, completionTokens: true, tokensUsed: true, durationMs: true, success: true },
  });

  const grouped = new Map<string, typeof rows>();
  for (const row of rows) {
    const key = row.sessionId ?? '(无会话)';
    const bucket = grouped.get(key);
    if (bucket) bucket.push(row);
    else grouped.set(key, [row]);
  }
  const sessions = [...grouped.entries()]
    .map(([sessionId, bucket]) => toRow(sessionId === '(无会话)' ? null : sessionId, bucket))
    .sort((a, b) => b.tokens - a.tokens);

  const scope = args.user ? `用户 ${args.user}` : '全部用户';
  console.log(`[cost] ${scope}｜最近 ${args.days} 天｜会话 ${sessions.length} 个｜总 token ${sessions.reduce((sum, row) => sum + row.tokens, 0)}`);
  for (const row of sessions.slice(0, args.top)) printSession(row);

  if (args.user) {
    const top = sessions.find((row) => row.sessionId !== '(无会话)');
    if (top) {
      console.log(`\n[cost] 最贵会话 ${top.sessionId} 的分解：`);
      await breakdownByActor(top.sessionId);
    }
  }
  console.log('\n[cost] 注：只统计 agent_call_logs（不含重试明细表）；不换算金额（缺按模型单价的权威表）。');
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