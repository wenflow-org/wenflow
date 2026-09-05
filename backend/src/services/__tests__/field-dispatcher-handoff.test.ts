/**
 * P1 golden 验证：配置式 goal→path 字段抽取（assembleGoalHandoff + pathInRawOutput）
 * 与既有确定性投影（buildGoalPathVisibleSummary）对同一 goal 输出的值等价。
 */

import { assembleGoalHandoff, extractFieldsByPath } from '../field-dispatcher';
import { buildGoalPathVisibleSummary } from '../learning/goal-path-visible-summary';
import { loadOrchestrationFiles } from '../field-routing/orchestration-file';

// 字段路由声明源：编排文件（seed TS 已退役）
const GOAL_STAGE = loadOrchestrationFiles().find((s) => s.stage === 'goal')!;
const GOAL_FIELD_ROUTING_FIELDS = GOAL_STAGE.fields;
const GOAL_FIELD_ROUTINGS = GOAL_STAGE.routings;

const GOAL_AGENT_HANDOFF_ROWS = GOAL_FIELD_ROUTINGS
  .filter((r) => r.agentId === 'goal-agent' && r.handoff.includes('path'))
  .map((r) => ({
    fieldId: r.fieldId,
    handoff: r.handoff,
    pathInRawOutput: GOAL_FIELD_ROUTING_FIELDS.find((f) => f.fieldId === r.fieldId)?.pathInRawOutput || null,
  }))

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
          },
          confirmedProposal: {
            learning_direction: '汇报逻辑框架',
            first_deliverable: '一次完整汇报',
            key_stages: ['识别问题结构', '建立汇报框架', '实战汇报'],
            out_of_scope: [],
          },
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
    const { fields } = await assembleGoalHandoff(output, GOAL_AGENT_HANDOFF_ROWS)
    const ext = output.internal.ext.goalConversation
    const visible = buildGoalPathVisibleSummary({
      understanding: ext.understanding,
      confirmedProposal: ext.confirmedProposal,
      collected: {},
    })

    expect(fields['understanding.real_problem']).toBe(ext.understanding.real_problem)
    expect(fields['understanding.real_problem']).toBe(visible.realProblem)
    expect(fields['understanding.background_experience']).toBe(visible.backgroundExperience)
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
    const { fields, skipped } = await assembleGoalHandoff(output, GOAL_AGENT_HANDOFF_ROWS)
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
})
