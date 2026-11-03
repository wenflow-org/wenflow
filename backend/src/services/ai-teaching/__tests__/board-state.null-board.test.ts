/**
 * 无板回合的正向告知（2026-11-03 心理学走查 S3-3 的收口）。
 *
 * 这句「本任务暂无板书」原先就写好了，却因调用点的 `if (board)` 守卫成了不可达分支——
 * 无板回合模型收不到任何"本轮没有板"的信号，于是自己假设有一块板并描述它的排布
 * （一手「两栏」、一手「两个圈」）。现在引擎每轮都注入，提示词判据也改为按内容判
 * （prompts/core/teaching-turn.yaml rule15），这里锁的是句子本身与签名放宽。
 */
import { describeBoardForTeacher, openBoard } from '../board-state';

describe('describeBoardForTeacher：无板回合的正向告知', () => {
  it('board 为 null/undefined 时返回「暂无板书」句（不再是不可能到达的死分支）', () => {
    for (const board of [null, undefined]) {
      const text = describeBoardForTeacher(board as never);
      expect(text).toContain('本任务暂无板书');
      expect(text).toContain('不要提及或假设任何图');
    }
  });

  it('figure 为 null 的 BoardState 同样得到「暂无板书」句（既有行为不变）', () => {
    const text = describeBoardForTeacher({ taskId: 't', figure: null, revision: 0 });
    expect(text).toContain('本任务暂无板书');
  });

  it('有板时仍然是「白板」开头的板书描述，不是暂无板书句', () => {
    const board = openBoard('t', {
      kind: 'split-compare',
      spec: {
        title: '两种解释',
        left: { head: '常识解释', rows: [{ label: '懒、不上心' }] },
        right: { head: '心理学解释', rows: [{ label: '条件、可推翻' }] },
      },
    });
    const text = describeBoardForTeacher(board);
    expect(text).toContain('白板');
    expect(text).not.toContain('本任务暂无板书');
  });
});
