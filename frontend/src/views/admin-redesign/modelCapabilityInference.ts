/**
 * 模型能力推断（2026-10-28 用户「元数据字典推断 / Zero-Config 引入」）。
 *
 * 只做「从上游 id 猜用途与能力」这一件事，猜不中的模型仍可手动编辑。
 * 2026-11-04 用户「我们不做模型类型区分」：判出的用途只服务「向量 / 重排卡按用途拉取」，
 * 不再把模型挡在添加清单之外，也不再给「建议归入哪张卡」的判词。
 */

export type ModelRole = 'chat' | 'embedding' | 'rerank' | 'image'

export interface ModelInference {
  role: ModelRole
  supportsThinking: boolean
  supportsReasoningEffort: boolean
  vision: boolean
  code: boolean
  tool: boolean
}

const RERANK_RE = /rerank|bge-reranker|jina-reranker|cross-encoder|cohere.*rerank/i
const EMBEDDING_RE =
  /embedding|text-embedding|embed[-_]|bge[-_/]|(^|[/_.-])(gte|e5|m3e|jina-embed|voyage|nomic-embed)([/_.-]|$)/i
/* 图像 / 视频生成模型（2026-11-02 评审）：此前一律按「对话」处理，
   它们会出现在可勾选清单里，与「只有对话模型可以添加」的说法自相矛盾。 */
const IMAGE_RE =
  /(^|[/_.-])(image|imagen|dall-e|dalle|flux|sdxl|stable-diffusion|video|veo|sora|kling|seedance|t2i|i2v)([/_.-]|$)|midjourney/i

/* 2026-11-03 用户：「不建议本地维护模型列表分类，由运营人员自行配置」。
   试过的那条 asr / tts / realtime → audio 规则已撤（本地认词表判用途，判错还要靠运营绕开）。
   新增用途前先想清楚：这份词表该不该由前端维护，别再把模型名当配置项。 */

const THINKING_RE =
  /(^|[/_.-])(r1|reasoner|reasoning|thinking?|qwq|o1|o3|o4)([/_.-]|$)|deepseek-r1|deepseek-reasoner|qwen[\d.]*[-_]?qwq|gpt-5|magistral/i

const VISION_RE =
  /(^|[/_.-])(vl|vision|omni)([/_.-]|$)|gpt-4o|gpt-4\.1|gpt-5|claude|gemini|pixtral|llava|internvl|glm-4v|qwen[\d.]*[-_]?vl|step-[\d.]+v|deepseek-vl/i

const CODE_RE = /code|coder|codestral|starcoder|devstral/i
const TOOL_RE =
  /deepseek|gpt|claude|gemini|qwen|glm|kimi|moonshot|mistral|llama|grok|step-|hunyuan|ernie|doubao/i

export function inferModelCapabilities(id: string): ModelInference {
  const name = String(id || '').trim()
  const role: ModelRole = IMAGE_RE.test(name)
    ? 'image'
    : RERANK_RE.test(name)
      ? 'rerank'
      : EMBEDDING_RE.test(name)
        ? 'embedding'
        : 'chat'
  const chat = role === 'chat'
  const thinking = chat && THINKING_RE.test(name)
  return {
    role,
    supportsThinking: thinking,
    supportsReasoningEffort: thinking,
    vision: chat && VISION_RE.test(name),
    code: chat && CODE_RE.test(name),
    tool: chat && TOOL_RE.test(name),
  }
}

/** 上屏的能力标签（顺序固定：思考 → 推理强度 → 读图 → 代码 → Tool）。 */
export function inferenceLabels(inference: ModelInference): string[] {
  if (inference.role !== 'chat') return []
  const labels: string[] = []
  if (inference.supportsThinking) labels.push('思考')
  if (inference.supportsReasoningEffort) labels.push('推理强度')
  if (inference.vision) labels.push('读图')
  if (inference.code) labels.push('代码')
  if (inference.tool) labels.push('Tool')
  return labels
}

/** 从上游 id 派生的可读名（只用于选择器辅助识别，不落库、不替代真实 id）。 */
export function readableModelName(id: string): string {
  const tail = String(id || '').split('/').pop() || id
  const spaced = tail.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim()
  if (!spaced) return id
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

/** 只有确实比原始 id 更好读时才展示第二行，避免重复两遍同一个字符串。 */
export function hasReadableName(id: string): boolean {
  return /[-_/]/.test(id) && readableModelName(id) !== id
}
