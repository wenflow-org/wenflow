import { buildSamplingDirectives, describeSamplingDirectives } from '../learner-sampling'

describe('virtual-lab 分层采样（C3）', () => {
  it('同一序号结果稳定（可复现）', () => {
    expect(buildSamplingDirectives(5)).toEqual(buildSamplingDirectives(5))
  })

  it('连续 12 个样本覆盖全部档位，且不是单一偏置', () => {
    const rows = Array.from({ length: 12 }, (_, index) => buildSamplingDirectives(index))
    for (const field of ['availableTime', 'techComfort', 'learningStyle', 'cognitiveLoadTolerance', 'motivationType'] as const) {
      expect(new Set(rows.map((row) => row[field])).size).toBeGreaterThanOrEqual(3)
    }
    expect(new Set(rows.map((row) => row.availableTime))).toEqual(new Set(['minimal', 'moderate', 'abundant']))
    expect(new Set(rows.map((row) => row.learningStyle)).size).toBe(4)
    expect(new Set(rows.map((row) => row.motivationType)).size).toBe(4)
  })

  it('学生比例约 3/10，显式 student/general 时强制', () => {
    const rows = Array.from({ length: 10 }, (_, index) => buildSamplingDirectives(index))
    expect(rows.filter((row) => row.sampleType === 'student')).toHaveLength(3)
    expect(buildSamplingDirectives(1, { student: true }).sampleType).toBe('student')
    expect(buildSamplingDirectives(0, { student: false }).sampleType).toBe('general')
  })

  it('describeSamplingDirectives 给出六项坐标（供提示词硬约束）', () => {
    const text = describeSamplingDirectives(buildSamplingDirectives(2))
    expect(text).toContain('sampleType=')
    expect(text).toContain('availableTime=')
    expect(text).toContain('cognitiveLoadTolerance=')
  })
})
