import { computeLearnerShortAckStreak } from '../teaching-turn-engine';

/**
 * 学员短确认连续计数（修复批 13-②，repetitive_closure_loop）：
 * 任务宣布结束后教师反复重发同一作业指令、学员只会「马上去/好」——短确认 ×2 + 教师低增量
 * 即为收口条件（u01 六轮、u04 十轮实证）。任一较长/含问句的学员回合打断计数。
 */
describe('computeLearnerShortAckStreak（学员短确认收口）', () => {
  it('病历单形态：连续短确认（马上去/好/收到）计数', () => {
    const messages = [
      { role: 'assistant', content: '四句的判法你都过了，把原句贴上来核对一遍就收工。' },
      { role: 'user', content: '马上去' },
      { role: 'assistant', content: '好，贴上来我帮你看。' },
      { role: 'user', content: '好' },
      { role: 'assistant', content: '嗯，就按这个走。' },
      { role: 'user', content: '收到' },
    ];
    expect(computeLearnerShortAckStreak(messages as any)).toBe(3);
  });

  it('较长/实质回合打断计数', () => {
    const messages = [
      { role: 'user', content: '马上去' },
      { role: 'user', content: '我这就按这个口径把三条线都走一遍再贴给你' },
    ];
    expect(computeLearnerShortAckStreak(messages as any)).toBe(0);
  });

  it('问句打断计数；教师回合不参与计数', () => {
    const messages = [
      { role: 'assistant', content: '还有哪里拿不准？' },
      { role: 'user', content: '补偿那格还是不太懂，能再讲一遍吗？' },
      { role: 'assistant', content: '行，我再讲一遍。' },
      { role: 'user', content: '好' },
    ];
    expect(computeLearnerShortAckStreak(messages as any)).toBe(1);
  });

  it('空消息/无学员回合 → 0', () => {
    expect(computeLearnerShortAckStreak([] as any)).toBe(0);
    expect(computeLearnerShortAckStreak([{ role: 'assistant', content: '上课了' }] as any)).toBe(0);
  });
});
