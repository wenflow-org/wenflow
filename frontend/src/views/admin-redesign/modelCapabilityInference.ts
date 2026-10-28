/**
 * 模型能力推断（2026-10-28 用户「元数据字典推断 / Zero-Config 引入」）。
 *
 * 只做「从上游 id 猜用途与能力」这一件事，猜不中的模型仍可手动编辑。
 * 用途判断优先于能力判断：向量 / 重排模型不应出现在对话模型的待选清单里。
 */

export type ModelRole = 'chat' | 'embedding' | 'rerank'

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

const THINKING_RE =
  /(^|[/_.-])(r1|reasoner|reasoning|thinking?|qwq|o1|o3|o4)([/_.-]|$)|deepseek-r1|deepseek-reasoner|qwen[\d.]*[-_]?qwq|gpt-5|magistral/i

const VISION_RE =
  /(^|[/_.-])(vl|vision|omni)([/_.-]|$)|gpt-4o|gpt-4\.1|gpt-5|claude|gemini|pixtral|llava|internvl|glm-4v|qwen[\d.]*[-_]?vl|step-[\d.]+v|deepseek-vl/i

const CODE_RE = /code|coder|codestral|starcoder|devstral/i
const TOOL_RE =
  /deepseek|gpt|claude|gemini|qwen|glm|kimi|moonshot|mistral|llama|grok|step-|hunyuan|ernie|doubao/i

export function inferModelCapabilities(id: string): ModelInference {
  const name = String(id || '').trim()
  const role: ModelRole = RERANK_RE.test(name)
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

/** 模型类型建议：非对话模型在选择器里提示应去哪张卡配置。 */
export function roleSuggestion(role: ModelRole): string {
  if (role === 'embedding') return '建议归入向量模型'
  if (role === 'rerank') return '建议归入重排模型'
  return ''
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
