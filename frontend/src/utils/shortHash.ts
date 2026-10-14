/**
 * 长散键指纹（`hash:…`）截断显示的单源工具。
 *
 * 卡库的 `hash:` 标签是 64 位十六进制指纹（整串 ~69 字符）：卡墙/卡详情 hero 的 chip 不折行，
 * 窄屏（390）下整串会超出右缘、被 `.mk-page{overflow:hidden}` 裁掉且无处看全值。
 * 统一截为 `hash:` + 前 8 位十六进制 + 省略号（够核对），完整值由调用方置于 title。
 * 非 `hash:` 前缀的短标签原样返回。
 */
export function shortHashTag(tag: string): string {
  return /^hash:/.test(tag) ? `${tag.slice(0, 13)}…` : tag
}
