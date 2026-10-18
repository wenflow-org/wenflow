/**
 * 学习负荷判据（相对量）——单一真理源
 *
 * 把「疲劳/节奏/可加速」等**机制判定**从绝对量（`lf >= 6`、`ktl >= 5` 这类）迁到**相对量**：
 *
 *   form = ktl − lf                 （= 既有的 lsb！TSB 角色）
 *   acwr = lf / ktl                 （急性:慢性负荷比，尺度无关）
 *
 * 为什么必须相对量：PMC 日负荷口径下，KTL/LF 随**每日课量**放大（一天 3 节 → 日负荷 ~15，
 * KTL/LF 稳态也 ~15）。此时绝对阈值失效——一个**习惯每天上 3 节**的学习者（已适应）会被
 * `lf >= 6` 永久判成"高疲劳"。相对量则正确：习惯者 acwr≈1（已适应），突然加量者 acwr>1.3（爬升）。
 *
 * 分带（标准 ACWR 带，见 doi:10.1136/bjsports-2015-095788 与 PMC/TSB 惯例）：
 *   acwr ≥ 1.5  → 急性负荷远超慢性（爬升过快，过度负荷风险）
 *   acwr ≥ 1.15 → 轻微爬升
 *   acwr ≤ 0.85 → 疲劳已消退（恢复良好，有余力）
 * 阈值集中在此，供 constants-provenance 登记与调参；**消费方只调本模块，不各写一套**。
 */

/** 判据阈值（唯一口径）。 */
export const LOAD_VERDICT_THRESHOLDS = {
  /** acwr ≥ 此值 → 高疲劳（acute 远超 chronic） */
  fatigueHighAcwr: 1.5,
  /** acwr ≥ 此值 → 中疲劳 */
  fatigueMediumAcwr: 1.15,
  /** form ≤ 此值 → 也判高疲劳（疲劳明显超过适应基座，即"欠账"；捕捉 lf 大、ktl 小的爬升/失衡态） */
  fatigueHighFormBelow: -1.5,
  /** acwr ≤ 此值 → 恢复良好（有余力） */
  recoveredAcwr: 0.85,
  /** acwr ≤ 此值 → **明显有余力**（可"加速/压缩"；对齐旧 `ktl>=6 && lf<=3` ⇒ acwr≤0.5） */
  accelerateAcwr: 0.5,
  /** 加速还需 ktl 达此下限（"已有可用适应基座"；新学习者负荷太薄不该被压缩）。
   *  注：这是**绝对量**，PMC 口径下需按真实分布重标——本批先沿用旧刻度值保持行为对齐。 */
  minKtlForAccelerate: 6,
  /**
   * ACWR 的**有效性下限**（ktl 低于此值时不判 acwr）：冷启动退化——从 0 起步的头几天，
   * acwr = (1−λl)/(1−λk) = 0.3/0.05 = 6 恒定（与负荷大小无关），任何新学习者第一天都会被
   * 误判"高疲劳"。ACWR 需要「慢性基座」成熟才可信（运动科学惯例 ~28 天；本刻度下 ktl 达 3
   * 约需 ~3 周稳定负荷）。低于此值 → acwr=null、不升疲劳档（薄历史学习者本就不可分类）。
   */
  minKtlForRatio: 3,
} as const;

export interface LoadSnapshot {
  ktl: number;
  lf: number;
}

export interface LoadVerdict {
  /** 相对形态 = ktl − lf（= 既有 lsb） */
  form: number;
  /** 急性:慢性负荷比 = lf / ktl；ktl 无有效基座时 null */
  acwr: number | null;
  /** 疲劳档：由 acwr 定（尺度无关） */
  fatigueRisk: 'low' | 'medium' | 'high';
  /** 全局节奏：慢（爬升过快）/ 快（恢复良好）/ 中 */
  pacing: 'slow' | 'moderate' | 'fast';
  /** 是否处于爬升期（acwr ≥ fatigueMediumAcwr） */
  ramping: boolean;
  /** 是否恢复良好（acwr ≤ recoveredAcwr，即有加速余力） */
  recovered: boolean;
  /** 是否明显有余力（acwr ≤ accelerateAcwr，可"压缩/加速"；比 recovered 更严） */
  accelerateReady: boolean;
  /** 适应基座是否已成熟（ktl ≥ minKtlForRatio）——未成熟时 lsb/acwr 都不可判 */
  mature: boolean;
  /**
   * 负荷失衡（form = ktl − lf < 0）**且基座已成熟**。
   *
   * 为什么要「且成熟」：PMC 从 0 起步时 KTL（慢，0.05/课）与 LF（快，0.30/课）都从 0 长出，
   * 爬升期 lf 必然 > ktl → **新学习者每节课都会 lsb<0**（这是"在建立适应"，不是"失衡"）。
   * 旧模型首课 KTL/LF 被播种为 lss×0.5 / lss×0.3 → lsb>0，故旧口径没暴露此问题。
   * 基座成熟后 lsb<0 才真正表示"疲劳短期超出适应"。
   */
  imbalanced: boolean;
}

const num = (v: number | null | undefined): number => (Number.isFinite(v as number) ? Math.max(0, v as number) : 0);

/**
 * 从一次状态快照（ktl/lf）派生相对量判据。**纯函数、尺度无关**：
 * 快照来自旧模型（0-10）还是 PMC 日负荷（可 >10）都成立。
 */
export function classifyLoad(snapshot: LoadSnapshot): LoadVerdict {
  const ktl = num(snapshot.ktl);
  const lf = num(snapshot.lf);
  const form = ktl - lf;
  const t = LOAD_VERDICT_THRESHOLDS;
  const acwr = ktl >= t.minKtlForRatio ? lf / ktl : null;

  let fatigueRisk: LoadVerdict['fatigueRisk'] = 'low';
  // 高疲劳**只由 ACWR 定**（尺度无关）：急性/慢性比 ≥ 1.5。不用绝对 form——form 的绝对值在
  // 日负荷口径下也是尺度相关的（冷启动时 ktl 很小、lf 略大 → form 天然很负，会把新学习者的
  // 第一节课误判成"高疲劳"）。ktl 无有效基座（< minKtlForRatio）时 acwr=null → 不判高。
  if (acwr !== null && acwr >= t.fatigueHighAcwr) {
    fatigueRisk = 'high';
  } else if (acwr !== null && acwr >= t.fatigueMediumAcwr) {
    fatigueRisk = 'medium';
  }

  // 节奏：ACWR 甜区（0.8–1.3）是适应最佳区——**不该**因此减速。只有明显超载（≥1.5）减速、
  // 明显欠载（≤0.5，恢复充分）加速。这比旧的绝对 `lf>=6 → slow` 更准（旧口径会把甜区误判为累）。
  let pacing: LoadVerdict['pacing'] = 'moderate';
  if (fatigueRisk === 'high') pacing = 'slow';
  else if (acwr !== null && acwr <= t.accelerateAcwr) pacing = 'fast';

  return {
    form,
    acwr,
    fatigueRisk,
    pacing,
    ramping: fatigueRisk !== 'low',
    recovered: acwr !== null && acwr <= t.recoveredAcwr,
    // 加速：明显有余力（acwr ≤ 0.5）且已有可用适应基座（ktl ≥ 下限；新学习者不该被压缩）
    accelerateReady: acwr !== null && acwr <= t.accelerateAcwr && ktl >= t.minKtlForAccelerate,
    mature: ktl >= t.minKtlForRatio,
    // 失衡 = form<0 **且基座成熟**（否则是冷启动爬升期，属"正在建立适应"，不是失衡）
    imbalanced: form < 0 && ktl >= t.minKtlForRatio,
  };
}

/** 便捷：仅要疲劳档。 */
export function fatigueRiskOf(snapshot: LoadSnapshot): LoadVerdict['fatigueRisk'] {
  return classifyLoad(snapshot).fatigueRisk;
}

/** 便捷：仅要节奏。 */
export function pacingOf(snapshot: LoadSnapshot): LoadVerdict['pacing'] {
  return classifyLoad(snapshot).pacing;
}
