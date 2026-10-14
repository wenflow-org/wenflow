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
    bandTitle: '学习压力 LSS（Learning Stress Score）：0-10，越高越累；参考区间 4–7。',
    toneOf: loadTone,
  },
  {
    key: 'ktl',
    label: 'KTL 训练负荷',
    code: 'KTL',
    band: '慢 EWMA · 参考 ≤ 7',
    bandTitle: '训练负荷 KTL（Knowledge Training Load）：学习压力 LSS 的慢速 EWMA，高 = 压力长期累积；参考 ≤ 7。',
    toneOf: loadTone,
  },
  {
    key: 'lf',
    label: 'LF 学习疲劳',
    code: 'LF',
    band: '警戒 ≥ 6',
    bandTitle: '学习疲劳 LF（Learning Fatigue）：越高越疲劳；≥6 警戒。',
    toneOf: (v) => (v == null || v === 0 ? '' : v >= 6 ? 'bad' : loadTone(v)),
  },
  {
    key: 'lsb',
    label: 'LSB 状态平衡',
    code: 'LSB',
    band: 'KTL−LF · 参考 ≥ 0',
    bandTitle: '状态平衡 LSB = KTL − LF：正 = 状态好；参考 ≥ 0。',
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
