/* eslint-disable @typescript-eslint/no-explicit-any -- 目标对话产出的动态 JSON 形状，由运行时校验兜底 */
/**
 * Goal 对话的输出一致性护栏（2026-11-26）。
 *
 * 背景：大模型的**具体表述**天然不稳定——同一份结构化方案，回复里可能自称「五站」却
 * 随手数出 1+2+2+1=6 个部分；成功标准里写「五段主线」，弹窗大纲却是 5 个阶段；未采集
 * 时间时又把平台默认值写成「未明确，按每次 25 分钟默认」灌进画像。这些不是提示词能逐条
 * 修干净的（换措辞/换模型都会复发），所以把**结构当唯一真值**，在出参口做确定性收敛：
 *
 *  1. 阶段总数：以 `confirmedProposal.key_stages` 为准，改写模型自报的「共 N 个阶段 / N 站」；
 *  2. 成功标准：把「N 段主线 / N 个阶段 / N 站」改成真实阶段数（「N 段原文选段」不动）；
 *  3. 快选：确认类（含「就按五站走」）一律剔除；文本完全重复的合并；
 *  4. 时间假设：`sessionsLengthSource === 'default'` 时，删掉模型写进画像的「未明确/默认」
 *     时间文案——默认值只供排课内部使用，不冒充用户提供的信息。
 *
 * 只改**可核对的数量与假设**，不重写正文观点；无法核对的内容原样保留。
 */
import { logger } from '../../utils/logger';

export interface GoalQuickReply {
  text: string;
  icon?: string;
}

interface GoalOutputInput {
  reply: string;
  quickReplies: GoalQuickReply[];
  understanding: Record<string, any>;
  confirmedProposal: Record<string, any> | null | undefined;
  stage: string;
}

export interface GoalOutputReconcileNotes {
  stageCount: number | null;
  replyCountsRewritten: number;
  criteriaCountsRewritten: number;
  quickRepliesDropped: number;
  defaultTimeRemoved: boolean;
}

const CN_DIGITS: Record<string, number> = {
  零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10,
};
const CN_NUMERALS = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
const NUM = '(?:[0-9０-９]+|[一二三四五六七八九十两]+)';

function parseCount(raw: string): number | null {
  const text = String(raw || '').trim();
  if (!text) return null;
  if (/^[0-9０-９]+$/.test(text)) {
    const n = Number(text.replace(/[０-９]/g, (ch) => String('０１２３４５６７８９'.indexOf(ch))));
    return Number.isFinite(n) ? n : null;
  }
  if (text === '十') return 10;
  if (text.length === 2 && text.startsWith('十')) return 10 + (CN_DIGITS[text[1]] ?? 0);
  if (text.length === 2 && text.endsWith('十')) return (CN_DIGITS[text[0]] ?? 0) * 10;
  if (text.length === 1) return CN_DIGITS[text] ?? null;
  return null;
}

function formatCount(n: number): string {
  return n >= 0 && n <= 10 ? CN_NUMERALS[n] : String(n);
}

/** 保持模型原句的数字风格：Arabic 进 Arabic 出，中文进中文出。 */
function formatLike(original: string, n: number): string {
  return /^[0-9０-９]+$/.test(original) ? String(n) : formatCount(n);
}

/** 阶段总数：以结构化 key_stages 为准（至少 2 段才算一份可核对的方案）。 */
export function resolveProposalStageCount(proposal: Record<string, any> | null | undefined): number | null {
  const stages = Array.isArray(proposal?.key_stages) ? proposal!.key_stages : [];
  const count = stages.filter((item: unknown) => typeof item === 'string' && item.trim().length > 0).length;
  return count >= 2 ? count : null;
}

/**
 * 改写正文里「自报总数」的句子：
 *   共 5 个阶段 / 一共五站 / 这么一来是五站 / 全课 4 段
 * 不动「第 3 站」「拆成两站」「前四站」这类**部分/序数**表达——那些是内容结构，
 * 改了反而会把「分成两块」改成「分成四块」。
 */
export function reconcileReplyStageCount(reply: string, stageCount: number | null): { text: string; changed: number } {
  if (!stageCount) return { text: reply, changed: 0 };
  let changed = 0;
  const totalPattern = new RegExp(
    `(共|一共|总共|合计|全课|整体|这么一来是|这么一来就是)(\\s*)(${NUM})(\\s*)(个)?(阶段|站|段(?!原文|选段|阅读))`,
    'g',
  );
  const text = String(reply || '').replace(totalPattern, (match, prefix, sp1, num, sp2, ge, unit) => {
    const n = parseCount(num);
    if (n === null || n === stageCount) return match;
    changed += 1;
    return `${prefix}${sp1}${formatLike(num, stageCount)}${sp2}${ge ?? ''}${unit}`;
  });
  return { text, changed };
}

/** 成功标准里的「N 段主线 / N 个阶段 / N 站」→ 真实阶段数；「N 段原文选段」保持不动。 */
export function reconcileSuccessCriteriaCount(
  understanding: Record<string, any>,
  stageCount: number | null,
): { understanding: Record<string, any>; changed: number } {
  if (!stageCount || !understanding?.success_criteria) return { understanding, changed: 0 };
  let changed = 0;
  const rewrite = (value: unknown): unknown => {
    if (typeof value !== 'string') return value;
    return value.replace(
      new RegExp(`(${NUM})(\\s*)(个)?(阶段|站|段)(\\s*)(主线|主干|主要脉络)`, 'g'),
      (match, num, sp1, ge, unit, sp2, tail) => {
        const n = parseCount(num);
        if (n === null || n === stageCount) return match;
        changed += 1;
        return `${formatLike(num, stageCount)}${sp1}${ge ?? ''}${unit}${sp2}${tail}`;
      },
    );
  };
  const sc = understanding.success_criteria;
  const next = {
    ...understanding,
    success_criteria: {
      ...sc,
      observable_result: rewrite(sc.observable_result),
      acceptance_check: rewrite(sc.acceptance_check),
    },
  };
  return { understanding: next, changed };
}

/** 确认类快选（含「就按五站走」这种带数量的放行语）。 */
const CONFIRM_CHIP_RE =
  /^(就按|直接按|按).{0,18}(走|排|来|办|开始)$|^(确认|确定|同意|可以|行|好的?|没问题|就这(?:么|样)|生成|开始吧)|(?:^|[，,、\s])确认(?:[，,、\s]|$)/;

function normalizeChipText(text: string): string {
  return String(text || '').replace(/[\s，,。.、；;：:！!？?]/g, '').toLowerCase();
}

/**
 * proposing 阶段快选：确认项归界面确认条；文本重复的合并。
 * 只在 proposing 生效——其它阶段的快选是正常动作。
 */
export function reconcileProposingQuickReplies(
  quickReplies: GoalQuickReply[],
  stage: string,
): { quickReplies: GoalQuickReply[]; dropped: number } {
  if (stage !== 'proposing') return { quickReplies, dropped: 0 };
  const seen = new Set<string>();
  const kept: GoalQuickReply[] = [];
  for (const item of quickReplies) {
    const text = String(item?.text || '').trim();
    if (!text) continue;
    if (CONFIRM_CHIP_RE.test(text)) continue;
    const key = normalizeChipText(text);
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push({ ...item, text });
  }
  return { quickReplies: kept, dropped: quickReplies.length - kept.length };
}

/**
 * 时间假设：用户没给时长（source=default）时，模型写进画像的「未明确，按每次 N 分钟默认」
 * 不是用户信息，删掉；内部 `sessionsLengthMin` 保留给排课。
 */
export function stripDefaultTimeClaim(understanding: Record<string, any>): { understanding: Record<string, any>; removed: boolean } {
  const source = understanding?.time_dimensions?.sessionsLengthSource;
  if (source !== 'default') return { understanding, removed: false };
  const looksDefault = (value: unknown) =>
    typeof value === 'string' && /(默认|未明确|未提及|暂按|平台先按)/.test(value);
  let removed = false;
  const next: Record<string, any> = { ...understanding };
  if (understanding?.available_resources && typeof understanding.available_resources === 'object') {
    const res = { ...understanding.available_resources };
    if (looksDefault(res.time_per_session)) {
      delete res.time_per_session;
      removed = true;
    }
    next.available_resources = res;
  }
  if (understanding?.background && typeof understanding.background === 'object') {
    const bg = { ...understanding.background };
    if (looksDefault(bg.available_time)) {
      delete bg.available_time;
      removed = true;
    }
    next.background = bg;
  }
  return { understanding: next, removed };
}

export function reconcileGoalConversationOutput(input: GoalOutputInput): {
  reply: string;
  quickReplies: GoalQuickReply[];
  understanding: Record<string, any>;
  notes: GoalOutputReconcileNotes;
} {
  const stageCount = resolveProposalStageCount(input.confirmedProposal);
  const reply = reconcileReplyStageCount(input.reply, stageCount);
  const criteria = reconcileSuccessCriteriaCount(input.understanding, stageCount);
  const chips = reconcileProposingQuickReplies(input.quickReplies, input.stage);
  const time = stripDefaultTimeClaim(criteria.understanding);
  const notes: GoalOutputReconcileNotes = {
    stageCount,
    replyCountsRewritten: reply.changed,
    criteriaCountsRewritten: criteria.changed,
    quickRepliesDropped: chips.dropped,
    defaultTimeRemoved: time.removed,
  };
  if (reply.changed || criteria.changed || chips.dropped || time.removed) {
    logger.info('[skill:goal-conversation] 输出一致性收敛', notes);
  }
  return {
    reply: reply.text,
    quickReplies: chips.quickReplies,
    understanding: time.understanding,
    notes,
  };
}
