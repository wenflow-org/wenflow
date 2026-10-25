/**
 * 显示名 / 头像首字共用的清洗与降级函数。
 *
 * 背景（2026-10-24 视觉走查 people-f1）：后台昵称来自历史导入数据，可能含
 *   - U+FFFD（解码失败的替换字符）；
 *   - 未配对的 UTF-16 代理项（emoji 被截半、按字节切分后残存的孤立 surrogate）；
 *   - C0/C1 控制字符。
 * 这些字符在头像首字位置会渲染成「� / 方框」，昵称本身也会出现乱码。
 * 要求头像（MkCellAvatar）与昵称输出（Users.vue）共用同一份清洗结果，
 * 避免一边已降级、另一边仍是乱码。
 */

/** 剔除非法/不可渲染字符并压缩空白（不改变合法 CJK / emoji）。 */
export function sanitizeDisplayName(raw: unknown): string {
  if (raw == null) return ''
  const text = typeof raw === 'string' ? raw : String(raw)
  let out = ''
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0
    // 替换字符与非字符
    if (cp === 0xfffd || cp === 0xfffe || cp === 0xffff) continue
    // 孤立代理项：for...of 会把合法代理对合成单个码点（>0xFFFF），
    // 落到 D800–DFFF 的只可能是未配对的那一半。
    if (cp >= 0xd800 && cp <= 0xdfff) continue
    // 控制字符（C0/C1）：换行/制表折成空格，其余直接剔除
    if (cp < 0x20 || (cp >= 0x7f && cp <= 0x9f)) {
      if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') out += ' '
      continue
    }
    // 零宽/方向控制/变体选择符：在头像首字位会渲染成空白或豆腐块
    if ((cp >= 0x200b && cp <= 0x200f) || (cp >= 0x202a && cp <= 0x202e)
      || (cp >= 0x2060 && cp <= 0x206f) || cp === 0xfeff
      || (cp >= 0xfe00 && cp <= 0xfe0f) || (cp >= 0xe0100 && cp <= 0xe01ef)) continue
    out += ch
  }
  return out.replace(/\s+/g, ' ').trim()
}

/** 副行邮箱：与主行同值（邮箱 local part 等于昵称）时不再渲染，避免逐行复读。 */
export function emailSubline(email: unknown, name: unknown): string {
  const mail = sanitizeDisplayName(email)
  if (!mail) return ''
  const local = mail.includes('@') ? mail.slice(0, mail.indexOf('@')) : mail
  const display = sanitizeDisplayName(name)
  return local && local !== display ? mail : ''
}

/** 主行本身已是机器 ID（UUID / 12 位以上无空格标识）时，不再用 shortId 副行复读同一标识。 */
export function isIdentifierLike(raw: unknown): boolean {
  const text = sanitizeDisplayName(raw)
  if (!text || /\s/.test(text) || /[\u4e00-\u9fa5]/.test(text)) return false
  return /^[0-9a-f]{8}-[0-9a-f-]{4,}$/i.test(text) || /^[A-Za-z0-9_-]{12,}$/.test(text)
}

/** 头像首字：清洗后按码点取第一个字符，并跳过开头的组合附加符
 *  （姓名以 é 的分解形式开头时，首字符会是不可见的重音符）。 */
export function avatarInitial(raw: unknown, email?: unknown): string {
  const name = displayNameOf(raw, email)
    .replace(/^[\u0300-\u036f\u1ab0-\u1aff\u1dc0-\u1dff\u20d0-\u20ff\ufe20-\ufe2f]+/, '')
  return Array.from(name)[0] || '用'
}

/** 昵称降级链：清洗后昵称 → 邮箱 local part → 「用」。 */
export function displayNameOf(raw: unknown, email?: unknown): string {
  const name = sanitizeDisplayName(raw)
  if (name) return name
  const mail = sanitizeDisplayName(email)
  const local = mail.includes('@') ? mail.slice(0, mail.indexOf('@')) : mail
  const cleaned = sanitizeDisplayName(local)
  return cleaned || '用'
}
