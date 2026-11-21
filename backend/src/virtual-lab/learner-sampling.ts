/**
 * 虚拟学习者分层采样（2026-11-21）。
 *
 * 背景：persona/scenario-designer 的提示词里写了「每个枚举各档约 1/3 / 每 10 个 2-3 个学生」，
 * 但单次 LLM 调用是无状态的，靠提示词祈祷全局均匀分布必然失效（实测历史产出
 * 73% minimal / 68% low / 62% doing）。这里把分层采样下沉到编排层代码：
 * 调用方传入一个递增的 samplingIndex，本模块掷出一组硬坐标，提示词只负责围绕坐标
 * 构造自洽的人物，不再负责统计学。
 *
 * 组合用错位取模（模 3 / 4 / 10），连续 12-20 个样本即可覆盖全部档位且边际大致均衡。
 */

export type SampleType = 'student' | 'general'

export interface SamplingDirectives {
  sampleType: SampleType
  availableTime: 'minimal' | 'moderate' | 'abundant'
  techComfort: 'low' | 'medium' | 'high'
  learningStyle: 'reading' | 'watching' | 'doing' | 'listening'
  cognitiveLoadTolerance: 'low' | 'normal' | 'high'
  motivationType: 'career' | 'interest' | 'necessity' | 'social'
}

const AVAILABLE_TIME = ['minimal', 'moderate', 'abundant'] as const
const TECH_COMFORT = ['low', 'medium', 'high'] as const
const LEARNING_STYLE = ['reading', 'watching', 'doing', 'listening'] as const
const LOAD_TOLERANCE = ['low', 'normal', 'high'] as const
const MOTIVATION = ['career', 'interest', 'necessity', 'social'] as const

/** 传统学生比例 3/10（提示词要求每 10 个 2-3 个，30% 在上界） */
const STUDENT_SLOTS = new Set([0, 4, 7])

function pick<T>(list: readonly T[], index: number): T {
  const normalized = ((index % list.length) + list.length) % list.length
  return list[normalized]
}

export function buildSamplingDirectives(index: number, options: { student?: boolean } = {}): SamplingDirectives {
  const i = Number.isFinite(index) ? Math.max(0, Math.trunc(index)) : 0
  const sampleType: SampleType = options.student === true
    ? 'student'
    : options.student === false
      ? 'general'
      : (STUDENT_SLOTS.has(i % 10) ? 'student' : 'general')
  // 错位取模：避免五个维度同相位导致「低时间=低技术=低耐受」总捆在一起。
  return {
    sampleType,
    availableTime: pick(AVAILABLE_TIME, i),
    techComfort: pick(TECH_COMFORT, Math.floor(i / 3)),
    learningStyle: pick(LEARNING_STYLE, i + 1),
    cognitiveLoadTolerance: pick(LOAD_TOLERANCE, i + 2),
    motivationType: pick(MOTIVATION, i + 3),
  }
}

/** 提示词里的硬坐标块（persona-designer 的 samplingDirectives 输入） */
export function describeSamplingDirectives(directives: SamplingDirectives): string {
  return [
    `sampleType=${directives.sampleType}`,
    `availableTime=${directives.availableTime}`,
    `techComfort=${directives.techComfort}`,
    `learningStyle=${directives.learningStyle}`,
    `cognitiveLoadTolerance=${directives.cognitiveLoadTolerance}`,
    `motivationType=${directives.motivationType}`,
  ].join('；')
}
