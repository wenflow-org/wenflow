import {
  changedTopLevelFields,
  diffCollection,
  diffMetrics,
} from '../snapshot-diff'

describe('snapshot-diff', () => {
  describe('diffCollection', () => {
    it('识别字符串集合的新增与移除', () => {
      const diff = diffCollection(['a', 'b'], ['b', 'c'])
      expect(diff.added).toEqual(['c'])
      expect(diff.removed).toEqual(['a'])
    })

    it('对象数组按内容指纹比较，输出可读标签', () => {
      const before = [{ conceptKey: 'x', label: '概念X' }]
      const after = [
        { conceptKey: 'x', label: '概念X' },
        { conceptKey: 'y', label: '概念Y' },
      ]
      const diff = diffCollection(before, after)
      expect(diff.added).toEqual(['概念Y'])
      expect(diff.removed).toEqual([])
    })

    it('非数组输入按空集合处理', () => {
      expect(diffCollection(null, ['a'])).toEqual({ added: ['a'], removed: [] })
      expect(diffCollection(undefined, undefined)).toEqual({ added: [], removed: [] })
    })
  })

  describe('diffMetrics', () => {
    it('只报告真正变化的字段', () => {
      const delta = diffMetrics(
        { lss: 5, ktl: 6, lf: 2, lsb: 7 },
        { lss: 6, ktl: 6, lf: 3, lsb: 7 },
        ['lss', 'ktl', 'lf', 'lsb']
      )
      expect(delta.changed).toEqual(['lss', 'lf'])
      expect(delta.before).toEqual({ lss: 5, ktl: 6, lf: 2, lsb: 7 })
      expect(delta.after).toEqual({ lss: 6, ktl: 6, lf: 3, lsb: 7 })
    })

    it('缺失一侧时字段按 null 处理', () => {
      const delta = diffMetrics(null, { lss: 5 }, ['lss', 'ktl'])
      expect(delta.before).toEqual({ lss: null, ktl: null })
      expect(delta.after).toEqual({ lss: 5, ktl: null })
      expect(delta.changed).toEqual(['lss'])
    })
  })

  describe('changedTopLevelFields', () => {
    it('报告内容变化的顶层字段', () => {
      const changed = changedTopLevelFields(
        { paceMode: 'normal', conceptLoad: 'low', nested: { a: 1 } },
        { paceMode: 'slow', conceptLoad: 'low', nested: { a: 2 } }
      )
      expect(changed).toEqual(['nested', 'paceMode'])
    })

    it('空对象边界安全', () => {
      expect(changedTopLevelFields(null, null)).toEqual([])
      expect(changedTopLevelFields(undefined, { a: 1 })).toEqual(['a'])
    })
  })
})
