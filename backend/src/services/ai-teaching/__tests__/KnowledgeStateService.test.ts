import { knowledgeStateService } from '../KnowledgeStateService'

describe('KnowledgeStateService.merge（知识看板合并）', () => {
  const mastered = { name: '概念A', status: 'mastered' as const, progress: 100 }
  const review = { name: '概念A', status: 'review' as const, progress: 50 }
  const learning = { name: '概念A', status: 'learning' as const, progress: 40 }

  it('普通课：mastered 只升不降（LLM 报 review 不降级）', () => {
    const merged = knowledgeStateService.merge([mastered], [review])
    expect(merged[0].status).toBe('mastered')
    expect(merged[0].progress).toBe(100)
  })

  it('普通课：mastered 后 progress 取 max 不回退', () => {
    const merged = knowledgeStateService.merge([mastered], [learning])
    expect(merged[0].progress).toBe(100)
  })

  it('复习课（allowDegrade）：mastered 可降级为 review（复习失败真实可见）', () => {
    const merged = knowledgeStateService.merge([mastered], [review], true)
    expect(merged[0].status).toBe('review')
    expect(merged[0].progress).toBe(50)
  })

  it('复习课（allowDegrade）：LLM 报 learning 也可降级', () => {
    const merged = knowledgeStateService.merge([mastered], [learning], true)
    expect(merged[0].status).toBe('learning')
    expect(merged[0].progress).toBe(40)
  })

  it('复习课（allowDegrade）：mastered 保持 mastered 时正常', () => {
    const merged = knowledgeStateService.merge([mastered], [{ name: '概念A', status: 'mastered' as const, progress: 90 }], true)
    expect(merged[0].status).toBe('mastered')
  })

  it('新概念直接加入', () => {
    const merged = knowledgeStateService.merge([], [{ name: '新概念', status: 'learning' as const, progress: 10 }])
    expect(merged).toHaveLength(1)
    expect(merged[0].name).toBe('新概念')
  })
})
