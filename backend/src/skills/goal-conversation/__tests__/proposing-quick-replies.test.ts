/**
 * proposing 阶段快选归一化（2026-10-31 用户走查）。
 *
 * 现场：方案已就绪的同一轮，界面上既有三条快选、又有「查看方案并确认」入口条，
 * 其中一条快选就是「就按这个方向来」——用户不知道该点哪个（原话：
 * 「到底是让用户干什么呢，又有快选，又有确认方案」）。
 *
 * 语料取自 prompt_call_logs 中 136 个真实 proposing 回合的快选原文。
 */
import {
  isProposalConfirmChip,
  normalizeProposingQuickReplies,
  parseGoalConversationResponse,
} from '../index';

function proposingContent(quickReplies: unknown): string {
  return JSON.stringify({
    reply: '这一版先聚焦两段：先把三张表对齐字段合成一张明细，再按商品和日期汇总出销售额。',
    state: { stage: 'proposing', confidence: 0.85, done: false },
    understanding: {
      surface_goal: '学会用 Python 自动合并三个平台的订单表',
      real_problem: '每周手工合并两个多小时且容易出错',
      available_resources: { time_horizon: '一个月', time_budget: '每天 1 小时' },
      success_criteria: { observable_result: '能自己独立跑通一次周报合并' },
    },
    nextQuestions: [],
    quickReplies,
    confirmedProposal: {
      learning_direction: '从明细合并到汇总报告的自动化',
      key_stages: ['字段对齐', '合并去重', '分组汇总'],
      first_deliverable: '一张能交付的周报',
      out_of_scope: [],
    },
  });
}

describe('isProposalConfirmChip：只认确认意图，不误伤调整意图', () => {
  it('实测语料里的确认项全部命中', () => {
    ['就按这个方向来', '方向对，就按这个来', '可以，就按这个', '就按这个来', '可以，就按这个来', '确认，生成学习路径']
      .forEach((text) => expect(`${text} → ${isProposalConfirmChip(text)}`).toBe(`${text} → true`));
  });

  it('实测语料里的调整项一个都不命中（否则用户的调整捷径被误删）', () => {
    [
      '先只讲加速器到底做了什么',
      '体量再小一点，压缩到 3-4 次',
      '我想先补点 Python 基础',
      '验收标准我想改一下',
      '抠图想放前面先练',
      '调色这一段再拆细一点',
      '先把调色那部分提前',
      '先只做前两个阶段试试',
      '阶段想再精简一点',
      '先把时间安排说清楚',
      '维度不是这几个',
      '想先补数据整理那一步',
      '字段对齐这块想再讲细一点',
      '想把时间压到两周内',
    ].forEach((text) => expect(`${text} → ${isProposalConfirmChip(text)}`).toBe(`${text} → false`));
  });
});

describe('normalizeProposingQuickReplies', () => {
  it('proposing：剔掉确认项，保留调整项', () => {
    const kept = normalizeProposingQuickReplies(
      [
        { text: '就按这个方向来' },
        { text: '字段对齐这块想再讲细一点' },
        { text: '想把时间压到两周内' },
      ],
      'proposing'
    );
    expect(kept.map((item) => item.text)).toEqual(['字段对齐这块想再讲细一点', '想把时间压到两周内']);
  });

  it('proposing：清一色确认项 → 全部剔空（页面只剩确认条一个下一步）', () => {
    expect(normalizeProposingQuickReplies([{ text: '确认，生成学习路径' }, { text: '就按这个来' }], 'proposing')).toEqual([]);
  });

  it('understanding：原样保留——那里的快选是「回答导师问题」的候选项，不是确认动作', () => {
    const asIs = [{ text: '就是拼成一张明细表' }, { text: '要按商品/日期汇总算指标' }];
    expect(normalizeProposingQuickReplies([...asIs], 'understanding')).toEqual(asIs);
  });
});

describe('parseGoalConversationResponse：proposing 不再与确认条抢同一个动作', () => {
  it('模型给了确认类快选 → 输出里只剩调整项', () => {
    const parsed = parseGoalConversationResponse(
      proposingContent(['就按这个方向来', '先把时间安排说清楚'])
    );
    expect(parsed.internal.core.stage).toBe('proposing');
    expect(parsed.internal.ext.goalConversation.quickReplies).toEqual([{ text: '先把时间安排说清楚' }]);
  });

  it('模型没给快选 → 不再凭空补一对「确认/需要调整」', () => {
    const parsed = parseGoalConversationResponse(proposingContent([]));
    expect(parsed.internal.ext.goalConversation.quickReplies).toBeUndefined();
  });

  it('understanding 阶段的快选不受影响（含「可以」字样的候选项也可能出现）', () => {
    const content = JSON.stringify({
      reply: '你平时拿这些数据做什么？',
      state: { stage: 'understanding', confidence: 0.4, done: false },
      understanding: { surface_goal: '学会数据透视表' },
      nextQuestions: ['你想用它处理什么数据？'],
      quickReplies: ['按区域和月份汇总', '看每月各类花销'],
    });
    const parsed = parseGoalConversationResponse(content);
    expect(parsed.internal.ext.goalConversation.quickReplies).toEqual([
      { text: '按区域和月份汇总' },
      { text: '看每月各类花销' },
    ]);
  });
});
