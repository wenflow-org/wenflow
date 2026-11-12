/**
 * 板书截断可见性（2026-11-12）：state-strip 帧数超上限被归一化截掉时，spec 带
 * `truncatedFrames`，describeBoardForTeacher 必须向模型显式声明「这是系统截断」。
 *
 * 实测事故：8 轮对话的板书被截成 5 帧后，boardContext 只描述 5 帧，模型把系统自己的
 * 截断归因成「学生误以为板书只有五轮」并写进卡点——学生看到的确实是 5 帧，归因与
 * 事实相反。截断一旦发生，老师（模型）看到的画面说明里必须带上这一点。
 */
import { describeBoardForTeacher, type BoardState } from '../board-state';

function stripBoard(spec: Record<string, unknown>): BoardState {
  return {
    taskId: 't1',
    revision: 1,
    lastReveal: null,
    figure: {
      kind: 'state-strip',
      fullSpec: spec,
      maskedSpec: spec,
      hiddenTakeaway: null,
      slots: 0,
      conceal: 'none',
      stage: 'revealed',
      focusId: null,
    },
  };
}

const EIGHT_FRAMES = ['轮1', '轮2', '轮3', '轮4', '轮5', '轮6', '轮7', '轮8']
  .map((label) => ({ label, items: [`${label} 的状态`] }));

describe('describeBoardForTeacher · 截断可见性', () => {
  it('spec 带 truncatedFrames → 描述里显式声明系统截断，禁止归因给学习者', () => {
    const text = describeBoardForTeacher(stripBoard({
      title: '八轮对话逐帧摆开',
      frames: EIGHT_FRAMES,
      truncatedFrames: 1,
    }));
    expect(text).toContain('系统');
    expect(text).toContain('1 帧被系统截掉');
    expect(text).toContain('不要据此推断');
  });

  it('未截断的板书不带截断声明', () => {
    const text = describeBoardForTeacher(stripBoard({
      title: 'TCP 三次握手',
      frames: EIGHT_FRAMES.slice(0, 3),
    }));
    expect(text).not.toContain('截掉');
  });
});
