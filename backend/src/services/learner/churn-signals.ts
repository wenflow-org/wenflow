/**
 * 学习者休眠 / 流失信号（Q19 · 只读、纯函数）
 *
 * 背景：`doc/SCALE_PREREQUISITES_DESIGN.md` §2（Q19）指出，冷启动继承已实现，但真实教学链
 * **没有时间跨度信号**，`churn / winback / dormant` 全仓零命中。本模块是 Q19 的第一个最小步骤：
 * 只从**既有时间戳**推导"距上次活跃多久、处于哪一档、风险分多高"，
 * **不写库、不改 schema、不接路由、不跑 prompts、不发 LLM**。
 *
 * 纪律（务必随任何报告输出）：
 * - **行为观测，不是因果结论**：`risk` 只是"距上次活跃"这一可观测代理量的平滑映射，
 *   **不是**流失概率，也不能解释"为什么"离开。禁止把 `risk` 当作预测或干预依据。
 * - **确定性**：不使用 `Math.random()`，同一输入恒得同一输出。
 * - **数据是代理**：真实用户可能不产生 `teaching_sessions`/`learner_evidence`，
 *   "上次活跃"只是若干时间戳的较新者，覆盖不完整（见 CLI 的 coverage 注记）。
 *
 * 默认休眠阈值（自然日，可覆盖）：
 *   active  < 7 天
 *   cooling ∈ [7, 14) 天
 *   dormant ∈ [14, 30) 天
 *   lost    ≥ 30 天
 * 与设计 §2.2(b) 的 D7 / D14 / D30 分层口径一致。
 *
 * risk 曲线：以阈值边界为锚点的**单调不减、C1 连续**平滑曲线
 *   （0→0，cooling 边界→0.15，dormant 边界→0.55，lost 边界→0.90，之后指数趋近 1）。
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export type DormancyBucket = 'active' | 'cooling' | 'dormant' | 'lost';

export interface DormancyThresholds {
  /** ≥ 该天数进入 cooling（默认 7） */
  coolingDays?: number;
  /** ≥ 该天数进入 dormant（默认 14） */
  dormantDays?: number;
  /** ≥ 该天数进入 lost（默认 30） */
  lostDays?: number;
}

export const DEFAULT_DORMANCY_THRESHOLDS: Required<DormancyThresholds> = {
  coolingDays: 7,
  dormantDays: 14,
  lostDays: 30,
};

/**
 * risk 在各档边界的锚点值（0–1）。曲线锚定这些点后平滑插值，
 * 便于人类解读"到了 D14 大约 0.55 风险分"，同时保证单调。
 */
export const DORMANCY_RISK_ANCHORS = {
  atZero: 0,
  atCooling: 0.15,
  atDormant: 0.55,
  atLost: 0.9,
} as const;

/** 统一随报告输出的观察性声明（CLI 复用，避免各处措辞漂移）。 */
export const CHURN_SIGNAL_CAVEAT =
  '观察性行为代理，非因果结论：休眠/风险分仅由既有时间戳推导，不代表用户流失的真实原因；' +
  '真实用户可能不产生 teaching_sessions/learner_evidence，"上次活跃"取既有时间戳的较新者，覆盖不完整；' +
  'risk 不是流失概率，禁止直接作为预测或营销触达依据（触达须另行取得同意，见 Q19 决策点 4）。';

export interface DormancySignal {
  /** 距上次活跃的天数（含小数）；`null` = 从无已知活跃记录 */
  daysSinceActive: number | null;
  bucket: DormancyBucket;
  /** 0–1 平滑风险分（行为观测代理，非概率） */
  risk: number;
}

function positiveOr(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

/**
 * 解析并校验阈值：三者必须严格递增（cooling < dormant < lost）。
 * 非法配置直接抛错，避免"静默错分档"。
 */
export function resolveDormancyThresholds(
  thresholds: DormancyThresholds = {},
): Required<DormancyThresholds> {
  const coolingDays = positiveOr(thresholds.coolingDays, DEFAULT_DORMANCY_THRESHOLDS.coolingDays);
  const dormantDays = positiveOr(thresholds.dormantDays, DEFAULT_DORMANCY_THRESHOLDS.dormantDays);
  const lostDays = positiveOr(thresholds.lostDays, DEFAULT_DORMANCY_THRESHOLDS.lostDays);
  if (!(coolingDays < dormantDays && dormantDays < lostDays)) {
    throw new Error(
      `[churn-signals] 阈值必须严格递增：cooling(${coolingDays}) < dormant(${dormantDays}) < lost(${lostDays})`,
    );
  }
  return { coolingDays, dormantDays, lostDays };
}

function toEpochMs(value: Date | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  if (typeof value === 'string') {
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? ms : null;
  }
  return null;
}

/** 天数 → 档位（边界：恰好等于阈值即进入下一档）。 */
export function bucketForDays(
  days: number,
  thresholds: Required<DormancyThresholds> = DEFAULT_DORMANCY_THRESHOLDS,
): DormancyBucket {
  if (days < thresholds.coolingDays) return 'active';
  if (days < thresholds.dormantDays) return 'cooling';
  if (days < thresholds.lostDays) return 'dormant';
  return 'lost';
}

/** 标准 smoothstep：在 [0,1] 内单调递增，两端一阶导为 0，保证分段拼接处 C1 连续。 */
function smoothstep(t: number): number {
  const x = t <= 0 ? 0 : t >= 1 ? 1 : t;
  return x * x * (3 - 2 * x);
}

/**
 * 平滑风险曲线（单调不减，值域 [0,1)）：
 * - `days <= 0` → 0；
 * - `[0, cooling)` 平滑升到 0.15；
 * - `[cooling, dormant)` 平滑升到 0.55；
 * - `[dormant, lost)` 平滑升到 0.90；
 * - `>= lost` 用 `1 - exp(-x²)` 指数趋近 1（在 lost 处一阶导为 0，与前一档平滑衔接）。
 */
export function dormancyRisk(
  days: number,
  thresholds: Required<DormancyThresholds> = DEFAULT_DORMANCY_THRESHOLDS,
): number {
  const { coolingDays, dormantDays, lostDays } = thresholds;
  const { atZero, atCooling, atDormant, atLost } = DORMANCY_RISK_ANCHORS;
  if (!(days > 0)) return atZero;
  if (days < coolingDays) {
    return atZero + (atCooling - atZero) * smoothstep(days / coolingDays);
  }
  if (days < dormantDays) {
    return atCooling + (atDormant - atCooling) * smoothstep((days - coolingDays) / (dormantDays - coolingDays));
  }
  if (days < lostDays) {
    return atDormant + (atLost - atDormant) * smoothstep((days - dormantDays) / (lostDays - dormantDays));
  }
  const tail = (days - lostDays) / (lostDays - dormantDays);
  return atLost + (1 - atLost) * (1 - Math.exp(-(tail * tail)));
}

/**
 * 纯函数：单个学习者的休眠信号。
 *
 * - 从未活跃 / 非法时间 → `{ daysSinceActive: null, bucket: 'lost', risk: 1 }`
 *   （未知视作最坏档，但 `null` 让调用方能把"从未活跃"与"长期未活跃"区分开）。
 * - 未来时间戳 / 时钟回拨 → 归零（`daysSinceActive: 0`），不当负值。
 */
export function computeDormancy(input: {
  lastActiveAt: Date | string | null | undefined;
  now: Date | string;
  thresholds?: DormancyThresholds;
}): DormancySignal {
  const thresholds = resolveDormancyThresholds(input.thresholds);
  const nowMs = toEpochMs(input.now);
  if (nowMs === null) {
    throw new Error('[churn-signals] now 必须是合法时间');
  }
  const lastMs = toEpochMs(input.lastActiveAt);
  if (lastMs === null) {
    return { daysSinceActive: null, bucket: 'lost', risk: 1 };
  }
  const rawDays = (nowMs - lastMs) / MS_PER_DAY;
  const days = rawDays > 0 ? rawDays : 0;
  return {
    daysSinceActive: days,
    bucket: bucketForDays(days, thresholds),
    risk: dormancyRisk(days, thresholds),
  };
}

export interface ChurnUserSignal {
  userId: string;
  /** 该用户的"上次活跃"时间戳；`null`/`undefined` = 从未活跃 */
  lastActiveAt: Date | string | null | undefined;
}

export interface ChurnBucketCounts {
  active: number;
  cooling: number;
  dormant: number;
  lost: number;
  /**
   * 从未有已知活跃记录的用户。`computeDormancy` 对这类用户返回 `bucket='lost'`，
   * 这里单列，避免与"曾有活跃但久未回归"混淆。
   */
  neverActive: number;
}

export interface ChurnAtRiskEntry {
  userId: string;
  daysSinceActive: number | null;
  bucket: DormancyBucket;
  risk: number;
}

export interface ChurnSummary {
  total: number;
  byBucket: ChurnBucketCounts;
  /** (dormant + lost + neverActive) / total；无用户时为 0 */
  dormancyRate: number;
  /** 有已知活跃时间的用户的中位"距今天数"；无此类用户时为 `null` */
  medianDaysSinceActive: number | null;
  /** dormant / lost / neverActive 用户，按风险（再按天数）降序、同分按 userId 升序 */
  atRisk: ChurnAtRiskEntry[];
}

function medianOf(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * 纯函数：汇总一批用户的休眠画像（确定性、与输入顺序无关）。
 *
 * - `total` 为**有效记录数**（缺 userId 的脏行跳过，不计入分母）；
 * - `medianDaysSinceActive` 只在**有活跃时间**的用户上计算，从未活跃者不参与（避免污染中位数）；
 * - `dormancyRate` = (dormant + lost + neverActive) / total，cooling 不计入。
 */
export function summarizeChurn(
  users: ChurnUserSignal[] | null | undefined,
  options: { now: Date | string; thresholds?: DormancyThresholds },
): ChurnSummary {
  const thresholds = resolveDormancyThresholds(options.thresholds);
  const byBucket: ChurnBucketCounts = { active: 0, cooling: 0, dormant: 0, lost: 0, neverActive: 0 };
  const knownDays: number[] = [];
  const atRisk: ChurnAtRiskEntry[] = [];
  let total = 0;

  for (const user of Array.isArray(users) ? users : []) {
    if (!user || typeof user.userId !== 'string' || !user.userId) continue;
    total += 1;
    const signal = computeDormancy({
      lastActiveAt: user.lastActiveAt,
      now: options.now,
      thresholds,
    });
    if (signal.daysSinceActive === null) {
      byBucket.neverActive += 1;
    } else {
      byBucket[signal.bucket] += 1;
      knownDays.push(signal.daysSinceActive);
    }
    if (signal.bucket !== 'active' && signal.bucket !== 'cooling') {
      atRisk.push({
        userId: user.userId,
        daysSinceActive: signal.daysSinceActive,
        bucket: signal.bucket,
        risk: signal.risk,
      });
    }
  }

  atRisk.sort((a, b) => {
    if (b.risk !== a.risk) return b.risk - a.risk;
    const aDays = a.daysSinceActive === null ? Number.POSITIVE_INFINITY : a.daysSinceActive;
    const bDays = b.daysSinceActive === null ? Number.POSITIVE_INFINITY : b.daysSinceActive;
    if (bDays !== aDays) return bDays - aDays;
    return a.userId.localeCompare(b.userId);
  });

  const atRiskCount = byBucket.dormant + byBucket.lost + byBucket.neverActive;
  return {
    total,
    byBucket,
    dormancyRate: total > 0 ? atRiskCount / total : 0,
    medianDaysSinceActive: medianOf(knownDays),
    atRisk,
  };
}
