/**
 * 伴学触发判定单测（2026-09-25 设计调整）：
 * ① helpKeywords 收紧——「怎么/为什么」几乎逢问必中，删去（真课实测两轮两弹）；
 * ② 会话内冷却——最近 N 条老师消息已带 peerMessage 则不再自动触发（model-control 越过冷却）。
 *
 * 2026-10-07 追加（P1-14 修复①②）：
 * ③ 关键词不再裸子串——「会不会/是不是」式反问语气不命中（生产实证 pcl 1791288425961）；
 * ④ 老师本轮在布置独立作业/等学生作答时，自动触发一律让路（model-control 除外）。
 */
import { PeerTriggerService, hasHelpSignal, detectAwaitingLearnerWork } from '../PeerTriggerService';
import type { TeachingSessionRecord } from '../TeachingSessionRepository';

const service = new PeerTriggerService();

type Msg = Partial<TeachingSessionRecord['messages'][number]> & { role: string; content: string };

function sessionWith(messages: Msg[]): TeachingSessionRecord {
  return { id: 'teaching_test', messages } as unknown as TeachingSessionRecord;
}

function output(overrides: Record<string, unknown> = {}) {
  return {
    control: { shouldTriggerPeer: false },
    analysis: { understanding: 0.8, cognitiveLevel: 'understand' },
    ...overrides,
  } as Parameters<PeerTriggerService['shouldTrigger']>[1];
}

describe('PeerTriggerService（伴学触发）', () => {
  it('含「怎么/为什么」的普通提问不再触发（关键词收紧后）', () => {
    const session = sessionWith([{ role: 'assistant', content: '老师讲解' }]);
    expect(service.shouldTrigger(session, output(), '这个怎么流动？为什么珍珠会沉底？')).toBe(false);
  });

  it('显式求助词仍触发', () => {
    const session = sessionWith([{ role: 'assistant', content: '老师讲解' }]);
    expect(service.shouldTrigger(session, output(), '这里我搞不懂，帮我讲讲')).toBe(true);
  });

  it('冷却：最近 2 条老师消息已带 peerMessage → 不触发；冷却期过后恢复', () => {
    const inCooldown = sessionWith([
      { role: 'assistant', content: '带插话的老师消息', peerMessage: '小启插话' },
      { role: 'user', content: '学生回应' },
      { role: 'assistant', content: '老师最新讲解' },
    ]);
    expect(service.shouldTrigger(inCooldown, output(), '我搞不懂这一步')).toBe(false);

    const cooled = sessionWith([
      { role: 'assistant', content: '带插话的老师消息', peerMessage: '小启插话' },
      { role: 'user', content: '学生回应' },
      { role: 'assistant', content: '老师讲解一' },
      { role: 'user', content: '学生回应' },
      { role: 'assistant', content: '老师讲解二' },
    ]);
    expect(service.shouldTrigger(cooled, output(), '我搞不懂这一步')).toBe(true);
  });

  it('model-control 越过冷却（教学模型显式要求）', () => {
    const inCooldown = sessionWith([
      { role: 'assistant', content: '带插话的老师消息', peerMessage: '小启插话' },
      { role: 'assistant', content: '老师最新讲解' },
    ]);
    expect(service.shouldTrigger(inCooldown, output({ control: { shouldTriggerPeer: true } }), '继续')).toBe(true);
  });
});

/**
 * P1-14 修复①：helpKeywords 语境判据（不再裸子串）。
 * 生产实证（prompt_call_logs 1791288425961）：学生「你看我会不会又把三行挤成一行」的
 * 子串「不会」曾命中 help-keyword 路径触发伴学。
 *
 * 2026-10-07 复核修订：只排除「X不X」正反问框架（会不会/懂不懂/明白不明白）。
 * 早前一版按"左邻单字 ∈ 会/要/能/是/该"作废命中，把「需要帮助」「能帮助我吗」
 * 「我还是不懂」「还是不会」等常见真求助一起静默丢弃（全量 4717 条伴学行中 164 条），
 * 本组用例把该回归面钉住。
 */
describe('PeerTriggerService：求助词语境判据（P1-14 修复①）', () => {
  // pcl 实录同型样本：学生消息含「不会」子串，但是「会不会」反问语气
  const PCL_STUDENT_MESSAGE =
    '老师你这么一夸我有点虚——刚才那题我是知道最后要落 SAS，才倒着把那个角塞进去的。 下一道能不能先别告诉我用哪个判定，让我自己写一遍，你看我会不会又把三行挤成一行、对应边也不交代。';

  it('「会不会…」反问语气不再命中（实录原句）', () => {
    expect(hasHelpSignal(PCL_STUDENT_MESSAGE)).toBe(false);
  });

  it('同族「X不X」正反问：懂不懂 / 明白不明白 不命中（关键词自身的重叠式）', () => {
    expect(hasHelpSignal('你懂不懂这个')).toBe(false);
    expect(hasHelpSignal('我明白不明白这一步')).toBe(false);
    expect(hasHelpSignal('会不会又要重写')).toBe(false);
  });

  it('不含关键词的疑问语气本就不命中（要不要 / 能不能 / 是不是）', () => {
    expect(hasHelpSignal('我是不是又漏了对应边？')).toBe(false);
    expect(hasHelpSignal('我要不要再检查一遍')).toBe(false);
    expect(hasHelpSignal('这题能不能这样做')).toBe(false);
  });

  it('「该不会」保留为命中（自述不确定；审计只要求排除 会不会/要不要 类，不扩面）', () => {
    expect(hasHelpSignal('这题该不会要用到垂直吧')).toBe(true);
  });

  it('常见真求助不被误杀（复核回归面：需要帮助 / 能帮助我 / 还是不懂 / 还是不会）', () => {
    expect(hasHelpSignal('我需要帮助')).toBe(true);
    expect(hasHelpSignal('能帮助我吗')).toBe(true);
    expect(hasHelpSignal('老师能帮助我一下吗')).toBe(true);
    expect(hasHelpSignal('我还是不懂，为什么要 total = total + score？不能直接加吗？感觉好绕')).toBe(true);
    expect(hasHelpSignal('下次换个药还是不会推')).toBe(true);
    expect(hasHelpSignal('老师我不会做这道题')).toBe(true);
  });

  it('基础求助词仍命中（我搞不懂 / 这题我不会 / 不明白）', () => {
    // 注意：命中来自「搞不懂」而非「帮我讲讲」——「帮我讲讲」不含任何 helpKeyword（修复前后都 false）。
    expect(hasHelpSignal('这里我搞不懂，帮我讲讲')).toBe(true);
    expect(hasHelpSignal('这道题我不会做')).toBe(true);
    expect(hasHelpSignal('不明白为什么要写公共边')).toBe(true);
    expect(hasHelpSignal('不会就是不会')).toBe(true); // 句首出现：无正反问前缀
  });

  it('一次正反问 + 一次真求助并存 → 命中（不因反问把真求助一起作废）', () => {
    expect(hasHelpSignal('我会不会写错了？说实话这一步我搞不懂')).toBe(true);
  });

  it('触发判定同口径：实录同型样本 + 老师未布置作业时不误触发', () => {
    const session = sessionWith([{ role: 'assistant', content: '上一轮老师讲解' }]);
    const reply = '对，这一栏填的是具体的几何量。';
    expect(service.shouldTrigger(session, output({ reply }), PCL_STUDENT_MESSAGE)).toBe(false);
  });
});

/**
 * P1-14 修复②：老师本轮在布置独立作业/等学生作答时，自动触发一律让路。
 * 生产实证（pcl 1791288425961）：老师「下一题我完全不给提示，你自己从头写」时伴学把证明关键步骤递了出去。
 */
describe('PeerTriggerService：等待作答态让路（P1-14 修复②）', () => {
  // pcl 实录同型样本：老师回复原文（含"完全不给提示""你自己从头写""发给我"）
  const PCL_TUTOR_REPLY =
    '你刚才那句"我知道最后要落SAS，才倒着把那个角塞进去"非常诚实，这说明你的眼睛和脑子已经能区分"缺口"和"工具"了。\n\n'
    + '下一题我完全不给提示，你自己从头写。题目："如图，点D在BC上，且 BD=CD，AD 垂直于 BC。求证：∠B = ∠C。"\n\n'
    + '直接把你打算写的那几行发给我。';

  it('判据命中实录老师回复（不给提示 + 你自己从头写 + 发给我）', () => {
    const result = detectAwaitingLearnerWork(PCL_TUTOR_REPLY);
    expect(result.awaiting).toBe(true);
    expect(result.reason).toBe('no-hint-instruction');
  });

  it('实录同型样本：学生含「不会」子串 + 老师布置独立作业 → 伴学不被触发', () => {
    const session = sessionWith([{ role: 'assistant', content: '上一轮老师讲解' }]);
    const studentMessage = '老师你这么一夸我有点虚——你看我会不会又把三行挤成一行、对应边也不交代。';
    expect(service.shouldTrigger(session, output({ reply: PCL_TUTOR_REPLY }), studentMessage)).toBe(false);
  });

  it('即使学生消息是真求助（我搞不懂），老师等作答时也让路', () => {
    const session = sessionWith([{ role: 'assistant', content: '上一轮老师讲解' }]);
    expect(service.shouldTrigger(session, output({ reply: '先自己写一遍，写完整理好发给我。' }), '我搞不懂这一步')).toBe(false);
  });

  it('老师已给出反馈（不在等作答）时，真求助仍触发', () => {
    const session = sessionWith([{ role: 'assistant', content: '上一轮老师讲解' }]);
    expect(service.shouldTrigger(session, output({ reply: '对，这一栏填的是具体的几何量。' }), '这里我搞不懂')).toBe(true);
  });

  it('model-control 越过等待作答态（教学模型本轮显式要求）', () => {
    const session = sessionWith([{ role: 'assistant', content: '上一轮老师讲解' }]);
    expect(
      service.shouldTrigger(session, output({ control: { shouldTriggerPeer: true }, reply: PCL_TUTOR_REPLY }), '继续'),
    ).toBe(true);
  });

  it('普通讲解/提问不带独立作业信号时不命中（不因有问号就判等待）', () => {
    expect(detectAwaitingLearnerWork('这一栏要填的是缺口元素，也就是具体的几何量。').awaiting).toBe(false);
    expect(detectAwaitingLearnerWork('你觉得第 3 栏应该填什么？').awaiting).toBe(false);
    expect(detectAwaitingLearnerWork('').awaiting).toBe(false);
    expect(detectAwaitingLearnerWork(null).awaiting).toBe(false);
  });
});
