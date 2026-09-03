/**
 * 数据流水线模型单测：用运行时抓取的真实字段路由矩阵驱动，
 * 验证「入口 / 出口 / 步骤 / 内部边」推导与编排文件语义一致（File-as-Truth 投影）。
 */
import { describe, expect, it } from 'vitest'
import { buildStageFlow, familyOf, familyHue } from '../dataFlow'
import { fixtureDetails } from './fixture-details'

const detailsById = fixtureDetails as Record<string, unknown>
const stageNames = { goal: 'Goal 阶段', path: 'Path 阶段', teaching: '教学阶段' }
const topo = [
  { id: 'skill:goal-conversation', type: 'skill', parentAgentId: 'goal-agent', stats: { totalCalls: 387, failed: 32 } },
  { id: 'skill:path-planning', type: 'skill', parentAgentId: 'path-agent', stats: { totalCalls: 490, failed: 7 } },
  { id: 'skill:stage-designer', type: 'skill', parentAgentId: 'path-agent', stats: { totalCalls: 1767, failed: 90 } },
  { id: 'skill:teaching-turn', type: 'skill', parentAgentId: 'teaching-agent', stats: { totalCalls: 3000, failed: 12 } },
]

const flowOf = (s: string) =>
  buildStageFlow(
    s,
    (detailsById as any)[s],
    detailsById as any,
    s === 'path'
      ? [
          { step: 1, agentId: 'PathCoordinator.buildFramedNormalizedInput', role: 'input-framing', condition: 'when goal handoff received', resolved: { displayName: 'PathCoordinator.buildFramedNormalizedInput', kind: 'service' } },
          { step: 2, agentId: 'skill:path-planning', role: 'cognitive-core-and-milestones', resolved: { displayName: '路径规划 Skill', kind: 'skill' } },
          { step: 3, agentId: 'skill:stage-designer', role: 'stage-task-expansion', loopOver: 'milestones', resolved: { displayName: '阶段设计 Skill', kind: 'skill' } },
        ]
      : [],
    topo as any,
    stageNames,
  )

describe('familyOf / familyHue', () => {
  it('取 fieldId 首段为数据族，无点号整体为族', () => {
    expect(familyOf('cognitiveCore.cognitiveDomain')).toBe('cognitiveCore')
    expect(familyOf('personaSeed')).toBe('personaSeed')
  })
  it('同一数据族颜色稳定', () => {
    expect(familyHue('cognitiveCore')).toBe(familyHue('cognitiveCore'))
    expect(familyHue('milestones')).toBe(familyHue('milestones'))
  })
})

describe('goal 阶段（链首：无入口，出口 24 字段 → path）', () => {
  const f = flowOf('goal')
  it('fieldCount 与真实定义一致（31）', () => {
    expect(f.fieldCount).toBe(31)
  })
  it('无上游入口；出口字段全部交接给 path', () => {
    expect(f.entry).toHaveLength(0)
    expect(f.exit.length).toBeGreaterThan(0)
    expect(f.exit.every((c) => c.handoffTargets.includes('path'))).toBe(true)
  })
  it('步骤含 goal-conversation（统计来自拓扑）', () => {
    const skill = f.steps.find((s) => s.agentId === 'skill:goal-conversation')
    expect(skill).toBeTruthy()
    expect(skill!.calls).toBe(387)
    expect(skill!.failed).toBe(32)
  })
})

describe('path 阶段（入口 24 字段；闸口分发 normalizedInput；内部边 path-planning→stage-designer）', () => {
  const f = flowOf('path')
  it('入口 = goal 阶段交接字段（无过滤）', () => {
    expect(f.entry.length).toBeGreaterThan(0)
    expect(f.entryFrom?.stageId).toBe('goal')
  })
  it('桥接闸口步骤包含分发字段（normalizedInput.* → skills），不含跨阶段出口字段', () => {
    const gate = f.steps.find((s) => s.kind === 'bridge-entry')
    expect(gate).toBeTruthy()
    expect(gate!.outputs.some((c) => c.family === 'normalizedInput')).toBe(true)
    // 闸口分发字段的去向标签 = 内部 skill
    const dist = gate!.outputs.find((c) => c.family === 'normalizedInput')!
    expect(dist.toTags.some((t) => t.kind === 'skill')).toBe(true)
    // 跨阶段字段（milestones.goal → teaching）不属于闸口分发，进出口卡
    expect(gate!.outputs.some((c) => c.fieldId === 'milestones.goal')).toBe(false)
    expect(f.exit.some((c) => c.fieldId === 'milestones.goal')).toBe(true)
  })
  it('步骤顺序 = defSteps：闸口 → path-planning → stage-designer', () => {
    const order = f.steps.map((s) => s.agentId)
    expect(order.indexOf('path-agent')).toBeGreaterThanOrEqual(0)
    expect(order.indexOf('skill:path-planning')).toBeGreaterThan(order.indexOf('path-agent'))
    expect(order.indexOf('skill:stage-designer')).toBeGreaterThan(order.indexOf('skill:path-planning'))
  })
  it('path-planning 产出 cognitiveCore.* 且其 handoff 指向 stage-designer → 内部边', () => {
    const pp = f.steps.find((s) => s.agentId === 'skill:path-planning')!
    expect(pp.outputs.some((c) => c.fieldId === 'cognitiveCore.cognitiveDomain')).toBe(true)
    const internal = f.edges.filter((e) => e.kind === 'internal')
    expect(internal.length).toBeGreaterThan(0)
  })
  it('stage-designer 的输入包含 path-planning 移交字段（里程碑/认知核心）', () => {
    const sd = f.steps.find((s) => s.agentId === 'skill:stage-designer')!
    expect(sd.inputs.some((c) => c.fieldId === 'milestones.goal')).toBe(true)
    expect(sd.inputs.some((c) => c.fieldId === 'cognitiveCore.cognitiveDomain')).toBe(true)
  })
  it('出口 = 桥接 agent 交接 teaching 的字段（milestones/path/subtasks）', () => {
    expect(f.exitTo?.stageId).toBe('teaching')
    const ids = f.exit.map((c) => c.fieldId)
    expect(ids).toContain('milestones.goal')
    expect(ids).toContain('path.name')
    expect(ids).toContain('subtasks.acceptanceCriteria')
  })
  it('服务步骤如实标注（代码服务，无字段契约）', () => {
    const svc = f.steps.find((s) => s.agentId === 'PathCoordinator.buildFramedNormalizedInput')
    expect(svc).toBeTruthy()
    expect(svc!.kind).toBe('service')
    expect(svc!.outputs).toHaveLength(0)
  })
  it('orphan 步骤：已注册 agent 但无字段契约（0 routing 行 + 不在 defSteps）→ kind=orphan，如实保留调用统计', () => {
    if (f.steps.some((s) => s.agentId === 'skill:kc-mapper')) {
      const o = f.steps.find((s) => s.agentId === 'skill:kc-mapper')!
      expect(o.kind).toBe('orphan')
      expect(o.outputs).toHaveLength(0)
      expect(o.inputs).toHaveLength(0)
      expect(o.calls).toBe(0)
    } else {
      // fixture 无 orphan 时：确认 model 类型可表达且普通 skill 不受影响
      const pp = f.steps.find((s) => s.agentId === 'skill:path-planning')!
      expect(pp.kind).toBe('skill')
      expect(pp.outputs.length).toBeGreaterThan(0)
    }
  })
})

describe('teaching 阶段（入口 path 交接；teaching-turn 输入来自闸口分发；内部边 teaching-turn→peer-reinforcement）', () => {
  const f = flowOf('teaching')
  it('入口来自 path 阶段', () => {
    expect(f.entryFrom?.stageId).toBe('path')
    expect(f.entry.length).toBeGreaterThan(0)
  })
  it('teaching-turn 输入含闸口分发的 classroomContext（内部）', () => {
    const tt = f.steps.find((s) => s.agentId === 'skill:teaching-turn')!
    expect(tt.inputs.some((c) => c.fieldId === 'classroomContext')).toBe(true)
    // 闸口同样不混入 analysis.*（这些字段走 teaching-agent → profile 出口）
    const gate = f.steps.find((s) => s.kind === 'bridge-entry')!
    expect(gate.outputs.some((c) => c.fieldId === 'analysis.confusionPoints')).toBe(false)
  })
  it('control.shouldTriggerPeer → peer-reinforcement 内部边', () => {
    const pr = f.steps.find((s) => s.agentId === 'skill:peer-reinforcement')
    expect(pr).toBeTruthy()
    expect(
      f.edges.some((e) => e.kind === 'internal' && e.fieldId === 'control.shouldTriggerPeer'),
    ).toBe(true)
  })
})

describe('统计与数据族', () => {
  it('path 阶段总调用 = 拓扑聚合（490 + 1767）', () => {
    expect(flowOf('path').stats.calls).toBe(2257)
  })
  it('数据族清单按字段数降序', () => {
    const fams = flowOf('path').families
    expect(fams.length).toBeGreaterThan(0)
    for (let i = 1; i < fams.length; i++) {
      expect(fams[i - 1].count).toBeGreaterThanOrEqual(fams[i].count)
    }
  })
})

/** 类型导出冒烟：StageFlow 可由模型产出 */
it('类型导出', () => {
  const f: import('../dataFlow').StageFlow = flowOf('path')
  expect(f.stageId).toBe('path')
})
