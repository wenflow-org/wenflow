import {
  detectFieldRoutingDrift,
  validateFieldRoutingSeedSemantics,
  FIELD_ROUTING_SEED_MANIFEST,
} from '../field-routing-bootstrap.service'
import { GOAL_FIELD_ROUTING_CONTRACTS, GOAL_FIELD_ROUTING_FIELDS, GOAL_FIELD_ROUTINGS } from '../../scripts/seed-goal-field-routings'
import { PATH_FIELD_ROUTING_CONTRACTS, PATH_FIELD_ROUTING_FIELDS, PATH_FIELD_ROUTINGS } from '../../scripts/seed-path-field-routings'
import { TEACHING_FIELD_ROUTING_CONTRACTS, TEACHING_FIELD_ROUTING_FIELDS, TEACHING_FIELD_ROUTINGS } from '../../scripts/seed-execution-field-routings'
import { PROFILE_FIELD_ROUTING_CONTRACTS, PROFILE_FIELD_ROUTING_FIELDS, PROFILE_FIELD_ROUTINGS } from '../../scripts/seed-learner-field-routings'

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
  it('seed 与 DB 一致时不报告漂移', async () => {
    const contracts = [...GOAL_FIELD_ROUTING_CONTRACTS, ...PATH_FIELD_ROUTING_CONTRACTS, ...TEACHING_FIELD_ROUTING_CONTRACTS, ...PROFILE_FIELD_ROUTING_CONTRACTS]
      .map((c) => ({ agentId: c.agentId, displayName: c.displayName, description: c.description, stage: 'goal', managedByCode: true }))
    const fields = [...GOAL_FIELD_ROUTING_FIELDS, ...PATH_FIELD_ROUTING_FIELDS, ...TEACHING_FIELD_ROUTING_FIELDS, ...PROFILE_FIELD_ROUTING_FIELDS]
      .map((f) => ({ fieldId: f.fieldId, promptRole: f.promptRole, valueType: f.valueType, snakeName: f.snakeName ?? null, camelName: f.camelName ?? null, systemLocked: f.systemLocked ?? false, structureLocked: f.structureLocked ?? false, pathInRawOutput: f.pathInRawOutput ?? null, description: f.description ?? null, bindings: f.bindings ? JSON.stringify(f.bindings) : null, managedByCode: true }))
    const routings = [...GOAL_FIELD_ROUTINGS, ...PATH_FIELD_ROUTINGS, ...TEACHING_FIELD_ROUTINGS, ...PROFILE_FIELD_ROUTINGS]
      .map((r) => ({ agentId: r.agentId, fieldId: r.fieldId, render: r.render, handoff: r.handoff.length ? JSON.stringify(r.handoff) : null, internalFlag: r.internal, accumulate: r.accumulate, visibilityPreset: r.visibilityPreset ?? null, managedByCode: true }))

    const report = await detectFieldRoutingDrift(buildDatabase({ contracts, fields, routings }))
    expect(report.driftCount).toBe(0)
  })

  it('seed 改了 render 后报告 routing 漂移', async () => {
    const dbRoutings = [...GOAL_FIELD_ROUTINGS, ...PATH_FIELD_ROUTINGS, ...TEACHING_FIELD_ROUTINGS, ...PROFILE_FIELD_ROUTINGS]
      .map((r) => ({ agentId: r.agentId, fieldId: r.fieldId, render: r.render, handoff: r.handoff.length ? JSON.stringify(r.handoff) : null, internalFlag: r.internal, accumulate: r.accumulate, visibilityPreset: r.visibilityPreset ?? null, managedByCode: true }))
    dbRoutings[0] = { ...dbRoutings[0], render: dbRoutings[0].render === 'visible' ? 'hidden' : 'visible' }

    const report = await detectFieldRoutingDrift(buildDatabase({ routings: dbRoutings }))
    expect(report.driftCount).toBeGreaterThanOrEqual(1)
    expect(report.items[0]).toEqual(expect.objectContaining({ kind: 'routing', field: 'render' }))
  })

  it('跳过 admin 全权行（managedByCode=false）', async () => {
    const dbRoutings = [...GOAL_FIELD_ROUTINGS, ...PATH_FIELD_ROUTINGS, ...TEACHING_FIELD_ROUTINGS, ...PROFILE_FIELD_ROUTINGS]
      .map((r) => ({ agentId: r.agentId, fieldId: r.fieldId, render: r.render === 'visible' ? 'hidden' : 'visible', handoff: r.handoff.length ? JSON.stringify(r.handoff) : null, internalFlag: r.internal, accumulate: r.accumulate, visibilityPreset: r.visibilityPreset ?? null, managedByCode: false }))

    const report = await detectFieldRoutingDrift(buildDatabase({ routings: dbRoutings }))
    expect(report.driftCount).toBe(0)
  })
})

describe('validateFieldRoutingSeedSemantics', () => {
  it('现有 seed 全部合规（handoff 白名单 + 组合语义）', () => {
    expect(validateFieldRoutingSeedSemantics()).toEqual([])
  })

  it('拒绝自环 handoff 与未知 handoff 目标', () => {
    const errors = validateFieldRoutingSeedSemantics([
      { agentId: 'goal-agent', fieldId: 'x.self', render: 'visible', handoff: ['goal-agent'], internal: false, accumulate: false },
      { agentId: 'goal-agent', fieldId: 'x.ghost', render: 'visible', handoff: ['ghost-stage'], internal: false, accumulate: false },
    ])
    expect(errors.some((e) => e.includes('自环'))).toBe(true)
    expect(errors.some((e) => e.includes('ghost-stage'))).toBe(true)
  })

  it('拒绝非 control-signal 的 visible+internal 组合', () => {
    const errors = validateFieldRoutingSeedSemantics([
      { agentId: 'goal-agent', fieldId: 'x.hidden', render: 'visible', handoff: ['path'], internal: true, accumulate: false },
    ])
    expect(errors.some((e) => e.includes('visible=visible 与 internal=true')) || errors.some((e) => e.includes('render=visible 与 internal=true'))).toBe(true)
  })

  it('拒绝无流转去向的非 public-reply 终点', () => {
    const errors = validateFieldRoutingSeedSemantics([
      { agentId: 'goal-agent', fieldId: 'x.orphan', render: 'visible', handoff: [], internal: false, accumulate: false },
    ])
    expect(errors.some((e) => e.includes('缺少流转去向'))).toBe(true)
  })
})
