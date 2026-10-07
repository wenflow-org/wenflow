/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * P1-14 修复③ + P2-11：独立作业进行中不得给解题钥匙 / 伴学历史转发。
 *
 * 本文件刻意只从**可直接加载**的模块取被测函数（teaching-session-views / skills/peer-reinforcement）：
 * 触发判定的钉测在 peer-trigger-service.test.ts，策略与载荷层的钉测在此。
 *
 * 生产实证链（prompt_call_logs 1791288425961，2026-10-06）：
 * - 同轮 teaching-turn（1791288423304）shouldTriggerPeer=false、understanding=0.85 ⇒ 只剩 help-keyword 路径；
 * - 学生消息「你看我会**不会**又把三行挤成一行」的裸子串「不会」命中 helpKeywords；
 * - pickPeerStrategy 仅按 cognitiveLevel=apply 盲选 counterexample，不看老师已布置独立作业；
 * - 伴学实际输出即该独立证明题的关键步骤（AD⊥BC→直角→与全等判定的关系）+ 去条件追问。
 *
 * P2-11：引擎主路径 peerInput 无 peerHistory，4879 条中 userPayload 含【此前伴学对话】0 条，
 * 规则 11「连续 3 问无进展即收手」的 3 问预算不可达。
 */
const mockCallPrompt = jest.fn();

jest.mock('../../../composers/prompt-composer', () => ({
  callPrompt: mockCallPrompt,
}));

import { pickPeerStrategy, collectPeerHistory } from '../teaching-session-views';
import { executePeerDiscussion, resolveEffectivePeerStrategy } from '../../../skills/peer-reinforcement';

const PCL_TUTOR_REPLY =
  '下一题我完全不给提示，你自己从头写。题目："如图，点D在BC上，且 BD=CD，AD 垂直于 BC。求证：∠B = ∠C。"\n\n'
  + '直接把你打算写的那几行发给我。';

const SUCCESS_RESULT = {
  success: true,
  output: { message: '你先自己写，写完咱俩对一对。', followUpQuestions: [] },
  runtimeEnvelope: { stub: true },
  debug: { attempts: [{ attempt: 1, status: 'success' }] },
};

describe('伴学策略：独立作业进行中不得给解题钥匙（P1-14 修复③）', () => {
  it('实录同型样本：apply + 老师布置独立作业 → encourage（不再盲选 counterexample）', () => {
    expect(pickPeerStrategy('apply', { tutorLatestReply: PCL_TUTOR_REPLY })).toBe('encourage');
  });

  it('analyze/understand 在等待作答时同样降级', () => {
    expect(pickPeerStrategy('analyze', { tutorLatestReply: '先自己写一遍，写完整理好发给我。' })).toBe('encourage');
    expect(pickPeerStrategy('understand', { tutorLatestReply: '你自己从头推一遍看看。' })).toBe('encourage');
  });

  it('老师已给反馈（不在等作答）时按层级正常派策略', () => {
    const reply = '对，这一栏填的是具体的几何量。';
    expect(pickPeerStrategy('apply', { tutorLatestReply: reply })).toBe('counterexample');
    expect(pickPeerStrategy('analyze', { tutorLatestReply: reply })).toBe('debate');
  });

  it('未提供 tutorLatestReply 时保持既有行为（向后兼容两个调用方）', () => {
    expect(pickPeerStrategy('apply')).toBe('counterexample');
    expect(pickPeerStrategy('analyze', {})).toBe('debate');
    expect(pickPeerStrategy('understand', { tutorLatestReply: null })).toBe('analogy');
  });
});

describe('伴学载荷：独立作业进行中【策略要求】降级为鼓励式（P1-14 修复③）', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCallPrompt.mockResolvedValue(SUCCESS_RESULT);
  });

  it('老师布置独立作业时：载荷策略降级 encourage、无解题线索、带【本轮禁令】', async () => {
    const input = {
      topic: '照示范仿写基础全等证明并逐行注明依据',
      strategy: 'counterexample' as const,
      studentMessage: '你看我会不会又把三行挤成一行',
      tutorLatestReply: PCL_TUTOR_REPLY,
      tutorContext: [],
      cognitiveLevel: 'apply',
      understanding: 0.85,
    };
    const result = await executePeerDiscussion(input as any);
    const [spec] = mockCallPrompt.mock.calls[0];
    const payload = spec.buildUserPayload(input, {});

    // 代码门：即便调用方仍传 counterexample，载荷侧也降级为 encourage
    expect(payload).toContain('【策略】encourage');
    // 回显/落库/前端状态与实际下发的手法一致（复核指出 chat 路径曾分裂）：
    // executePeerDiscussion 返回值、mapEnvelope、handler 都走 resolveEffectivePeerStrategy。
    expect(result.strategy).toBe('encourage');
    expect(resolveEffectivePeerStrategy(input as any)).toBe('encourage');
    expect(payload).not.toContain('【策略】counterexample');
    // 不得给反例/边界线索
    expect(payload).not.toContain('请给一个边界情况或反例');
    // 显式禁令（优先于【策略要求】）
    expect(payload).toContain('【本轮禁令】');
    expect(payload).toContain('不得给出任何线索');
  });

  it('老师不在等作答时：载荷策略与【策略要求】照旧', async () => {
    const input = {
      topic: '闭包',
      strategy: 'counterexample' as const,
      tutorLatestReply: '对，这一栏填的是具体的几何量。',
      tutorContext: [],
    };
    await executePeerDiscussion(input as any);
    const [spec] = mockCallPrompt.mock.calls[0];
    const payload = spec.buildUserPayload(input, {});

    expect(payload).toContain('【策略】counterexample');
    expect(payload).toContain('请给一个边界情况或反例');
    expect(payload).not.toContain('【本轮禁令】');
  });
});

describe('伴学历史转发 collectPeerHistory（P2-11）', () => {
  it('从 peer 标记消息恢复（与聊天路径 teaching-session-ops.ts:638-641 同口径）', () => {
    const history = collectPeerHistory([
      { role: 'user', content: '学生问' },
      { role: 'user', content: '小启我懂了', peer: true },
      { role: 'assistant', content: '那你说说看', peer: true },
    ]);
    expect(history).toEqual([
      { role: 'user', content: '小启我懂了' },
      { role: 'assistant', content: '那你说说看' },
    ]);
  });

  it('恢复引擎内嵌插话（老师消息的 peerMessage 旁挂字段），只取伴学那一边', () => {
    const history = collectPeerHistory([
      { role: 'assistant', content: '老师本轮回复原文', peerMessage: '小启：先说说你的直觉' },
      { role: 'user', content: '学生回答' },
    ]);
    expect(history).toEqual([{ role: 'assistant', content: '小启：先说说你的直觉' }]);
    // 老师原文不得混入伴学历史（否则会被当成伴学说过的话）
    expect(history.some((m) => m.content === '老师本轮回复原文')).toBe(false);
  });

  it('无伴学历史 → 空数组（规则 11 据此不凭空假设追问次数）', () => {
    expect(collectPeerHistory([{ role: 'user', content: 'x' }, { role: 'assistant', content: 'y' }])).toEqual([]);
    expect(collectPeerHistory([])).toEqual([]);
    expect(collectPeerHistory(undefined as any)).toEqual([]);
  });

  it('peerMessage 为空串/null 时不入历史（不伪造伴学发过空话）', () => {
    expect(collectPeerHistory([
      { role: 'assistant', content: 'a', peerMessage: '' },
      { role: 'assistant', content: 'b', peerMessage: null },
      { role: 'assistant', content: 'c', peerMessage: '   ' },
    ])).toEqual([]);
  });

  it('载荷含【此前伴学对话】分区（转发后规则 11 的 3 问预算可达）', async () => {
    jest.clearAllMocks();
    mockCallPrompt.mockResolvedValue(SUCCESS_RESULT);
    const input = {
      topic: '闭包',
      strategy: 'analogy' as const,
      tutorContext: [],
      peerHistory: [
        { role: 'assistant', content: '第一个追问：它引用了谁？' },
        { role: 'user', content: '外部变量' },
        { role: 'assistant', content: '第二个追问：那它活多久？' },
      ],
    };
    await executePeerDiscussion(input as any);
    const [spec] = mockCallPrompt.mock.calls[0];
    const payload = spec.buildUserPayload(input, {});
    expect(payload).toContain('【此前伴学对话】');
    expect(payload).toContain('伴学伙伴: 第二个追问：那它活多久？');
  });
});