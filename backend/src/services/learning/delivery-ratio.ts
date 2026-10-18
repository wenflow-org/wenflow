/**
 * 路径交付比（#55 / P-30）纯函数域。
 *
 * 两个口径必须分开算，混用会把「交付塌方」读成「设计上就该小」：
 * - **计划口径** `ratioPlanned = bc.after / bc.target`：守恒层（path-planning 的
 *   budgetConservation）自己报的值。它只证明「预算被夹到多少」，不证明阶段任务真的排了这么多；
 * - **实际口径** `ratioActual = Σ(subtask.estimatedMinutes)/60 / bc.target`：学习者实际会被
 *   排到的课时量。2026-10-18 全库复算实证两者差距巨大（CPA 240h 锚：计划 127.5h、实际 62.1h），
 *   前者读出的真缺口是 0，后者是 11.9% —— 差额全落在计划→实际这一跳（与 #56 的
 *   `stage_sum_mismatch` 同源）。
 *
 * 判据（issue #55 原文）：`ratioActual < 0.6 且 ratioCap < 0.8` 记为真缺口；
 * `ratioCap = 实际交付 / capacitySum`，用来区分「容量本来就装不下」（cap ≥ 0.8，属设计性缩水）
 * 与「装得下却没交付」（cap < 0.8，真塌方）。没有预算锚（budgetConservation 为 null）的路径
 * 不可算，单独计数，绝不当成 0 或 1 参与分母。
 */

export interface DeliveryRatioInput {
  /** 预算锚（budgetConservation.target，小时）；null/0 表示无锚 */
  targetHours: number | null;
  /** 容量上限（budgetConservation.capacitySum，小时） */
  capacityHours: number | null;
  /** 守恒层输出（budgetConservation.after，小时）——计划口径 */
  plannedHours: number | null;
  /** 阶段任务 estimatedMinutes 合计换算的小时——实际口径 */
  deliveredHours: number;
}

export interface DeliveryRatioRow {
  templateHours: number;
  capacityHours: number | null;
  plannedHours: number | null;
  deliveredHours: number;
  ratioActual: number;
  ratioPlanned: number | null;
  ratioCap: number | null;
  /** ratioActual < 0.6 且（无 cap 或 cap < 0.8） */
  trueGap: boolean;
  /** 计划→实际这一跳的兑现率（实际/计划）；计划为 0 时 null */
  actualVsPlanned: number | null;
}

export interface DeliveryRatioBand {
  lt04: number;
  b04_06: number;
  b06_08: number;
  b08_10: number;
  gt10: number;
}

export interface DeliveryRatioSummary {
  computable: number;
  below60: number;
  below60Rate: number;
  trueGap: number;
  trueGapRate: number;
  medianActual: number | null;
  bands: DeliveryRatioBand;
  /** 实际 < 计划 × 0.8 的条数：守恒层说排了这么多、任务实际没排到 */
  plannedShortfall: number;
  /** issue 判据（真缺口率 > 40% 即成立） */
  verdict: '成立' | '不成立';
}

const round3 = (value: number): number => Number(value.toFixed(3));

/** 单条路径的比值；无锚或锚为 0 → null（不可算，调用方须单独计数） */
export function computeDeliveryRatio(input: DeliveryRatioInput): DeliveryRatioRow | null {
  const target = Number(input.targetHours);
  if (!Number.isFinite(target) || target <= 0) return null;
  const delivered = Number(input.deliveredHours);
  if (!Number.isFinite(delivered) || delivered < 0) return null;
  const capacity = Number.isFinite(Number(input.capacityHours)) && Number(input.capacityHours) > 0
    ? Number(input.capacityHours)
    : null;
  const planned = Number.isFinite(Number(input.plannedHours)) && Number(input.plannedHours) > 0
    ? Number(input.plannedHours)
    : null;
  const ratioActual = round3(delivered / target);
  const ratioCap = capacity ? round3(delivered / capacity) : null;
  return {
    templateHours: round3(target),
    capacityHours: capacity,
    plannedHours: planned,
    deliveredHours: round3(delivered),
    ratioActual,
    ratioPlanned: planned ? round3(planned / target) : null,
    ratioCap,
    trueGap: ratioActual < 0.6 && (ratioCap === null || ratioCap < 0.8),
    actualVsPlanned: planned ? round3(delivered / planned) : null,
  };
}

export function summarizeDeliveryRatios(rows: DeliveryRatioRow[]): DeliveryRatioSummary {
  const bands: DeliveryRatioBand = { lt04: 0, b04_06: 0, b06_08: 0, b08_10: 0, gt10: 0 };
  for (const row of rows) {
    const value = row.ratioActual;
    if (value < 0.4) bands.lt04 += 1;
    else if (value < 0.6) bands.b04_06 += 1;
    else if (value < 0.8) bands.b06_08 += 1;
    else if (value <= 1) bands.b08_10 += 1;
    else bands.gt10 += 1;
  }
  const computable = rows.length;
  const below60 = rows.filter((row) => row.ratioActual < 0.6).length;
  const trueGap = rows.filter((row) => row.trueGap).length;
  const sorted = rows.map((row) => row.ratioActual).sort((a, b) => a - b);
  const medianActual = computable > 0 ? sorted[Math.floor(computable / 2)] : null;
  const plannedShortfall = rows.filter(
    (row) => row.plannedHours !== null && row.actualVsPlanned !== null && row.actualVsPlanned < 0.8
  ).length;
  const trueGapRate = computable > 0 ? round3(trueGap / computable) : 0;
  return {
    computable,
    below60,
    below60Rate: computable > 0 ? round3(below60 / computable) : 0,
    trueGap,
    trueGapRate,
    medianActual,
    bands,
    plannedShortfall,
    verdict: trueGapRate > 0.4 ? '成立' : '不成立',
  };
}
