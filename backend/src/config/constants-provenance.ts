/**
 * 学习科学常量「来源」登记表 —— 审计 §7 P1-2 的收尾项。
 *
 * 为什么存在：早期审计发现同一口径的量在不同文件里各写一份、数值互相矛盾
 * （如 LSS 的三套公式、LF 的 0.85/0.70 两版 λ），而"这个数是文献来的还是我们拍的"
 * 只写在注释里——改代码的人往往不改变量，注释会静默漂移。
 *
 * 两道机器可校验的防线（`npm run constants:check`，已进 check:quality / CI）：
 *  1. **来源必填**：`source` ∈ {文献, 工程启发式}；标 `文献` 必须给 `ref`
 *     （防"看起来有依据"：拍脑袋的值不许伪装成有出处的）。
 *  2. **防漂移**：`value` 必须等于 `resolve()` 的运行时真值；同一口径若有
 *     多处实现，用 `mirrors` 声明，二者不等即失败（正是"同一个量写两份"的护栏）。
 *
 * 维护约定：新增或修改这里的常量时同步改登记；CI 会拦。
 * 覆盖范围：**状态量 / 难度控制 / 复习调度 / 信念更新 / 检查点触发** 这几类
 * 会进入学习者状态回路的常量（curated，不是全仓常量普查）。
 */

export type ConstantSource = '文献' | '工程启发式';

/** 同一口径的第二处实现：值必须与主值相等（"同一个量写两份"的护栏） */
export interface ConstantMirror {
  /** 另一处实现的位置（人可读，便于修） */
  where: string;
  resolve: () => number | string | boolean;
}

export interface ScientificConstant {
  /** 稳定标识（CI 报告与评审引用用） */
  key: string;
  value: number | string | boolean;
  source: ConstantSource;
  /** 文献出处（source === '文献' 时必填） */
  ref?: string;
  /** 为什么是这个值 / 工程取舍说明 */
  note?: string;
  /** 运行时真值——与 `value` 不符即"标注漂移" */
  resolve: () => number | string | boolean;
  /** 该口径的其它实现（必须同值） */
  mirrors?: ConstantMirror[];
}

import { EWMA_CONFIG, NATURAL_DECAY } from '../services/learning/learning-state.service';
import { KTL_EWMA_LAMBDA, LF_EWMA_LAMBDA } from '../services/metrics/LearningMetricService';
import {
  SUCCESS_BAND_LOW,
  SUCCESS_BAND_HIGH,
  SUCCESS_BAND_MIN_SAMPLE,
  SUCCESS_BAND_WINDOW_DAYS,
} from '../services/learner/independent-success-band.service';
import { DEFAULT_BKT_PARAMS, BKT_PARAM_TIERS } from '../services/learner/concept-belief.service';
import { FSRS_DEFAULT_RETENTION, FSRS_MIN_FIRST_INTERVAL_DAYS } from '../services/memory/fsrs';
import { FRUSTRATION_DECREASE_MIN_STREAK } from '../services/learner/TaskDifficultyAdjustmentService';
import {
  CHECKPOINT_MIN_TURNS,
  CHECKPOINT_TRIGGER_MIN_UNDERSTANDING,
} from '../services/ai-teaching/AITeachingCoordinator';

export const SCIENTIFIC_CONSTANTS: ScientificConstant[] = [
  // ---------- 状态量：掌握趋势 KTL（慢） ----------
  {
    key: 'state.ktl.lambda',
    value: 0.95,
    source: '工程启发式',
    note: 'EWMA 平滑系数；半衰期 h=ln0.5/lnλ≈13.5 天，量级对齐长时记忆的日级衰减。',
    resolve: () => EWMA_CONFIG.KTL_LAMBDA,
    mirrors: [{ where: 'metrics/LearningMetricService.KTL_EWMA_LAMBDA', resolve: () => KTL_EWMA_LAMBDA }],
  },
  {
    key: 'state.ktl.dailyDecayFactor',
    value: 0.99,
    source: '工程启发式',
    note: '未学习日的自然衰减（与 EWMA 分工：一个管更新、一个管搁置）。',
    resolve: () => NATURAL_DECAY.KTL_DAILY_FACTOR,
  },

  // ---------- 状态量：疲劳 LF（快） ----------
  {
    key: 'state.lf.lambda',
    value: 0.7,
    source: '工程启发式',
    note: '归一化 λ（0.70/0.30）：稳态=输入值。旧版 0.70/0.15 系数和 0.85 会把稳态压到 0.5c，'
      + '使 lf≥6 的疲劳阈值实际要求真实疲劳≈12（量程外）⇒ 疲劳保护近乎失效（§7 P1-2）。',
    resolve: () => EWMA_CONFIG.LF_LAMBDA,
    mirrors: [{ where: 'metrics/LearningMetricService.LF_EWMA_LAMBDA', resolve: () => LF_EWMA_LAMBDA }],
  },
  {
    key: 'state.lf.dailyDecayFactor',
    value: 0.74,
    source: '工程启发式',
    note: '半衰期≈1.9 天：疲劳消退远快于掌握，符合"休息一晚明显回血"。',
    resolve: () => NATURAL_DECAY.LF_DAILY_FACTOR,
  },
  {
    key: 'state.lf.baseline',
    value: 1.2,
    source: '工程启发式',
    note: '回归基线：衰减往基线收，而不是往 0 收（完全无负荷 ≠ 疲劳为 0）。',
    resolve: () => NATURAL_DECAY.LF_BASELINE,
  },

  // ---------- 状态量：课内 LSS ----------
  {
    key: 'state.lss.dailyDecayFactor',
    value: 0.82,
    source: '工程启发式',
    note: '课内状态不跨日累积，隔日快速回落。',
    resolve: () => NATURAL_DECAY.LSS_DAILY_FACTOR,
  },

  // ---------- 难度控制：目标成功率带 ----------
  {
    key: 'difficulty.successBand.low',
    value: 0.8,
    source: '文献',
    ref: 'Wilson et al. 2019, "The Eighty Five Percent Rule for optimal learning"（desirable difficulty）；带宽取 0.80–0.90',
    note: '低于带下沿 ⇒ 太难 ⇒ 降档。',
    resolve: () => SUCCESS_BAND_LOW,
  },
  {
    key: 'difficulty.successBand.high',
    value: 0.9,
    source: '文献',
    ref: '同上（85% 规则的上沿；高于上沿说明过易，无学习增益）',
    note: '高于带上沿 ⇒ 太易 ⇒ 升档（双向油门）。',
    resolve: () => SUCCESS_BAND_HIGH,
  },
  {
    key: 'difficulty.successBand.minSample',
    value: 6,
    source: '工程启发式',
    note: '样本下限：先测量再控制——样本不足时"不动"，避免被一两题带偏。',
    resolve: () => SUCCESS_BAND_MIN_SAMPLE,
  },
  {
    key: 'difficulty.successBand.windowDays',
    value: 14,
    source: '工程启发式',
    note: '统计窗口；与复习到期窗口的日尺度对齐。',
    resolve: () => SUCCESS_BAND_WINDOW_DAYS,
  },

  // ---------- 复习调度：FSRS ----------
  {
    key: 'review.fsrs.desiredRetention',
    value: 0.9,
    source: '文献',
    ref: 'FSRS / Anki 默认目标保留率 0.9（考试目标可上调至 0.95）',
    note: '间隔由"降到该保留率所需天数"反推。',
    resolve: () => FSRS_DEFAULT_RETENTION,
  },
  {
    key: 'review.fsrs.minFirstIntervalDays',
    value: 1,
    source: '文献',
    ref: 'FSRS/Anki 最小间隔 1 天（同日不重复排程）',
    resolve: () => FSRS_MIN_FIRST_INTERVAL_DAYS,
  },

  // ---------- 信念更新：BKT 先验 ----------
  {
    key: 'belief.bkt.default.pL0',
    value: 0.3,
    source: '文献',
    ref: 'Corbett & Anderson 1995（BKT）；未拟合先验',
    note: '参数是**未拟合**先验，且 LLM 语义观测不满足 BKT 单技能二值作答假设 ⇒ 只允许有界消费（§7 P1-3）。',
    resolve: () => DEFAULT_BKT_PARAMS.pL0,
  },
  {
    key: 'belief.bkt.default.pT',
    value: 0.15,
    source: '文献',
    ref: 'Corbett & Anderson 1995（BKT）；未拟合先验',
    resolve: () => DEFAULT_BKT_PARAMS.pT,
  },
  {
    key: 'belief.bkt.default.pG',
    value: 0.25,
    source: '文献',
    ref: 'Corbett & Anderson 1995 约束 pG<0.3（严格建议）',
    resolve: () => DEFAULT_BKT_PARAMS.pG,
  },
  {
    key: 'belief.bkt.default.pS',
    value: 0.1,
    source: '文献',
    ref: 'Corbett & Anderson 1995 约束 pS≤0.1；并须满足 pG+pS<1',
    resolve: () => DEFAULT_BKT_PARAMS.pS,
  },
  {
    key: 'belief.bkt.hard.pG',
    value: 0.25,
    source: '文献',
    ref: '同上约束；难点档"噪声更大"的意图改由更低的 pT/pL0 承担（不能靠抬高 pS 实现）',
    resolve: () => BKT_PARAM_TIERS.hard.pG,
  },
  {
    key: 'belief.bkt.hard.pS',
    value: 0.1,
    source: '文献',
    ref: '同上约束（2026-09-17 由 0.15 修正到 0.1，原值违反约束）',
    resolve: () => BKT_PARAM_TIERS.hard.pS,
  },

  // ---------- 情感闭环（§4.5）：软传感器只做减速 ----------
  {
    key: 'emotion.frustration.minStreakToDecelerate',
    value: 2,
    source: '工程启发式',
    note: '连续受挫 ≥2 轮才降档：与 PF 逃生舱同阈值（避免单轮情绪波动就降档）。'
      + '软传感器（LLM 观测的 emotionalState）**只允许降档/减速**，结构上不可能成为升档依据。',
    resolve: () => FRUSTRATION_DECREASE_MIN_STREAK,
  },

  // ---------- 检查点：出题时机（代码给时机，模型给内容） ----------
  {
    key: 'checkpoint.minTurns',
    value: 4,
    source: '工程启发式',
    note: '最小间隔（条消息）：太密会打断课堂节奏。',
    resolve: () => CHECKPOINT_MIN_TURNS,
  },
  {
    key: 'checkpoint.minUnderstanding',
    value: 0.6,
    source: '工程启发式',
    note: '出题前要求"上一轮确有进展"：没进展时先讲，不急着考。',
    resolve: () => CHECKPOINT_TRIGGER_MIN_UNDERSTANDING,
  },
];

/** 供检查脚本与评审用的来源统计 */
export function summarizeConstantSources(constants: ScientificConstant[] = SCIENTIFIC_CONSTANTS) {
  const bySource: Record<ConstantSource, number> = { 文献: 0, 工程启发式: 0 };
  for (const c of constants) bySource[c.source] += 1;
  return { total: constants.length, bySource };
}
