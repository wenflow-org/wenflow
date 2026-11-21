/**
 * 课末终检题的展示层规则（2026-11-19）：
 * 终检轮只允许一个待答问题——模型回复末尾若还有自己的追问，必须撤掉，
 * 否则学生（尤其模拟学习者）会去答前一个问题，终检被记成「空作答」。
 */
import { appendExitTicketToReply } from '../teaching-turn-engine';
import { gradePendingExitTicket, isExitTicketFormatMiss } from '../teaching-turn-preparation';
import type { ExitTicket } from '../lesson-contract';

const ticket: ExitTicket = {
  id: 'et-1',
  question: '某公司本年营业收入 5000 万、收现 4600 万，应收增加 600 万、合同负债减少 200 万，差额怎么解释？',
  type: 'single_choice',
  options: [
    { id: 'A', text: '收现少 400 万' },
    { id: 'B', text: '收现少 800 万' },
  ],
  correctOptionIds: ['B'],
  conceptName: '定位收入在三表上的落点',
  askedAt: '2026-11-19T00:00:00.000Z',
  status: 'pending',
  attempts: 1,
};

describe('appendExitTicketToReply', () => {
  it('回复末尾的自带追问被撤掉，只留终检一题', () => {
    const output = {
      reply: '这节课你把三表关系串起来了。\n\n再想一下：合同负债减少对收现是往上还是往下？',
    };
    appendExitTicketToReply(output, ticket);
    expect(output.reply).not.toContain('再想一下');
    expect(output.reply).toContain('这节课你把三表关系串起来了。');
    expect(output.reply).toContain(ticket.question);
    expect(output.reply).toContain('回复选项字母即可');
  });

  it('回复没有追问时保留原内容，再追加终检', () => {
    const output = { reply: '这节课的重点是三表勾稽。' };
    appendExitTicketToReply(output, ticket);
    expect(output.reply).toContain('这节课的重点是三表勾稽。');
    expect(output.reply).toContain(ticket.question);
  });

  it('题面已在回复里时不重复追加', () => {
    const output = { reply: `最后一道题：${ticket.question}` };
    appendExitTicketToReply(output, ticket);
    expect(output.reply.match(new RegExp(ticket.question.slice(0, 20), 'g'))?.length).toBe(1);
  });

  it('选择题必须列出选项原文，不能只问「回复选项字母」', () => {
    const output = { reply: '这节课的重点是三表勾稽。' };
    appendExitTicketToReply(output, ticket);
    expect(output.reply).toContain('A. 收现少 400 万');
    expect(output.reply).toContain('B. 收现少 800 万');
    expect(output.reply.indexOf('A. 收现少 400 万')).toBeLessThan(output.reply.indexOf('回复选项字母即可'));
  });
});

describe('gradePendingExitTicket 格式未识别', () => {
  const failedEmpty = (id: string, attempt: number): ExitTicket => ({
    ...ticket,
    id,
    status: 'failed',
    passed: false,
    attempts: attempt,
    answerExcerpt: '两列都会互换：按位置拼，部门列的文本会落进人数列。',
    detail: '选项集合不一致（正确 A，作答 空）',
  });

  it('整句作答、未带选项字母：保持 pending，不判负、不消耗次数，并触发重贴题面', () => {
    const result = gradePendingExitTicket({
      exitTicketState: ticket,
      exitTicketHistory: [],
      message: '两列都会互换：按位置拼，部门列的文本会落进人数列。',
    });
    expect(result.formatMiss).toBe(true);
    expect(result.graded).toBe(false);
    expect(result.state?.status).toBe('pending');
    expect(result.attempts).toBe(0);
    expect(result.history).toHaveLength(0);
  });

  it('历史里的「作答 空」不计入失败次数，不会把终检额度耗成死局', () => {
    expect(isExitTicketFormatMiss(failedEmpty('et-0', 1))).toBe(true);
    const result = gradePendingExitTicket({
      exitTicketState: failedEmpty('et-2', 2),
      exitTicketHistory: [failedEmpty('et-1', 1), failedEmpty('et-2', 2)],
      message: '继续',
    });
    expect(result.attempts).toBe(0);
  });

  it('废弃已发出的多答案单选题，且不扣作答次数', () => {
    const invalid = { ...ticket, correctOptionIds: ['A', 'B'] };
    expect(gradePendingExitTicket({ exitTicketState: invalid, exitTicketHistory: [invalid], message: 'A' }))
      .toMatchObject({ state: null, history: [], attempts: 0, graded: false, verdict: null });
  });

  it('真正选了错误选项仍计一次失败', () => {
    const result = gradePendingExitTicket({
      exitTicketState: ticket,
      exitTicketHistory: [failedEmpty('et-0', 1)],
      message: 'A',
    });
    expect(result.formatMiss).toBe(false);
    expect(result.graded).toBe(true);
    expect(result.state?.status).toBe('failed');
    expect(result.attempts).toBe(1);
  });
});
