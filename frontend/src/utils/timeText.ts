/**
 * 生成文案里的「伪时间」剥离（2026-11-25 去时间化）。
 *
 * 生成期会把平台默认的单次时长写进 summary / description（「每次约 25 分钟」「每天约 30 分钟」），
 * 但这不是用户给的约束，也不该在路径卡片里变成承诺。展示前统一剥掉；真实学习时长
 * （历史/仪表盘的已学分钟）不走这里。
 */
const PSEUDO_TIME_PATTERNS: RegExp[] = [
  /每[次天]\s*约?\s*\d+\s*分钟[，,。；;]?\s*/g,
  /每[次天]\s*约?\s*[一二三四五六七八九十两]+[来多]?\s*分钟[，,。；;]?\s*/g,
];

export function stripPseudoTime(text: string | null | undefined): string {
  if (!text) return '';
  let out = text;
  for (const pattern of PSEUDO_TIME_PATTERNS) out = out.replace(pattern, '');
  return out.replace(/[ \t]{2,}/g, ' ').trim();
}
