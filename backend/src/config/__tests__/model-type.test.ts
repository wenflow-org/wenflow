import { inferModelType } from '../model-type'

describe('inferModelType（上游模型软分类）', () => {
  it('对话模型：常见 LLM 名字默认归 llm', () => {
    expect(inferModelType('deepseek-v4.1-flash')).toBe('llm')
    expect(inferModelType('gpt-4o')).toBe('llm')
    expect(inferModelType('claude-sonnet-4-5')).toBe('llm')
    expect(inferModelType('qwen3-max')).toBe('llm')
    expect(inferModelType('cohere-command-r-plus')).toBe('llm')
    // 本地注册表里 tier=chat 的多模态模型：名字带 image 但不按通用词误判
    expect(inferModelType('agnes-image-2.0-flash')).toBe('llm')
    expect(inferModelType('')).toBe('unknown')
  })

  it('向量模型：embed 家族与无 embed 字样的常见向量家族', () => {
    expect(inferModelType('text-embedding-3-large')).toBe('embedding')
    expect(inferModelType('BAAI/bge-large-zh-v1.5')).toBe('embedding')
    expect(inferModelType('bge-m3')).toBe('embedding')
    expect(inferModelType('Qwen3-Embedding-4B')).toBe('embedding')
    expect(inferModelType('voyage-3')).toBe('embedding')
    expect(inferModelType('gte-Qwen2-7B-instruct')).toBe('embedding')
    expect(inferModelType('nomic-embed-text')).toBe('embedding')
    expect(inferModelType('multilingual-e5-large')).toBe('embedding')
    expect(inferModelType('m3e-base')).toBe('embedding')
    expect(inferModelType('all-MiniLM-L6-v2')).toBe('embedding')
    expect(inferModelType('sentence-transformers/all-mpnet-base-v2')).toBe('embedding')
    expect(inferModelType('paraphrase-multilingual-MiniLM-L12-v2')).toBe('embedding')
    // 评审里点名的「没有 embed 字样」例子
    expect(inferModelType('cohere-multilingual-v3.0')).toBe('embedding')
  })

  it('重排模型优先于向量判定（bge-reranker 不落进 embedding）', () => {
    expect(inferModelType('BAAI/bge-reranker-v2-m3')).toBe('reranker')
    expect(inferModelType('cohere-rerank-3.5')).toBe('reranker')
    expect(inferModelType('bce-reranker-base')).toBe('reranker')
    expect(inferModelType('jina-reranker-v2-base-multilingual')).toBe('reranker')
    expect(inferModelType('colbert-v2')).toBe('reranker')
  })

  it('多模态编码器与生成模型归其它，不冒充对话模型', () => {
    expect(inferModelType('clip-vit-large-patch14')).toBe('unknown')
    expect(inferModelType('siglip-so400m')).toBe('unknown')
    expect(inferModelType('dall-e-3')).toBe('unknown')
    expect(inferModelType('gpt-image-1')).toBe('unknown')
    expect(inferModelType('stable-diffusion-3.5-large')).toBe('unknown')
    expect(inferModelType('flux.1-schnell')).toBe('unknown')
    expect(inferModelType('midjourney-v6')).toBe('unknown')
    expect(inferModelType('whisper-1')).toBe('unknown')
    expect(inferModelType('tts-1-hd')).toBe('unknown')
    expect(inferModelType('sora-2')).toBe('unknown')
    expect(inferModelType('veo-3')).toBe('unknown')
    expect(inferModelType('seedance-1.0-pro')).toBe('unknown')
  })
})
