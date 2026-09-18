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

import {
  EWMA_CONFIG,
  NATURAL_DECAY,
  AGGREGATION_ACTIVE_WINDOW_DAYS,
  DAY_LOAD_FATIGUE_RULES,
} from '../services/learning/learning-state.service';
import { KTL_EWMA_LAMBDA, LF_EWMA_LAMBDA } from '../services/metrics/LearningMetricService';
import {
  SUCCESS_BAND_LOW,
  SUCCESS_BAND_HIGH,
  SUCCESS_BAND_MIN_SAMPLE,
  SUCCESS_BAND_WINDOW_DAYS,
} from '../services/learner/independent-success-band.service';
import { DEFAULT_BKT_PARAMS, BKT_PARAM_TIERS } from '../services/learner/concept-belief.service';
import {
  FSRS_DEFAULT_RETENTION,
  FSRS_MIN_FIRST_INTERVAL_DAYS,
} from '../services/memory/fsrs';
import { DEFAULT_DAILY_LOAD_LIMIT } from '../services/memory/review-quota.service';
import {
  BASE_LOAD_BUDGET,
  LOW_LOAD_BUDGET,
  HIGH_LOAD_BUDGET,
  MAX_WARMUP_ITEMS,
  LEECH_CONSECUTIVE_AGAIN,
  GRADUATE_CONSECUTIVE_SUCCESS,
  MIN_BUDGET_SAMPLE,
  SESSION_DAILY_SHARE_CAP,
  SESSION_DAILY_SHARE_FLOOR,
  BELIEF_DIVERGENCE_MASTERY,
  BELIEF_DIVERGENCE_PKNOWL,
  MAX_SINGLE_LOAD,
} from '../services/memory/review-plan.service';
import {
  GRANULARITY_FACTOR,
  PROCEDURAL_FACTOR,
  HARD_FACTOR,
} from '../services/memory/concept-load.service';
import { MISCONCEPTION_STABILITY_MULTIPLIER } from '../services/learner/ReviewCompletedConsumer';
import {
  CHALLENGE_CAP_LIMITS,
  DIFFICULTY_RANGE,
  FRUSTRATION_DECREASE_MIN_STREAK,
} from '../services/learner/TaskDifficultyAdjustmentService';
import {
  CHECKPOINT_MIN_TURNS,
  CHECKPOINT_TRIGGER_MIN_UNDERSTANDING,
  WARMUP_FUZZY_MIN_LENGTH,
  WARMUP_FUZZY_OVERLAP_MIN,
  RECOVERY_WINDOW_MS,
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

  // ---------- 状态量：学习者级聚合（按路径 max + 当日课量加成） ----------
  {
    key: 'state.aggregation.activeWindowDays',
    value: 14,
    source: '工程启发式',
    note: '只有窗口内有活动的路径才参与全局聚合；陈年峰值（实证见过 7 月的 ktl 4.4）不再顶住当前判断。',
    resolve: () => AGGREGATION_ACTIVE_WINDOW_DAYS,
  },
  {
    key: 'state.dayLoad.fatigue.perExtraLesson',
    value: 0.5,
    source: '工程启发式',
    note: '当天第 1 节课不额外加疲劳，之后每多一节 +0.5；与复习额度「单课份额」分开，各管各的口径。',
    resolve: () => DAY_LOAD_FATIGUE_RULES.perExtraLesson,
  },
  {
    key: 'state.dayLoad.fatigue.maxLessonBonus',
    value: 2,
    source: '工程启发式',
    note: '课节数加成的封顶，避免"一天十节课"把 lf 顶穿 10。',
    resolve: () => DAY_LOAD_FATIGUE_RULES.maxLessonBonus,
  },
  {
    key: 'state.dayLoad.fatigue.freeMinutes',
    value: 90,
    source: '工程启发式',
    note: '当日累计时长免加成区间（分钟）；90 分钟内的学习不算"过量"。',
    resolve: () => DAY_LOAD_FATIGUE_RULES.freeMinutes,
  },
  {
    key: 'state.dayLoad.fatigue.perExtra30Minutes',
    value: 0.25,
    source: '工程启发式',
    note: '超出免加成时长后，每 30 分钟 +0.25。',
    resolve: () => DAY_LOAD_FATIGUE_RULES.perExtra30Minutes,
  },
  {
    key: 'state.dayLoad.fatigue.maxMinutesBonus',
    value: 1.5,
    source: '工程启发式',
    note: '时长加成封顶，防止超长挂机把全局疲劳顶高。',
    resolve: () => DAY_LOAD_FATIGUE_RULES.maxMinutesBonus,
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
  {
    key: 'difficulty.challengeCap.low',
    value: 4,
    source: '工程启发式',
    note: 'paceMode=recover（累了）时的任务难度封顶；上限只封顶、不额外降一档（避免同一压力被算两次）。',
    resolve: () => CHALLENGE_CAP_LIMITS.low,
  },
  {
    key: 'difficulty.challengeCap.medium',
    value: 7,
    source: '工程启发式',
    note: 'steady（常态）封顶。',
    resolve: () => CHALLENGE_CAP_LIMITS.medium,
  },
  {
    key: 'difficulty.challengeCap.high',
    value: 10,
    source: '工程启发式',
    note: 'push（有余力）封顶；也是升档资格的前提（cap=high 才允许升）。',
    resolve: () => CHALLENGE_CAP_LIMITS.high,
  },
  {
    key: 'difficulty.range.min',
    value: 1,
    source: '工程启发式',
    note: '难度取值域下界，与 LSS/KTL 的 0-10 内刻度相邻（任务难度天然从 1 起）。',
    resolve: () => DIFFICULTY_RANGE.min,
  },
  {
    key: 'difficulty.range.max',
    value: 10,
    source: '工程启发式',
    note: '难度取值域上界，与 0-10 状态刻度对齐。',
    resolve: () => DIFFICULTY_RANGE.max,
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

  // ---------- 复习调度：当日额度与课内温故预算 ----------
  {
    key: 'review.dailyLoadLimit',
    value: 6,
    source: '工程启发式',
    note: '跨会话共享的当日温故负担上限（负担单位）≈ 3 节课 × 基准预算 2.0；防"一天反复开课把温故量放大三倍"（Anki 积压一次性倒出）。env REVIEW_DAILY_LOAD_LIMIT 可覆盖。',
    resolve: () => DEFAULT_DAILY_LOAD_LIMIT,
  },
  {
    key: 'review.budget.base',
    value: 2,
    source: '工程启发式',
    note: '单节课基准负担预算 ≈ 两个原子点（1.0+1.0）或一个复合点（1.5）；无样本/样本不足时取它。',
    resolve: () => BASE_LOAD_BUDGET,
  },
  {
    key: 'review.budget.low',
    value: 1,
    source: '工程启发式',
    note: '近期检索成功率偏低（<0.7 且样本充足）→ 收缩预算（点太难/预算定高了）。',
    resolve: () => LOW_LOAD_BUDGET,
  },
  {
    key: 'review.budget.high',
    value: 3,
    source: '工程启发式',
    note: '近期检索成功率偏高（>0.9 且样本充足）→ 扩张预算（间隔偏短/预算偏保守）。',
    resolve: () => HIGH_LOAD_BUDGET,
  },
  {
    key: 'review.maxWarmupItems',
    value: 3,
    source: '工程启发式',
    note: '单节课温故条数硬上限（即使预算充裕也不超过）；预算按负担而非条数，这是条数兜底。',
    resolve: () => MAX_WARMUP_ITEMS,
  },
  {
    key: 'review.minBudgetSample',
    value: 5,
    source: '工程启发式',
    note: '切换预算档位所需的最小结果样本数：样本不足保持基准，防"1/1 成功即跳到高档"。',
    resolve: () => MIN_BUDGET_SAMPLE,
  },
  {
    key: 'review.sessionDailyShareCap',
    value: 0.6,
    source: '工程启发式',
    note: '单节课最多占用"当日剩余额度"的比例：让额度在一天多节课之间摊开，而不是第一节课吃光。',
    resolve: () => SESSION_DAILY_SHARE_CAP,
  },
  {
    key: 'review.sessionDailyShareFloor',
    value: 1,
    source: '工程启发式',
    note: '单节课额度下限（负担单位）：剩余很少时也保留一点，避免当天第二节完全不能温故。',
    resolve: () => SESSION_DAILY_SHARE_FLOOR,
  },
  {
    key: 'review.singleLoadCap',
    value: 3,
    source: '工程启发式',
    note: '单个知识点的负担上限：防多因子连乘（复合×流程×…）让一个点吃掉整份预算。',
    resolve: () => MAX_SINGLE_LOAD,
  },
  {
    key: 'review.leechConsecutiveAgain',
    value: 3,
    source: '工程启发式',
    note: '连续失败达到该次数判"没学会"→ 退出复习队列、转回路径重学（Anki leech 语义）。',
    resolve: () => LEECH_CONSECUTIVE_AGAIN,
  },
  {
    key: 'review.graduateConsecutiveSuccess',
    value: 5,
    source: '工程启发式',
    note: '连续成功达到该次数判"毕业"→ 不再按计划间隔回捞（仅在保留率跌破阈值时回捞）。',
    resolve: () => GRADUATE_CONSECUTIVE_SUCCESS,
  },
  {
    key: 'review.beliefDivergence.mastery',
    value: 0.7,
    source: '工程启发式',
    note: '状态/自评 masteryScore ≥ 此值算"说掌握了"；与下一条共同触发信念背离 → 建议回路径重学（BKT 只产建议，不改间隔/难度）。',
    resolve: () => BELIEF_DIVERGENCE_MASTERY,
  },
  {
    key: 'review.beliefDivergence.pKnowL',
    value: 0.2,
    source: '工程启发式',
    note: 'BKT 信念 pKnowL ≤ 此值算"仍未掌握"；与上一条组合判定背离（BKT 未拟合，仅作有界消费）。',
    resolve: () => BELIEF_DIVERGENCE_PKNOWL,
  },

  // ---------- 复习负担：单概念认知负荷因子 ----------
  {
    key: 'review.conceptLoad.granularityFactor',
    value: 1.5,
    source: '工程启发式',
    note: '复合/超长概念（一个名字其实是一个技能簇）的负担乘数。因子设计为"只有惩罚没有奖励"，不因模型乐观而扩张额度。',
    resolve: () => GRANULARITY_FACTOR,
  },
  {
    key: 'review.conceptLoad.proceduralFactor',
    value: 1.5,
    source: '工程启发式',
    note: '过程型知识（检索需多步）的负担乘数。',
    resolve: () => PROCEDURAL_FACTOR,
  },
  {
    key: 'review.conceptLoad.hardFactor',
    value: 1.3,
    source: '工程启发式',
    note: '难点档位的负担乘数。掌握度刻意不作乘数（到期项几乎必然掌握弱，统一加价只会架空"2.0≈两个原子点"且无区分度）。',
    resolve: () => HARD_FACTOR,
  },

  // ---------- 记忆：误解惩罚 ----------
  {
    key: 'memory.misconception.stabilityMultiplier',
    value: 0.85,
    source: '工程启发式',
    note: '存在活跃误解时，复习后 FSRS 稳定性打折（下次更早），为对比式纠错留出机会；与旧直写路径 bumpReviewInterval 同值。',
    resolve: () => MISCONCEPTION_STABILITY_MULTIPLIER,
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
  {
    key: 'belief.bkt.easy.pL0',
    value: 0.4,
    source: '文献',
    ref: 'Corbett & Anderson 1995（BKT）；简单点起点先验更高（按难度分档，零训练先验）',
    resolve: () => BKT_PARAM_TIERS.easy.pL0,
  },
  {
    key: 'belief.bkt.easy.pT',
    value: 0.2,
    source: '文献',
    ref: 'Corbett & Anderson 1995（BKT）；简单点"学一次就通"比例更高',
    resolve: () => BKT_PARAM_TIERS.easy.pT,
  },
  {
    key: 'belief.bkt.easy.pG',
    value: 0.15,
    source: '文献',
    ref: 'Corbett & Anderson 1995 约束 pG<0.3；事实型单点上"蒙对"更少见',
    resolve: () => BKT_PARAM_TIERS.easy.pG,
  },
  {
    key: 'belief.bkt.easy.pS',
    value: 0.08,
    source: '文献',
    ref: 'Corbett & Anderson 1995 约束 pS≤0.1',
    resolve: () => BKT_PARAM_TIERS.easy.pS,
  },
  {
    key: 'belief.bkt.hard.pL0',
    value: 0.2,
    source: '文献',
    ref: 'Corbett & Anderson 1995（BKT）；难点起点先验更低（"难点噪声更大"的意图改由 pL0/pT 承担）',
    resolve: () => BKT_PARAM_TIERS.hard.pL0,
  },
  {
    key: 'belief.bkt.hard.pT',
    value: 0.1,
    source: '文献',
    ref: 'Corbett & Anderson 1995（BKT）；难点学习率更低：一次机会不足以跨越',
    resolve: () => BKT_PARAM_TIERS.hard.pT,
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

  // ---------- 课内温故：名称匹配与恢复窗口（AITeachingCoordinator） ----------
  {
    key: 'warmup.fuzzy.minLength',
    value: 8,
    source: '工程启发式',
    note: '保守包含匹配的归一化字符数门槛：短名包含关系太容易误伤，宁可不匹配（误判会把本节知识点当温故点摘掉）。',
    resolve: () => WARMUP_FUZZY_MIN_LENGTH,
  },
  {
    key: 'warmup.fuzzy.overlapMin',
    value: 0.8,
    source: '工程启发式',
    note: '字符重合率下限（以较短名为分母）：调序+截断并存时的最后退路，再松就会误伤本节知识点。',
    resolve: () => WARMUP_FUZZY_OVERLAP_MIN,
  },
  {
    key: 'session.recoveryWindowMs',
    value: 172800000,
    source: '工程启发式',
    note: '断线可恢复窗口（48h，毫秒）：超过则视为新会话，避免"几天前的课"被当成进行中。',
    resolve: () => RECOVERY_WINDOW_MS,
  },
];

/** 供检查脚本与评审用的来源统计 */
export function summarizeConstantSources(constants: ScientificConstant[] = SCIENTIFIC_CONSTANTS) {
  const bySource: Record<ConstantSource, number> = { 文献: 0, 工程启发式: 0 };
  for (const c of constants) bySource[c.source] += 1;
  return { total: constants.length, bySource };
}
