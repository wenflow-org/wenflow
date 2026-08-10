import {
  detectFieldRoutingDrift,
  validateFieldRoutingSeedSemantics,
  FIELD_ROUTING_SEED_MANIFEST,
} from '../field-routing-bootstrap.service'
import { loadOrchestrationFiles, type OrchestrationStage } from '../field-routing/orchestration-file'

// 字段路由声明源：编排文件（seed TS 已退役）
const ORCHESTRATION_STAGES: OrchestrationStage[] = loadOrchestrationFiles()
const stageOf = (stage: string): OrchestrationStage =>
  ORCHESTRATION_STAGES.find((s) => s.stage === stage)!
const GOAL = stageOf('goal')
const PATH = stageOf('path')
const TEACHING = stageOf('teaching')
const PROFILE = stageOf('profile')
const CONTRACTS = [...GOAL.contracts, ...PATH.contracts, ...TEACHING.contracts, ...PROFILE.contracts]
const FIELDS = [...GOAL.fields, ...PATH.fields, ...TEACHING.fields, ...PROFILE.fields]
const ROUTINGS = [...GOAL.routings, ...PATH.routings, ...TEACHING.routings, ...PROFILE.routings]

function buildDatabase(overrides: {
  contracts?: Array<Record<string, any>>
  fields?: Array<Record<string, any>>
  routings?: Array<Record<string, any>>
} = {}) {
  return {
    agent_contracts: { findMany: jest.fn(async () => overrides.contracts || []) },
    field_definitions: { findMany: jest.fn(async () => overrides.fields || []) },
    agent_field_routings: { findMany: jest.fn(async () => overrides.routings || []) },
  } as any
}

describe('detectFieldRoutingDrift', () => {
  it('编排文件声明与 DB 一致时不报告漂移', async () => {
    const contracts = CONTRACTS
      .map((c) => ({ agentId: c.agentId, displayName: c.displayName, description: c.description, stage: 'goal', managedByCode: true }))
    const fields = FIELDS
      .map((f) => ({ fieldId: f.fieldId, promptRole: f.promptRole, valueType: f.valueType, snakeName: f.snakeName ?? null, camelName: f.camelName ?? null, systemLocked: f.systemLocked ?? false, structureLocked: f.structureLocked ?? false, pathInRawOutput: f.pathInRawOutput ?? null, description: f.description ?? null, bindings: f.bindings ? JSON.stringify(f.bindings) : null, managedByCode: true }))
    const routings = ROUTINGS
      .map((r) => ({ agentId: r.agentId, fieldId: r.fieldId, render: r.render, handoff: r.handoff.length ? JSON.stringify(r.handoff) : null, internalFlag: r.internal, accumulate: r.accumulate, visibilityPreset: r.visibilityPreset ?? null, managedByCode: true }))

    const report = await detectFieldRoutingDrift(buildDatabase({ contracts, fields, routings }))
    expect(report.driftCount).toBe(0)
  })

  it('声明改了 render 后报告 routing 漂移', async () => {
    const dbRoutings = ROUTINGS
      .map((r) => ({ agentId: r.agentId, fieldId: r.fieldId, render: r.render, handoff: r.handoff.length ? JSON.stringify(r.handoff) : null, internalFlag: r.internal, accumulate: r.accumulate, visibilityPreset: r.visibilityPreset ?? null, managedByCode: true }))
    dbRoutings[0] = { ...dbRoutings[0], render: dbRoutings[0].render === 'visible' ? 'hidden' : 'visible' }

    const report = await detectFieldRoutingDrift(buildDatabase({ routings: dbRoutings }))
    expect(report.driftCount).toBeGreaterThanOrEqual(1)
    expect(report.items[0]).toEqual(expect.objectContaining({ kind: 'routing', field: 'render' }))
  })

  it('跳过 admin 全权行（managedByCode=false）', async () => {
    const dbRoutings = ROUTINGS
      .map((r) => ({ agentId: r.agentId, fieldId: r.fieldId, render: r.render === 'visible' ? 'hidden' : 'visible', handoff: r.handoff.length ? JSON.stringify(r.handoff) : null, internalFlag: r.internal, accumulate: r.accumulate, visibilityPreset: r.visibilityPreset ?? null, managedByCode: false }))

    const report = await detectFieldRoutingDrift(buildDatabase({ routings: dbRoutings }))
    expect(report.driftCount).toBe(0)
  })
})

describe('validateFieldRoutingSeedSemantics', () => {
  it('现有编排数据全部合规（handoff 白名单 + 组合语义）', () => {
    expect(validateFieldRoutingSeedSemantics()).toEqual([])
  })

  it('拒绝自环 handoff 与未知 handoff 目标', () => {
    // 从编排文件真实行构造：改 handoff 为自环 / 未知阶段
    const base = GOAL.routings[0]
    const errors = validateFieldRoutingSeedSemantics([
      { ...base, fieldId: 'x.self', handoff: [base.agentId] },
      { ...base, fieldId: 'x.ghost', handoff: ['ghost-stage'] },
    ])
    expect(errors.some((e) => e.includes('自环'))).toBe(true)
    expect(errors.some((e) => e.includes('ghost-stage'))).toBe(true)
  })

  it('拒绝非 control-signal 的 visible+internal 组合', () => {
    // 从编排文件取一个 visible 且非 control-signal 的字段行
    const visibleRow = GOAL.routings.find((r) =>
      r.render === 'visible' && GOAL.fields.find((f) => f.fieldId === r.fieldId)?.promptRole !== 'control-signal'
    )!
    const errors = validateFieldRoutingSeedSemantics([
      { ...visibleRow, internal: true },
    ])
    expect(errors.some((e) => e.includes('visible=visible 与 internal=true')) || errors.some((e) => e.includes('render=visible 与 internal=true'))).toBe(true)
  })

  it('拒绝无流转去向的非 public-reply 终点', () => {
    // 从编排文件取一个 visible 且非 public-reply 的字段行
    const visibleRow = GOAL.routings.find((r) =>
      r.render === 'visible' && GOAL.fields.find((f) => f.fieldId === r.fieldId)?.promptRole !== 'public-reply'
    )!
    const errors = validateFieldRoutingSeedSemantics([
      { ...visibleRow, handoff: [], internal: false, accumulate: false },
    ])
    expect(errors.some((e) => e.includes('缺少流转去向'))).toBe(true)
  })
})
