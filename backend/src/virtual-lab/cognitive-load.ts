/**
 * 教师单轮信息量 → 学习者工作记忆超载信号（2026-11-21）。
 *
 * 人类工作记忆一次只能处理 3-4 个信息块；LLM 没有这个生理限制，容易一路「懂了」。
 * 这里不试图真的理解语义，只做一个**保守的、可解释的**启发式：
 *   - 句子/分句数量；
 *   - 显式枚举（第一/第二/首先/其次/步骤/1. 2.）；
 *   - 因果连接（因为/所以/因此/如果…就/只要…就）；
 *   - 消息长度。
 * 达到阈值且学习者 cognitiveLoadTolerance=low/normal 时，输出 overloaded=true，
 * 交给 learn-turn 演一个真实的「内存溢出」反应（而不是继续假装听懂）。
 *
 * 宁可不触发，也不要把正常的一段讲解误判成过载：阈值刻意偏高，且至少要两条信号。
 */

export type LoadTolerance = 'low' | 'normal' | 'high'

export interface OverloadSignal {
  overloaded: boolean
  /** 0-1 的信息负荷估计，仅用于解释/审计 */
  loadScore: number
  /** 触发原因（overloaded=true 时给出） */
  reason?: string
  signals: {
    sentences: number
    enumerations: number
    causalChains: number
    chars: number
  }
}

const ENUMERATION_RE = /(第一|第二|第三|第四|其一|其二|其三|首先|其次|再次|然后|接着|接下来|最后|步骤|第[一二三四五六七八九十\d]+步)/g
const CAUSAL_RE = /(因为|所以|因此|由于|如果[^。！？!?\n]{0,20}就|只要[^。！？!?\n]{0,20}就|一旦[^。！？!?\n]{0,20}就)/g
const SENTENCE_SPLIT_RE = /[。！？!?；;\n]+/

function countMatches(text: string, pattern: RegExp): number {
  const matches = text.match(pattern)
  return matches ? matches.length : 0
}

/**
 * @param message 教师本轮最新消息（visibleContext.lastTeacherMessage）
 * @param tolerance 学习者 cognitiveLoadTolerance；缺失按 normal
 */
export function detectTeacherOverload(params: {
  message: string | null | undefined
  tolerance?: LoadTolerance | string | null
}): OverloadSignal {
  const message = typeof params.message === 'string' ? params.message.trim() : ''
  const chars = message.length
  const sentences = message
    ? message.split(SENTENCE_SPLIT_RE).map((item) => item.trim()).filter(Boolean).length
    : 0
  const enumerations = countMatches(message, ENUMERATION_RE)
  const causalChains = countMatches(message, CAUSAL_RE)
  const tolerance: LoadTolerance = params.tolerance === 'low' || params.tolerance === 'high'
    ? params.tolerance
    : 'normal'

  const loadScore = Math.min(
    1,
    Math.round((
      Math.min(chars / 420, 1) * 0.35
      + Math.min(sentences / 7, 1) * 0.2
      + Math.min(enumerations / 4, 1) * 0.3
      + Math.min(causalChains / 3, 1) * 0.15
    ) * 100) / 100
  )

  const threshold = tolerance === 'low' ? 0.5 : tolerance === 'high' ? 0.85 : 0.68
  // 至少两条信号：纯长文（没有枚举/因果）不轻易判过载，避免把正常讲解演成听不懂。
  const signalCount = [
    chars >= 260,
    sentences >= 5,
    enumerations >= 3,
    causalChains >= 2,
  ].filter(Boolean).length
  const overloaded = loadScore >= threshold && signalCount >= 2

  return {
    overloaded,
    loadScore,
    ...(overloaded
      ? {
          reason: tolerance === 'low'
            ? '低耐受学习者接到多步/多因果链讲解'
            : '单轮信息块超过工作记忆容量',
        }
      : {}),
    signals: { sentences, enumerations, causalChains, chars },
  }
}
