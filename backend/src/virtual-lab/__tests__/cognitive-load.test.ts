import { detectTeacherOverload } from '../cognitive-load'

describe('detectTeacherOverload（工作记忆超载信号）', () => {
  it('短消息不触发', () => {
    const signal = detectTeacherOverload({
      message: '先看这个表格的第一列，告诉我它写的是什么。',
      tolerance: 'low',
    })
    expect(signal.overloaded).toBe(false)
  })

  it('低耐受 + 多步多因果长讲解 → 触发', () => {
    const message = [
      '第一步先看表头，因为表头决定每一列的含义；',
      '第二步再看数据区，如果某一行有空值，就先标记出来；',
      '第三步把空值按列汇总，所以你要先想清楚汇总口径；',
      '第四步再回到表头，最后检查一遍列名和数据是否对应。',
      '另外，如果发现合并单元格，就先把它们拆开，再重复第二步到第四步。',
    ].join('')
    const signal = detectTeacherOverload({ message, tolerance: 'low' })
    expect(signal.overloaded).toBe(true)
    expect(signal.loadScore).toBeGreaterThanOrEqual(0.5)
    expect(signal.reason).toBeTruthy()
  })

  it('同样消息对高耐受学习者不触发（阈值更高）', () => {
    const message = [
      '第一步先看表头，因为表头决定每一列的含义；',
      '第二步再看数据区，如果某一行有空值，就先标记出来；',
      '第三步把空值按列汇总，所以你要先想清楚汇总口径；',
      '第四步再回到表头，最后检查一遍列名和数据是否对应。',
      '另外，如果发现合并单元格，就先把它们拆开，再重复第二步到第四步。',
    ].join('')
    expect(detectTeacherOverload({ message, tolerance: 'high' }).overloaded).toBe(false)
  })

  it('纯长文但没有枚举/因果 → 不轻易判过载（避免误伤正常讲解）', () => {
    const message = '这段话只是在解释一个背景，'.repeat(20)
    const signal = detectTeacherOverload({ message, tolerance: 'low' })
    expect(signal.overloaded).toBe(false)
  })
})
