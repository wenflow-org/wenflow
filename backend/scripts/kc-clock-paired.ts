/* eslint-disable no-console -- 一次性对照 CLI */
/**
 * 跨日时钟修复的**配对对照**（设计 §6.2 轨道 B 的对照要求）
 *
 * 用**同一个学习者的同一份已提交状态快照**，分别按两条读取路径折算自然衰减：
 *   - 改造前：`getPreviousMetrics(userId)` —— asOf 缺省走真墙钟（旧行为，无模拟上下文时
 *     `simulatedNowOr()` 就是 `new Date()`），日差 = 真实今天 − 模拟日 ≈ 18 天 → **过度恢复**；
 *   - 改造后：`getPreviousMetrics(userId, { asOf: 模拟日 })` —— 按模拟日折算，日差 = 1/2/3。
 * 两者只差"缺省值"，其余代码路径完全相同，故是干净的单变量对照。
 *
 * 用法：npx ts-node --transpile-only scripts/kc-clock-paired.ts [学习者名关键字]
 */
import 'dotenv/config';
import prisma from '../src/config/database';
import learningStateService from '../src/services/learning/learning-state.service';
import { dayKeyOf, startOfDay, dayDiffInDays } from '../src/services/time/day-boundary';

const NAME = process.argv[2] || '[kc] 配对对照';

const fmt = (m: { lss: number; ktl: number; lf: number; lsb: number } | null) =>
  m ? `lss=${m.lss.toFixed(3)} ktl=${m.ktl.toFixed(3)} lf=${m.lf.toFixed(3)} lsb=${m.lsb.toFixed(3)}` : 'null';

/** 本地日 + 小时 → 绝对时刻（与 natural-decay.test 同口径） */
const localAt = (dayKey: string, hour: number): Date => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dayKey)!;
  const midnight = startOfDay(new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12)));
  return new Date(midnight.getTime() + hour * 3600 * 1000);
};

async function main() {
  const user = await prisma.users.findFirst({ where: { name: { contains: NAME } }, select: { id: true, name: true } });
  if (!user) throw new Error(`找不到学习者：${NAME}`);
  console.log(`[paired] 学习者: ${user.name} (${user.id})`);

  // 只取**已提交的 learning_state** 行（与服务 listCommittedSnapshots 同口径）；
  // session_load 行的 lss/ktl/lf/lsb 只是默认 0（真值在 metadata），混进来会把基准带偏。
  const rows = await prisma.learning_metrics.findMany({
    where: { userId: user.id, metricType: 'learning_state' },
    orderBy: { calculatedAt: 'asc' },
    select: { calculatedAt: true, lss: true, ktl: true, lf: true, lsb: true, sourceKey: true },
  });
  console.log(`[paired] 已提交 learning_state 快照 ${rows.length} 条：`);
  for (const r of rows) {
    console.log(`  ${r.calculatedAt.toISOString()} (本地日 ${dayKeyOf(r.calculatedAt)}) lss=${r.lss} ktl=${r.ktl} lf=${r.lf} lsb=${r.lsb}`);
  }
  if (rows.length === 0) throw new Error('该学习者没有已提交 learning_state 快照，无法对照');

  const last = rows[rows.length - 1]!;
  const lastDayKey = dayKeyOf(last.calculatedAt);
  console.log(`\n[paired] 基准快照：本地日 ${lastDayKey} lss=${last.lss} ktl=${last.ktl} lf=${last.lf}`);

  // ── 改造前：asOf 缺省 = 真墙钟（脚本无模拟时钟上下文，simulatedNowOr() 即 new Date()）──
  const before = await learningStateService.getPreviousMetrics(user.id);
  const realNow = new Date();
  console.log(`\n── 改造前（asOf 缺省=真墙钟）──`);
  console.log(`  读取时刻 = 真实现在 ${realNow.toISOString()}（本地日 ${dayKeyOf(realNow)}）`);
  console.log(`  隐含日差 = ${dayDiffInDays(last.calculatedAt, realNow)} 天`);
  console.log(`  折算结果: ${fmt(before)}`);

  // ── 改造后：显式按模拟日折算 ──
  console.log(`\n── 改造后（按模拟日折算）──`);
  const baseMidnight = startOfDay(last.calculatedAt);
  for (const d of [0, 1, 2, 3]) {
    const asOf = new Date(baseMidnight.getTime() + d * 24 * 3600 * 1000 + 12 * 3600 * 1000);
    const after = await learningStateService.getPreviousMetrics(user.id, { asOf });
    console.log(`  模拟日 +${d}（${dayKeyOf(asOf)}，日差 ${dayDiffInDays(last.calculatedAt, asOf)}）: ${fmt(after)}`);
  }

  console.log(`\n[paired] 结论：同一份快照，改造前按 ${dayDiffInDays(last.calculatedAt, realNow)} 天折算（过度恢复），`);
  console.log(`         改造后按 1/2/3 天折算（逐日可见），差异只来自 asOf 缺省值。`);
  void localAt;
}

main().then(() => process.exit(0)).catch((e) => { console.error('[paired] 失败:', e); process.exit(1); });
