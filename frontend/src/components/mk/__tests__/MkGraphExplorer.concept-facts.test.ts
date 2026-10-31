/**
 * 图谱侧栏节点详情 · 概念事实三行（2026-10-20）。
 *
 * 「逐概念明细」从概览「概念掌握」卡搬到图谱节点详情后，可迁移 / 误解风险 / 证据数
 * 这三样必须在这里仍然可读；宿主不传 conceptFacts（用户侧知识图谱没有学习者模型台账）
 * 时不能凭空出现这三行。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'

vi.mock('../MkGraph.vue', () => ({
  default: {
    name: 'MkGraph',
    props: ['nodes', 'edges', 'theme', 'height', 'hideIsolated'],
    emits: ['select'],
    template:
      '<button class="stub-select" @click="$emit(\'select\', { id: \'c1\', label: \'概念一\' })">选中</button>'
  },
  relationStyleOf: () => ({ width: 2, type: 'solid', color: '#ccc' })
}))
vi.mock('../../ui/SkeletonLoader.vue', () => ({ default: { template: '<div />' } }))
vi.mock('../../ui/V2ResultState.vue', () => ({ default: { template: '<div />' } }))

import MkGraphExplorer from '../MkGraphExplorer.vue'

beforeEach(() => {
  Element.prototype.scrollIntoView = () => undefined
  Element.prototype.scrollTo = () => undefined
})

const NODES = [{ id: 'c1', label: '概念一' }]

async function mountAndSelect(props: Record<string, unknown> = {}) {
  const w = mount(MkGraphExplorer, { props: { nodes: NODES, edges: [], ...props } })
  await w.find('.stub-select').trigger('click')
  await flushPromises()
  return w
}

describe('MkGraphExplorer · 节点详情里的概念事实', () => {
  it('传入台账事实时，节点详情按「迁移就绪 / 误解风险 / 证据」三行给出', async () => {
    const w = await mountAndSelect({
      conceptFacts: {
        概念一: { readiness: '可迁移', risk: '高', riskTone: 'bad', evidenceCount: 3 }
      }
    })
    const cells = w.findAll('.mk-ge__cell').map((c) => c.text())
    expect(cells.some((t) => t.startsWith('迁移就绪') && t.includes('可迁移'))).toBe(true)
    expect(cells.some((t) => t.startsWith('误解风险') && t.includes('高'))).toBe(true)
    expect(cells.some((t) => t.startsWith('证据') && t.includes('3 条'))).toBe(true)
    // 高风险仍带色彩档（与概览卡原来的红档一致）
    expect(w.find('.mk-ge__fact--bad').exists()).toBe(true)
  })

  it('节点没有对应台账（或宿主不传）时不渲染这三行，也不拿别的概念顶替', async () => {
    const w = await mountAndSelect({
      conceptFacts: {
        另一个概念: { readiness: '不宜迁移', risk: '高', riskTone: 'bad', evidenceCount: 9 }
      }
    })
    const cells = w.findAll('.mk-ge__cell').map((c) => c.text())
    expect(cells.some((t) => t.startsWith('迁移就绪'))).toBe(false)
    expect(cells.some((t) => t.startsWith('误解风险'))).toBe(false)
    expect(cells.some((t) => t.startsWith('证据'))).toBe(false)
  })
})
