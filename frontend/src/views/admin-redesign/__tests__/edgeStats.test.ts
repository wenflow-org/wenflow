/**
 * 隶属边用量投影单测（Q9 后续）
 * 覆盖：indexEdgeStats 索引（缺省死边 / 成功率现算 / 非法项跳过）；
 * buildStageFlow 把 `goal-agent → skill:*` 边用量贴到 Skill 步骤并汇总阶段边统计。
 */
import { describe, expect, it } from 'vitest'
import { buildStageFlow, indexEdgeStats, type TopoEdgeLike, type TopoNodeLike } from '../dataFlow'
import type { StageDetailLike } from '../fieldFlowLayout'
import { fixtureDetails } from './fixture-details'

const detailsById = fixtureDetails as unknown as Record<string, StageDetailLike>
const stageNames = { goal: 'Goal 阶段' }
const topo: TopoNodeLike[] = [
  { id: 'skill:goal-conversation', type: 'skill', parentAgentId: 'goal-agent', stats: { totalCalls: 387, failed: 32 } },
]
const edges: TopoEdgeLike[] = [
  {
    id: 'goal-agent__skill:goal-conversation',
    source: 'goal-agent',
    target: 'skill:goal-conversation',
    type: 'membership',
    stats: { totalCalls: 320, failed: 45, successRate: 85.9, lastSeenAt: '2026-09-17T02:00:00.000Z' },
  },
  {
    id: 'goal-agent__skill:ghost',
    source: 'goal-agent',
    target: 'skill:ghost',
    type: 'membership',
    stats: { totalCalls: 0, failed: 0, successRate: null, lastSeenAt: null },
  },
]

function flowOf() {
  return buildStageFlow(
    'goal',
    detailsById.goal,
    detailsById,
    [],
    topo,
    stageNames,
    edges,
  )
}

describe('indexEdgeStats', () => {
  it('按 source\\0target 建索引并透传字段；缺 stats 视为零调用死边', () => {
    const idx = indexEdgeStats([
      { source: 'A', target: 'B', stats: { totalCalls: 4, failed: 1, successRate: 75, lastSeenAt: '2026-09-01T00:00:00.000Z' } },
      { source: 'A', target: 'C' },
    ])
    expect(idx.get('A\0B')).toEqual({
      calls: 4, failed: 1, successRate: 75, lastSeenAt: '2026-09-01T00:00:00.000Z', dead: false,
    })
    expect(idx.get('A\0C')).toEqual({
      calls: 0, failed: 0, successRate: null, lastSeenAt: '', dead: true,
    })
  })

  it('successRate 缺失时由 calls/failed 现算；非法端点跳过', () => {
    const idx = indexEdgeStats([
      { source: 'A', target: 'B', stats: { totalCalls: 3, failed: 1 } },
      { source: '', target: 'B' } as unknown as TopoEdgeLike,
    ])
    expect(idx.get('A\0B')?.successRate).toBe(66.7)
    expect(idx.size).toBe(1)
  })

  it('空输入返回空索引', () => {
    expect(indexEdgeStats(null).size).toBe(0)
    expect(indexEdgeStats([]).size).toBe(0)
  })
})

describe('buildStageFlow 隶属边用量', () => {
  it('把 goal-agent → skill:goal-conversation 边用量贴到对应 Skill 步骤', () => {
    const f = flowOf()
    const step = f.steps.find((s) => s.agentId === 'skill:goal-conversation')!
    expect(step).toBeTruthy()
    expect(step.handoff).toEqual({
      calls: 320,
      failed: 45,
      successRate: 85.9,
      lastSeenAt: '2026-09-17T02:00:00.000Z',
      dead: false,
    })
  })

  it('阶段边统计：活跃 / 死边 / 调用与失败合计', () => {
    expect(flowOf().edgeStats).toEqual({
      edgeCount: 2,
      usedEdgeCount: 1,
      deadEdgeCount: 1,
      totalCalls: 320,
      failed: 45,
    })
  })

  it('未传 edges 时 handoff / edgeStats 均为 null（向后兼容，不渲染边统计）', () => {
    const f = buildStageFlow('goal', detailsById.goal, detailsById, [], topo, stageNames)
    const step = f.steps.find((s) => s.agentId === 'skill:goal-conversation')!
    expect(step.handoff).toBeNull()
    expect(f.edgeStats).toBeNull()
  })
})
