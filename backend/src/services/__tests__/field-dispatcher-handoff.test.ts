/**
 * P1 golden 验证：配置式 goal→path 字段抽取（assembleGoalHandoff + pathInRawOutput）
 * 与既有确定性投影（buildGoalPathVisibleSummary）对同一 goal 输出的值等价。
 */

import { assembleGoalHandoff, clearRoutingCache, extractFieldsByPath, goalHandoffSourceAgentIds } from '../field-dispatcher';
import { buildGoalPathVisibleSummary } from '../learning/goal-path-visible-summary';
import { loadOrchestrationFiles } from '../field-routing/orchestration-file';

// 默认路径（不传 rowsOverride）读 DB 路由表：用替身注入编排文件声明，验证真实代码路径（#189）
jest.mock('../../config/system-database', () => ({
  __esModule: true,
  default: {
    agent_field_routings: { findMany: jest.fn() },
    field_definitions: { findMany: jest.fn() },
  },
}))
import systemPrisma from '../../config/system-database'

// 字段路由声明源：编排文件（seed TS 已退役）
const GOAL_STAGE = loadOrchestrationFiles().find((s) => s.stage === 'goal')!;
const GOAL_FIELD_ROUTING_FIELDS = GOAL_STAGE.fields;
const GOAL_FIELD_ROUTINGS = GOAL_STAGE.routings;

// 声明集：goal 阶段全部 handoff→path 的行（含挂在 skill 名下的行——抽取器读取范围=全阶段，#189）
const GOAL_PATH_HANDOFF_ROUTINGS = GOAL_FIELD_ROUTINGS.filter((r) => r.handoff.includes('path'))
const GOAL_PATH_HANDOFF_ROWS = GOAL_PATH_HANDOFF_ROUTINGS
  .map((r) => ({
    fieldId: r.fieldId,
    handoff: r.handoff,
    pathInRawOutput: GOAL_FIELD_ROUTING_FIELDS.find((f) => f.fieldId === r.fieldId)?.pathInRawOutput || null,
  }))

// 挂在 skill:goal-conversation 名下、声明 handoff→path 的字段（#189 修复前抽取器读不到）
const GOAL_SKILL_PATH_HANDOFF_FIELDS = GOAL_PATH_HANDOFF_ROUTINGS
  .filter((r) => r.agentId === 'skill:goal-conversation')
  .map((r) => r.fieldId);

function buildGoalSkillOutput(overrides: Record<string, any> = {}) {
  return {
    userVisible: '我已经了解你的目标了。',
    internal: {
      core: { conversationId: 'conv-1', stage: 'proposing', confidence: 0.86, isCompleted: false },
      ext: {
        goalConversation: {
          understanding: {
            surface_goal: '向上汇报时抓不住重点',
            real_problem: '每次汇报被追问逻辑就乱，缺问题框架',
            background_experience: '做过几次汇报，都被追问到卡壳',
            goal_orientation: '偏表现型：想尽快做出成果、证明自己',
            learning_signal: '想直接要模板',
            cognitive_bandwidth: '多任务并发',
            constraints_and_boundaries: ['不能占用工作时间'],
            pain_points: ['逻辑混乱', '紧张'],
            motivation: '想升职',
            urgency: '高',
            scenario: '月度经营会',
            deadline_text: '1个月',
            current_baseline: { level: '初级', evidence: '上次汇报被领导打断' },
            success_criteria: { observable_result: '独立完成一次15分钟汇报', acceptance_check: '逻辑链完整' },
            available_resources: { time_budget: '每周5小时', time_horizon: '1个月+', time_per_session: '45分钟' },
            // P0.1 起新增的 goal 理解字段（与 prompts/orchestration/goal.yaml 声明同步；金样覆盖可解析性）
            deadline_date: '2026-11-24',
            time_dimensions: '每周 5 小时，约 1 个月',
            primary_block_type: 'expression',
            recurrence: 'once',
            block_type_evidence: '汇报被追问后卡壳',
            support_need: '需要框架模板与陪练',
            school_anchor: { textbook: '自选材料', exam_form: '工作汇报', progress: '有若干次未通过经历' },
            // R8 起新增的可判定性/能力边界字段（与 goal.yaml 声明同步）
            skill_nature: 'cognitive_internalized',
            skill_nature_evidence: '需要自己组织汇报逻辑，AI 不能代跑',
            platform_judgment: 'judgeable_output',
            platform_judgment_evidence: '汇报稿与结构图可提交对照',
            sensor_readouts: [],
            needsMaterial: { kind: 'standard', title: '内部汇报规范', why: '需要原文对照结构要求', queries: [], origin: 'private' },
            prerequisiteDiagnostics: [{ concept: '汇报结构', mastery: 'weak' }],
            prerequisiteCheckResults: [{ questionId: 'q1', correct: true }],
          },
          confirmedProposal: {
            learning_direction: '汇报逻辑框架',
            first_deliverable: '一次完整汇报',
            key_stages: ['识别问题结构', '建立汇报框架', '实战汇报'],
            out_of_scope: [],
            scope_size: 'small',
          },
          proposalQuality: { pass: true, issues: [] },
          nextQuestions: ['你希望先解决哪一块？'],
          quickReplies: ['先搭框架', '先练表达'],
          structuredData: { learner: { identity: { role: 'manager' }, learning_context: { context: '工作' } } },
          confidenceScores: { overall: 0.86, surfaceGoal: 0.9, realProblem: 0.8 },
        },
      },
    },
    ...overrides,
  };
}

describe('assembleGoalHandoff（配置式 goal→path 值抽取）', () => {
  it('抽取的字段值与 visibleSummary 确定性投影等价', async () => {
    const output = buildGoalSkillOutput()
    const { fields } = await assembleGoalHandoff(output, GOAL_PATH_HANDOFF_ROWS)
    const ext = output.internal.ext.goalConversation
    const visible = buildGoalPathVisibleSummary({
      understanding: ext.understanding,
      confirmedProposal: ext.confirmedProposal,
      collected: {},
    })

    expect(fields['understanding.real_problem']).toBe(ext.understanding.real_problem)
    expect(fields['understanding.real_problem']).toBe(visible.realProblem)
    expect(fields['understanding.background_experience']).toBe(visible.backgroundExperience)
    expect(fields['understanding.goal_orientation']).toBe(visible.goalOrientation)
    expect(fields['understanding.learning_signal']).toBe(visible.learningSignal)
    expect(fields['confirmedProposal.key_stages']).toEqual(visible.confirmedProposal?.keyStages)
    expect(fields['understanding.success_criteria.observable_result']).toBe(visible.successCriteria?.observableResult)
    expect(fields['understanding.available_resources.time_budget']).toBe(visible.resources?.timeBudget)
  })

  it('缺字段时跳过（不猜测路径），其余字段照常抽取', async () => {
    const output = buildGoalSkillOutput({
      internal: {
        core: { conversationId: 'conv-1' },
        ext: {
          goalConversation: {
            understanding: {
              surface_goal: '只给了表面目标',
              // real_problem 缺失
            },
            confirmedProposal: { key_stages: ['阶段一'] },
          },
        },
      },
    })
    const { fields, skipped } = await assembleGoalHandoff(output, GOAL_PATH_HANDOFF_ROWS)
    expect(fields['understanding.surface_goal']).toBe('只给了表面目标')
    expect(fields['understanding.real_problem']).toBeUndefined()
    expect(skipped.some((item) => item.includes('understanding.real_problem'))).toBe(true)
  })

  it('编排文件的 pathInRawOutput 与 goal skill 输出结构一致（全部可解析）', () => {
    const output = buildGoalSkillOutput()
    const rows = GOAL_FIELD_ROUTING_FIELDS.map((f) => ({ fieldId: f.fieldId, pathInRawOutput: f.pathInRawOutput }))
    const flat = extractFieldsByPath(output, rows)
    const registered = rows.filter((r) => r.pathInRawOutput).map((r) => r.fieldId)
    expect(registered.length).toBeGreaterThan(20)
    expect(registered.every((fieldId) => fieldId in flat)).toBe(true)
  })

  // 回归守卫（#189）：挂在 skill 名下、声明 handoff→path 的字段此前抽取不到（抽取器只读 agent 名下行）
  it('skill 名下 handoff→path 的字段可被抽取（#189）', async () => {
    expect(GOAL_SKILL_PATH_HANDOFF_FIELDS.length).toBe(6)
    const output = buildGoalSkillOutput()
    const { fields } = await assembleGoalHandoff(output, GOAL_PATH_HANDOFF_ROWS)
    for (const fieldId of GOAL_SKILL_PATH_HANDOFF_FIELDS) {
      expect(Object.prototype.hasOwnProperty.call(fields, fieldId)).toBe(true)
    }
    expect(fields['understanding.skill_nature']).toBe('cognitive_internalized')
    expect(fields['understanding.needsMaterial']).toEqual(
      expect.objectContaining({ title: '内部汇报规范' }),
    )
  })

  // 抽取器读取范围守卫（#189）：若把 loadGoalStageRows 收窄回 goal-agent，本条失败
  it('抽取器读取范围覆盖 goal 阶段全部 handoff→path 声明行', () => {
    const scope = goalHandoffSourceAgentIds()
    const declaredOwners = [...new Set(GOAL_PATH_HANDOFF_ROUTINGS.map((r) => r.agentId))]
    // 两种声明归属都出现：agent 桥接行 + skill 行
    expect(declaredOwners.length).toBeGreaterThan(1)
    for (const owner of declaredOwners) {
      expect(scope).toContain(owner)
    }
    // 直接钉住：goal 的成员 skill 必须在读取范围内
    expect(scope).toContain('skill:goal-conversation')
  })

  // 真实代码路径守卫（#189）：默认路径（读 DB 路由表）必须经 goal 阶段成员 skill 行抽取；
  // 若把 loadGoalStageRows 收窄回 goal-agent，本条的 6 个字段会全部缺失
  it('默认路径（读 DB 路由表）抽取 skill 名下 handoff→path 的字段', async () => {
    const mockPrisma = systemPrisma as unknown as {
      agent_field_routings: { findMany: jest.Mock }
      field_definitions: { findMany: jest.Mock }
    }
    mockPrisma.agent_field_routings.findMany.mockResolvedValue(
      GOAL_FIELD_ROUTINGS.map((r) => ({
        agentId: r.agentId,
        fieldId: r.fieldId,
        render: r.render,
        handoff: JSON.stringify(r.handoff),
        internalFlag: r.internal,
        accumulate: r.accumulate,
        notes: r.notes ?? null,
      })),
    )
    mockPrisma.field_definitions.findMany.mockResolvedValue(
      GOAL_FIELD_ROUTING_FIELDS.map((f) => ({
        stage: 'goal',
        fieldId: f.fieldId,
        promptRole: f.promptRole,
        valueType: f.valueType,
        pathInRawOutput: f.pathInRawOutput ?? null,
      })),
    )
    clearRoutingCache()
    try {
      const { fields } = await assembleGoalHandoff(buildGoalSkillOutput())
      for (const fieldId of GOAL_SKILL_PATH_HANDOFF_FIELDS) {
        expect(Object.prototype.hasOwnProperty.call(fields, fieldId)).toBe(true)
      }
    } finally {
      clearRoutingCache()
    }
  })
})
