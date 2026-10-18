/**
 * 审计：学习负荷「旧模型（按课 EWMA + 读取侧自然衰减） vs 新 PMC 引擎（日负荷求和 + 按天 EWMA）」
 *
 * **只读**。不改任何生产行为，不写任何表。
 *
 * 背景（2026-10-15）：旧模型每节课各推进一次 EWMA，数学上对同一输入连推进 N 次会收敛到该输入
 * 本身 → 一天 N 节课 ≈ 一天 1 节课（KTL/LF 读不到累加）。新 PMC 引擎把「当日各节 LSS 求和」
 * 作为当日负荷、**每天只推进一次**，多课日才真正累加。详见 services/learning/learning-load.pmc.ts。
 *
 * 本脚本在真实历史上重放两者，回答三个问题：
 *   ① 单课日是否逐字一致（在单测里证明；本表的"多课之前无单课"不构成缺口）；
 *   ② 多课日的 KTL/LF 差异有多大（新引擎应显著更高）；
 *   ③ 有多少学习者会因旧模型而"被读成高疲劳"（旧模型 lf≥6，而 PMC 的 form 显示其实在正常区）。
 *
 * 数据来源与重放逻辑：`learning-load-pmc.service.ts`（`learning_metrics` 的 `lss` 列是关键——
 * 它是每节的瞬时 LSS，不是 EWMA，故可离线按日求和重放；`ktl`/`lf` 列是旧模型的每课输出）。
 *
 * 用法：
 *   npx ts-node --transpile-only src/scripts/audit-learning-load-pmc.ts [--user=<id>] [--top=5] [--json]
 */
import 'dotenv/config';
import prisma from '../config/database';
import { learningLoadPmcService, type UserPmcSeries } from '../services/learning/learning-load-pmc.service';

interface Args {
  user: string | null;
  top: number;
  json: boolean;
}

export function parseArgs(argv: string[]): Args {
  const args: Args = { user: null, top: 5, json: false };
  for (const arg of argv) {
    if (arg.startsWith('--user=')) args.user = arg.slice('--user='.length);
    else if (arg.startsWith('--top=')) {
      const v = Number(arg.slice('--top='.length));
      if (Number.isFinite(v) && v > 0) args.top = Math.min(Math.floor(v), 50);
    } else if (arg === '--json') args.json = true;
    else if (arg) throw new Error(`未知参数：${arg}`);
  }
  return args;
}

const f = (v: number | null | undefined, d = 2) => (v == null ? '—' : v.toFixed(d));

interface UserPmcSummary {
  userId: string;
  days: number;
  rows: number;
  maxLessonsPerDay: number;
  multiLessonDays: number;
  oldFinalKtl: number | null;
  oldFinalLf: number | null;
  newFinalKtl: number;
  newFinalLf: number;
  maxOldLf: number;
  maxNewLf: number;
  form: number;
  acwr: number | null;
  /** 旧模型末值是否触发高疲劳（lf≥6），而 PMC form/ACWR 未显示超载 */
  oldFlaggedFatigue: boolean;
  pmcFormNormal: boolean;
}

function summarize(userId: string, series: UserPmcSeries, rowCount: number): UserPmcSummary {
  let maxLessonsPerDay = 0;
  let multiLessonDays = 0;
  let maxOldLf = 0;
  let maxNewLf = 0;
  series.daily.forEach((d, i) => {
    if (d.lessons > maxLessonsPerDay) maxLessonsPerDay = d.lessons;
    if (d.lessons > 1) multiLessonDays += 1;
    if (d.oldLf != null) maxOldLf = Math.max(maxOldLf, d.oldLf);
    if (series.pmc[i]) maxNewLf = Math.max(maxNewLf, series.pmc[i].lf);
  });
  const lastDay = series.daily[series.daily.length - 1];
  const latest = series.latest!;
  const form = series.latestForm!;
  const oldFlaggedFatigue = (lastDay.oldLf ?? 0) >= 6;
  // PMC 视角"未超载"：form 不深负（> -3）且 ACWR 不过高（< 1.5）
  const pmcFormNormal = form.form > -3 && (form.acwr == null || form.acwr < 1.5);
  return {
    userId,
    days: series.daily.length,
    rows: rowCount,
    maxLessonsPerDay,
    multiLessonDays,
    oldFinalKtl: lastDay.oldKtl,
    oldFinalLf: lastDay.oldLf,
    newFinalKtl: latest.ktl,
    newFinalLf: latest.lf,
    maxOldLf,
    maxNewLf,
    form: form.form,
    acwr: form.acwr,
    oldFlaggedFatigue,
    pmcFormNormal,
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const users = await prisma.learning_metrics.findMany({
    where: { metricType: 'learning_state', ...(args.user ? { userId: args.user } : {}) },
    select: { userId: true },
    distinct: ['userId'],
  });

  const summary: UserPmcSummary[] = [];
  for (const { userId } of users) {
    const series = await learningLoadPmcService.computeUserPmcSeries(userId);
    if (series.daily.length === 0) continue;
    const rows = await prisma.learning_metrics.count({
      where: { userId, metricType: 'learning_state' },
    });
    summary.push(summarize(userId, series, rows));
  }

  summary.sort((a, b) => b.maxLessonsPerDay - a.maxLessonsPerDay);

  if (args.json) {
    console.log(JSON.stringify({ users: summary.length, summary }, null, 2));
    return;
  }

  const multi = summary.filter((s) => s.multiLessonDays > 0).length;
  const oldFlagged = summary.filter((s) => s.oldFlaggedFatigue).length;
  const oldFlaggedButPmcNormal = summary.filter((s) => s.oldFlaggedFatigue && s.pmcFormNormal).length;

  console.log(`[audit-pmc] 有已提交 learning_state 的用户 ${summary.length} 个；其中单日多课(≥2) ${multi} 个\n`);
  console.log('（old = 旧模型落库值；new = PMC 日负荷重放；多课日的 LF 差异是本次要改的核心语义）\n');
  console.log(
    ['userId', 'days', 'max课/日', '多课日', 'old末KTL/LF', 'new末KTL/LF', 'maxOldLF', 'maxNewLF', 'form', 'acwr'].join('  '),
  );
  for (const s of summary.slice(0, args.top)) {
    console.log(
      [
        s.userId.slice(0, 8),
        s.days,
        s.maxLessonsPerDay,
        s.multiLessonDays,
        `${f(s.oldFinalKtl)}/${f(s.oldFinalLf)}`,
        `${f(s.newFinalKtl)}/${f(s.newFinalLf)}`,
        f(s.maxOldLf),
        f(s.maxNewLf),
        f(s.form),
        s.acwr == null ? '—' : f(s.acwr),
      ].join('  '),
    );
  }

  console.log(
    `\n[旧模型误判面] 旧模型末值 lf≥6（会被判高疲劳）的用户 ${oldFlagged} 个；` +
      `其中 PMC 视角其实未超载（form>-3 且 ratio<1.5）的 ${oldFlaggedButPmcNormal} 个。`,
  );
  console.log('[注] 单课日零漂移的**权威证明在单测** learning-load.pmc.test.ts（"单课日 stepPmc == 旧按课 EWMA 一步"）。');
  console.log('[注] 出现多课日之后 old/new 分叉是**预期语义**（新模型把当日多课负荷叠加），非缺陷。');
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error('[audit-pmc] 失败：', error);
      process.exit(1);
    });
}
