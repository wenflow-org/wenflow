/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * F1 掌握聚合仲裁（修复轮三，R1 finding A2「代码裁决的检查点失败不进任何掌握聚合」+
 * R2 判定#8/High1「失败证据跨课不可见 + 占位键」）修复的先失败后通过测试：
 *
 *  a. 概念归属缺失：checkpoint 证据 payload 不带 conceptKey/conceptName（R1 H2 全库 0/5955）
 *     → 检查点概念归属纯函数 + 两类证据写入（result/attempt）必须带归属字段。
 *  b. 负证据进不了账：KnowledgeStateService 只升不降（:24,:38-43）使 code 裁决失败不影响聚合
 *     → merge 增加仲裁入参：本会话内有 code 失败的（检查点归属）概念不得晋升 mastered；
 *       授予处 evidenceSource: code|llm|mixed 可追溯。
 *  c. 占位键治理：失败被归到 concept-1/concept-2 占位概念（R2 复现 3 行 + ledger 8 行证据）
 *     → 误解失败路由把占位键改挂检查点/当前教学点的确定性派生键。
 *
 * 只 mock 外部协作者（DB/logger/邻接域），被测实现走真实代码。
 */
const mockCreate = jest.fn(async (..._args: any[]) => undefined)
const mockUpsert = jest.fn(async (..._args: any[]) => undefined)

jest.mock('../../../config/database', () => ({
  __esModule: true,
  default: {
    learner_evidence: {
      create: (...args: any[]) => mockCreate(...(args as [])),
      upsert: (...args: any[]) => mockUpsert(...(args as [])),
    },
  },
}))
jest.mock('../../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}))
// 邻接域模块只为让 teaching-checkpoint 可加载；本测试不触达其实现
jest.mock('../../learner/anchor-probe', () => ({
  shouldRunAnchorProbe: jest.fn(() => false),
  partitionDelayedAnchorCandidates: jest.fn(() => ({ candidates: [], skipped: [] })),
  selectAnchorCandidates: jest.fn(() => []),
  evaluateAnchorProbeOutcome: jest.fn(() => ({ signal: 'consistent', falsified: false })),
}))
jest.mock('../anchor-probe-emit', () => ({
  ANCHOR_RESULT_LOOKBACK: 20,
  summarizeAnchorEvidence: jest.fn(() => ({ lastProbeAt: null, probesSinceLastFlag: 0 })),
  buildAnchorSignalSource: jest.fn(() => ({})),
  buildDelayedAnchorCandidatesFromLearnerSignals: jest.fn(() => []),
  resolveDelayedAnchorDays: jest.fn(() => 7),
  deriveTurnsSinceLastProbe: jest.fn(() => 0),
  buildAnchorCandidatesFromLearnerSignals: jest.fn(() => []),
  buildAnchorResultEvidence: jest.fn(() => ({})),
  anchorResultEvidenceKey: jest.fn(() => ({ eventId: 'e', evidenceKey: 'k' })),
}))
jest.mock('../../../skills/degradation-telemetry', () => ({
  recordDegradation: jest.fn(),
  degradationCause: jest.fn(() => ''),
}))

import { knowledgeStateService } from '../KnowledgeStateService'
import {
  recordCheckpointResultEvidence,
  recordCheckpointAttemptEvidence,
  buildCheckpointCodeArbitration,
} from '../teaching-checkpoint'
import {
  deriveConceptKeyFromName,
  resolveCheckpointConceptAttribution,
  isPlaceholderConceptKey,
} from '../checkpoint-shared'
import {
  cloneKnowledgePoints,
  normalizeFrozenKnowledgeState,
} from '../teaching-knowledge-state'
import { rerouteMisconceptionConceptKey } from '../../learner/misconception-ledger.service'

const session = { id: 'sess-1', userId: 'user-1', learningPathId: 'path-1', taskId: 'task-1' } as any

beforeEach(() => {
  jest.clearAllMocks()
  mockCreate.mockResolvedValue(undefined)
  mockUpsert.mockResolvedValue(undefined)
})

describe('F1-a 检查点概念归属（发出与证据写入带键）', () => {
  it('resolveCheckpointConceptAttribution：当前教学点名 → 确定性派生键，source=derived', () => {
    const attribution = resolveCheckpointConceptAttribution('叶绿体的结构与功能')
    expect(attribution).not.toBeNull()
    expect(attribution!.conceptName).toBe('叶绿体的结构与功能')
    expect(attribution!.conceptSource).toBe('derived')
    expect(attribution!.conceptKey).toMatch(/^cpt_[0-9a-f]{16}$/)
  })

  it('deriveConceptKeyFromName：同名跨调用/跨课同键（失败证据跨课可归位），空白/大小写不敏感', () => {
    const a = deriveConceptKeyFromName('光合作用的原料与产物')
    const b = deriveConceptKeyFromName('  光合作用 的原料与产物 ')
    const c = deriveConceptKeyFromName('光合作用的原料与产物'.toUpperCase())
    expect(a).toBe(b)
    expect(a).toBe(c)
    expect(a).not.toBe(deriveConceptKeyFromName('呼吸作用的原料与产物'))
  })

  it('无点名 → 无归属（null，不产出占位键）', () => {
    expect(resolveCheckpointConceptAttribution('')).toBeNull()
    expect(resolveCheckpointConceptAttribution(null)).toBeNull()
    expect(resolveCheckpointConceptAttribution('   ')).toBeNull()
  })

  it('checkpoint:result 证据 payload 带概念归属字段（此前全库 0/5955）', async () => {
    const checkpoint = {
      id: 'cp-att-1',
      type: 'single_choice',
      title: '理解检查',
      question: 'q',
      conceptName: '叶绿体的结构与功能',
      conceptKey: 'cpt_abc123',
      conceptSource: 'derived' as const,
    } as any
    await recordCheckpointResultEvidence(session, checkpoint, {
      passed: false,
      judgedBy: 'code',
      detail: '选项集合不一致（正确 B，作答 A）',
      submission: { selectedOptionIds: ['A'] },
    })

    expect(mockCreate).toHaveBeenCalledTimes(1)
    const payload = JSON.parse((mockCreate.mock.calls[0][0] as any).data.payload)
    expect(payload).toEqual(expect.objectContaining({
      checkpointId: 'cp-att-1',
      passed: false,
      judgedBy: 'code',
      conceptName: '叶绿体的结构与功能',
      conceptKey: 'cpt_abc123',
      conceptSource: 'derived',
    }))
  })

  it('checkpoint:attempt 证据 payload 同样带概念归属字段（attempts_exhausted 终局）', async () => {
    const checkpoint = {
      id: 'cp-att-2',
      type: 'single_choice',
      title: '理解检查',
      question: 'q',
      conceptName: '光合呼吸净收支',
      conceptKey: 'cpt_def456',
      conceptSource: 'derived' as const,
    } as any
    await recordCheckpointAttemptEvidence(session, checkpoint, { outcome: 'attempts_exhausted', attempts: 2 })

    expect(mockUpsert).toHaveBeenCalledTimes(1)
    const payload = JSON.parse((mockUpsert.mock.calls[0][0] as any).create.payload)
    expect(payload).toEqual(expect.objectContaining({
      checkpointId: 'cp-att-2',
      outcome: 'attempts_exhausted',
      attempts: 2,
      conceptName: '光合呼吸净收支',
      conceptKey: 'cpt_def456',
      conceptSource: 'derived',
    }))
  })

  it('无归属的检查点（存量形态）：证据 payload 不带概念字段（保持历史形状）', async () => {
    const checkpoint = { id: 'cp-old', type: 'short_answer', title: '理解检查', question: 'q' } as any
    await recordCheckpointResultEvidence(session, checkpoint, {
      passed: true,
      judgedBy: 'model-reference',
      detail: null,
      submission: {},
    })
    const payload = JSON.parse((mockCreate.mock.calls[0][0] as any).data.payload)
    expect(payload.conceptKey).toBeUndefined()
    expect(payload.conceptName).toBeUndefined()
    expect(payload.conceptSource).toBeUndefined()
  })
})

describe('F1-b 掌握聚合仲裁（code 负证据阻断 mastered 晋升）', () => {
  const learning = { name: '汽车故障码读取', status: 'learning' as const, progress: 40 }
  const masteredIncoming = { name: '汽车故障码读取', status: 'mastered' as const, progress: 90 }

  it('判据复现：同一概念两次 code 失败 → 课末 LLM 报 mastered 不得被判 mastered（阻断晋升）', () => {
    // VL-1/B1 形态：checkpointHistory 两行 code 裁决失败（带归属），课末 merge 收到 mastered 增量
    const arbitration = buildCheckpointCodeArbitration([
      { checkpointId: 'cp-1', passed: false, judgedBy: 'code', conceptName: '汽车故障码读取', conceptKey: 'cpt_x' },
      { checkpointId: 'cp-1', passed: false, judgedBy: 'code', conceptName: '汽车故障码读取', conceptKey: 'cpt_x' },
    ])
    expect(arbitration.codeFailedConceptNames).toContain('汽车故障码读取')

    const merged = knowledgeStateService.merge([learning], [masteredIncoming], false, arbitration)
    expect(merged[0].status).not.toBe('mastered')
    expect(merged[0].status).toBe('learning')
  })

  it('同会话单次 code 失败同样阻断（attempts_exhausted 由失败行派生，不需单独通道）', () => {
    const arbitration = buildCheckpointCodeArbitration(
      [{ checkpointId: 'cp-1', passed: false, judgedBy: 'code', conceptName: '汽车故障码读取' }],
      { judgedBy: 'code', passed: false },
      { conceptName: '汽车故障码读取' },
    )
    const merged = knowledgeStateService.merge([learning], [masteredIncoming], false, arbitration)
    expect(merged[0].status).toBe('learning')
  })

  it('失败后看板上才出现该概念（新点直接报 mastered）也阻断', () => {
    const arbitration = buildCheckpointCodeArbitration(
      [{ checkpointId: 'cp-1', passed: false, judgedBy: 'code', conceptName: '新概念' }],
    )
    const merged = knowledgeStateService.merge([], [{ name: '新概念', status: 'mastered' as const, progress: 80 }], false, arbitration)
    expect(merged[0].status).toBe('learning')
  })

  it('无 code 失败：行为不变（mastered 照常晋升）', () => {
    const arbitration = buildCheckpointCodeArbitration([
      { checkpointId: 'cp-1', passed: true, judgedBy: 'code', conceptName: '汽车故障码读取' },
    ])
    const merged = knowledgeStateService.merge([learning], [masteredIncoming], false, arbitration)
    expect(merged[0].status).toBe('mastered')
  })

  it('不传仲裁（温故等旧调用形态）：合并行为与历史完全一致', () => {
    const merged = knowledgeStateService.merge([learning], [masteredIncoming])
    expect(merged[0].status).toBe('mastered')
    expect(merged[0].progress).toBe(90)
  })

  it('model-reference 裁决与 skip 不是 code 负证据：不阻断', () => {
    const arbitration = buildCheckpointCodeArbitration([
      { checkpointId: 'cp-1', passed: false, judgedBy: 'model-reference', conceptName: '汽车故障码读取' },
      { checkpointId: 'cp-2', passed: false, skipped: true, conceptName: '汽车故障码读取' },
    ])
    expect(arbitration.codeFailedConceptNames).toHaveLength(0)
    const merged = knowledgeStateService.merge([learning], [masteredIncoming], false, arbitration)
    expect(merged[0].status).toBe('mastered')
  })

  it('非归属概念（无 conceptName 的历史失败行）不误伤其它概念', () => {
    const arbitration = buildCheckpointCodeArbitration([
      { checkpointId: 'cp-1', passed: false, judgedBy: 'code' },
    ])
    expect(arbitration.codeFailedConceptNames).toHaveLength(0)
    const merged = knowledgeStateService.merge([learning], [masteredIncoming], false, arbitration)
    expect(merged[0].status).toBe('mastered')
  })

  it('evidenceSource：晋升带 code 证据（全对）标 code；零 code 证据标 llm（行为不变仅标注）', () => {
    const withCode = knowledgeStateService.merge(
      [learning],
      [masteredIncoming],
      false,
      buildCheckpointCodeArbitration([{ checkpointId: 'cp-1', passed: true, judgedBy: 'code', conceptName: '汽车故障码读取' }]),
    )
    expect(withCode[0].evidenceSource).toBe('code')

    const llmOnly = knowledgeStateService.merge([learning], [masteredIncoming])
    expect(llmOnly[0].status).toBe('mastered')
    expect(llmOnly[0].evidenceSource).toBe('llm')
  })

  it('F1-c 负证据降级：先 mastery 后 code 失败（普通课）→ 从 mastered 降为 learning', () => {
    // R1 处置建议「checkpoint 负证据可降级」的聚合兑现：已达成 mastered 的点遇 code 负证据，
    // 沿授予处 mixed 标注同一判据路径降级（不再保留 mastered 造成状态双写）
    const arbitration = buildCheckpointCodeArbitration([
      { checkpointId: 'cp-1', passed: false, judgedBy: 'code', conceptName: '汽车故障码读取' },
    ])
    const merged = knowledgeStateService.merge(
      [{ name: '汽车故障码读取', status: 'mastered' as const, progress: 100 }],
      [learning],
      false,
      arbitration,
    )
    expect(merged[0].status).toBe('learning')
    expect(merged[0].status).not.toBe('mastered')
  })

  it('F1-c 负证据降级：同一轮 LLM 仍报 mastered 也降级（末轮答错→同轮判 mastered 不漏网）', () => {
    const arbitration = buildCheckpointCodeArbitration(
      [{ checkpointId: 'cp-1', passed: false, judgedBy: 'code', conceptName: '汽车故障码读取' }],
    )
    const merged = knowledgeStateService.merge(
      [{ name: '汽车故障码读取', status: 'mastered' as const, progress: 100 }],
      [masteredIncoming],
      false,
      arbitration,
    )
    expect(merged[0].status).toBe('learning')
    expect(merged[0].evidenceSource).not.toBe('mixed')
  })

  it('F1-c 反例：无 code 负证据时绝不降级（mastered 照常保留）', () => {
    // 有 code 判定行但全过：不降级
    const passOnly = knowledgeStateService.merge(
      [{ name: '汽车故障码读取', status: 'mastered' as const, progress: 100 }],
      [learning],
      false,
      buildCheckpointCodeArbitration([
        { checkpointId: 'cp-1', passed: true, judgedBy: 'code', conceptName: '汽车故障码读取' },
      ]),
    )
    expect(passOnly[0].status).toBe('mastered')

    // model-reference 失败不是 code 负证据：不降级（只认独立传感器）
    const modelReference = knowledgeStateService.merge(
      [{ name: '汽车故障码读取', status: 'mastered' as const, progress: 100 }],
      [learning],
      false,
      buildCheckpointCodeArbitration([
        { checkpointId: 'cp-1', passed: false, judgedBy: 'model-reference', conceptName: '汽车故障码读取' },
      ]),
    )
    expect(modelReference[0].status).toBe('mastered')

    // 缺省仲裁（旧调用形态）：不降级
    const noArbitration = knowledgeStateService.merge(
      [{ name: '汽车故障码读取', status: 'mastered' as const, progress: 100 }],
      [learning],
    )
    expect(noArbitration[0].status).toBe('mastered')
  })

  it('F1-c 名字匹配折叠空格：失败行 A B vs 看板 AB 仍阻断/降级（复核 P16 探针形态）', () => {
    const arbitration = buildCheckpointCodeArbitration([
      { checkpointId: 'cp-1', passed: false, judgedBy: 'code', conceptName: 'A B' },
    ])
    // 新点直报 mastered：空格异写不绕过阻断
    const blocked = knowledgeStateService.merge(
      [],
      [{ name: 'AB', status: 'mastered' as const, progress: 90 }],
      false,
      arbitration,
    )
    expect(blocked[0].status).toBe('learning')
    // 已 mastered 的点：空格异写不绕过降级
    const degraded = knowledgeStateService.merge(
      [{ name: 'AB', status: 'mastered' as const, progress: 100 }],
      [{ name: 'A B', status: 'learning' as const, progress: 50 }],
      false,
      arbitration,
    )
    expect(degraded[0].status).toBe('learning')
  })

  it('F1-c 名字匹配折叠空格：cpt 键同源（含中文/全角空白）同样进阻断', () => {
    // 派生键口径：折叠全部空白，'光合 作用' 与 '光合作用' 派生同键 → 仲裁必须同判
    const arbitration = buildCheckpointCodeArbitration([
      { checkpointId: 'cp-1', passed: false, judgedBy: 'code', conceptName: '光合 作用' },
    ])
    expect(deriveConceptKeyFromName('光合 作用')).toBe(deriveConceptKeyFromName('光合作用'))
    const merged = knowledgeStateService.merge(
      [{ name: '光合作用', status: 'mastered' as const, progress: 100 }],
      [{ name: '光合作用', status: 'mastered' as const, progress: 95 }],
      false,
      arbitration,
    )
    expect(merged[0].status).toBe('learning')
  })

  it('复习课（allowDegrade）通道不受 F1-c 降级影响：已 mastered 遇 code 失败仍由 LLM 判定生效', () => {
    const arbitration = buildCheckpointCodeArbitration([
      { checkpointId: 'cp-1', passed: false, judgedBy: 'code', conceptName: '汽车故障码读取' },
    ])
    // 复习课 LLM 报 learning → learning（与改动前一致）
    const toLearning = knowledgeStateService.merge(
      [{ name: '汽车故障码读取', status: 'mastered' as const, progress: 100 }],
      [learning],
      true,
      arbitration,
    )
    expect(toLearning[0].status).toBe('learning')
    expect(toLearning[0].progress).toBe(40)

    // 复习课 LLM 仍报 mastered → 保留 mastered，按原语义标 mixed
    const keptMastered = knowledgeStateService.merge(
      [{ name: '汽车故障码读取', status: 'mastered' as const, progress: 100 }],
      [masteredIncoming],
      true,
      arbitration,
    )
    expect(keptMastered[0].status).toBe('mastered')
    expect(keptMastered[0].evidenceSource).toBe('mixed')
  })

  it('复习课（allowDegrade）通道不受仲裁影响：LLM 判定照旧生效', () => {
    const arbitration = buildCheckpointCodeArbitration([
      { checkpointId: 'cp-1', passed: false, judgedBy: 'code', conceptName: '汽车故障码读取' },
    ])
    const merged = knowledgeStateService.merge(
      [{ name: '汽车故障码读取', status: 'mastered' as const, progress: 100 }],
      [{ name: '汽车故障码读取', status: 'review' as const, progress: 50 }],
      true,
      arbitration,
    )
    expect(merged[0].status).toBe('review')
    expect(merged[0].progress).toBe(50)
  })

  it('buildCheckpointCodeArbitration：本回合裁决（merge 先于判分落历史）显式并入', () => {
    const arbitration = buildCheckpointCodeArbitration(
      [],
      { judgedBy: 'code', passed: false },
      { conceptName: '汽车故障码读取' },
    )
    expect(arbitration.codeFailedConceptNames).toEqual(['汽车故障码读取'])
    expect(arbitration.codeJudgedConceptNames).toEqual(['汽车故障码读取'])
  })

  it('evidenceSource 随看板穿越归一/冻结合并（否则落库前即被剥掉，授予标注形同虚设）', () => {
    const board = knowledgeStateService.merge([learning], [masteredIncoming])
    expect(board[0].evidenceSource).toBe('llm')

    const cloned = cloneKnowledgePoints(board)
    expect(cloned[0].evidenceSource).toBe('llm')

    const nextTurn = normalizeFrozenKnowledgeState(cloned, [
      { name: '汽车故障码读取', status: 'mastered' as const, progress: 95 },
    ])
    expect(nextTurn.find((point) => point.name === '汽车故障码读取')?.evidenceSource).toBe('llm')
  })
})

describe('F1-c 误解失败路由占位键治理（不得产出 concept-N）', () => {
  const attribution = resolveCheckpointConceptAttribution('叶绿体的结构与功能')

  it('isPlaceholderConceptKey：识别路径骨架的 concept-N 序列占位', () => {
    expect(isPlaceholderConceptKey('concept-1')).toBe(true)
    expect(isPlaceholderConceptKey('concept-12')).toBe(true)
    expect(isPlaceholderConceptKey(' Concept-2 ')).toBe(true)
    expect(isPlaceholderConceptKey('叶绿体存在于哪些细胞')).toBe(false)
    expect(isPlaceholderConceptKey('cpt_abc123')).toBe(false)
    expect(isPlaceholderConceptKey('')).toBe(false)
    expect(isPlaceholderConceptKey(null)).toBe(false)
  })

  it('占位键 → 改挂检查点归属键（R2 复现：ml_1791232773803 占位 concept-2）', () => {
    expect(rerouteMisconceptionConceptKey('concept-2', attribution)).toBe(attribution!.conceptKey)
    expect(rerouteMisconceptionConceptKey('concept-2', attribution)).not.toMatch(/^concept-\d+$/)
  })

  it('真键原样保留（模型给的规范概念键不被改写）', () => {
    expect(rerouteMisconceptionConceptKey('叶绿体存在于哪些细胞', attribution)).toBe('叶绿体存在于哪些细胞')
  })

  it('确实无键（占位 + 无归属可挂）→ null（调用方丢弃，宁缺勿错挂，不再落 concept-N）', () => {
    expect(rerouteMisconceptionConceptKey('concept-1', null)).toBeNull()
    expect(rerouteMisconceptionConceptKey('concept-1', undefined)).toBeNull()
    expect(rerouteMisconceptionConceptKey('', attribution)).toBe(attribution!.conceptKey)
  })
})
