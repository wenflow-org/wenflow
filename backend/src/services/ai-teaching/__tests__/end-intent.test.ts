/**
 * 结束意图识别（2026-11-26 真课实录）：学生说「今天就到这里，谢谢。」时，
 * 旧词表只认「结束本节 / 到此结束 / 不学了」这类显式说法，阶段机因此停在审错，
 * 待答检查点也一直挂着（caseA3/12-turn.json：phase=audit、pending 题仍在、shouldConfirmEnd=false）。
 * 这里锁住：最自然的几种告别语要识别，句中「谢谢」不算结束。
 */
import { detectEndIntent } from '../teaching-classroom-flow';

describe('detectEndIntent：自然结束语', () => {
  it.each([
    '今天就到这里，谢谢。',
    '好，今天先到这儿吧',
    '先到这里。',
    '下次再继续',
    '谢谢！',
  ])('识别为结束：%s', (text) => {
    expect(detectEndIntent(text).isEndIntent).toBe(true);
  });

  it.each([
    '谢谢老师，我懂了，继续下一段',
    '今天的学习内容有点多',
    '这道题先到这里推不下去了，卡在第二步',
    '我还没学完',
  ])('不误判：%s', (text) => {
    expect(detectEndIntent(text).isEndIntent).toBe(false);
  });

  it('显式结束说法仍然识别', () => {
    expect(detectEndIntent('我们结束这节课').isEndIntent).toBe(true);
    expect(detectEndIntent('到此结束').isEndIntent).toBe(true);
  });
});
