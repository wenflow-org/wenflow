/**
 * 卡面展示名工具（2026-10-05 卡库 demo 化）。
 *
 * 从 card-import.service 拆出（2026-10-29）：卡服务文件已超分层棘轮预算，只许缩短；
 * 这些纯函数只依赖字符串，独立成文件不改变任何口径。cardImport 仍原样再导出，
 * 既有调用方/单测无需改 import。
 */

/** cardKey 形态（导入校验、身份回退、昵称回填共用同一口径） */
export const CARD_KEY_RE = /^[a-z0-9][a-z0-9._-]{1,63}$/i;

/**
 * 批次产物名清理（2026-10-05 卡库 demo 化）：本地跑批脚本建的 VL 名称形如
 * 「rw-wild6-03（24岁广告公司文案）」——ID（人设短语）。取括号内人设短语作卡面名；
 * 无括号的裸 ID / 正常名原样返回。
 */
export function cleanDisplayName(raw: string | null | undefined): string | null {
  const s = String(raw || '').trim();
  if (!s) return null;
  const m = s.match(/^[^\s（(]{2,}[（(]([^）)]{2,})[）)]\s*$/);
  if (m) return m[1].trim();
  // 竖线形态（批次产物另一族）：「rw-school-02｜二年级学生家长·社区快递驿站店主」取｜后人设短语
  const pipe = s.match(/^[a-z0-9][a-z0-9._-]{1,63}\s*[｜|]\s*(.+)$/);
  if (pipe) return pipe[1].trim();
  return s;
}

/**
 * 昵称推导（2026-10-05 存量卡规范化）：为没有 nickname 的卡从现有字段派生人设短语——
 * ①nameHint 非 key 形态 → cleanDisplayName（「rw-int6-07（24岁广告公司文案）」→「24岁广告公司文案」）；
 * ②回退 users.name 清理版（仅括号提取成功时——普通名本就是卡面，不重复回填）；
 * ③null = 无可派生（展示链自行兜底）。key 形态的 nameHint（如 w6-math-01）不是人话，跳过。
 */
export function deriveCardNickname(seed: Record<string, unknown>, usersName: string | null | undefined): string | null {
  if (typeof seed.nickname === 'string' && seed.nickname.trim()) return null;
  const hint = typeof seed.nameHint === 'string' ? seed.nameHint.trim() : '';
  if (hint && !CARD_KEY_RE.test(hint)) {
    const fromHint = cleanDisplayName(hint);
    if (fromHint) return fromHint;
  }
  const rawName = String(usersName || '').trim();
  const fromUsers = cleanDisplayName(rawName);
  if (fromUsers && fromUsers !== rawName) return fromUsers;
  return null;
}

/** 波次标签剔除（数据层）：w5/w6 等本地跑批批次代号不入 demo 卡数据 */
export function stripWaveTags(tags: string[]): string[] {
  return tags.filter((t) => !/^w\d+$/i.test(t));
}
