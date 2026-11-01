/**
 * LSS / KTL / LF / LSB 四读数的**单一口径**（管理端两页 + 学习端完课卡共用）。
 *
 * 语义来源 backend/src/services/learning/learning-state.service.ts：
 *   LSS = Learning Stress Score 学习压力（0-10，越高越累）
 *   KTL = Knowledge Training Load 训练负荷（LSS 的慢 EWMA，高 = 压力长期累积）
 *   LF  = Learning Fatigue 学习疲劳（≥6 警戒）
 *   LSB = KTL − LF 状态平衡（正 = 状态好）
 * 三者均为**负荷类**——高值是坏、低值是好。
 *
 * ⚠ 与「会话级」评分不是一回事：完课卡上的 sessionKtl 是后端 `evaluation.sessionKtl`
 * = **本节知识获得质量**（high = 8-10 学生能独立完成核心任务，高 = 好），判据见
 * prompts/skill.session-wrapup.md 与 LearnerKnowledgeMemoryService 的 resolveEvaluationSignal。
 * 长期状态里的 `ktl` 才是训练负荷。两者同名不同义，别互相套用框法。
 *
 * 本文件只放**纯定义**（无任何 import），好让 src/components/ 下的学习端组件也能引；
 * 管理端的读数出处文案在 views/admin-redesign/opsShared.ts 的 loadCaliber()。
 */
export type LearnerMetricKey = 'lss' | 'ktl' | 'lf' | 'lsb'
/** '' = 不判色（缺值 / 中性）；ok = 低负荷（好）、warn = 中间档、bad = 高负荷（坏） */
export type LearnerMetricTone = 'ok' | 'warn' | 'bad' | ''

export interface LearnerMetricDef {
  key: LearnerMetricKey
  /** 完整标签，各处同用（如「LF 学习疲劳」，不再出现「疲劳度」「知识掌握」的别名） */
  label: string
  /** 短代码，图例/卡头罗列用 */
  code: string
  /** 可见参考带（短口径，管理端 hint / ref 徽章用） */
  band: string
  /** 悬停长释 */
  bandTitle: string
  toneOf: (v: number | null | undefined) => LearnerMetricTone
}

/** 负荷类色调：高=坏、低=好。0 视同缺值不判色（保留既有视觉，避免新学者被标绿）。 */
function loadTone(v: number | null | undefined): LearnerMetricTone {
  if (v == null || v === 0) return ''
  return v >= 7 ? 'bad' : v <= 4 ? 'ok' : 'warn'
}

const METRICS: LearnerMetricDef[] = [
  {
    key: 'lss',
    label: 'LSS 学习压力',
    code: 'LSS',
    band: '0–10 · 参考 4–7',
    bandTitle: '学习压力 LSS（Learning Stress Score）：0-10，越高说明越累。',
    toneOf: loadTone,
  },
  {
    key: 'ktl',
    label: 'KTL 训练负荷',
    code: 'KTL',
    band: '慢 EWMA · 参考 ≤ 7',
    bandTitle: '训练负荷 KTL（Knowledge Training Load）：学习压力的慢速均值，越高说明压力累积越久。',
    toneOf: loadTone,
  },
  {
    key: 'lf',
    label: 'LF 学习疲劳',
    code: 'LF',
    band: '警戒 ≥ 6',
    bandTitle: '学习疲劳 LF（Learning Fatigue）：越高说明越疲劳。',
    toneOf: (v) => (v == null || v === 0 ? '' : v >= 6 ? 'bad' : loadTone(v)),
  },
  {
    key: 'lsb',
    label: 'LSB 状态平衡',
    code: 'LSB',
    band: 'KTL−LF · 参考 ≥ 0',
    bandTitle: '状态平衡 LSB = 训练负荷 − 学习疲劳：正数说明状态好，负数说明该休息了。',
    toneOf: (v) => (v == null || v === 0 ? '' : v >= 1 ? 'ok' : v <= -3 ? 'bad' : 'warn'),
  },
]

export const LEARNER_METRICS: readonly LearnerMetricDef[] = METRICS

export function learnerMetric(key: LearnerMetricKey): LearnerMetricDef {
  const def = METRICS.find((m) => m.key === key)
  if (!def) throw new Error(`未知学习者读数: ${key}`)
  return def
}

/** 四读数卡头图例（各处同款，避免一处「LSS · KTL · LF · LSB」另一处写成别的顺序/别名） */
export const LEARNER_METRIC_CODES = METRICS.map((m) => m.code).join(' · ')

/* ---------------------------------------------------------------------------
 * 刻度换算（2026-11-01 外部评审 P0 修复）
 *
 * 同一套 LSS/KTL/LF/LSB 在库里有两个刻度，后端 `learning-state-types.ts` 已把它们分成
 * `LearnerMetricsInternalTen`（0–10，快照/落库侧）与 `DisplayHundred`（0–100，展示契约），
 * 并注明「同一个 lss 在落库侧是 0-10、在回调契约里是 0-100，混用就是事故」。
 *
 * 管理端学习者详情页恰好两处都画：卡片四读数读快照（0–10），下方「学习压力记录」曲线读
 * `learning_metrics`（0–100）——同屏两个读数差 10 倍、风险判断相反（实测：卡 1.1 / 曲线 10.8，
 * LF 卡上判绿、曲线上判红）。该页的图例、警戒线（60）与口径文案都是 0–100，故本页统一到 0–100：
 * 快照读数经本文件换算后再上屏，阈值同步按 10 倍口径判色。
 * ------------------------------------------------------------------------- */

/** 内部 0–10 → 展示 0–100（null/undefined/非有限值按缺值透传） */
export function toDisplayHundred(v: number | null | undefined): number | null {
  if (v == null || !Number.isFinite(v)) return null
  return Math.max(0, Math.min(100, v * 10))
}

/**
 * 展示刻度（0–100）的负荷类判色：与 0–10 口径同比例（好 ≤40、坏 ≥70；LF 警戒 60）。
 * 0 视同缺值不判色，与 0–10 版 `loadTone` 一致。
 */
export function toneOfHundred(key: LearnerMetricKey, v: number | null | undefined): LearnerMetricTone {
  if (v == null || v === 0) return ''
  if (key === 'lsb') return v >= 10 ? 'ok' : v <= -30 ? 'bad' : 'warn'
  if (key === 'lf') return v >= 60 ? 'bad' : v <= 40 ? 'ok' : 'warn'
  return v >= 70 ? 'bad' : v <= 40 ? 'ok' : 'warn'
}

/** 展示刻度（0–100）的参考带文案，供已统一到 0–100 的页面直接用（避免与 0–10 文案同屏打架） */
export const LEARNER_METRIC_BAND_HUNDRED: Record<LearnerMetricKey, { band: string; bandTitle: string }> = {
  lss: { band: '0–100 · 参考 40–70', bandTitle: '学习压力 LSS（Learning Stress Score）：0-100，越高说明越累。' },
  // KTL 的长释不涉刻度（同为「慢速均值」语义）→ 引用基础定义，只覆盖参考带
  ktl: { band: '慢 EWMA · 参考 ≤ 70', bandTitle: learnerMetric('ktl').bandTitle },
  lf: { band: '警戒 ≥ 60', bandTitle: '学习疲劳 LF（Learning Fatigue）：0-100，越高说明越疲劳。' },
  // 0–100 与 0–10 两档的 LSB 文案一致（同为差值语义，不涉刻度）——直接引用基础定义，避免抄两份
  lsb: { band: learnerMetric('lsb').band, bandTitle: learnerMetric('lsb').bandTitle },
}
