import { classifyWrapupSource } from '../platform-overview.service'

/**
 * #70 P-45：session-wrapup handler 成功路径恒返回 success:true，
 * 降级统计必须读内部显式来源，不能用 success 推断。
 */
function output(sessionWrapup: Record<string, unknown>, success = true) {
  return JSON.stringify({
    schemaVersion: 'agent-output-v1',
    success,
    internal: { ext: { sessionWrapup } },
  })
}

describe('classifyWrapupSource', () => {
  it('摘要 fallback + 评估 failed：判为降级（即使 success=true）', () => {
    const parsed = classifyWrapupSource(output({
      result: { summarySource: 'fallback', evaluationSource: 'failed' },
      artifact: { sources: { summary: 'fallback', evaluation: 'failed' } },
    }))
    expect(parsed).toEqual({ summaryModel: false, evaluationModel: false, evaluationAiFallback: false })
  })

  it('模型摘要 + 模型评估：判为模型产出', () => {
    const parsed = classifyWrapupSource(output({
      result: { summarySource: 'model', evaluationSource: 'model' },
      artifact: { sources: { summary: 'model', evaluation: 'model' } },
    }))
    expect(parsed).toEqual({ summaryModel: true, evaluationModel: true, evaluationAiFallback: false })
  })

  it('result 缺失时回退 artifact.sources；ai-fallback 单列', () => {
    const parsed = classifyWrapupSource(output({
      artifact: { sources: { summary: 'model', evaluation: 'ai-fallback' } },
    }))
    expect(parsed).toEqual({ summaryModel: true, evaluationModel: false, evaluationAiFallback: true })
  })

  it('旧格式无来源字段：回退 success 推断', () => {
    const parsed = classifyWrapupSource(output({}, true))
    expect(parsed).toEqual({ summaryModel: true, evaluationModel: true, evaluationAiFallback: false })
  })

  it('非 agent-output-v1 / 坏 JSON：返回 null（不计数）', () => {
    expect(classifyWrapupSource('not json')).toBeNull()
    expect(classifyWrapupSource(JSON.stringify({ schemaVersion: 'other' }))).toBeNull()
  })
})
