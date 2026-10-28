/**
 * 学习准入：已下线（archived）路径必须一律拦下。
 *
 * 判例（2026-10-22）：后台「下线」只改了 learning_paths.status，用户端准入函数
 * getPathLearningAccessState 没有 archived 分支，会掉进「生成状态齐全」的放行分支，
 * 于是「用户端将无法继续学习」这句确认文案并不成立。这里锁住短路顺序。
 */
import { getPathLearningAccessState } from '../queries/path-views.queries'

const READY_TEMPLATE = JSON.stringify({
  _generation: { core: 'succeeded', stageDesign: 'succeeded' }
})

describe('学习准入：已下线路径', () => {
  it('archived 即使生成状态齐全也不可开始学习', () => {
    const state = getPathLearningAccessState('archived', READY_TEMPLATE, null, true, 4)
    expect(state.canStartLearning).toBe(false)
    expect(state.learningBlockedReason).toContain('已下线')
  })

  it('archived 且没有生成记录时同样不可学', () => {
    const state = getPathLearningAccessState('archived', null, null, false, 0)
    expect(state.canStartLearning).toBe(false)
    expect(state.learningBlockedReason).toContain('已下线')
  })

  it('active 且生成状态齐全仍可学（未误伤）', () => {
    const state = getPathLearningAccessState('active', READY_TEMPLATE, null, true, 4)
    expect(state.canStartLearning).toBe(true)
    expect(state.learningBlockedReason).toBeNull()
  })
})
