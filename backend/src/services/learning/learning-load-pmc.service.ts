/**
 * 学习负荷 PMC 影子服务（DB 读取 + 纯引擎重放）
 *
 * 与 `learning-load.pmc.ts`（纯函数）分工：本模块**只做数据装配**——从 `learning_metrics`
 * 读已提交行、按应用时区本地日聚合成日负荷、交给纯引擎重放，产出「新 PMC 模型会读到什么」。
 *
 * **为什么不需要在结课热路径上写影子**：`learning_metrics` 每节课一行，既存了该节的**瞬时 LSS**
 * （`lss` 列，内容驱动、非 EWMA），也存了**旧模型的每课 EWMA 输出**（`ktl`/`lf` 列）。
 * 于是「旧模型 vs 新 PMC」的差异在任何时刻都能**离线重放**得到（见 audit-learning-load-pmc.ts），
 * 无需给 `endSession` 增加查询、也无需新增列或 wrapup 字段——这是对"零行为变更"最忠实的实现。
 *
 * 前值种子：窗口内第一行反映的是"接续历史"还是"从 0 起步"？真实用户窗口前早有积累，
 * 故从首日的旧模型落库值**反解**出前值（stepPmc(prior, load0) == old0），使窗口内逐日比对
 * 是"同一前值下的增量差异"，而非被起点差淹没。
 */
import prisma from '../../config/database';
import { simulatedNowOr } from '../virtual-lab/simulation-clock-context';
import { dayKeyOf, addDaysToDayKey } from '../time/day-boundary';
import {
  replayDailySeries,
  buildDailyLoadSeries,
  deriveFormState,
  PMC_KTL_LAMBDA,
  PMC_LF_LAMBDA,
  type PmcPoint,
  type PmcState,
  type FormState,
} from './learning-load.pmc';

export interface DailyPmcRow {
  dayKey: string;
  /** 当日总负荷（Σ 各节 LSS）；空闲日 = 0 */
  load: number;
  lessons: number;
  /** 旧模型当日末值（学习量为 0 的日为空） */
  oldKtl: number | null;
  oldLf: number | null;
}

/** 重放输入行：至少要有 calculatedAt/lss；带 sourceKey/taskId 才能做跨家族去重。 */
export interface PmcSourceRow {
  calculatedAt: Date;
  lss: number | null;
  ktl?: number | null;
  lf?: number | null;
  /** 来源键：`teaching-wrapup:<sessionId>` / `task-completion:<taskId>` */
  sourceKey?: string | null;
  /** 任务 id：一节课的稳定身份（同一天同一 taskId = 同一节课） */
  taskId?: string | null;
}

/**
 * 去重：一节课可能被**两个写入家族各记一行**——
 *   - `teaching-wrapup:<sessionId>`：会话评估的**真实 LSS**（权威）
 *   - `task-completion:<taskId>`：任务完成侧的**合成占位**（LSS 恒 4，`calculateLSS` 默认档）
 * 二者是**同一节课**的两个观测，都落在同一天、同一 taskId 上。若直接求和，日负荷会翻倍
 * （实测：周敏 10-12 六节课 → 12 行，Σ 从真实 ~15.8 被顶到 41.76；四位 VL 的 10-09/10-12 同病）。
 *
 * 规则（最小、保守）：同一天、同 taskId 下**只要存在 teaching-wrapup 行，就丢弃 task-completion 行**。
 * taskId 缺失、或只有单家族的行一律保留——无法配对即不折叠，宁可多留不误删。
 */
export function dedupeLessonRows<T extends PmcSourceRow>(rows: ReadonlyArray<T>): T[] {
  const wrapupKeys = new Set<string>();
  for (const r of rows) {
    const tid = String(r.taskId ?? '').trim();
    if (!tid) continue;
    if (String(r.sourceKey ?? '').startsWith('teaching-wrapup:')) {
      const key = dayKeyOf(r.calculatedAt);
      if (key) wrapupKeys.add(`${key}|${tid}`);
    }
  }
  if (wrapupKeys.size === 0) return [...rows];
  return rows.filter((r) => {
    const tid = String(r.taskId ?? '').trim();
    if (!tid || !String(r.sourceKey ?? '').startsWith('task-completion:')) return true;
    const key = dayKeyOf(r.calculatedAt);
    return !key || !wrapupKeys.has(`${key}|${tid}`);
  });
}

export interface UserPmcSeries {
  daily: DailyPmcRow[];
  /** 逐日 PMC 状态（与 daily 一一对应） */
  pmc: PmcPoint[];
  /** 最新一天的状态（无数据时 null） */
  latest: PmcPoint | null;
  latestForm: FormState | null;
  /** 最近一节课的**瞬时 LSS**（内容驱动，非状态）——供读侧回填 metrics.lss */
  latestLessonLss: number | null;
  /** 最近一节课的发生时刻 */
  latestLessonAt: Date | null;
}

/**
 * 纯函数：把「日键 → 原始行」铺成逐日序列并重放 PMC。
 *
 * - `until`：把序列**延伸到该日期**（该日及之前，缺日以 0 参与）——这是**空闲回落**的关键：
 *   学习者停课后以 `asOf` 读取时，必须把"最后一节课之后到今天"的空闲日补进序列，
 *   KTL/LF 才会按 λ^d 回落（否则读到的永远是最后一节课那天的值）。缺省 = 不延伸。
 * - `seedFromFirstRow`（缺省 false）：审计脚本专用——用首日的旧模型值**反解**前值
 *   （stepPmc(prior,load0)==old0），仅供审计脚本做"同一前值下的增量差异"比对。
 * - `bootstrapFromFirstLoad`（生产读侧，2026-11-23）：用**首日负荷**作为慢性基线播种
 *   （下限 PMC_BOOTSTRAP_FLOOR），而不是从 0 起步。原因（数值可达性验证实锤）：
 *   KTL λ=0.95 与 LF λ=0.70 从 0 起步时收敛错配——一个每天 1 节常规课的学习者 40 天
 *   ktl 只到 2.96，永远跨不过 ACWR 有效性门 ktl≥3；连肝 5 天高负荷也只有 ktl 1.54，
 *   长时调节与恢复全是死分支。用首日负荷当基线后，比值从第 1 天就有意义，
 *   重负荷能触发 recover、停学能回到 recovered（见 reachability-check 脚本）。
 *   与 `seed` / `seedFromFirstRow` 互斥（优先级：seed > seedFromFirstRow > bootstrap）。
 * - `seed`（架构优化批 2b，2026-10-24）：从**滚动 checkpoint**（该日收盘态）继续重放——
 *   `dayKey` 及之前的行已被吸收进种子，必须剔除（本函数防御性再滤一次）；序列从
 *   `dayKey+1` 起铺（空日以 0 参与 = 延续空闲回落），latestLesson 回退到种子携带值。
 *   与 `seedFromFirstRow` 互斥（seed 优先）。
 */
export interface PmcReplaySeed {
  /** checkpoint 覆盖到的最后一天（YYYY-MM-DD，应用时区日键） */
  dayKey: string;
  ktl: number;
  lf: number;
  latestLessonLss?: number | null;
  latestLessonAt?: Date | null;
}

/**
 * 冷启动慢性基线下限（负荷单位，与 LSS 同刻度）。
 * 取 low 档代表值 2.5（session-evaluation-scale）：低于此值的首日课不足以代表慢性负荷，
 * 直接拿它当基线会让后续常规课被误判成"负荷陡增"。
 */
export const PMC_BOOTSTRAP_FLOOR = 2.5;

export function replayDailyPmc(
  rows: ReadonlyArray<PmcSourceRow>,
  options: { seedFromFirstRow?: boolean; bootstrapFromFirstLoad?: boolean; until?: Date; seed?: PmcReplaySeed } = {},
): UserPmcSeries {
  const byDay = new Map<string, { load: number; lessons: number; oldKtl: number; oldLf: number }>();
  // 跨家族去重（teaching-wrapup 权威行优先于 task-completion 占位行）——否则一节课被计两次，日负荷翻倍
  const deduped = dedupeLessonRows(rows);
  const seed = options.seed ?? null;
  const ordered = [...deduped]
    .filter((r) => {
      if (!seed) return true;
      const key = dayKeyOf(r.calculatedAt);
      return !key || key > seed.dayKey; // checkpoint 日及之前已被种子吸收
    })
    .sort((a, b) => a.calculatedAt.getTime() - b.calculatedAt.getTime());
  for (const r of ordered) {
    const key = dayKeyOf(r.calculatedAt);
    if (!key) continue;
    const cur = byDay.get(key) ?? { load: 0, lessons: 0, oldKtl: 0, oldLf: 0 };
    cur.load += Number(r.lss) || 0;
    cur.lessons += 1;
    cur.oldKtl = Number(r.ktl) || 0;
    cur.oldLf = Number(r.lf) || 0;
    byDay.set(key, cur);
  }
  const keys = [...byDay.keys()].sort();
  const seedLatestPoint = seed
    ? { dayLoad: 0, ktl: seed.ktl, lf: seed.lf, lsb: seed.ktl - seed.lf }
    : null;
  if (keys.length === 0 && !seed) {
    return { daily: [], pmc: [], latest: null, latestForm: null, latestLessonLss: null, latestLessonAt: null };
  }
  // 种子但无后续行：latest = 种子收盘态；空日回落仍需铺到 until（否则停课后读值不衰减）
  if (keys.length === 0 && seed) {
    const untilKey = options.until ? dayKeyOf(options.until) : seed.dayKey;
    if (!untilKey || untilKey <= seed.dayKey) {
      return {
        daily: [], pmc: [],
        latest: seedLatestPoint,
        latestForm: deriveFormState(seedLatestPoint),
        latestLessonLss: seed.latestLessonLss ?? null,
        latestLessonAt: seed.latestLessonAt ?? null,
      };
    }
    const idleSeries = buildDailyLoadSeries(new Map(), addDaysToDayKey(seed.dayKey, 1), untilKey, addDaysToDayKey);
    const idlePmc = replayDailySeries(idleSeries.map((s) => s.load), { ktl: seed.ktl, lf: seed.lf });
    const idleLatest = idlePmc[idlePmc.length - 1];
    return {
      daily: idleSeries.map((s) => ({ dayKey: s.dayKey, load: 0, lessons: 0, oldKtl: null, oldLf: null })),
      pmc: idlePmc,
      latest: idleLatest,
      latestForm: idleLatest ? deriveFormState(idleLatest) : null,
      latestLessonLss: seed.latestLessonLss ?? null,
      latestLessonAt: seed.latestLessonAt ?? null,
    };
  }
  const lastRow = ordered[ordered.length - 1] ?? null;
  const loadMap = new Map<string, number>();
  for (const [k, v] of byDay) loadMap.set(k, v.load);
  // 序列上界 = max(最后一节课的日, until 的日)：延伸到 asOf 才能体现空闲回落
  let toKey = keys[keys.length - 1];
  if (options.until) {
    const untilKey = dayKeyOf(options.until);
    if (untilKey && untilKey > toKey) toKey = untilKey;
  }
  // 有种子时序列从 dayKey+1 起铺（种子日的负荷已在收盘态里）
  const fromKey = seed ? addDaysToDayKey(seed.dayKey, 1) : keys[0];
  const series = buildDailyLoadSeries(loadMap, fromKey, toKey, addDaysToDayKey);

  let prior: PmcState | undefined;
  if (seed) {
    prior = { ktl: seed.ktl, lf: seed.lf };
  } else if (options.seedFromFirstRow) {
    const first = byDay.get(keys[0])!;
    prior = {
      ktl: Math.max(0, (first.oldKtl - (1 - PMC_KTL_LAMBDA) * first.load) / PMC_KTL_LAMBDA),
      lf: Math.max(0, (first.oldLf - (1 - PMC_LF_LAMBDA) * first.load) / PMC_LF_LAMBDA),
    };
  } else if (options.bootstrapFromFirstLoad) {
    // 2026-11-23 可达性修复：首日负荷作为慢性基线（下限 FLOOR），避免从 0 起步的
    // KTL/LF 收敛错配把 ACWR 调节锁死（详见函数头注释与 reachability-check 脚本）。
    const firstLoad = Math.max(PMC_BOOTSTRAP_FLOOR, byDay.get(keys[0])!.load);
    prior = { ktl: firstLoad, lf: firstLoad };
  }
  const pmc = replayDailySeries(series.map((s) => s.load), prior);
  const daily: DailyPmcRow[] = series.map((s) => {
    const v = byDay.get(s.dayKey);
    return {
      dayKey: s.dayKey,
      load: s.load,
      lessons: v?.lessons ?? 0,
      oldKtl: v ? v.oldKtl : null,
      oldLf: v ? v.oldLf : null,
    };
  });
  const latest = pmc.length > 0 ? pmc[pmc.length - 1] : null;
  return {
    daily,
    pmc,
    latest,
    latestForm: latest ? deriveFormState(latest) : null,
    latestLessonLss: lastRow ? (Number.isFinite(lastRow.lss as number) ? (lastRow.lss as number) : null) : null,
    latestLessonAt: lastRow ? lastRow.calculatedAt : null,
  };
}

/**
 * 读某用户的已提交 learning_state 行（可选限路径），重放 PMC 序列。
 * `asOf` 之前的行；只认已提交行（metadata 含 committed:true），与读侧权威口径一致。
 *
 * `asOf` **缺省 = 当前时钟（模拟钟优先）**，不是"全部"。此前缺省时不加时间过滤，
 * 于是 calculatedAt 落在未来的残留行（陈旧模拟日遗留 / 未来日推进残留）会混进序列、
 * 污染"当前状态"——实测一户 LSS 被抬到 8.57（真值 1.97）。写侧早已统一走 simulatedNowOr，
 * 读侧同口径才自洽（见 learning-state.service.ts 顶部"时钟域"注释）。
 */
export async function computeUserPmcSeries(
  userId: string,
  options: { pathId?: string | null; asOf?: Date } = {},
): Promise<UserPmcSeries> {
  const asOf = options.asOf ?? simulatedNowOr();
  const rows = await prisma.learning_metrics.findMany({
    where: {
      userId,
      metricType: 'learning_state',
      // 2026-10-24 架构优化批 2a：committed 走实列（迁移回填后与旧 metadata JSON 过滤等价；
      // synthetic 行保留——重放内 dedupeLessonRows 按权威行折叠，冷启动占位行仍参与）
      ...(options.pathId ? { pathId: options.pathId } : {}),
      committed: true,
      calculatedAt: { lte: asOf },
    },
    select: { calculatedAt: true, lss: true, ktl: true, lf: true, sourceKey: true, taskId: true },
    orderBy: { calculatedAt: 'asc' },
  });
  return replayDailyPmc(rows, { until: asOf, bootstrapFromFirstLoad: true });
}

export const learningLoadPmcService = { replayDailyPmc, computeUserPmcSeries };
export default learningLoadPmcService;
