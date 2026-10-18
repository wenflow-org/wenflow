/**
 * 学习负荷 PMC 引擎（纯函数域，零副作用）
 *
 * 把 LSS/KTL/LF/LSB 从「每节课各推进一次 EWMA」改成参考 intervals.icu PMC/TSB 模型
 * （CTL=fitness 慢 / ATL=fatigue 快 / TSB=form）的**日负荷**口径：
 *
 *   当日负荷 D_day = Σ(该日每节课的 LSS)        ← 每节 LSS 已内容驱动（calculateLSS 不动）
 *   KTL_t = λk·KTL_{t-1} + (1−λk)·D_day         ← CTL 角色，半衰期 ≈ 13.5 天
 *   LF_t  = λl·LF_{t-1}  + (1−λl)·D_day         ← ATL 角色，半衰期 ≈ 1.9 天
 *   LSB_t = KTL_t − LF_t                         ← TSB 角色（form）
 *
 * 与旧模型（learning-state.service 的「按课 EWMA」+ 读取侧「自然衰减」）的两处结构差：
 *   ① 旧模型**每节课**各推进一次 EWMA —— 对同一输入连推进 N 次数学上收敛到该输入本身，
 *      于是一天 N 节课 ≈ 一天 1 节课（实测周敏 10-12 一天 12 课，KTL 仅 5.57→6.00）。
 *      新模型**每天**只推进一次，输入是当日负荷**之和**（一天 N 课真的累加）。
 *   ② 旧模型读取侧另有一套独立「自然衰减」（LSS×0.82^d / KTL×0.99^d / LF→1.2×0.74^d），
 *      与写入侧的按课 EWMA 是两个时钟、两条机制。新模型只有**一条**机制——空闲日以
 *      D_day=0 参与推进，自然回落（等价于「不衰减就没有日负荷」）。
 *
 * 关键不变量 —— **单课日不漂移**：单课日 D_day=LSS，新模型推进一次 = 旧模型推进一次
 * （逐字一致）。差异只出现在**多课日**（新模型把 N 节课的负荷叠加），这正是本次要改的语义。
 *
 * 半衰期不变（13.5 / 1.9 天）：λ 沿用旧模型的 0.95 / 0.70，只把「按课步进」改成「按天步进」，
 * 保证单课日与既有数值对齐、消费侧阈值不被整体位移。
 */

// ── 常数：λ 沿用旧模型（EWMA_CONFIG.KTL_LAMBDA / LF_LAMBDA），保证单课日逐字一致 ──
/** KTL 的每日保留系数（= CTL 角色）：半衰期 ln(0.5)/ln(0.95) ≈ 13.5 天 */
export const PMC_KTL_LAMBDA = 0.95;
/** LF 的每日保留系数（= ATL 角色）：半衰期 ln(0.5)/ln(0.70) ≈ 1.9 天 */
export const PMC_LF_LAMBDA = 0.70;

/** 半衰期（天）↔ 保留系数 λ 的换算：λ = 0.5^(1/半衰期)。 */
export function lambdaForHalfLife(halfLifeDays: number): number {
  if (!Number.isFinite(halfLifeDays) || halfLifeDays <= 0) return 0;
  return Math.pow(0.5, 1 / halfLifeDays);
}

/** 保留系数 λ → 半衰期（天）：h = ln(0.5)/ln(λ)。用于把 λ 反标成可读天数。 */
export function halfLifeForLambda(lambda: number): number {
  if (!Number.isFinite(lambda) || lambda <= 0 || lambda >= 1) return 0;
  return Math.log(0.5) / Math.log(lambda);
}

export const PMC_KTL_HALF_LIFE_DAYS = halfLifeForLambda(PMC_KTL_LAMBDA);
export const PMC_LF_HALF_LIFE_DAYS = halfLifeForLambda(PMC_LF_LAMBDA);

export interface PmcState {
  /** 知识训练负荷（CTL 角色，慢） */
  ktl: number;
  /** 学习疲劳（ATL 角色，快） */
  lf: number;
}

export interface PmcPoint extends PmcState {
  /** 该日总负荷（Σ LSS）；空闲日为 0 */
  dayLoad: number;
  /** 状态平衡（TSB 角色）= ktl − lf */
  lsb: number;
}

const nonNegative = (value: number | null | undefined): number =>
  Number.isFinite(value as number) ? Math.max(0, value as number) : 0;

/**
 * 推进一天：输入**当日负荷之和**（不是单节课的 LSS）。
 * 空闲日传 0（等价于自然回落）。
 * 返回新状态，不修改入参。
 */
export function stepPmc(prev: PmcState, dayLoad: number): PmcPoint {
  const load = nonNegative(dayLoad);
  const ktl = PMC_KTL_LAMBDA * prev.ktl + (1 - PMC_KTL_LAMBDA) * load;
  const lf = PMC_LF_LAMBDA * prev.lf + (1 - PMC_LF_LAMBDA) * load;
  return { dayLoad: load, ktl, lf, lsb: ktl - lf };
}

/**
 * 逐日重放一串日负荷（数组元素 = 该日总负荷，**必须逐日连续**，空闲日填 0）。
 * 用于审计脚本/单测在真实历史上重放模型。prior 为起始前值（缺省从 0 起步）。
 */
export function replayDailySeries(loads: ReadonlyArray<number>, prior?: PmcState): PmcPoint[] {
  let state: PmcState = prior ? { ktl: nonNegative(prior.ktl), lf: nonNegative(prior.lf) } : { ktl: 0, lf: 0 };
  const out: PmcPoint[] = [];
  for (const load of loads) {
    const next = stepPmc(state, load);
    out.push(next);
    state = { ktl: next.ktl, lf: next.lf };
  }
  return out;
}

/**
 * 把「按日键聚合的负荷」铺成**逐日连续**的负荷数组（缺日填 0），覆盖 [fromKey, toKey]。
 * 日键为应用时区本地日 'YYYY-MM-DD'，加法走日历运算（由调用方保证键合法）。
 */
export function buildDailyLoadSeries(
  byDay: ReadonlyMap<string, number>,
  fromKey: string,
  toKey: string,
  addDays: (dayKey: string, days: number) => string,
): Array<{ dayKey: string; load: number }> {
  const out: Array<{ dayKey: string; load: number }> = [];
  if (!fromKey || !toKey || fromKey > toKey) return out;
  let cursor = fromKey;
  // 护栏：防止脏日键导致死循环（覆盖上限 ~10 年）
  for (let guard = 0; guard < 4000 && cursor <= toKey; guard += 1) {
    out.push({ dayKey: cursor, load: nonNegative(byDay.get(cursor) ?? 0) });
    const next = addDays(cursor, 1);
    if (!next || next === cursor) break;
    cursor = next;
  }
  return out;
}

/**
 * 相对量形态（TSB/ACWR 角色）——供消费方把「疲劳/节奏/可加速」判据从绝对量迁到相对量。
 *
 * - `form = ktl − lf`（TSB 角色）：>0 表示近期疲劳消退、状态在恢复；<0 表示疲劳跑在适应前面。
 * - `acwr = lf / ktl`（**急性:慢性负荷比**，standard acute:chronic workload ratio）：
 *   近期疲劳相对适应基座的比例，**尺度无关**（不受日负荷量纲影响）。
 *   >1.3 → 负荷涨得比基座快（有风险）；≈1 → 稳态；<0.8 → 在恢复/去训练。ktl≈0（长期空闲）时为 null。
 *
 * **注意**：稳态下（恒定日负荷）KTL≈LF，form→0、acwr→1——form 捕捉的是**趋势**
 * （负荷在涨还是在退），不是绝对水平。这与 PMC 一致（TSB 本就是"适应 − 疲劳"的差）。
 */
export interface FormState {
  form: number;
  acwr: number | null;
}

export function deriveFormState(state: PmcState): FormState {
  const ktl = nonNegative(state.ktl);
  const lf = nonNegative(state.lf);
  const form = ktl - lf;
  // ACWR = 急性/慢性：疲劳（快通道）÷ 适应（慢通道）。ktl≈0 时无基座，返回 null（不是 0 或 Inf）。
  const acwr = ktl > 1e-6 ? lf / ktl : null;
  return { form, acwr };
}

/** 形态分档（相对量判据）。阈值由消费侧传入——分档**策略**不在本纯函数域内固化。 */
export type FormLevel = 'fresh' | 'optimal' | 'strained' | 'overreached';

export interface FormThresholds {
  /** form ≥ 此值 → fresh（明显在恢复） */
  freshAbove: number;
  /** form ≤ 此值 → overreached（疲劳远超适应，最严重） */
  overreachedBelow: number;
  /** acwr ≥ 此值 → strained（负荷涨得比基座快；standard ACWR 警戒 ≈1.3） */
  strainedAcwrAbove: number;
}

export function classifyForm(state: PmcState, thresholds: FormThresholds): FormLevel {
  const { form, acwr } = deriveFormState(state);
  // 严重度序：overreached（疲劳远超适应）→ strained（爬升过快）→ fresh（在恢复）→ optimal
  if (form <= thresholds.overreachedBelow) return 'overreached';
  if (acwr !== null && acwr >= thresholds.strainedAcwrAbove) return 'strained';
  if (form >= thresholds.freshAbove) return 'fresh';
  return 'optimal';
}
