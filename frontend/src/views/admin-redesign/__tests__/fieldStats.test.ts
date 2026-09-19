/**
 * 字段级运行时命中率投影单测（Q9 后半程）
 * 覆盖：indexFieldStats 索引（缺省/非法项/状态兜底）；buildStageFlow 把字段状态贴到芯片与 routing 边、
 * 阶段汇总计数；未传 fieldStats 时向后兼容（field=null / fieldStats=null，无视觉变化）。
 */
import { describe, expect, it } from 'vitest'
import { buildStageFlow, indexFieldStats, type FieldStatsBlock, type TopoNodeLike } from '../dataFlow'
import type { StageDetailLike } from '../fieldFlowLayout'
import { fixtureDetails } from './fixture-details'

const detailsById = fixtureDetails as unknown as Record<string, StageDetailLike>
const stageNames = { goal: 'Goal 阶段' }
const topo: TopoNodeLike[] = [
  { id: 'skill:goal-conversation', type: 'skill', parentAgentId: 'goal-agent', stats: { totalCalls: 10, failed: 1 } },
]

const block: FieldStatsBlock = {
  fields: [
    { agentId: 'skill:goal-conversation', fieldId: 'confidenceScores', declared: true, hits: 5, hitRate: 0.5, totalCalls: 10, status: 'produced' },
    { agentId: 'skill:goal-conversation', fieldId: 'confirmedProposal.first_deliverable', declared: true, hits: 0, hitRate: 0, totalCalls: 10, status: 'dead' },
    { agentId: 'skill:goal-conversation', fieldId: 'core.confidence', declared: false, hits: 3, hitRate: 0.3, totalCalls: 10, status: 'drift' },
    { fieldId: 'missing-agent', declared: true }, // 非法：缺 agentId → 跳过
  ],
  deadRoutingEdges: [{ stage: 'goal' }, { stage: 'path' }],
}

function flowOf(fieldStats?: FieldStatsBlock | null) {
  return buildStageFlow('goal', detailsById.goal, detailsById, [], topo, stageNames, [], fieldStats)
}

/** 在步骤/入口/出口所有芯片里找某产出方的字段卡 */
function chipOf(f: ReturnType<typeof flowOf>, agentId: string, fieldId: string) {
  const all = [
    ...f.entry,
    ...f.steps.flatMap((s) => [...s.inputs, ...s.outputs]),
    ...f.exit,
  ]
  return all.find((c) => c.agentId === agentId && c.fieldId === fieldId)
}

describe('indexFieldStats', () => {
  it('按 agentId\\0fieldId 建索引并投影字段；非法项跳过', () => {
    const idx = indexFieldStats(block)
    expect(idx.get('skill:goal-conversation\0confidenceScores')).toEqual({
      declared: true, hits: 5, hitRate: 0.5, totalCalls: 10, status: 'produced',
    })
    expect(idx.get('skill:goal-conversation\0confirmedProposal.first_deliverable')?.status).toBe('dead')
    expect(idx.get('skill:goal-conversation\0core.confidence')?.status).toBe('drift')
    expect(idx.size).toBe(3)
  })

  it('status 非法 / 缺省按 produced 兜底；hits 缺省为 0', () => {
    const idx = indexFieldStats({
      fields: [{ agentId: 'A', fieldId: 'f', declared: true, status: 'weird' }, { agentId: 'A', fieldId: 'g' }],
    })
    expect(idx.get('A\0f')).toEqual({ declared: true, hits: 0, hitRate: 0, totalCalls: 0, status: 'produced' })
    expect(idx.get('A\0g')?.declared).toBe(false)
  })

  it('空输入 / null 返回空索引', () => {
    expect(indexFieldStats(null).size).toBe(0)
    expect(indexFieldStats(undefined).size).toBe(0)
    expect(indexFieldStats({}).size).toBe(0)
    expect(indexFieldStats({ fields: null }).size).toBe(0)
  })
})

describe('buildStageFlow 字段运行时状态', () => {
  it('把字段状态贴到对应产出方的字段卡；非 skill 产出方无统计', () => {
    const f = flowOf(block)
    const produced = chipOf(f, 'skill:goal-conversation', 'confidenceScores')
    const dead = chipOf(f, 'skill:goal-conversation', 'confirmedProposal.first_deliverable')
    const drift = chipOf(f, 'skill:goal-conversation', 'core.confidence')
    const bridge = chipOf(f, 'goal-agent', 'confidenceScores')

    expect(produced?.field?.status).toBe('produced')
    expect(dead?.field?.status).toBe('dead')
    expect(dead?.field?.declared).toBe(true)
    expect(drift?.field?.status).toBe('drift')
    expect(bridge?.field).toBeNull()
  })

  it('routing 边随产出字段状态标死边（dead=true）', () => {
    const f = flowOf(block)
    const deadEdge = f.edges.find((e) => e.fieldId === 'confirmedProposal.first_deliverable')
    const aliveEdge = f.edges.find((e) => e.fieldId === 'confidenceScores' && e.kind === 'exit')
    expect(deadEdge?.dead).toBe(true)
    expect(aliveEdge?.dead).toBe(false)
  })

  it('阶段字段汇总：产出/死/漂移计数，死边按 stage 归属统计', () => {
    const f = flowOf(block)
    expect(f.fieldStats).toBeTruthy()
    const s = f.fieldStats!
    expect(s.fieldCount).toBe(s.producedCount + s.deadCount + s.driftCount)
    expect(s.deadCount).toBeGreaterThanOrEqual(1)
    expect(s.driftCount).toBeGreaterThanOrEqual(1)
    expect(s.deadRoutingEdges).toBe(1)
  })

  it('未传 fieldStats：field 全为 null、fieldStats 为 null、边无 dead 标记（向后兼容）', () => {
    const f = flowOf(null)
    const all = [...f.entry, ...f.steps.flatMap((s) => [...s.inputs, ...s.outputs]), ...f.exit]
    expect(all.every((c) => c.field === null)).toBe(true)
    expect(f.fieldStats).toBeNull()
    expect(f.edges.every((e) => e.dead === false)).toBe(true)
  })
})
