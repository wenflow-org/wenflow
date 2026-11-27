/**
 * Goal 输出一致性护栏（2026-11-26）：结构是唯一真值。
 *
 * 实测缺陷（哲学史路径）：
 *  ① 正文数出 1+2+2+1=6 个部分，却自称「五站」；弹窗按 5 个阶段合并；
 *  ② 成功标准写「五段主线」，实际只有 4 条主线 + 1 站原文；
 *  ③ proposing 快选同时给「就按五站走」和「原文加到四段」（已包含在前者里）；
 *  ④ 用户没说时长，画像却出现「未明确，按每次 25 分钟默认」。
 */
import {
  reconcileGoalConversationOutput,
  reconcileProposingQuickReplies,
  reconcileReplyStageCount,
  reconcileSuccessCriteriaCount,
  resolveProposalStageCount,
  stripDefaultTimeClaim,
} from '../output-consistency';
import { parseGoalConversationResponse } from '..';

const proposal = (stages: string[]) => ({ key_stages: stages });
const FOUR = proposal(['古希腊', '笛卡尔到休谟', '康德', '二十世纪']);
const FIVE = proposal(['古希腊', '笛卡尔到休谟', '康德', '二十世纪·语言', '二十世纪·生活', '原文对读'].slice(0, 5));

describe('阶段数：结构说话', () => {
  it('以 key_stages 的有效条数为准；少于 2 条不出数', () => {
    expect(resolveProposalStageCount(FOUR)).toBe(4);
    expect(resolveProposalStageCount(proposal([''] ))).toBeNull();
    expect(resolveProposalStageCount(null)).toBeNull();
  });

  it('正文自报总数与结构不一致 → 改成真实数（保留数字风格）', () => {
    expect(reconcileReplyStageCount('这么一来是五站，深度没翻倍。', 4)).toEqual({
      text: '这么一来是四站，深度没翻倍。',
      changed: 1,
    });
    expect(reconcileReplyStageCount('共 5 个阶段，先走主干。', 4).text).toBe('共 4 个阶段，先走主干。');
    expect(reconcileReplyStageCount('总共三段。', 4).text).toBe('总共四段。');
  });

  it('一致时不改；部分/序数表达不动（拆成两站、前四站、第 3 站）', () => {
    expect(reconcileReplyStageCount('这么一来是四站。', 4).changed).toBe(0);
    const text = '近代拆成两站，前四站各对一段，第 3 站讲康德。';
    expect(reconcileReplyStageCount(text, 4).text).toBe(text);
  });
});

describe('成功标准：只改主线计数，不动原文选段数', () => {
  it('「五段主线」→ 真实阶段数；「四段原文选段」保持', () => {
    const input = {
      success_criteria: {
        observable_result: '能用自己的话讲清五段主线各在追问什么，并读完四段原文选段',
        acceptance_check: '五段主线都能说清',
      },
    };
    const { understanding, changed } = reconcileSuccessCriteriaCount(input, 4);
    expect(understanding.success_criteria.observable_result)
      .toBe('能用自己的话讲清四段主线各在追问什么，并读完四段原文选段');
    expect(understanding.success_criteria.acceptance_check).toBe('四段主线都能说清');
    expect(changed).toBe(2);
  });

  it('没有阶段数或没有成功标准时原样返回', () => {
    const input = { success_criteria: { observable_result: '能讲清各段主线' } };
    expect(reconcileSuccessCriteriaCount(input, null).understanding).toBe(input);
    expect(reconcileSuccessCriteriaCount({}, 4).changed).toBe(0);
  });
});

describe('proposing 快选：确认归确认条，重复项合并', () => {
  it('「就按五站走」这类带数量的放行语也被剔除', () => {
    const { quickReplies, dropped } = reconcileProposingQuickReplies(
      [{ text: '就按五站走' }, { text: '还是三段吧' }, { text: '原文加到四段' }],
      'proposing',
    );
    expect(dropped).toBe(1);
    expect(quickReplies.map((q) => q.text)).toEqual(['还是三段吧', '原文加到四段']);
  });

  it('文本重复（只差标点/空格）只留一个；非 proposing 阶段不动', () => {
    const { quickReplies } = reconcileProposingQuickReplies(
      [{ text: '选段想换一篇' }, { text: '选段想换一篇。' }, { text: '四段比例要调' }],
      'proposing',
    );
    expect(quickReplies.map((q) => q.text)).toEqual(['选段想换一篇', '四段比例要调']);
    const understandingPhase = [{ text: '确认' }];
    expect(reconcileProposingQuickReplies(understandingPhase, 'understanding').quickReplies).toBe(understandingPhase);
  });
});

describe('默认时间假设不冒充用户信息', () => {
  it('source=default 时删掉「未明确，按每次 25 分钟默认」', () => {
    const input = {
      time_dimensions: { sessionsLengthMin: 25, sessionsLengthSource: 'default' },
      available_resources: { time_per_session: '未明确，按每次 25 分钟默认', other: 1 },
      background: { available_time: '平台先按 25 分钟安排' },
    };
    const { understanding, removed } = stripDefaultTimeClaim(input);
    expect(removed).toBe(true);
    expect(understanding.available_resources).toEqual({ other: 1 });
    expect(understanding.background).toEqual({});
    expect(understanding.time_dimensions.sessionsLengthMin).toBe(25);
  });

  it('用户明确给过时长（source=explicit）时保留文本', () => {
    const input = {
      time_dimensions: { sessionsLengthMin: 45, sessionsLengthSource: 'explicit' },
      available_resources: { time_per_session: '每次 45 分钟' },
    };
    expect(stripDefaultTimeClaim(input).understanding).toBe(input);
  });
});

describe('reconcileGoalConversationOutput：一次收敛', () => {
  it('同时修正文计数、成功标准、确认快选与默认时间', () => {
    const result = reconcileGoalConversationOutput({
      reply: '这么一来是五站，正好前四站各对一段。',
      quickReplies: [{ text: '就按五站走' }, { text: '还是三段吧' }],
      understanding: {
        success_criteria: { observable_result: '讲清五段主线', acceptance_check: null },
        time_dimensions: { sessionsLengthSource: 'default', sessionsLengthMin: 25 },
        available_resources: { time_per_session: '未明确，按每次 25 分钟默认' },
      },
      confirmedProposal: FOUR,
      stage: 'proposing',
    });
    expect(result.reply).toContain('这么一来是四站');
    expect(result.understanding.success_criteria.observable_result).toBe('讲清四段主线');
    expect(result.quickReplies.map((q) => q.text)).toEqual(['还是三段吧']);
    expect(result.understanding.available_resources.time_per_session).toBeUndefined();
    expect(result.notes).toMatchObject({
      stageCount: 4,
      replyCountsRewritten: 1,
      criteriaCountsRewritten: 1,
      quickRepliesDropped: 1,
      defaultTimeRemoved: true,
    });
  });

  it('五站结构时不改动一致的数字', () => {
    const result = reconcileGoalConversationOutput({
      reply: '这么一来是五站。',
      quickReplies: [],
      understanding: { success_criteria: { observable_result: '五段主线' } },
      confirmedProposal: FIVE,
      stage: 'proposing',
    });
    expect(result.reply).toBe('这么一来是五站。');
    expect(result.understanding.success_criteria.observable_result).toBe('五段主线');
    expect(result.notes.replyCountsRewritten).toBe(0);
  });
});

describe('接线：parseGoalConversationResponse 出参口生效', () => {
  it('模型一轮里同时数错阶段、写错成功标准、给确认快选 → 出参前已收敛', () => {
    const payload = {
      stage: 'proposing',
      reply: '这么一来是五站，正好前四站各对一段。',
      quickReplies: [{ text: '就按五站走' }, { text: '还是三段吧' }],
      understanding: {
        real_problem: '想系统了解西方哲学',
        success_criteria: { observable_result: '讲清五段主线，读完四段原文选段' },
        time_dimensions: { sessionsLengthMin: 25, sessionsLengthSource: 'default' },
        available_resources: { time_per_session: '未明确，按每次 25 分钟默认' },
      },
      confirmedProposal: {
        learning_direction: '按问题更替走四段',
        first_deliverable: '讲清四段主线',
        out_of_scope: ['中世纪经院'],
        key_stages: ['古希腊', '笛卡尔到休谟', '康德', '二十世纪'],
      },
    };
    const result = parseGoalConversationResponse(JSON.stringify(payload));
    const ext = (result.internal as any).ext.goalConversation;
    expect(result.userVisible).toContain('这么一来是四站');
    expect(ext.understanding.success_criteria.observable_result)
      .toBe('讲清四段主线，读完四段原文选段');
    expect(ext.quickReplies.map((q: any) => q.text)).toEqual(['还是三段吧']);
    expect(ext.understanding.available_resources.time_per_session).toBeUndefined();
  });
});
