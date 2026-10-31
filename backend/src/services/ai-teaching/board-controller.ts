/**
 * 板书控制器（2026-10-27 白板改造）：决定「这一轮白板做什么动作」。
 *
 * 定位（用户定调）：「白板解决的是纯文字认知压力过大的问题，不是做题区」。
 * 所以动作空间对应三个**认知**动作，而不是「出题/揭晓」：
 *   show   上板减负——本轮涉及多步对比、多变量、长背景，把结构完整摆上去
 *   focus  视觉引导——老师聊到哪一行/哪条边，把焦点指过去（并可把干扰项置灰）
 *   update 随情境刷新——老师换了例子/条件，同一结构的板换成新数据（替学生记住「现在的现场」）
 * 旧口径的 reveal 保留，但只服务 conceal:'full'（检索练习）那一档。
 *
 * 为什么必须是确定性状态机：V8 之前每轮由模型决定「要不要画」，结果是刷屏 + 重复 + 泄题三件套。
 * 这里判据全部来自代码已有事实：是否首轮、任务是否换了、检查点是否通过、本轮是否出现新数值。
 *
 * 与 board-state.ts 的分工：那边算「板上长什么样」，这边决定「这一轮对板做什么」。
 */

import type { BoardStage, BoardState } from './board-state';
import { revealBoard, focusBoard, updateBoard } from './board-state';

export type BoardOp =
  /** 换任务/首轮且需要板书：新开一块完整板（show） */
  | { type: 'setup'; reason: 'first-turn' | 'task-changed' }
  /** 老师换了例子/条件：同结构换新数据（减负模式的核心动作） */
  | { type: 'update'; reason: 'new-example' | 'condition-changed' }
  /** 学生补上了空槽 / 检查点通过：同一块板切到完整态（仅 conceal:'full' 用） */
  | { type: 'reveal'; summary?: string }
  /** 学生还没答到点上：只移动焦点，把注意力引回那一处，不改内容 */
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
  /** 检查点作答的代码裁决（学生答对 = 板上该揭晓了；仅 conceal:'full' 有意义） */
  checkpointVerdict?: { passed: boolean; detail?: string | null } | null;
  /** 学生本轮发言是否补上了板上的空槽（由关键词/答案键比对得出；仅 conceal:'full' 有意义） */
  filledSlot?: boolean;
  /** 本轮是否识别到学生的典型误解（用于把焦点引到对应空槽） */
  misconception?: boolean;
  /** 老师本轮引入了板上没有的新数值/新条件（见 hasNewNumbers，启发式） */
  newExample?: boolean;
}

/**
 * 动作优先级（越靠前越「板上真的该变了」）：
 *   换任务 → 建板；老师换例子 → 换板；答对/补上 → 揭晓（仅挖空口径）；还没答到 → 指板；否则不动。
 *
 * 注意两点：
 *  - 减负模式下（conceal !== 'full'）板面本来就是完整的，不存在「揭晓」这个动作，
 *    答对之后板不需要变——学生要的是继续看着这块板往下走。
 *  - 已揭晓的板不会为了「再问一次」而重新挖空：重新挖空等于把已经学会的东西再藏起来。
 */
export function decideBoardOp(signals: BoardSignals): BoardOp {
  const { board } = signals;
  const stage: BoardStage | null = board?.figure?.stage ?? null;

  if (signals.taskChanged || (!board?.figure && signals.firstTurnOfTask && signals.wantsNewBoard)) {
    return { type: 'setup', reason: signals.taskChanged ? 'task-changed' : 'first-turn' };
  }
  if (!board?.figure) return { type: 'none', reason: 'no-board' };

  const conceal = board.figure.conceal;
  if (signals.newExample) {
    return { type: 'update', reason: 'new-example' };
  }

  if (conceal !== 'full') {
    // 减负模式：板面已完整，没有「揭晓」；答对后老师继续用同一块板往下推
    if (signals.misconception) {
      return { type: 'focus', target: board.figure.focusId ?? null, reason: 'misconception' };
    }
    return { type: 'none', reason: 'revealed-already' };
  }

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

/** 把动作应用到板上（setup / update 需要外部给出新 figure） */
export function applyBoardOp(
  board: BoardState | null,
  op: BoardOp,
  nextFigure?: { kind?: string; spec?: unknown },
): BoardState | null {
  if (op.type === 'setup') return board; // setup 由 openBoard 构造，见 board-state
  if (!board) return board;
  if (op.type === 'update') {
    return nextFigure ? updateBoard(board, nextFigure, '白板已换成当前这组条件') : board;
  }
  if (op.type === 'reveal') return revealBoard(board, op.summary);
  if (op.type === 'focus') return focusBoard(board, op.target);
  return board;
}

/** 给老师的一句话：本轮白板动了什么（让 reply 可以自然承接，而不用复述图） */
export function describeBoardOp(op: BoardOp): string {
  switch (op.type) {
    case 'setup':
      return '本轮白板摆上了这一任务的完整板书（材料、步骤、结构都在板上）。';
    case 'update':
      return '本轮白板上的数据换成了当前这组条件，结构没变。';
    case 'reveal':
      return '本轮白板把刚才留空的位置补上了答案，底部结论也上板了。';
    case 'focus':
      return '本轮白板内容不变，只是把焦点指回学生还没答上的那一处。';
    case 'none':
      return '本轮白板没有变化。';
  }
}

/**
 * 本轮话里是否出现了板上没有的新数值——启发式判据，用来触发 update。
 *
 * 为什么用数字而不是「语义是否换题」：换例子在课堂里几乎总伴随新数值（800 m、4 min、0.8 倍密度、
 * 水银 13.6），而纯语言换题（「换个说法」）不需要换板。抽取双方的数字集合做差，
 * 命中即认为「现场变了」，宁可多刷一次板也不要老师讲新题而板上是旧题（报告里的实测问题）。
 */
export function hasNewNumbers(spec: unknown, text: string): boolean {
  const numbersIn = (s: string): Set<string> => {
    const out = new Set<string>();
    // 小数、整数、带千分位；「第 2 轮」这类序数也计入（板上一般没有「第 N 轮」）
    for (const m of s.matchAll(/\d+(?:[.,]\d+)?/g)) out.add(m[0].replace(/,/g, ''));
    return out;
  };
  const onBoard = numbersIn(collectSpecText(spec));
  const inText = numbersIn(text);
  for (const n of inText) {
    if (!onBoard.has(n)) return true;
  }
  return false;
}

function collectSpecText(value: unknown, depth = 0): string {
  if (depth > 6) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  if (Array.isArray(value)) return value.map((v) => collectSpecText(v, depth + 1)).join(' ');
  if (value && typeof value === 'object') {
    return Object.values(value as Record<string, unknown>)
      .map((v) => collectSpecText(v, depth + 1))
      .join(' ');
  }
  return '';
}
