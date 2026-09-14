/**
 * 数据回填：合并 memory_traces 里「同一概念、不同名字」的重复记忆痕迹。
 *
 * 背景：conceptKey 直接取模型生成的知识点名字（endSession 回写 / ktEstimate），
 * 模型换个说法就多一条痕迹。实测某账号「离开前翻页立好」被记成 5 条、
 * 「回来后的第一眼/第一手」4 条，复习清单因此膨胀。
 * 现在写入层已用 normalizeConceptKey 归一化；本脚本按同一规则回填历史数据。
 *
 * 规则：按 normalizeConceptKey(conceptKey) 分组，每组保留 1 条：
 *   优先取名字已等于归一化键的那条（避免改键撞唯一约束），否则取 extractionCount 最大、
 *   masteryScore 最高、lastSeenAt 最新的一条；其余删除。被保留行的 label 若为空，用其原名补上。
 *
 * 用法：
 *   npx ts-node --transpile-only src/scripts/dedupe-memory-traces.ts --dry-run
 *   npx ts-node --transpile-only src/scripts/dedupe-memory-traces.ts
 */
import 'dotenv/config';
import prisma from '../config/database';
import { normalizeConceptKey } from '../services/memory/memory-trace.service';

export interface DedupeArgs {
  dryRun: boolean;
}

export function parseDedupeArgs(argv: string[]): DedupeArgs {
  const args: DedupeArgs = { dryRun: false };
  for (const arg of argv) {
    if (arg === '--dry-run') args.dryRun = true;
    else throw new Error(`未知参数：${arg}`);
  }
  return args;
}

interface TraceRow {
  id: string;
  conceptKey: string;
  label: string | null;
  extractionCount: number;
  masteryScore: number;
  lastSeenAt: Date | null;
}

const lastSeenMs = (row: TraceRow) => (row.lastSeenAt ? new Date(row.lastSeenAt).getTime() : 0);

async function main(): Promise<void> {
  const { dryRun } = parseDedupeArgs(process.argv.slice(2));

  const rows = await prisma.memory_traces.findMany({
    select: { id: true, userId: true, conceptKey: true, label: true, extractionCount: true, masteryScore: true, lastSeenAt: true },
  });

  const byUser = new Map<string, TraceRow[]>();
  for (const row of rows as Array<TraceRow & { userId: string }>) {
    const list = byUser.get(row.userId) ?? [];
    list.push(row);
    byUser.set(row.userId, list);
  }

  let groups = 0;
  let deleted = 0;
  let renamed = 0;
  const samples: string[] = [];

  for (const [userId, list] of byUser) {
    const grouped = new Map<string, TraceRow[]>();
    for (const row of list) {
      const key = normalizeConceptKey(row.conceptKey);
      const bucket = grouped.get(key) ?? [];
      bucket.push(row);
      grouped.set(key, bucket);
    }

    for (const [key, bucket] of grouped) {
      const exact = bucket.find((row) => row.conceptKey === key);
      const winner = exact ?? bucket.slice().sort((a, b) =>
        (b.extractionCount - a.extractionCount)
        || (b.masteryScore - a.masteryScore)
        || (lastSeenMs(b) - lastSeenMs(a)))[0];
      const losers = bucket.filter((row) => row.id !== winner.id);
      if (losers.length === 0 && winner.conceptKey === key) continue;

      groups += 1;
      deleted += losers.length;
      if (winner.conceptKey !== key) renamed += 1;
      if (samples.length < 8) {
        samples.push(`${userId.slice(0, 8)} | ${bucket.length} 条 → 1 条「${key}」`);
      }
      if (dryRun) continue;

      if (winner.conceptKey !== key) {
        await prisma.memory_traces.update({
          where: { id: winner.id },
          data: { conceptKey: key, ...(winner.label ? {} : { label: winner.conceptKey }) },
        });
      } else if (!winner.label) {
        await prisma.memory_traces.update({
          where: { id: winner.id },
          data: { label: winner.conceptKey },
        });
      }
      if (losers.length > 0) {
        await prisma.memory_traces.deleteMany({ where: { id: { in: losers.map((row) => row.id) } } });
      }
    }
  }

  console.log(
    `[dedupe-memory-traces] mode=${dryRun ? 'dry-run（只统计，未写库）' : 'apply'}` +
    ` traces=${rows.length} 合并组=${groups} 删除重复=${deleted} 改键=${renamed}`
  );
  if (samples.length > 0) {
    console.log('[dedupe-memory-traces] 样例：');
    for (const line of samples) console.log(`  ${line}`);
  }
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
