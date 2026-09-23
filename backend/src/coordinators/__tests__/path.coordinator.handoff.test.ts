/**
 * G2P golden：normalizedInputV1 配置式装配（goalHandoffFields 优先 + visibleSummary 回退）
 * 与既有确定性投影装配的等价性验证。
 */

import pathOrchestrator from '../path.coordinator'

jest.mock('../../services/agentConfig.service', () => ({
  getPathAgentInputConfig: jest.fn(async () => ({
    normalizedInput: {
      descriptionSources: ['goalFinalPayload.rawGoal'],
      subjectSources: ['goalFinalPayload.visibleSummary.surfaceGoal'],
      skillLevelSources: ['goalFinalPayload.visibleSummary.currentBaseline.level'],
      timePerDaySources: ['goalFinalPayload.visibleSummary.resources.timeBudget'],
      deadlineTextSources: ['goalFinalPayload.visibleSummary.resources.deadlineText'],
      includeConfirmedProposal: true,
      includeConversationHistory: false,
    },
  })),
}))

jest.mock('../../services/learning/learning.service', () => ({ __esModule: true, default: {} }))

const VISIBLE_SUMMARY = {
  surfaceGoal: '向上汇报时抓不住重点',
  realProblem: '每次汇报被追问逻辑就乱，缺问题框架',
  backgroundExperience: '做过几次汇报都被追问到卡壳',
  learningSignal: '想直接要模板',
  painPoints: ['逻辑混乱', '紧张'],
  constraintsAndBoundaries: ['不能占用工作时间'],
  scenario: '月度经营会',
  currentPainPoint: '逻辑混乱',
  currentBaseline: { level: '初级', evidence: '上次汇报被领导打断' },
  resources: {
    timeBudget: '每周5小时',
    timeBudgetCadence: 'per_week',
    timePerWeek: '每周5小时',
    timePerSession: '45分钟',
    timeHorizon: '1个月+',
    deadlineText: '1个月',
  },
  successCriteria: { observableResult: '独立完成一次15分钟汇报', acceptanceCheck: '逻辑链完整' },
  confirmedProposal: {
    learningDirection: '汇报逻辑框架',
    firstDeliverable: '一次完整汇报',
    keyStages: ['识别问题结构', '建立汇报框架', '实战汇报'],
    outOfScope: [],
  },
}

const HANDOFF_FIELDS = {
  'understanding.surface_goal': '向上汇报时抓不住重点',
  'understanding.real_problem': '每次汇报被追问逻辑就乱，缺问题框架',
  'understanding.background_experience': '做过几次汇报都被追问到卡壳',
  'understanding.learning_signal': '想直接要模板',
  'understanding.pain_points': ['逻辑混乱', '紧张'],
  'understanding.constraints_and_boundaries': ['不能占用工作时间'],
  'understanding.scenario': '月度经营会',
  'understanding.current_baseline.level': '初级',
  'understanding.current_baseline.evidence': '上次汇报被领导打断',
  'understanding.success_criteria.observable_result': '独立完成一次15分钟汇报',
  'understanding.success_criteria.acceptance_check': '逻辑链完整',
  'understanding.available_resources.time_budget': '每周5小时',
  'understanding.available_resources.time_horizon': '1个月+',
  'understanding.available_resources.time_per_session': '45分钟',
  'confirmedProposal.learning_direction': '汇报逻辑框架',
  'confirmedProposal.first_deliverable': '一次完整汇报',
  'confirmedProposal.key_stages': ['识别问题结构', '建立汇报框架', '实战汇报'],
  'confirmedProposal.out_of_scope': [],
}

describe('path.coordinator normalizedInputV1 配置式装配', () => {
  it('goalHandoffFields 齐全时装配结果与 visibleSummary 等价', async () => {
    const withHandoff = await pathOrchestrator.previewNormalizedGoalInput({
      userId: 'user-1',
      rawGoal: '想学会向上汇报',
      visibleSummary: VISIBLE_SUMMARY,
      goalHandoffFields: HANDOFF_FIELDS,
    } as any)

    const withoutHandoff = await pathOrchestrator.previewNormalizedGoalInput({
      userId: 'user-1',
      rawGoal: '想学会向上汇报',
      visibleSummary: VISIBLE_SUMMARY,
    } as any)

    const ni = withHandoff.userProfile.normalizedInput
    const niOld = withoutHandoff.userProfile.normalizedInput

    // 关键字段：handoff 装配与旧装配（visibleSummary 回退）一致
    expect(ni.learnerProfile.surfaceGoal).toBe(niOld.learnerProfile.surfaceGoal)
    expect(ni.problemSpace.realProblem).toBe('每次汇报被追问逻辑就乱，缺问题框架')
    expect(ni.problemSpace.realProblem).toBe(niOld.problemSpace.realProblem)
    expect(ni.problemSpace.scenario).toBe(niOld.problemSpace.scenario)
    expect(ni.resources.timeBudget).toBe('每周5小时')
    expect(ni.resources.timeBudget).toBe(niOld.resources.timeBudget)
    expect(ni.resources.timePerSession).toBe(niOld.resources.timePerSession)
    expect(ni.successCriteria.observableResult).toBe(niOld.successCriteria.observableResult)
    expect(ni.confirmedProposal?.firstDeliverable).toBe(niOld.confirmedProposal?.firstDeliverable)
    expect(ni.confirmedProposal?.keyStages).toEqual(niOld.confirmedProposal?.keyStages)
    // 派生字段保持既有逻辑
    expect(ni.resources.timeBudgetCadence).toBe('per_week')
    expect(ni.problemSpace.currentPainPoint).toBe('逻辑混乱')
    // 定帧附加 planningHints
    expect(ni.planningHints.paceSignal).toBeDefined()
  })

  it('learnerLoadProfile 透传并真正收紧体量（虚拟学习者负荷接线）', async () => {
    const tightenedInput = await pathOrchestrator.previewNormalizedGoalInput({
      userId: 'user-1',
      rawGoal: '想学会向上汇报',
      visibleSummary: VISIBLE_SUMMARY,
      learnerLoadProfile: { availableTime: 'minimal', loadTolerance: '低——步骤一多就烦' },
    } as any)
    const baseInput = await pathOrchestrator.previewNormalizedGoalInput({
      userId: 'user-1',
      rawGoal: '想学会向上汇报',
      visibleSummary: VISIBLE_SUMMARY,
    } as any)

    const tightened = tightenedInput.userProfile.normalizedInput
    const base = baseInput.userProfile.normalizedInput

    // 1) 画像本身透传进 normalizedInput
    expect(tightened.learnerLoadProfile).toEqual({ availableTime: 'minimal', loadTolerance: '低——步骤一多就烦' })
    // 2) 未传时不注入（真实用户链路行为不变）
    expect(base.learnerLoadProfile ?? null).toBeNull()
    // 3) 真正影响到 planningHints（收紧紧预算/低耐受）
    expect(tightened.planningHints.subtaskMinutesRange[1]).toBeLessThanOrEqual(45)
    expect(tightened.planningHints.subtaskMinutesRange[1])
      .toBeLessThanOrEqual(base.planningHints.subtaskMinutesRange[1])
    expect(tightened.planningHints.maxWeeks).toBeLessThanOrEqual(2)
    expect(tightened.planningHints.maxWeeks).toBeLessThanOrEqual(base.planningHints.maxWeeks)
  })

  it('handoff 缺失字段时回退 visibleSummary（不丢数据）', async () => {
    const partial = await pathOrchestrator.previewNormalizedGoalInput({
      userId: 'user-1',
      rawGoal: '想学会向上汇报',
      visibleSummary: VISIBLE_SUMMARY,
      goalHandoffFields: {
        'understanding.real_problem': '每次汇报被追问逻辑就乱，缺问题框架',
        // 其余字段缺失 → 回退 visibleSummary
      },
    } as any)

    const ni = partial.userProfile.normalizedInput
    expect(ni.problemSpace.realProblem).toBe('每次汇报被追问逻辑就乱，缺问题框架')
    expect(ni.learnerProfile.surfaceGoal).toBe(VISIBLE_SUMMARY.surfaceGoal)
    expect(ni.resources.timeBudget).toBe(VISIBLE_SUMMARY.resources.timeBudget)
    expect(ni.successCriteria.observableResult).toBe(VISIBLE_SUMMARY.successCriteria.observableResult)
  })

  it('无 handoff 无 visibleSummary 时 rawGoal 兜底', async () => {
    const bare = await pathOrchestrator.previewNormalizedGoalInput({
      userId: 'user-1',
      rawGoal: '想学会向上汇报',
    } as any)

    const ni = bare.userProfile.normalizedInput
    expect(ni.learnerProfile.surfaceGoal).toBe('想学会向上汇报')
  })

  // 回归（审计 P0 §1.1）：goal 层 prerequisiteCheckResults 曾从不进 GoalPathRequest，
  // 前置探测（"防自评虚高"）在主流程里完全不生效。锁定消费端接线，防再次断开。
  it('prerequisiteCheckResults 透传进 normalizedInput；未提供时不注入', async () => {
    const probes = [
      { probeId: 'probe-1', targetConcept: '问题结构识别', userAnswer: 'B', isCorrect: false },
    ]

    const withProbes = await pathOrchestrator.previewNormalizedGoalInput({
      userId: 'user-1',
      rawGoal: '想学会向上汇报',
      visibleSummary: VISIBLE_SUMMARY,
      prerequisiteCheckResults: probes,
    } as any)

    const withoutProbes = await pathOrchestrator.previewNormalizedGoalInput({
      userId: 'user-1',
      rawGoal: '想学会向上汇报',
      visibleSummary: VISIBLE_SUMMARY,
    } as any)

    expect(withProbes.userProfile.normalizedInput.prerequisiteCheckResults).toEqual(probes)
    // 真实用户无探测结果 → 不注入（行为与今天一致）
    expect(withoutProbes.userProfile.normalizedInput.prerequisiteCheckResults ?? null).toBeNull()
    // 落库快照保留探测结果，供异步生成/重试复用
    expect(withProbes.userProfile.goalFinalPayload?.prerequisiteCheckResults).toEqual(probes)
  })

  // 回归（审计 P1 §2.2a/§2.2c）：用户「补充说明重新生成」写进 GoalPathRequest.adjustments，
  // 但 buildNormalizedInputV1 不产出 understanding ⇒ core 规则要消费的
  // normalizedInput.understanding.adjustments 永无输入，用户可见功能实际无效。
  it('adjustments 进入 normalizedInput.understanding（用户补充说明可达）；未提供时不注入', async () => {
    const withAdjustments = await pathOrchestrator.previewNormalizedGoalInput({
      userId: 'user-1',
      rawGoal: '想学会向上汇报',
      visibleSummary: VISIBLE_SUMMARY,
      adjustments: '第二阶段太难了，想先补基础',
    } as any)

    const without = await pathOrchestrator.previewNormalizedGoalInput({
      userId: 'user-1',
      rawGoal: '想学会向上汇报',
      visibleSummary: VISIBLE_SUMMARY,
    } as any)

    expect(withAdjustments.userProfile.normalizedInput.understanding?.adjustments).toBe('第二阶段太难了，想先补基础')
    expect(without.userProfile.normalizedInput.understanding ?? null).toBeNull()
  })

  // 回归：GoalFinalPayload 重建时曾漏拷 goalHandoffFields，导致 handoff 恒被丢弃、永远回退 visibleSummary。
  // 本用例取 handoff 与 visibleSummary 不同的值，只有真交接才会得到 HANDOFF 值。
  it('goalHandoffFields 真实生效：与 visibleSummary 取值不同时以 handoff 为准', async () => {
    const result = await pathOrchestrator.previewNormalizedGoalInput({
      userId: 'user-1',
      rawGoal: '想学会向上汇报',
      visibleSummary: VISIBLE_SUMMARY,
      goalHandoffFields: {
        'understanding.real_problem': 'HANDOFF 版本的真问题',
        'understanding.available_resources.time_budget': 'HANDOFF 每周2小时',
        'understanding.pain_points': ['HANDOFF 痛点A'],
      },
    } as any)

    const ni = result.userProfile.normalizedInput
    expect(ni.problemSpace.realProblem).toBe('HANDOFF 版本的真问题')
    expect(ni.resources.timeBudget).toBe('HANDOFF 每周2小时')
    expect(ni.learnerProfile.painPoints).toEqual(['HANDOFF 痛点A'])
    // 落库快照必须保留 handoff，供异步生成/重试/重生成复用
    expect(result.userProfile.goalFinalPayload?.goalHandoffFields).toMatchObject({
      'understanding.real_problem': 'HANDOFF 版本的真问题',
    })
  })
})
