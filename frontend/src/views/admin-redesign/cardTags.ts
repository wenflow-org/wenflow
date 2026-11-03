/**
 * 卡面标识过滤（卡库卡墙与卡详情共用一份判断）。
 *
 * 为什么单列成文件：卡墙 2026-10-24 起就不再展示 `preset:` / `hash:` / `builtin` / `vN`
 * 这类内部标记，卡详情却仍在徽标行原样摊开，同一张卡在两处读出两套身份
 * （2026-11-02 评审 R18/R17/R11）。判断只写一份，两页才不会再分叉。
 */

/** 内部标记：预置卡 tags 里的来源/版本/内容指纹，运营读不出信息 */
const INTERNAL_TAG_RE = /^(?:preset:|hash:|builtin$|in_scope$|out_of_scope$|v\d+(?:\.\d+)*$|w\d+$)/i

export function isInternalTag(tag: string): boolean {
  return INTERNAL_TAG_RE.test(tag)
}

/** `builtin` 是预置卡的系统占位卡号：既不区分两张卡，也不是运营能读的卡号 */
const PLACEHOLDER_CARD_KEYS = new Set(['builtin'])

export function isPlaceholderCardKey(key: string | null | undefined): boolean {
  return !!key && PLACEHOLDER_CARD_KEYS.has(key.trim())
}