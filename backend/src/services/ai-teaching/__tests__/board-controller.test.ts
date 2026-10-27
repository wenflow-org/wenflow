/* eslint-disable @typescript-eslint/no-explicit-any -- 测试内构造板状态 */
/**
 * 板书状态机（2026-10-27）：这一轮白板做什么动作。
 *
 * 动作空间只有五个：建板 / 揭晓 / 指板 / 不动（纠错覆盖由 focus 承载）。
 * 判据全部来自代码事实，模型不参与决定。
 */
import { decideBoardOp, applyBoardOp, describeBoardOp } from '../board-controller';
import { openBoard } from '../board-state';

const figure = {
  kind: 'split-compare',
  spec: {
    left: { head: '错', rows: [{ label: '60 ÷ 400' }] },
    right: { head: '对', rows: [{ label: '1 ÷ 0.4' }] },
    delta: { label: '先换算', at: 1 },
  },
};

const awaiting = openBoard('task-1', figure);
const revealed = { ...awaiting, figure: { ...awaiting.figure!, stage: 'revealed' as const } };

describe('board-controller：动作决策', () => {
  it('首轮 + 有板书意愿 → 建板', () => {
    expect(
      decideBoardOp({ board: null, firstTurnOfTask: true, taskChanged: false, wantsNewBoard: true }),
    ).toEqual({ type: 'setup', reason: 'first-turn' });
  });

  it('换任务 → 换板（即使已有旧板）', () => {
    expect(
      decideBoardOp({ board: revealed, firstTurnOfTask: false, taskChanged: true, wantsNewBoard: true }),
    ).toEqual({ type: 'setup', reason: 'task-changed' });
  });

  it('无板书意愿且无板 → 不动（纯语言推进）', () => {
    expect(
      decideBoardOp({ board: null, firstTurnOfTask: true, taskChanged: false, wantsNewBoard: false }),
    ).toEqual({ type: 'none', reason: 'no-board' });
  });

  it('提问态 + 检查点通过 → 揭晓', () => {
    const op = decideBoardOp({
      board: awaiting, firstTurnOfTask: false, taskChanged: false, wantsNewBoard: false,
      checkpointVerdict: { passed: true },
    });
    expect(op.type).toBe('reveal');
  });

  it('提问态 + 学生补上空槽 → 揭晓', () => {
    const op = decideBoardOp({
      board: awaiting, firstTurnOfTask: false, taskChanged: false, wantsNewBoard: false, filledSlot: true,
    });
    expect(op.type).toBe('reveal');
  });

  it('提问态 + 答错 → 只指板，不揭晓也不重挖', () => {
    const op = decideBoardOp({
      board: awaiting, firstTurnOfTask: false, taskChanged: false, wantsNewBoard: false,
      checkpointVerdict: { passed: false, detail: '缺单位' },
    });
    expect(op.type).toBe('focus');
    expect((op as any).reason).toBe('awaiting-answer');
  });

  it('提问态 + 误解 → 指板（把注意力引回空槽）', () => {
    const op = decideBoardOp({
      board: awaiting, firstTurnOfTask: false, taskChanged: false, wantsNewBoard: false, misconception: true,
    });
    expect(op).toEqual({ type: 'focus', target: null, reason: 'misconception' });
  });

  it('已揭晓 + 无新信号 → 不动（不把学会的东西重新藏起来）', () => {
    expect(
      decideBoardOp({ board: revealed, firstTurnOfTask: false, taskChanged: false, wantsNewBoard: false }),
    ).toEqual({ type: 'none', reason: 'revealed-already' });
  });

  it('已揭晓 + 新误解 → 指板，不改内容', () => {
    const op = decideBoardOp({
      board: revealed, firstTurnOfTask: false, taskChanged: false, wantsNewBoard: false, misconception: true,
    });
    expect(op.type).toBe('focus');
  });
});

describe('board-controller：动作落地', () => {
  it('揭晓动作让同一块板升版并记录揭晓摘要', () => {
    const next = applyBoardOp(awaiting, { type: 'reveal', summary: '学生答对了' })!;
    expect(next.figure!.stage).toBe('revealed');
    expect(next.revision).toBe(awaiting.revision + 1);
    expect(next.lastReveal!.summary).toBe('学生答对了');
  });

  it('指板动作只改焦点，不改阶段', () => {
    const next = applyBoardOp(awaiting, { type: 'focus', target: 'right.rows[0]', reason: 'awaiting-answer' })!;
    expect(next.figure!.stage).toBe('awaiting');
    expect(next.figure!.focusId).toBe('right.rows[0]');
  });

  it('每种动作都有给老师的一句话（reply 可以自然承接）', () => {
    const texts = [
      describeBoardOp({ type: 'setup', reason: 'first-turn' }),
      describeBoardOp({ type: 'reveal' }),
      describeBoardOp({ type: 'focus', target: null, reason: 'awaiting-answer' }),
      describeBoardOp({ type: 'none', reason: 'no-board' }),
    ];
    texts.forEach((t) => expect(t.length).toBeGreaterThan(4));
  });
});
