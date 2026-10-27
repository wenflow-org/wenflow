/**
 * 板书控制器（2026-10-27 白板改造）：决定「这一轮白板做什么动作」。
 *
 * 为什么必须是确定性状态机而不是让模型自己决定：
 *   V8 之前每轮由模型决定「要不要画」，结果是刷屏 + 重复 + 泄题三件套。
 *   白板模式下动作空间很小（建板 / 揭晓 / 指板 / 纠错覆盖 / 不动），
 *   判据全部来自代码已有的事实：是否首轮、任务是否换了、检查点是否通过、学生是否补上了空槽。
 *
 * 与 board-state.ts 的分工：那边算「板上长什么样」，这边决定「这一轮对板做什么」。
 */

import type { BoardStage, BoardState } from './board-state';
import { revealBoard, focusBoard } from './board-state';

export type BoardOp =
  /** 换任务/首轮且需要板书：新开一块板（提问态） */
  | { type: 'setup'; reason: 'first-turn' | 'task-changed' }
  /** 学生补上了空槽 / 检查点通过：同一块板切到完整态（补上答案与结论） */
  | { type: 'reveal'; summary?: string }
  /** 学生还没答到点上：只移动焦点，把注意力引回那个空槽，不新建、不揭晓 */
  | { type: 'focus'; target: string | null; reason: 'awaiting-answer' | 'misconception' }
  /** 什么都没变：保持现状（老师纯用语言推进） */
  | { type: 'none'; reason: 'no-board' | 'revealed-already' | 'no-signal' };

export interface BoardSignals {
  /** 会话里已有的板（无板为 null） */
  board: BoardState | null;
  /** 本轮是否为该任务的第一个回合 */
  firstTurnOfTask: boolean;
  /** 当前任务是否与板上任务不同（换了知识点/任务） */
  taskChanged: boolean;
  /** 本轮是否值得为任务新建板书（由图型路由/任务结构判定，沿用 buildVisualOpportunity 的结论） */
  wantsNewBoard: boolean;
  /** 检查点作答的代码裁决（学生答对 = 板上该揭晓了） */
  checkpointVerdict?: { passed: boolean; detail?: string | null } | null;
  /** 学生本轮发言是否补上了板上的空槽（由关键词/答案键比对得出） */
  filledSlot?: boolean;
  /** 本轮是否识别到学生的典型误解（用于把焦点引到对应空槽） */
  misconception?: boolean;
}

/**
 * 动作优先级（越靠前越「板上真的该变了」）：
 *   换任务 → 建板；答对/补上 → 揭晓；还没答到 → 指板；否则不动。
 * 注意：已揭晓的板不会为了「再问一次」而重新挖空——重新挖空等于把已经学会的东西再藏起来。
 */
export function decideBoardOp(signals: BoardSignals): BoardOp {
  const { board } = signals;
  const stage: BoardStage | null = board?.figure?.stage ?? null;

  if (signals.taskChanged || (!board?.figure && signals.firstTurnOfTask && signals.wantsNewBoard)) {
    return { type: 'setup', reason: signals.taskChanged ? 'task-changed' : 'first-turn' };
  }
  if (!board?.figure) return { type: 'none', reason: 'no-board' };

  if (stage !== 'revealed') {
    const passed = signals.checkpointVerdict?.passed === true;
    if (passed || signals.filledSlot) {
      return {
        type: 'reveal',
        summary: signals.checkpointVerdict?.passed ? '学生答对了检查点' : '学生补上了空槽',
      };
    }
    if (signals.misconception) {
      return { type: 'focus', target: board.figure.focusId ?? null, reason: 'misconception' };
    }
    return { type: 'focus', target: board.figure.focusId ?? null, reason: 'awaiting-answer' };
  }

  // 已揭晓：只在学生有新误解时把焦点拉回板上（提示「板上已经是完整的，对照着看」）
  if (signals.misconception) {
    return { type: 'focus', target: board.figure.focusId ?? null, reason: 'misconception' };
  }
  return { type: 'none', reason: 'revealed-already' };
}

/** 把动作应用到板上，返回新板（setup 需要外部先构造好 figure，见 openBoard） */
export function applyBoardOp(board: BoardState | null, op: BoardOp): BoardState | null {
  if (!board) return board;
  if (op.type === 'reveal') return revealBoard(board, op.summary);
  if (op.type === 'focus') return focusBoard(board, op.target);
  return board;
}

/** 给老师的一句话：本轮白板动了什么（让 reply 可以自然承接，而不用复述图） */
export function describeBoardOp(op: BoardOp): string {
  switch (op.type) {
    case 'setup':
      return '本轮白板换成了新的一张（提问态），上面有留白等学生填。';
    case 'reveal':
      return '本轮白板揭晓：刚才留空的位置补上了答案，底部结论也上板了。';
    case 'focus':
      return '本轮白板内容不变，只是把焦点指回学生还没答上的那一处。';
    case 'none':
      return '本轮白板没有变化。';
  }
}
