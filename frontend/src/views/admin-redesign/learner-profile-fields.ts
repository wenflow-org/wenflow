/**
 * 画像 KV 的展示口径（2026-11-02 P1-8）。
 *
 * 后端 profile 下发的是枚举原值与 0~1 比率，直接 String() 上屏会读到「moderate」「0.5」
 * 这类接口词：既不像人话，也读不出高低与量纲（「一致性 0.5」是半稳还是不稳？）。
 * 这里把枚举翻成中文分档、把比率标成百分比；没有对应口径的字段原样返回，不硬编。
 *
 * 与本文件配套的是后端 `profileSources`（逐字段来源）：本模块只管「怎么写」，
 * 「这格是实测还是初始默认值」由 sources 决定，两者不要混在一起。
 */

export type ProfileSection =
  | 'cognitive'
  | 'behavioral'
  | 'preferences'
  | 'emotional'
  | 'history'
  | 'curriculumControls'
  | 'derivedInsights'

/** 枚举字段 → 中文分档（键就是画像字段名；同名枚举值在不同字段里含义不同，故按字段分表） */
const ENUM_ZH: Record<string, Record<string, string>> = {
  metacognitionLevel: { high: '高', medium: '中', low: '低' },
  thinkingStyle: { intuitive: '直觉型', logical: '逻辑型', visual: '视觉型', practical: '实践型', mixed: '混合型' },
  confusionPattern: {
    'concept-confusion': '概念混淆',
    'application-difficulty': '应用困难',
    'principle-misunderstanding': '原理误解',
    none: '暂无明显模式'
  },
  priorKnowledgeStructure: { scattered: '零散', systematic: '系统', blank: '接近空白' },
  selfAssessmentAccuracy: { overconfident: '自评偏高', accurate: '准确', underconfident: '自评偏低' },
  preferredStyle: { video: '视频', reading: '阅读', practice: '动手练习', mixed: '混合' },
  theoryVsPractice: { 'theory-first': '先理论后实践', 'practice-first': '先实践后理论', balanced: '理论实践均衡' },
  sessionLength: { short: '短（约 20 分钟）', medium: '中（约 30 分钟）', long: '长（约 60 分钟）' },
  preferredDifficulty: { easy: '偏易', medium: '适中', hard: '偏难' },
  motivationTrigger: { interest: '兴趣驱动', 'problem-solving': '解决问题', 'external-pressure': '外部压力', career: '职业发展' },
  urgencyLevel: { high: '高', medium: '中', low: '低' },
  confidenceLevel: { confident: '自信', moderate: '一般', anxious: '容易紧张' },
  rewardSensitivity: { high: '高', medium: '中', low: '低' },
  taskGranularityLevel: { small: '细粒度', medium: '中等', large: '粗粒度' },
  conceptDensityLevel: { low: '低', medium: '中', high: '高' },
  reviewFrequencyLevel: { low: '低', medium: '中', high: '高' },
  recommendedDifficulty: { easy: '偏易', medium: '适中', hard: '偏难' }
}

/** 布尔字段 → 两个词 */
const BOOL_ZH: Record<string, [string, string]> = {
  prefersHints: ['需要提示', '不需要提示']
}

/** 后端按 0~1 下发的比率字段：上屏统一成百分比（截图走查里 0.5 被读成「5」的情况来自裸小数） */
const RATIO_FIELDS = new Set([
  'engagementLevel',
  'consistencyScore',
  'frustrationTolerance',
  'learningVelocity'
])

/** 比率的量纲说明（百分比本身不自解释「高好还是坏」） */
const RATIO_HINT: Record<string, string> = {
  engagementLevel: '课堂互动的投入程度，0-100%',
  consistencyScore: '学习节奏的稳定程度，0-100%',
  frustrationTolerance: '遇到卡点时的耐受程度，0-100%',
  learningVelocity: '按训练负荷与近期趋势归一后的推进速度，0-100%'
}

/** 字段值上屏文案：枚举/布尔/比率按口径翻译，其余交给调用方的兜底（保留浮点收敛等既有处理） */
export function profileFieldText(key: string, raw: unknown, fallback: (value: unknown) => string): string {
  const enumText = ENUM_ZH[key]?.[String(raw)]
  if (enumText) return enumText
  const boolText = BOOL_ZH[key]
  if (boolText && typeof raw === 'boolean') return raw ? boolText[0] : boolText[1]
  if (RATIO_FIELDS.has(key)) {
    const n = Number(raw)
    if (Number.isFinite(n)) return `${Math.round(Math.max(0, Math.min(1, n)) * 100)}%`
  }
  return fallback(raw)
}

/** 字段值的量纲/口径说明（没写就是空串，模板按空 title 处理）。
    2026-11-09 画像链路核查：把「窗口口径」和「建议 vs 实际」写进 tooltip，避免被读成全量/已生效。 */
const FIELD_HINT: Record<string, string> = {
  totalSessions: '全部课堂记录数（真实计数，不受最近 50 节窗口限制）',
  totalMessages: '最近 50 节课的消息总数（逐会话聚合的窗口口径）',
  avgSessionDuration: '最近 50 节课的平均时长（逐会话聚合的窗口口径）',
  reviewFrequencyLevel: '画像给出的复习节奏建议；实际复习调度由 FSRS 到期队列决定，不由该字段控制',
  optimalSessionLength: '按目标对话里的可用时间推断的建议时长；平台没有真实交互间隔采集，不是测量值'
}

/** 字段值的量纲说明（没写就是空串，模板按空 title 处理） */
export function profileFieldHint(key: string): string {
  return FIELD_HINT[key] || RATIO_HINT[key] || ''
}