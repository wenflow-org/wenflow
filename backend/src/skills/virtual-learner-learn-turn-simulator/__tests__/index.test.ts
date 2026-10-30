const mockCallPrompt = jest.fn()

jest.mock('../../../composers/prompt-composer', () => ({ callPrompt: mockCallPrompt }))

import {
  normalizeOutput,
  virtualLearnerLearnTurnSimulator,
  VIRTUAL_LEARNER_LEARN_TURN_SIMULATION_FAILED,
  LEARN_STATE_FIELDS,
  LEARN_FEEDBACK_FIELDS,
  LEARN_JUDGE_COMPLETION_MASTERY_THRESHOLD,
  evaluateJudgeCompletionGate,
} from '../index'
import type { LearnLearnerSimulationInput } from '../index'

const input: LearnLearnerSimulationInput = {
  learner: {},
  story: null,
  visibleContext: { history: [], lastTeacherMessage: '' },
  currentPhase: 'trying',
  previousLearnerState: null,
  currentTask: null,
  knowledgeSnapshot: [],
}

describe('virtual-learner-learn-turn-simulator normalize', () => {
  it('部分输出：缺失字段被补齐并记录 normalizedFallback 审计标记', () => {
    const output = normalizeOutput({ reply: '我试试。' }, input)
    expect(output.debug?.normalizedFallback?.fieldCount).toBe(
      LEARN_STATE_FIELDS.length + LEARN_FEEDBACK_FIELDS.length
    )
    expect(output.debug?.normalizedFallback?.learnerState).toContain('taskUnderstanding')
    expect(typeof output.learnerState.taskUnderstanding).toBe('number')
  })

  it('「理解检查：」模板前缀剥离（2026-10-10 评审：作答回显工件不进学生可见消息）', () => {
    const echo = normalizeOutput(
      { reply: '理解检查：默写：静止的箱子，支持力成因核心词是？\n我的答案：B. 形变恢复' },
      input
    )
    expect(echo.reply.startsWith('理解检查')).toBe(false)
    expect(echo.reply).toContain('我的答案：B. 形变恢复')

    const echoColon = normalizeOutput({ reply: '理解检查: 支持力的施力方是谁？我的答案：地面' }, input)
    expect(echoColon.reply.startsWith('理解检查')).toBe(false)

    const noPrefix = normalizeOutput({ reply: '我试着写了一下三行默写。' }, input)
    expect(noPrefix.reply).toBe('我试着写了一下三行默写。')
  })

  // D1（A/B 报告 2026-10-13）：初版按字符上限硬切（48/80/96）补"…"，学生发言被拦腰截断。
  // 二次修复改「句末保留、子句分隔符丢弃」，但子句分支丢掉标点直接返回 → 产出无标点半句，
  // 教师当完整发言脑补（2026-10-13 复评 lesson 13 实证）。本版：子句收尾必须补"…"明示未完。
  it('长回复按句末边界收尾：整句保留、无省略号（A/B 报告 D1）', () => {
    const first = `${'甲'.repeat(59)}。`  // 60 字
    const second = `${'乙'.repeat(59)}。` // 60 字，两句合计 120 > 96 上限
    const out = normalizeOutput({ reply: first + second }, input)
    expect(out.reply).toBe(first)
    expect(out.reply.endsWith('。')).toBe(true)
    expect(out.reply).not.toContain('…')
  })

  it('长回复只有子句边界时收尾并补省略号（D1 复评：不得用无标点半句冒充完整句）', () => {
    const out = normalizeOutput({ reply: `${'甲'.repeat(60)}，${'乙'.repeat(100)}` }, input)
    expect(out.reply).toBe(`${'甲'.repeat(60)}…`)
    expect(out.reply.endsWith('…')).toBe(true)
  })

  it('通篇无标点的超长回复才回退硬截断加省略号（A/B 报告 D1）', () => {
    const out = normalizeOutput({ reply: '丙'.repeat(200) }, input)
    expect(out.reply.endsWith('…')).toBe(true)
    expect(out.reply.length).toBeLessThanOrEqual(96)
  })

  // P0-3（外部审计）：老师明确要求列举/分点/总结时，1-2 句的默认上限必须让位，
  // 否则多步清单任务永远只说第一项。
  it('老师要求「分别/列出/总结」时保留多句（P0-3）', () => {
    const teacherAsksList = {
      ...input,
      visibleContext: {
        history: [],
        lastTeacherMessage: '把这三件事分别说清楚：你点的是哪、填了什么、预览还叠不叠。'
      }
    }
    const threeSentences = '我点的是页面布局里的缩放栏。缩放填的是 1 页宽。预览里价格和产品名还叠着。'
    const out = normalizeOutput({ reply: threeSentences }, teacherAsksList)
    // 句子拼接会补空格，按去空白比较
    expect(out.reply.replace(/\s+/g, '')).toBe(threeSentences.replace(/\s+/g, ''))
  })

  it('老师没要求列举时仍保持 1-2 句（不因修复而全面变长）', () => {
    const brief = {
      ...input,
      visibleContext: { history: [], lastTeacherMessage: '你点的是哪？' }
    }
    const fourSentences = '我点的是页面布局。缩放填的是 1 页宽。预览里还叠着。下一步我想收窄列宽。'
    const out = normalizeOutput({ reply: fourSentences }, brief)
    expect(out.reply).toBe('我点的是页面布局。 缩放填的是 1 页宽。')
  })
})

describe('virtual-learner-learn-turn-simulator 失败显式传播', () => {
  beforeEach(() => jest.clearAllMocks())

  it('callPrompt 抛错 → success:false（不再产出伪 selfReportedTaskDone）', async () => {
    mockCallPrompt.mockRejectedValue(new Error('boom'))
    const result = await virtualLearnerLearnTurnSimulator(input)
    expect(result.success).toBe(false)
    expect(result.error?.code).toBe(VIRTUAL_LEARNER_LEARN_TURN_SIMULATION_FAILED)
    expect(result.error?.message).toBe('boom')
    expect(result.output).toBeUndefined()
  })

  it('callPrompt success:false → success:false（与 catch 路径统一）', async () => {
    mockCallPrompt.mockResolvedValue({
      success: false,
      error: { code: 'SKILL_X_FAILED', message: 'validation failed' },
      debug: { durationMs: 4 },
    })
    const result = await virtualLearnerLearnTurnSimulator(input)
    expect(result.success).toBe(false)
    expect(result.error?.code).toBe(VIRTUAL_LEARNER_LEARN_TURN_SIMULATION_FAILED)
    expect(result.error?.message).toBe('validation failed')
    expect(result.output).toBeUndefined()
  })
})

describe('virtual-learner-learn-turn-simulator payload 透传（检查点 / 时间上下文）', () => {
  const previousStablePrefix = process.env.PAYLOAD_STABLE_PREFIX

  beforeEach(() => {
    jest.clearAllMocks()
    mockCallPrompt.mockResolvedValue({
      success: true,
      output: { reply: '我试试。', learnerState: {} },
      debug: { durationMs: 1 },
    })
  })

  afterEach(() => {
    if (previousStablePrefix === undefined) delete process.env.PAYLOAD_STABLE_PREFIX
    else process.env.PAYLOAD_STABLE_PREFIX = previousStablePrefix
  })

  const withCheckpoint: LearnLearnerSimulationInput = {
    ...input,
    pendingCheckpoint: {
      id: 'cp_1',
      type: 'single_choice',
      question: '二分查找的时间复杂度是？',
      options: [
        { id: 'A', text: 'O(n)' },
        { id: 'B', text: 'O(log n)' },
      ],
      allowSkip: false,
    },
    temporalContext: {
      simulatedDay: '2026-09-01',
      dayIndex: 3,
      timezone: 'UTC',
      sinceLastSessionDays: 3,
    },
  }

  async function capturedPayload(payloadInput: LearnLearnerSimulationInput): Promise<{
    pendingCheckpoint?: { id?: string; question?: string; options?: Array<{ id: string; text: string }>; allowSkip?: boolean };
    temporalContext?: { simulatedDay?: string; dayIndex?: number; sinceLastSessionDays?: number | null };
    memoryRecall?: Array<{ conceptKey: string; status: string; outputConceptKey?: string }>;
  }> {
    await virtualLearnerLearnTurnSimulator(payloadInput)
    const spec = mockCallPrompt.mock.calls[0][0]
    return spec.buildUserPayload(payloadInput)
  }

  it('pendingCheckpoint 真进 payload（含题目与选项），且不泄漏答案键', async () => {
    const payload = await capturedPayload(withCheckpoint)
    expect(payload.pendingCheckpoint).toMatchObject({ id: 'cp_1', question: '二分查找的时间复杂度是？' })
    expect(payload.pendingCheckpoint.options).toEqual([
      { id: 'A', text: 'O(n)' },
      { id: 'B', text: 'O(log n)' },
    ])
    expect(JSON.stringify(payload)).not.toMatch(/correctOptionIds|expectedKeywords|answerKey|correctAnswer/i)
  })

  it('temporalContext 真进 payload', async () => {
    const payload = await capturedPayload(withCheckpoint)
    expect(payload.temporalContext).toMatchObject({
      simulatedDay: '2026-09-01',
      dayIndex: 3,
      sinceLastSessionDays: 3,
    })
  })

  it('两者都缺省时不注入这两个键（现网 payload 不变）', async () => {
    const payload = await capturedPayload(input)
    expect(payload).not.toHaveProperty('pendingCheckpoint')
    expect(payload).not.toHaveProperty('temporalContext')
  })

  it('PAYLOAD_STABLE_PREFIX=0 的旧序分支同样透传', async () => {
    process.env.PAYLOAD_STABLE_PREFIX = '0'
    const payload = await capturedPayload(withCheckpoint)
    expect(payload.pendingCheckpoint?.id).toBe('cp_1')
    expect(payload.temporalContext?.dayIndex).toBe(3)
  })

  it('memoryRecall 进 payload（同概念时省略 outputConceptKey）；缺省不注入', async () => {
    const withRecall: LearnLearnerSimulationInput = {
      ...input,
      memoryRecall: [
        { conceptKey: '二分查找', status: 'VAGUE' },
        { conceptKey: '防抖', status: 'CONFUSED', outputConceptKey: '节流' },
      ],
    }
    const payload = await capturedPayload(withRecall)
    expect(payload.memoryRecall).toEqual([
      { conceptKey: '二分查找', status: 'VAGUE' },
      { conceptKey: '防抖', status: 'CONFUSED', outputConceptKey: '节流' },
    ])
    expect(await capturedPayload(input)).not.toHaveProperty('memoryRecall')
  })
})

describe('virtual-learner-learn-turn-simulator · 检查点作答（P1-3）', () => {
  const withCheckpoint: LearnLearnerSimulationInput = {
    ...input,
    pendingCheckpoint: {
      id: 'cp1',
      type: 'single_choice',
      question: '哪个是条件类型？',
      options: [{ id: 'A', text: 'T extends U' }, { id: 'B', text: 'Array<T>' }],
      allowSkip: true,
    },
  }

  it('选择题：保留真实存在的选项 id，丢弃编造的 id', () => {
    const output = normalizeOutput(
      { reply: '我选 B。', checkpointAnswer: { selectedOptionIds: ['B', 'ZZZ'], confidence: 0.7 } },
      withCheckpoint,
    )
    expect(output.checkpointAnswer).toEqual({ selectedOptionIds: ['B'], confidence: 0.7 })
  })

  it('简答题：保留 answerText', () => {
    const shortInput: LearnLearnerSimulationInput = {
      ...input,
      pendingCheckpoint: { id: 'cp2', type: 'short_answer', question: '说说为什么' },
    }
    const output = normalizeOutput({ reply: '因为擦除。', checkpointAnswer: { answerText: '  因为类型擦除  ' } }, shortInput)
    expect(output.checkpointAnswer).toEqual({ answerText: '因为类型擦除' })
  })

  it('没有待答检查点时，不产出 checkpointAnswer', () => {
    const output = normalizeOutput({ reply: '继续吧。', checkpointAnswer: { selectedOptionIds: ['A'] } }, input)
    expect(output.checkpointAnswer).toBeUndefined()
  })

  it('草案无效（选项 id 全不存在）→ 不产出，交给 runner 兜底', () => {
    const output = normalizeOutput({ reply: '……', checkpointAnswer: { selectedOptionIds: ['ZZZ'] } }, withCheckpoint)
    expect(output.checkpointAnswer).toBeUndefined()
  })
})

describe('virtual-learner-learn-turn-simulator · 判决完成门（P1-5 / VL-1）', () => {
  const doneRaw = {
    reply: '这一步我会了。',
    learnerState: { phaseFocus: 'ready_to_close', taskUnderstanding: 0.9, conceptualMastery: 0.85, proceduralMastery: 0.86 },
    learnerFeedback: { selfReportedTaskDone: true, wantsMoreHelp: false, stopAsking: true, remainingBlockers: [] },
  }

  it('wantsExtension 缺省为 false，且只在 selfReportedTaskDone=true 时成立（#124）', () => {
    // 缺省：LLM 未输出 → false（不改变既有 VL 行为）
    expect(normalizeOutput(doneRaw, input).learnerFeedback.wantsExtension).toBe(false)
    // 达标 + 显式意愿 → true
    const eager = normalizeOutput(
      { ...doneRaw, learnerFeedback: { ...doneRaw.learnerFeedback, wantsExtension: true } },
      input,
    )
    expect(eager.learnerFeedback.wantsExtension).toBe(true)
    // 未达标（自评 false）→ 意愿被钳掉：延伸是达标后的深入兴趣，不是纠缠通道
    const notDone = normalizeOutput(
      {
        ...doneRaw,
        learnerState: { ...doneRaw.learnerState, phaseFocus: 'trying', taskUnderstanding: 0.4, conceptualMastery: 0.3, proceduralMastery: 0.2 },
        learnerFeedback: { ...doneRaw.learnerFeedback, selfReportedTaskDone: false, wantsExtension: true },
      },
      input,
    )
    expect(notDone.learnerFeedback.selfReportedTaskDone).toBe(false)
    expect(notDone.learnerFeedback.wantsExtension).toBe(false)
  })

  it('判决缺失 → 保持现状（宁松勿误伤）：selfReportedTaskDone 照常为 true', () => {
    const output = normalizeOutput(doneRaw, input)
    expect(output.learnerFeedback.selfReportedTaskDone).toBe(true)
    expect(output.debug?.judgeCompletionBlock).toBeUndefined()
  })

  it('sampledCorrectness=false → 学员自评不被改写，拦截原因只作观测留痕（#46 教师权威）', () => {
    const output = normalizeOutput(doneRaw, {
      ...input,
      epistemicGrounding: { sampledCorrectness: false, blockedConcept: '执行停—绕—留钩子降级', errorPattern: null, masteryProb: 0.3 },
    })
    expect(output.learnerFeedback.selfReportedTaskDone).toBe(true)
    expect(output.learnerFeedback.stopAsking).toBe(true)
    expect(output.debug?.judgeCompletionBlock).toBe('judge-sampled-correctness-false')
  })

  it('判对但 masteryProb 低于阈值 → 自评保留，拦截原因留痕', () => {
    const output = normalizeOutput(doneRaw, {
      ...input,
      epistemicGrounding: { sampledCorrectness: true, blockedConcept: null, errorPattern: null, masteryProb: 0.3 },
    })
    expect(output.learnerFeedback.selfReportedTaskDone).toBe(true)
    expect(output.debug?.judgeCompletionBlock).toBe('judge-mastery-below-threshold')
  })

  it('判对且 masteryProb 达标 → 放行完成', () => {
    const output = normalizeOutput(doneRaw, {
      ...input,
      epistemicGrounding: { sampledCorrectness: true, blockedConcept: null, errorPattern: null, masteryProb: 0.78 },
    })
    expect(output.learnerFeedback.selfReportedTaskDone).toBe(true)
    expect(output.debug?.judgeCompletionBlock).toBeUndefined()
  })

  it('evaluateJudgeCompletionGate 阈值边界：等于阈值放行、低于阈值拦截、null 放行', () => {
    expect(evaluateJudgeCompletionGate(null).allowsCompletion).toBe(true)
    expect(evaluateJudgeCompletionGate({ sampledCorrectness: true, blockedConcept: null, errorPattern: null, masteryProb: LEARN_JUDGE_COMPLETION_MASTERY_THRESHOLD }).allowsCompletion).toBe(true)
    expect(evaluateJudgeCompletionGate({ sampledCorrectness: true, blockedConcept: null, errorPattern: null, masteryProb: LEARN_JUDGE_COMPLETION_MASTERY_THRESHOLD - 0.01 }).allowsCompletion).toBe(false)
  })

  it('判错 + masteryProb=0.3 → 掌握度硬钳到 0.3，并留钳制字段（P1-4）', () => {
    const output = normalizeOutput(doneRaw, {
      ...input,
      epistemicGrounding: { sampledCorrectness: false, blockedConcept: '执行停—绕—留钩子降级', errorPattern: null, masteryProb: 0.3 },
    })
    expect(output.learnerState.conceptualMastery).toBe(0.3)
    expect(output.learnerState.proceduralMastery).toBe(0.3)
    expect(output.debug?.judgeMasteryClampedFields).toEqual(['conceptualMastery', 'proceduralMastery'])
  })

  it('判决缺失 → 掌握度不钳制（宁松勿误伤）', () => {
    const output = normalizeOutput(doneRaw, input)
    expect(output.learnerState.conceptualMastery).toBe(0.85)
    expect(output.debug?.judgeMasteryClampedFields).toBeUndefined()
  })
})
