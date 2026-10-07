/**
 * concept-consolidator 的契约容错与纠偏重试（审计 P1 §2.4 末条）——与 D1/D3 同类。
 *
 * 实测失败画像（近 7 天 197 次）：52 次 SKILL_CONCEPT_CONSOLIDATOR_FAILED，其中
 *   42 次 `response does not contain valid JSON object`（重试只是重发同样 prompt，无纠偏）
 *   10 次契约缺字段（merges/ambiguous 声明为 object[] 必填，模型省略即整轮失败）
 * 另有 44 次 CALLER_ABORTED（调用方取消，非提示词缺陷，单独登记）。
 */
const mockCallPrompt = jest.fn()

jest.mock('../../composers/prompt-composer', () => ({
  callPrompt: mockCallPrompt,
}))

import { auxSkillHandlers } from '../v4-aux-skills'

const CANDIDATES = [
  { conceptKey: '离开前翻页立好', label: '离开前翻页立好' },
  { conceptKey: '离开前翻页立好：动作先于评价', label: '离开前翻页立好：动作先于评价' },
]

interface AuxSpec {
  coerceParsedForContract?: (parsed: unknown) => Record<string, unknown>
  retryStrategy?: { maxAttempts: number; onValidationFail?: (p: { failureReason: string }) => string | null }
  buildUserPayload?: () => Record<string, unknown>
}

describe('concept-consolidator 契约容错与纠偏重试', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockCallPrompt.mockResolvedValue({
      success: true,
      output: { merges: [], ambiguous: [], dropCandidates: [] },
      debug: {},
    })
  })

  it('coerceParse：缺失 / 非数组的 merges、ambiguous、dropCandidates 一律收敛为 []', async () => {
    await auxSkillHandlers['concept-consolidator']({ candidates: CANDIDATES } as never)
    const [spec] = mockCallPrompt.mock.calls[0] as [AuxSpec]

    expect(spec.coerceParsedForContract?.({})).toEqual({ merges: [], ambiguous: [], dropCandidates: [] })
    expect(spec.coerceParsedForContract?.({ merges: [{ canonical: 'a' }] }))
      .toEqual({ merges: [{ canonical: 'a' }], ambiguous: [], dropCandidates: [] })
    // 非对象原样返回（不构造）
    expect(spec.coerceParsedForContract?.(null)).toBeNull()
  })

  it('retryStrategy：有纠偏话术（此前只有 maxAttempts，重试等于重发同样 prompt）', async () => {
    await auxSkillHandlers['concept-consolidator']({ candidates: CANDIDATES } as never)
    const [spec] = mockCallPrompt.mock.calls[0] as [AuxSpec]

    expect(spec.retryStrategy?.maxAttempts).toBe(2)
    const nudge = spec.retryStrategy?.onValidationFail?.({ failureReason: 'response does not contain valid JSON object' })
    expect(nudge).toContain('只输出一个 JSON 对象')
    expect(nudge).toContain('merges')
    expect(nudge).toContain('response does not contain valid JSON object')
  })

  it('retryStrategy（P2-25）：回灌语与 core 同口径，不再字面反转教模型输出散文/代码块', async () => {
    await auxSkillHandlers['concept-consolidator']({ candidates: CANDIDATES } as never)
    const [spec] = mockCallPrompt.mock.calls[0] as [AuxSpec]

    const nudge = spec.retryStrategy?.onValidationFail?.({ failureReason: '散文失败' }) as string
    // 正面指令：第一个字符必须是 {、不要解释文字、不要 markdown 代码块围栏、三个数组字段
    expect(nudge).toContain('第一个字符必须是 {')
    expect(nudge).toContain('不要任何解释文字')
    expect(nudge).toContain('不要 markdown 代码块围栏')
    expect(nudge).toContain('merges、ambiguous、dropCandidates 三个顶层字段均为数组')
    // 旧的字面反转句（「不要输出解释文字或 markdown 代码块之外的内容」）已删除
    expect(nudge).not.toContain('代码块之外的内容')
  })

  it('P1-17：payload 仍注入 canonicalWhitelist/aliasMap（选项①保留字段，语义由 yaml 定义）', async () => {
    await auxSkillHandlers['concept-consolidator']({
      candidates: CANDIDATES,
      canonicalWhitelist: ['离开前翻页立好'],
      aliasMap: { '离开前翻页立好：动作先于评价': '离开前翻页立好' },
    } as never)
    const [spec] = mockCallPrompt.mock.calls[0] as [AuxSpec]

    const payload = spec.buildUserPayload?.() as Record<string, unknown>
    expect(payload.canonicalWhitelist).toEqual(['离开前翻页立好'])
    expect(payload.aliasMap).toEqual({ '离开前翻页立好：动作先于评价': '离开前翻页立好' })
  })
})
