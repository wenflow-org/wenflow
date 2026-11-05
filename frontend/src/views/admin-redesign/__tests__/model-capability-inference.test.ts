import { describe, expect, it } from 'vitest'
import {
  hasReadableName,
  inferModelCapabilities,
  inferenceLabels,
  readableModelName,
} from '../modelCapabilityInference'

describe('modelCapabilityInference', () => {
  it('识别向量与重排用途，优先于对话能力', () => {
    expect(inferModelCapabilities('BAAI/bge-m3').role).toBe('embedding')
    expect(inferModelCapabilities('text-embedding-3-small').role).toBe('embedding')
    expect(inferModelCapabilities('BAAI/bge-reranker-v2-m3').role).toBe('rerank')
    expect(inferModelCapabilities('deepseek-v3').role).toBe('chat')
    // 2026-11-04：用途只服务向量/重排卡按用途拉取，不再产出「建议归入哪张卡」的判词
  })

  it('从模型名推断思考、推理强度与读图', () => {
    const r1 = inferModelCapabilities('deepseek-r1')
    expect(r1.supportsThinking).toBe(true)
    // 预填历史三档（low/high/max）：推断只是预填，用户核对后才落盘
    expect(r1.reasoningEfforts).toEqual(['low', 'high', 'max'])
    expect(inferenceLabels(r1)).toEqual(['思考', '推理强度', 'Tool'])

    const vision = inferModelCapabilities('gpt-4o')
    expect(vision.vision).toBe(true)
    expect(vision.supportsThinking).toBe(false)
    expect(inferenceLabels(vision)).toEqual(['读图', 'Tool'])

    const step = inferModelCapabilities('step-fun/step-1v')
    expect(step.vision).toBe(true)
  })

  it('派生展示名只做可读化，不替代真实 id', () => {
    expect(readableModelName('deepseek-ai/DeepSeek-V3')).toBe('DeepSeek V3')
    expect(readableModelName('step-fun/step-1v')).toBe('Step 1v')
    expect(hasReadableName('deepseek-ai/DeepSeek-V3')).toBe(true)
    expect(hasReadableName('gpt4o')).toBe(false)
  })
})
