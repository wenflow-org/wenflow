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
 *     入口条只留一颗「查看方案」；
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
 * 入口条文案：hint 只在真有非可见信息时出现（导师在要信息），按钮一颗。
 * 正常态不再给提示句（2026-11-03 用户反馈「不要这种写法」）：「方案已就绪——回复即可
 * 继续调整，满意了再确认」是自我宣告加教用法，方案面板本身就在，按钮「查看方案」足够。
 * 导师在问会改方案的问题时，入口条不再宣称「方案已就绪」——因为方案里正有一个待表态的点。
 * （快选行在 understanding 也存在，文案不能只说「调整」；该行可见标签已于 2026-11-03 移除。）
 *
 * `unansweredProbes`（2026-11-02 业务口径）：自测题只长在预览面板里，用户不开面板就看不到题，
 * 也谈不上作答。有题未答时入口条把这件事挑明，别让「可选」变成「不可见」。
 */
export function proposalEntryCopy(awaitingAnswer: boolean, unansweredProbes = 0): ProposalEntryCopy {
  if (awaitingAnswer) {
    // 不写「在下面回复导师」：方位指路是文案门禁 R2 禁项，且方案卡审阅浮层打开时
    // 输入区会随遮罩锁定（P21），「下面」并不总是一个能立刻用的去处
    return {
      hint: '导师这一问会影响方案：回复导师即可更新方案，也可以先看当前这版。',
      button: '查看当前方案',
    };
  }
  if (unansweredProbes > 0) {
    return {
      hint: `还有 ${unansweredProbes} 道快速自测可先答，用来校准起点`,
      button: '查看方案',
    };
  }
  return {
    hint: '',
    // 2026-11-05 用户裁定：就绪态按钮表达「看完即可确认」的动作闭环（微卡片语境）
    button: '查看并确认',
  };
}

/* 快选行的可见标签已整体移除（2026-11-03 用户反馈「直接不要这个提示」），
   用法说明只保留给读屏器（V2GoalConversation .visually-hidden）。 */
