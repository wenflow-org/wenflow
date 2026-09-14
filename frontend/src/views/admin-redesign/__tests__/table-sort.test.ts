/**
 * useTableSort 单元测试：默认不排序 / 升降序切换 / 空值恒末尾 / 稳定排序 / 持久化。
 * 该组合式只服务「数据完整」的列表（全量已在客户端），不适用于截断或服务端分页列表。
 */
import { describe, expect, it, beforeEach } from 'vitest'
import { useTableSort } from '../useTableSort'

interface Row {
  name: string
  n: number
  t: string | null
}

const rows: Row[] = [
  { name: 'b', n: 2, t: '2026-01-02' },
  { name: 'a', n: 3, t: '2026-01-01' },
  { name: 'c', n: 1, t: null }
]

function make() {
  return useTableSort<Row>({
    accessors: { name: (r) => r.name, n: (r) => r.n, t: (r) => r.t },
    defaultDir: 'desc'
  })
}

describe('useTableSort', () => {
  beforeEach(() => localStorage.clear())

  it('未指定默认键时不排序（保持数据原序）', () => {
    const s = make()
    expect(s.sortKey.value).toBe('')
    expect(s.sortRows(rows).map((r) => r.name)).toEqual(['b', 'a', 'c'])
    expect(s.sortState('n')).toBe('none')
  })

  it('点击同列切换升/降序；换列先用默认方向', () => {
    const s = make()
    s.toggle('n')
    expect(s.sortState('n')).toBe('descending')
    expect(s.sortRows(rows).map((r) => r.n)).toEqual([3, 2, 1])
    s.toggle('n')
    expect(s.sortState('n')).toBe('ascending')
    expect(s.sortRows(rows).map((r) => r.n)).toEqual([1, 2, 3])
    s.toggle('name')
    expect(s.sortState('n')).toBe('none')
    expect(s.sortState('name')).toBe('descending')
  })

  it('空值恒排末尾（升序/降序都不把它翻到最前）', () => {
    const s = make()
    s.toggle('t') // desc
    expect(s.sortRows(rows).map((r) => r.name)).toEqual(['b', 'a', 'c'])
    s.toggle('t') // asc
    expect(s.sortRows(rows).map((r) => r.name)).toEqual(['a', 'b', 'c'])
  })

  it('稳定排序：同值保持原始相对顺序', () => {
    const s = useTableSort<{ k: number; id: string }>({ accessors: { k: (r) => r.k } })
    const data = [
      { k: 1, id: 'x' },
      { k: 1, id: 'y' },
      { k: 0, id: 'z' }
    ]
    s.toggle('k') // desc
    expect(s.sortRows(data).map((r) => r.id)).toEqual(['x', 'y', 'z'])
  })

  it('storageKey：读取持久化，脏数据回退默认', () => {
    localStorage.setItem('wf_test_sort', JSON.stringify({ key: 'name', dir: 'asc' }))
    const s = useTableSort<Row>({ accessors: { name: (r) => r.name }, storageKey: 'wf_test_sort' })
    expect(s.sortKey.value).toBe('name')
    expect(s.sortState('name')).toBe('ascending')
    s.toggle('name')
    expect(JSON.parse(localStorage.getItem('wf_test_sort')!).dir).toBe('desc')

    localStorage.setItem('wf_test_sort', JSON.stringify({ key: 'bogus', dir: 'asc' }))
    const s2 = useTableSort<Row>({ accessors: { name: (r) => r.name }, storageKey: 'wf_test_sort' })
    expect(s2.sortKey.value).toBe('')
  })

  it('toggleDir 只翻转方向；未选字段时不动', () => {
    const s = make()
    s.toggleDir()
    expect(s.sortKey.value).toBe('')
    s.toggle('n') // desc
    s.toggleDir()
    expect(s.sortDir.value).toBe('asc')
  })

  it('纯 keys 模式（服务端排序）：可切换状态，但 sortRows 原样返回不改序', () => {
    const s = useTableSort({ keys: ['calledAt', 'durationMs'], defaultKey: 'calledAt' })
    expect(s.sortState('calledAt')).toBe('descending')
    expect(s.isSortable('durationMs')).toBe(true)
    s.toggle('durationMs')
    expect(s.sortState('durationMs')).toBe('descending')
    const data = [{ id: 'a' }, { id: 'b' }]
    expect(s.sortRows(data)).toEqual(data) // 无 accessor → 交给后端，前端不动
  })
})
