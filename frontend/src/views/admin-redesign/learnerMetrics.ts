/**
 * LSS / KTL / LF / LSB 四读数的**单一口径**（管理端三处渲染点共用）。
 *
 * 语义来源 backend/src/services/learning/learning-state.service.ts：
 *   LSS = Learning Stress Score 学习压力（0-10，越高越累）
 *   KTL = Knowledge Training Load 训练负荷（LSS 的慢 EWMA，高 = 压力长期累积）
 *   LF  = Learning Fatigue 学习疲劳（≥6 警戒）
 *   LSB = KTL − LF 状态平衡（正 = 状态好）
 * 三者均为**负荷类**——高值是坏、低值是好。
 *
 * 为什么要有这个文件：同一个读数此前在 LearnerDetail（两处：概览「学习状态追踪」+ 证据
 * 「压力记录」卡头）与 VirtualProfile（概览/画像两处「学习状态读数」）各自硬编码标签与参考带，
 * 且互相打架——LSS 一边「0-10，越高越累」一边「参考 4–7」、KTL 一边「压力长期累积」一边
 * 「参考 ≤ 7」、LF 一边「学习疲劳」一边「疲劳度」。现在标签/参考带/色调阈值只此一份。
 *
 * 另附 loadCaliber()：四个读数在管理端有两套**完全不同的来源**，数值天然不同，此前两页都不
 * 标出处，同屏对照会以为其中一个坏了。见 LOAD_CALIBER 的说明。
 */
import { timeAgo } from './live'

export type LearnerMetricKey = 'lss' | 'ktl' | 'lf' | 'lsb'
/** '' = 不判色（缺值 / 中性）；ok = 低负荷（好）、warn = 中间档、bad = 高负荷（坏） */
export type LearnerMetricTone = 'ok' | 'warn' | 'bad' | ''

export interface LearnerMetricDef {
  key: LearnerMetricKey
  /** 完整标签，两页同用（如「LF 学习疲劳」，不再出现「疲劳度」的别名） */
  label: string
  /** 短代码，图例/卡头罗列用 */
  code: string
  /** 可见参考带（短口径，进 hint / ref 徽章） */
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

/** 四读数卡头图例（两页同款，避免一处「LSS · KTL · LF · LSB」另一处写成别的顺序/别名） */
export const LEARNER_METRIC_CODES = METRICS.map((m) => m.code).join(' · ')

/* ------------------------------------------------------------------ *
 * 读数出处（口径透明化）
 * ------------------------------------------------------------------ */

/** 读数来源两分：学习者级聚合快照 vs 单次会话的运行时快照。 */
export type LoadCaliber = 'aggregate' | 'session-snapshot'

export interface LoadCaliberNote {
  /** 可见短标（进卡头 mk-card__meta） */
  label: string
  /** 悬停长释：说清来源与「为什么另一页的数字不一样」 */
  title: string
}

export function loadCaliber(kind: LoadCaliber, at?: string | null): LoadCaliberNote {
  const hasStamp = !!at && !Number.isNaN(new Date(at).getTime())
  const stamp = hasStamp ? timeAgo(at) : ''
  const stampLine = hasStamp ? `\n取样时刻：${stamp}。` : ''
  if (kind === 'aggregate') {
    return {
      label: hasStamp ? `学习者级聚合 · 快照 ${stamp}` : '学习者级聚合',
      title:
        `LSS/KTL/LF/LSB 取自**学习者级聚合快照**（learning-state.service 按路径保守聚合 + 当日课量疲劳加成），` +
        `不是某一次会话的读数。${stampLine}\n同一学习者在「虚拟学习者档案」页看到的同名读数取自单次会话的运行时快照，数值天然不同——那是两套来源，不是其中一处算错。`,
    }
  }
  return {
    label: hasStamp ? `单次会话快照 · ${stamp}` : '单次会话快照',
    title:
      `LSS/KTL/LF/LSB 取自**最近一次带读数的教学会话**的运行时快照（该会话 teachingState 的 currentState），` +
      `不是学习者级聚合。${stampLine}\n同一学习者在「学习者详情」页看到的同名读数是学习者级聚合态，数值天然不同——那是两套来源，不是其中一处算错。`,
  }
}
