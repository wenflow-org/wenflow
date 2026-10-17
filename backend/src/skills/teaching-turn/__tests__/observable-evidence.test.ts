import { applyObservableEvidenceGate, detectObservableEvidence } from '../observable-evidence'

/**
 * #54 P-28：规则 15 只是提示词。这里钉住确定性护栏：
 * 离线动作 / 学生无实质发言 → 不判完成、不升掌握。
 */
describe('detectObservableEvidence', () => {
  const messages = (text: string) => [{ role: 'user', content: text }]

  it('离线动作命中（镜子/比划/纸上）', () => {
    expect(detectObservableEvidence(messages('好'), '你先对着镜子念一遍。').offlineAction).toBe(true)
    expect(detectObservableEvidence(messages('好'), '用手比划一下这个流程。').offlineAction).toBe(true)
    expect(detectObservableEvidence(messages('好'), '把答案写在纸上。').offlineAction).toBe(true)
  })

  it('纯文本练习不命中', () => {
    const evidence = detectObservableEvidence(messages('蒸发是水变成水蒸气'), '用你自己的话把这一步讲出来。')
    expect(evidence.offlineAction).toBe(false)
    expect(evidence.substantiveUserTurn).toBe(true)
  })

  it('「嗯/好的/继续」不算实质发言', () => {
    for (const text of ['嗯', '嗯嗯', '好的', '继续', 'OK', '明白了。']) {
      expect(detectObservableEvidence(messages(text), '继续下一步。').substantiveUserTurn).toBe(false)
    }
  })

  it('取最近一条 user 消息，忽略其后的 assistant', () => {
    const evidence = detectObservableEvidence(
      [{ role: 'user', content: '第一轮作答' }, { role: 'assistant', content: '好' }, { role: 'user', content: '嗯' }],
      '继续',
    )
    expect(evidence.substantiveUserTurn).toBe(false)
  })
})

describe('applyObservableEvidenceGate', () => {
  const points = [
    { name: '蒸发', status: 'mastered', progress: 100 },
    { name: '凝结', status: 'learning', progress: 60 },
  ]

  it('离线动作：mastered 降为 learning 且进度封顶 79，其它点不动', () => {
    const gated = applyObservableEvidenceGate(points, {
      offlineAction: true, substantiveUserTurn: true, lastUserText: '好',
    })
    expect(gated[0]).toEqual({ name: '蒸发', status: 'learning', progress: 79 })
    expect(gated[1]).toBe(points[1])
  })

  it('无实质发言：同样不允许本轮升 mastered', () => {
    const gated = applyObservableEvidenceGate(points, {
      offlineAction: false, substantiveUserTurn: false, lastUserText: '嗯',
    })
    expect(gated[0].status).toBe('learning')
  })

  it('证据充足：原样返回', () => {
    const gated = applyObservableEvidenceGate(points, {
      offlineAction: false, substantiveUserTurn: true, lastUserText: '蒸发是水变成水蒸气',
    })
    expect(gated).toBe(points)
  })
})
