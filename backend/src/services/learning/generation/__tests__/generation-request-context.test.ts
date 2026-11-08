/**
 * #248 写侧：路径生成期的 LLM 调用必须把 pathId 带进请求上下文。
 *
 * 读侧（routes/users.buildAgentLogView + agent-log-grouping 的 pathId 索引）早已按
 * `metadata.pathId` 关联网关行，但生产库里 api-gateway 行一条都没有 pathId——
 * 根因在写侧：POST /paths/generate 在占位路径创建前就进了 withPathContext(req)（pathId 空），
 * 生成期两个阶段都没有再补，于是同一组里 path-agent 阶段流水有 pathId、网关行没有，
 * 「模型」列仍然恒空。本用例锁住两处写侧口径与公共构造器。
 */
export {}

const runWithContextCalls: Array<{ context: any; }> = []
let mockRunWithContextResult: any = undefined

jest.mock('../../../../gateway/api-gateway/context', () => {
  const actual = jest.requireActual('../../../../gateway/api-gateway/context')
  return {
    ...actual,
    runWithContext: (context: any, _fn: () => any) => {
      runWithContextCalls.push({ context })
      return Promise.resolve(mockRunWithContextResult)
    },
  }
})

import { buildPathGenerationContext } from '../generation-request-context'
import { enrichLearningPathWithAnderson } from '../stage-enrichment'
import { generateLearningPath } from '../path-generation.core'

describe('#248 路径生成写侧的 pathId 上下文', () => {
  beforeEach(() => {
    runWithContextCalls.length = 0
    mockRunWithContextResult = undefined
  })

  it('构造器把 userId / pathId / sourceConversationId 放进上下文，并保留既有字段', () => {
    const context = buildPathGenerationContext({
      userId: 'user-1',
      pathId: 'lp_1793831456704',
      sourceConversationId: 'gc_1793831456704',
    })
    expect(context.userId).toBe('user-1')
    expect(context.pathId).toBe('lp_1793831456704')
    expect(context.conversationId).toBe('gc_1793831456704')
  })

  it('不带 pathId 时退回上下文里已有的值（不把 undefined 覆盖上去）', () => {
    const context = buildPathGenerationContext({ userId: 'user-1', pathId: null })
    expect(context.pathId).toBeUndefined()
    expect(context.userId).toBe('user-1')
  })

  it('阶段设计（stageDesign）在带 pathId 的上下文里执行', async () => {
    await enrichLearningPathWithAnderson(
      'lp_stage_1',
      'pgr_1',
      { userId: 'user-1', description: '目标', sourceConversationId: 'gc_1' } as any,
      {}
    )
    expect(runWithContextCalls).toHaveLength(1)
    expect(runWithContextCalls[0].context.pathId).toBe('lp_stage_1')
    expect(runWithContextCalls[0].context.userId).toBe('user-1')
    expect(runWithContextCalls[0].context.conversationId).toBe('gc_1')
  })

  it('核心生成（path-planning / path-reviewer）也在带 pathId 的上下文里执行', async () => {
    // 只走到 core 调用为止：runWithContext 被替换掉，返回一个没有 activeGenerationRunId 的骨架
    // → 紧随其后的 GENERATION_RUN_REQUIRED 就是「已进入 core 包装」的证据。
    mockRunWithContextResult = { fullPath: { activeGenerationRunId: null }, analysis: {}, firstMilestoneId: null }
    await expect(generateLearningPath({
      userId: 'user-1',
      existingPathId: 'lp_core_1',
      generationRunId: 'pgr_core_1',
      description: '目标',
      sourceConversationId: 'gc_core_1',
    } as any)).rejects.toThrow('GENERATION_RUN_REQUIRED')

    expect(runWithContextCalls).toHaveLength(1)
    expect(runWithContextCalls[0].context.pathId).toBe('lp_core_1')
    expect(runWithContextCalls[0].context.userId).toBe('user-1')
    expect(runWithContextCalls[0].context.conversationId).toBe('gc_core_1')
  })
})
