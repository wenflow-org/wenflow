/**
 * 上游模型的软分类（BYOK 体验优化，2026-11-11 用户评审）：
 * 对话框「添加对话模型」只默认推荐对话模型，向量 / 重排 / 生成模型收进「全部」。
 *
 * 为什么不放前端：命名没有行业标准（bge-m3、text2vec、voyage、clip-vit…），
 * 前端写死字典等于每次出新模型都要发版；规则放这一处，后端发版即生效。
 * 只抓确定性特征，判不准一律按对话模型（llm）——错了用户切「全部」即可，
 * 不因为误判把模型从清单里彻底藏掉。
 *
 * 2026-11-11 第二版：上游 `/v1/models` 只给扁平 id（没有 type 字段），所以这里就是唯一分类器；
 * 对话弹窗与向量 / 重排卡都读它，前端不再另养一份词表。
 * 若将来上游开始返回类型字段，应当优先读上游字段，这里只做兜底。
 */
export type InferredModelType = 'llm' | 'embedding' | 'reranker' | 'unknown'

/** 重排优先判：bge-reranker / cohere-rerank 这类名字里也带 bge / 可能的 embed 词 */
const RERANK_RE = /rerank|re-rank|re_rank|colbert|cross[-_]?encoder/i
/**
 * 向量模型：嵌入、双塔与常见向量家族。
 * bge-m3 等名字里没有 "embed"，靠家族前缀兜住；MiniLM / m3e / sentence-transformers
 * 是社区最常见、却都不带 embed 字样的向量命名。
 */
const EMBEDDING_RE =
  /embed|text2vec|voyage|\bbge(?:$|[-_.:])|[/_.-]bge-|\bgte-|\be5-|\bm3e\b|minilm|sentence[-_]transformers|paraphrase-|jina|nomic|bce-embed|cohere.*(?:embed|multilingual)/i
/**
 * 非对话的其它模型：多模态编码器 + 图像 / 视频 / 语音生成。
 * 只认确定性家族名，不用 `image`、`video` 这类通用词——本地注册表里的 `agnes-image-*`
 * 是 tier=chat 的对话模型，按通用词误判会把正常模型从推荐视图里踢掉。
 */
const OTHER_RE =
  /\bclip\b|siglip|\bvit-|vit[-_]|dall-?e|\bimagen\b|\bgpt-image|stable[-_]?diffusion|sdxl|(?:^|[/_.-])flux(?:$|[/_.-])|midjourney|whisper|\btts(?:-|$)|fish[-_]?speech|cosyvoice|musicgen|\bsuno\b|stable[-_]?audio|(?:^|[/_.-])sora(?:$|[/_.-])|\bveo-|\bkling\b|seedance/i

export function inferModelType(id: string): InferredModelType {
  const s = String(id || '').trim()
  if (!s) return 'unknown'
  if (RERANK_RE.test(s)) return 'reranker'
  if (EMBEDDING_RE.test(s)) return 'embedding'
  if (OTHER_RE.test(s)) return 'unknown'
  return 'llm'
}
