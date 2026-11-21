import { buildProbeAnswers, extractProbePrompts } from '../probe-answers'

describe('virtual-lab probe answers（C1）', () => {
  const proposal = {
    prerequisiteDiagnostics: [
      {
        probeId: 'p1',
        targetConcept: '函数参数',
        question: '哪个是参数？',
        options: [{ id: 'A', text: 'a' }, { id: 'B', text: 'b' }],
        correctOption: 'B',
      },
      {
        probe_id: 'p2',
        target_concept: '数据透视表',
        options: [{ id: 'A' }, { id: 'B' }],
        correct_option: 'A',
      },
    ],
  }

  it('兼容驼峰/下划线抽取题目，并丢弃无选项的脏项', () => {
    const prompts = extractProbePrompts(proposal)
    expect(prompts.map((item) => item.probeId)).toEqual(['p1', 'p2'])
    expect(prompts[0].correctOption).toBe('B')
    expect(prompts[1].targetConcept).toBe('数据透视表')
    expect(prompts[1].options.length).toBe(2)

    expect(extractProbePrompts({ prerequisiteDiagnostics: [{ probeId: 'p3', options: [] }] })).toEqual([])
    expect(extractProbePrompts(null)).toEqual([])
  })

  it('卡点命中→故意答错；未命中→答对', () => {
    const prompts = extractProbePrompts(proposal)
    const answers = buildProbeAnswers(prompts, ['函数参数'])
    expect(answers).toEqual([
      expect.objectContaining({ probeId: 'p1', userAnswer: 'A' }),
      // p2 未命中卡点 → 选判分键 A
      expect.objectContaining({ probeId: 'p2', userAnswer: 'A' }),
    ])
  })

  it('没有判分键时：卡点命中选第二项，否则选第一项', () => {
    const prompts = extractProbePrompts({
      prerequisiteDiagnostics: [{
        probeId: 'p4',
        targetConcept: '循环',
        options: [{ id: 'A' }, { id: 'B' }],
      }],
    })
    expect(buildProbeAnswers(prompts, ['循环'])[0].userAnswer).toBe('B')
    expect(buildProbeAnswers(prompts, [])[0].userAnswer).toBe('A')
  })
})
