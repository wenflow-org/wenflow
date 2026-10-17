/**
 * 截止日文本解析（#57）。
 *
 * 背景：goal 对话偶尔产出「未明确，先按 3 个月规划」这类文本——模型在替学习者给默认节奏，
 * 学习者本人并没有外部截止。旧实现直接拿其中的「3 个月」推算硬截止日，于是
 * `learning_paths.deadline` 出现一个**凭空的硬锚**，deadline 驱动的重排会据此判「进度落后」
 * （实测 5 条非空 deadline 里 3 条来自这类文本）。
 *
 * 口径：文本自述未明确 → 不产出日期（仍保留文本用于展示）；显式 YYYY-MM-DD 或相对表述才落日期。
 */

/** 文本是否自述「没有明确截止」 */
export function isDeadlineExplicitlyUnspecified(text: string): boolean {
  return /未明确|不确定|没(有)?明确|尚未|待定|暂无|没有(截止|期限)|没定/.test(String(text || ''));
}

/** 相对表述 → 日期（「3 个月」「6 周」）；文本里没有相对表述时返回 null */
export function deriveRelativeDeadline(text: string, now: Date = new Date()): Date | null {
  const source = String(text || '');
  const monthsMatch = source.match(/(\d+)\s*个月/);
  if (monthsMatch) {
    const date = new Date(now.getTime());
    date.setMonth(date.getMonth() + parseInt(monthsMatch[1], 10));
    return date;
  }
  const weeksMatch = source.match(/(\d+)\s*周/);
  if (weeksMatch) {
    const date = new Date(now.getTime());
    date.setDate(date.getDate() + parseInt(weeksMatch[1], 10) * 7);
    return date;
  }
  return null;
}

/** 显式绝对日期（YYYY-MM-DD 前缀）→ Date；不匹配返回 null */
export function parseAbsoluteDeadline(text: string): Date | null {
  const value = String(text || '').trim();
  return /^\d{4}-\d{2}-\d{2}/.test(value) ? new Date(value) : null;
}
