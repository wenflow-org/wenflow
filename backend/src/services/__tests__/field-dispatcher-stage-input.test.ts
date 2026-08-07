/**
 * P2 golden：stage-designer 输入装配的配置化等价验证。
 * 当前 learning.service 手拼 stageDesignerInput（milestone/previousMilestone/cognitiveCore/normalizedInput）；
 * 本测试验证：按路由表（path-agent 注入行 + path-planning 产出行）配置化抽取的字段
 * 与手拼装配的关键字段值等价。
 */

import { extractFieldsByPath, assembleStageDesignerChannels } from '../field-dispatcher';
import { PATH_FIELD_ROUTING_FIELDS, PATH_FIELD_ROUTINGS } from '../../scripts/seed-path-field-routings';
import { buildFramedNormalizedInput } from '../learning/path-planning-hints';

const MILESTONE = {
  stageNumber: 2,
  title: '建立汇报框架',
  coreConcept: 'concept-2',
  description: '基于诊断建立汇报的认知框架',
  goal: '能独立搭建一次汇报的逻辑框架',
  estimatedHours: 4,
}

const PREVIOUS_MILESTONE = {
  stageNumber: 1,
  title: '识别问题结构',
  coreConcept: 'concept-1',
}

const PATH_STATE = {
  milestones: [MILESTONE],
  previousMilestone: PREVIOUS_MILESTONE,
  cognitiveCore: {
    cognitiveDomain: '在汇报约束下识别问题结构并建立表达框架',
    coreConcepts: [
      { id: 'concept-1', name: '问题结构的识别与定位', role: 'hub' },
      { id: 'concept-2', name: '表达框架的建立与稳定', role: 'supporting' },
    ],
  },
  normalizedInput: buildFramedNormalizedInput({
    version: '1.0',
    learnerProfile: { surfaceGoal: '学会汇报' },
    problemSpace: { realProblem: '汇报被追问就乱' },
    resources: { timeBudget: '每周5小时', timeBudgetCadence: 'per_week', timeHorizon: '1个月+' },
    successCriteria: { observableResult: '独立完成一次汇报' },
    confirmedProposal: { learningDirection: '汇报框架', firstDeliverable: '一次完整汇报', keyStages: ['识别问题', '建框架', '实战'] },
  }),
}

describe('stage-designer 输入装配（配置化 vs 手拼等价）', () => {
  it('path 阶段路由行可按 pathInRawOutput 从路径状态抽取 stage-designer 输入', () => {
    // path-agent 注入行（normalizedInput.*/previousMilestone）+ path-planning 产出行（milestones/cognitiveCore）
    const rows = PATH_FIELD_ROUTINGS
      .filter((r) => r.handoff.includes('skill:stage-designer'))
      .map((r) => ({
        fieldId: r.fieldId,
        handoff: r.handoff,
        pathInRawOutput: PATH_FIELD_ROUTING_FIELDS.find((f) => f.fieldId === r.fieldId)?.pathInRawOutput || null,
      }))
    // 本阶段行未登记 pathInRawOutput（编排数据源，非 skill 输出）——按 fieldId 语义直取
    const byField = (state: Record<string, any>, fieldId: string): any => {
      const [root, ...rest] = fieldId.split('.')
      let value = state[root]
      if (Array.isArray(value)) value = value[0]
      return rest.reduce((cur: any, key) => (cur && typeof cur === 'object' ? cur[key] : undefined), value)
    }

    const extracted = rows.filter((r) => !r.pathInRawOutput)
    const milestoneRow = extracted.find((r) => r.fieldId === 'milestones.title')
    const normalizedRow = extracted.find((r) => r.fieldId.startsWith('normalizedInput.'))
    // previousMilestone 已登记 pathInRawOutput（编排注入通道），走配置抽值
    const previousRow = rows.find((r) => r.fieldId === 'previousMilestone')

    expect(milestoneRow).toBeDefined()
    expect(previousRow).toBeDefined()
    expect(previousRow!.pathInRawOutput).toBe('previousMilestone')
    expect(normalizedRow).toBeDefined()
    expect(byField(PATH_STATE, 'milestones.title')).toBe(MILESTONE.title)
    expect(byField(PATH_STATE, 'previousMilestone')).toEqual(PREVIOUS_MILESTONE)
    expect(byField(PATH_STATE, 'normalizedInput.problemSpace.realProblem')).toBe('汇报被追问就乱')
  })

  it('配置化抽取的 normalizedInput 与手拼 buildFramedNormalizedInput 定帧值一致', () => {
    const configured = PATH_STATE.normalizedInput
    // 手拼等价：learning.service processStageDesign 用 stageDesignerBaseInput = { cognitiveCore, normalizedInput }
    expect(configured.problemSpace.realProblem).toBe('汇报被追问就乱')
    expect(configured.resources.timeBudget).toBe('每周5小时')
    expect(configured.confirmedProposal.firstDeliverable).toBe('一次完整汇报')
    expect(configured.planningHints.paceSignal).toBeDefined()
    expect(configured.planningHints.milestoneRange).toBeDefined()
  })

  it('previousMilestone 已登记路由行且 handoff 指向 stage-designer', () => {
    const row = PATH_FIELD_ROUTINGS.find((r) => r.fieldId === 'previousMilestone')
    expect(row).toBeDefined()
    expect(row!.handoff).toContain('skill:stage-designer')
    expect(row!.agentId).toBe('path-agent')
  })

  it('assembleStageDesignerChannels 抽值与手拼 previousMilestone 等价（含首阶段跳过）', async () => {
    const rows = PATH_FIELD_ROUTINGS
      .filter((r) => r.agentId === 'path-agent' && r.fieldId === 'previousMilestone')
      .map((r) => ({
        fieldId: r.fieldId,
        handoff: r.handoff,
        pathInRawOutput: PATH_FIELD_ROUTING_FIELDS.find((f) => f.fieldId === r.fieldId)?.pathInRawOutput || null,
      }))

    // 非首阶段：配置抽值 = 手拼投影
    const withPrev = await assembleStageDesignerChannels({
      previousMilestone: { stageNumber: 1, title: '识别问题结构', coreConcept: 'concept-1' },
    }, rows)
    expect(withPrev.channels['previousMilestone']).toEqual({ stageNumber: 1, title: '识别问题结构', coreConcept: 'concept-1' })
    expect(withPrev.skipped).toEqual([])

    // 首阶段（null）：抽到显式 null（与手拼一致），不报错
    const withoutPrev = await assembleStageDesignerChannels({ previousMilestone: null }, rows)
    expect(withoutPrev.channels['previousMilestone']).toBeNull()
    expect(withoutPrev.skipped).toEqual([])
  })
})
