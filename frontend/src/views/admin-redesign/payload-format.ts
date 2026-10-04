/**
 * 日志负载展示格式化：输入/输出负载多为紧凑单行 JSON（无换行无缩进），
 * 直接塞进 <pre> 排障时要在一眼望不到头的长行里找字段。
 * 这里尝试 JSON.parse，成功且为对象/数组时输出两格缩进的美化版；
 * 原始字符串/数字或解析失败（错误文本、prompt 原文）一律原样返回。
 * 保护：超长负载（>1MB 字符）不格式化——stringify 展开约 2-3 倍，避免大负载卡渲染。
 */
export function prettyPayload(text: unknown): string {
  if (typeof text !== 'string') return ''
  if (!text || text.length > 1_000_000) return text
  const t = text.trim()
  if (!t.startsWith('{') && !t.startsWith('[')) return text
  try {
    const parsed = JSON.parse(t)
    if (parsed && typeof parsed === 'object') return JSON.stringify(parsed, null, 2)
  } catch {
    /* 非 JSON（错误文本 / prompt 原文 / 截断的负载）原样展示 */
  }
  return text
}
