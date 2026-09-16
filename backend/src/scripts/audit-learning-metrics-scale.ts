/**
 * 审计：learner 状态指标的量纲一致性（learning_metrics）
 *
 * 背景：消费侧阈值按 **0-10** 写（`lf >= 6` → 疲劳高、`ktl >= 6 && lf <= 3 && lss <= 4` → 可加速、
 * `ktl >= 7` → 可加速下一阶段…），而 `normalizeTenScale` 只做「>10 就 /10」——
 * 一旦上游写进 **0-1 量纲**的值，它会原样穿透，于是这些分支永远不触发（难度/节奏/加速判断静默失效）。
 *
 * 本脚本做三件事：
 * 1) 按 metricType × metadata.source 统计各指标的分布（min/median/max），定位谁在写小数值；
 * 2) 标出"与声明 scale 不自洽"的行（scale=internal-10 但值落在 (0,1)）；
 * 3) 按用户取**最新一条已提交的 learning_state**，逐个判定消费侧分支会/不会触发 —— 给出影响面。
 *
 * 用法：npx ts-node --transpile-only src/scripts/audit-learning-metrics-scale.ts [--sample=10]
 */
import 'dotenv/config';
import prisma from '../config/database';

interface Args {
  sample: number;
}

export function parseArgs(argv: string[]): Args {
  const args: Args = { sample: 8 };
  for (const arg of argv) {
    if (arg.startsWith('--sample=')) {
      const value = Number(arg.slice('--sample='.length));
      if (Number.isFinite(value) && value > 0) args.sample = Math.min(Math.floor(value), 50);
    } else if (arg) {
      throw new Error(`未知参数：${arg}`);
    }
  }
  return args;
}

const median = (values: number[]): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return Math.round(sorted[Math.floor(sorted.length / 2)] * 1000) / 1000;
};

/** 消费侧阈值（0-10 口径）：集中列在这里，便于与代码里的散落阈值对照 */
export const CONSUMER_THRESHOLDS = [
  { key: 'pacing=slow', test: (m: any) => m.lf >= 6 || m.lss >= 6 },
  { key: 'pacing=fast', test: (m: any) => m.ktl >= 5 && m.lf <= 3 && m.lss <= 4 },
  { key: 'fatigueRisk=high', test: (m: any) => m.lf >= 6 },
  { key: 'conceptLoad=low', test: (m: any) => m.lf >= 6 || m.lsb < 0 },
  { key: 'signal.accelerate', test: (m: any) => m.ktl >= 6 && m.lf <= 3 && m.lss <= 4 },
  { key: 'advisory.canAccelerate', test: (m: any) => m.ktl >= 7 && m.lss <= 4.5 && m.lf <= 4.5 },
  { key: 'signal.highRisk(lf)', test: (m: any) => m.lf >= 6 },
  { key: 'signal.highRisk(lss)', test: (m: any) => m.lss >= 6 },
];

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const rows = await prisma.learning_metrics.findMany({
    select: { userId: true, metricType: true, lss: true, ktl: true, lf: true, lsb: true, metadata: true, recordedAt: true },
    orderBy: [{ recordedAt: 'desc' }],
  });
  console.log(`[audit] learning_metrics 共 ${rows.length} 行`);

  // 1) 按 metricType × source × scale 分组统计
  const groups = new Map<string, { count: number; lss: number[]; ktl: number[]; lf: number[]; lsb: number[] }>();
  for (const row of rows) {
    let meta: any = {};
    try {
      meta = typeof row.metadata === 'string' ? JSON.parse(row.metadata) : (row.metadata ?? {});
    } catch {
      meta = {};
    }
    const key = `${row.metricType} | source=${meta.source ?? '-'} | scale=${meta.scale ?? '-'}`;
    const bucket = groups.get(key) ?? { count: 0, lss: [], ktl: [], lf: [], lsb: [] };
    bucket.count += 1;
    for (const [field, value] of [['lss', row.lss], ['ktl', row.ktl], ['lf', row.lf], ['lsb', row.lsb]] as const) {
      if (typeof value === 'number' && Number.isFinite(value)) bucket[field].push(value);
    }
    groups.set(key, bucket);
  }
  console.log('\n[audit] 分组分布（metricType | source | scale）：');
  for (const [key, bucket] of [...groups.entries()].sort((a, b) => b[1].count - a[1].count)) {
    console.log(`  ${key}  n=${bucket.count}`);
    console.log(`    lss min/med/max = ${Math.min(...bucket.lss, 0)}/${median(bucket.lss)}/${Math.max(...bucket.lss, 0)}`);
    console.log(`    ktl min/med/max = ${Math.min(...bucket.ktl, 0)}/${median(bucket.ktl)}/${Math.max(...bucket.ktl, 0)}`);
    console.log(`    lf  min/med/max = ${Math.min(...bucket.lf, 0)}/${median(bucket.lf)}/${Math.max(...bucket.lf, 0)}`);
    console.log(`    lsb min/med/max = ${Math.min(...bucket.lsb, 0)}/${median(bucket.lsb)}/${Math.max(...bucket.lsb, 0)}`);
  }

  // 2) 与声明 scale 不自洽的行
  const suspicious = rows.filter((row) => {
    if (row.metricType !== 'learning_state') return false;
    const values = [row.lss, row.ktl, row.lf].filter((value) => typeof value === 'number') as number[];
    if (values.length === 0) return false;
    // internal-10 声明下，全部指标都 <=1 且至少一个为正 → 疑似 0-1 量纲穿透
    return values.every((value) => value >= 0 && value <= 1) && values.some((value) => value > 0);
  });
  const placeholder = rows.filter((row) => row.metricType === 'learning_state'
    && row.lss === 0.4 && row.ktl === 1 && row.lf === 1 && (row.lsb === 0 || row.lsb === null));
  console.log(`\n[audit] learning_state 中疑似 0-1 量纲穿透：${suspicious.length} 行`);
  for (const row of suspicious.slice(0, args.sample)) {
    console.log(`  ${new Date(row.recordedAt).toISOString().slice(0, 16)} ${row.userId.slice(0, 8)} lss=${row.lss} ktl=${row.ktl} lf=${row.lf} lsb=${row.lsb}`);
  }
  console.log(`[audit] 完全吻合占位值(lss=0.4,ktl=1,lf=1,lsb=0)：${placeholder.length} 行`);
  for (const row of placeholder.slice(0, args.sample)) {
    console.log(`  ${new Date(row.recordedAt).toISOString().slice(0, 16)} ${row.userId.slice(0, 8)}`);
  }

  // 3) 按用户取最新一条 learning_state，看消费侧分支触发情况
  const latestByUser = new Map<string, typeof rows[number]>();
  for (const row of rows) {
    if (row.metricType !== 'learning_state') continue;
    if (!latestByUser.has(row.userId)) latestByUser.set(row.userId, row);
  }
  const triggerCounts = new Map<string, number>();
  let inertUsers = 0;
  for (const [, row] of latestByUser) {
    const metrics = { lss: Number(row.lss) || 0, ktl: Number(row.ktl) || 0, lf: Number(row.lf) || 0, lsb: Number(row.lsb) || 0 };
    let anyFired = false;
    for (const threshold of CONSUMER_THRESHOLDS) {
      if (threshold.test(metrics)) {
        triggerCounts.set(threshold.key, (triggerCounts.get(threshold.key) || 0) + 1);
        anyFired = true;
      }
    }
    if (!anyFired) inertUsers += 1;
  }
  console.log(`\n[audit] 用户数 ${latestByUser.size}｜最新状态下**所有**消费侧分支都不触发（适配静默失效）：${inertUsers} 人`);
  for (const threshold of CONSUMER_THRESHOLDS) {
    console.log(`  ${threshold.key}: ${triggerCounts.get(threshold.key) || 0} 人触发`);
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
