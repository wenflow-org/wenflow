/**
 * 目标澄清阶段的「本轮导师在问你信息」判据 + 两行入口的文案（2026-10-31 用户走查）。
 *
 * 背景：`proposing` 既表示「方案已可确认」，同一条回复又有收尾问句。用户走查截图里同屏
 * 既有三条快选、又有「查看方案并确认」入口条 ——「到底是让用户干什么」。
 *
 * 那一屏的根因在后端（proposing 的快选里混进「就按这个方向来」这类**确认**项，与确认条
 * 抢同一个动作；见 backend/src/skills/goal-conversation/index.ts 的 normalizeProposingQuickReplies）。
 * 后端剔除确认类快选后，快选只剩「调整方向」一种语义。
 *
 * 本模块是剩下那一半：把收尾问句分两类，别把「请求确认」误读成「还在要信息」——
 *   · 确认式问句（「……可以吗？」「这个方向对不对？」）＝ 导师在请你拍板，方案就是最终态，
 *     入口条按原措辞（「查看方案并确认」）；
 *   · 信息式问句（「你之前考过 CPA 吗？」）＝ 答案会改方案参数，此时入口条不该宣称「方案已就绪」。
 * 判据刻意用回复文本的确定性特征，不新增后端字段：现场可复算，测试可锁。
 */

/** 收尾问句属于「请你确认/请你定」而不是「向你要信息」（语料取自 prompt_call_logs 的 proposing 回复） */
const CONFIRM_ASK_PATTERN =
  /(可以吗|行吗|行不行|好吗|可以吧|对不对|对吧|是不是|合适吗|要紧吗|要不要调整|要调整吗|需要调整|哪里要调|哪儿要调|怎么样|如何|这版行)/;

export function isAwaitingAnswer(stage: string | null | undefined, lastAiText: string): boolean {
  if (stage !== 'proposing') return false;
  const text = String(lastAiText || '').trim();
  if (!/[?？]\s*$/.test(text)) return false;
  return !CONFIRM_ASK_PATTERN.test(text);
}

export interface ProposalEntryCopy {
  /** 确认入口条的左提示 */
  hint: string;
  /** 确认入口条的按钮文案 */
  button: string;
}

/**
 * 两行入口的文案：一行是「回答导师」、一行是「看/确认方案」。
 * 导师在问会改方案的问题时，入口条不再宣称「方案已就绪」——因为方案里正有一个待表态的点。
 * （快选行的标签见 {@link goalRepliesLabel}：那一行在 understanding 也存在，文案不能只说「调整」。）
 */
export function proposalEntryCopy(awaitingAnswer: boolean): ProposalEntryCopy {
  if (awaitingAnswer) {
    // 不写「在下面回复导师」：方位指路是文案门禁 R2 禁项，且方案卡审阅浮层打开时
    // 输入区会随遮罩锁定（P21），「下面」并不总是一个能立刻用的去处
    return {
      hint: '导师这一问会影响方案：回复导师即可更新方案，也可以先看当前这版。',
      button: '查看当前方案',
    };
  }
  return {
    hint: '方案已就绪——回复即可继续调整，满意了再确认',
    button: '查看方案并确认',
  };
}

/**
 * 快选行前的可见标签（此前只有读屏器能看到，用户会把两行读成同一组选项）。
 * understanding 阶段的快选是「本轮问题的候选项」，不能说成「调整方案」——
 * 实测：只按 proposing 的两套文案取，会在澄清阶段打出「也可以这样调整」（2026-11-01 自测截图）。
 */
export function goalRepliesLabel(stage: string | null | undefined, awaitingAnswer: boolean): string {
  if (stage === 'proposing') {
    return awaitingAnswer
      ? '回应导师这一问（点选填入输入框，可多选）'
      : '也可以这样调整（点选填入输入框，可多选）';
  }
  return '也可以直接选（点选填入输入框，可多选）';
}
