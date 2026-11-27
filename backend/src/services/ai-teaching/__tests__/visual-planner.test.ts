/**
 * 视觉节点（2026-11-26 契约层拆分）：把 intent 翻成一张图。
 *
 * 钉住：
 *  1) relation → kindHint 映射与「只画这一张、不画整课板书」指令；
 *  2) focus / opportunityInstruction 进绘图指令；
 *  3) 绘图失败或超时 → fail-open（figure=null），不抛给课堂。
 */
const mockDesignBoard = jest.fn();

jest.mock('../teaching-board-design.service', () => ({
  designBoard: mockDesignBoard,
}));

import { planVisualFigure, intentFromOpportunity, shouldDeferWholeStructureFigure } from '../visual-planner';

beforeEach(() => { mockDesignBoard.mockReset(); });

const FIGURE = { engine: 'svg', kind: 'range-bar', caption: null, spec: {} };

const baseInput = () => ({
  intent: { need: true as const, relation: 'range' as const, focus: '两组四天的波动范围' },
  task: { title: '对比实验', description: '看两组数据', taskType: 'practice', material: '新组 3.1–3.8，旧组 2.9–3.6' },
  scenario: { subject: '数学', topic: '对比', learnerLevel: 'beginner' },
  studentSays: '这两组差多少？',
  lastTeacherReply: null,
  opportunityInstruction: '必须出图',
  context: { userId: 'u1', sessionId: 's1', taskId: 't1' },
});

describe('planVisualFigure', () => {
  it('relation → kindHint，指令写明只画一张且带 focus / 编排层要求', async () => {
    mockDesignBoard.mockResolvedValue({ figure: FIGURE, reason: 'ok' });
    const result = await planVisualFigure(baseInput());
    expect(result.figure).toEqual(FIGURE);

    const [request, context, options] = mockDesignBoard.mock.calls[0];
    expect(request.kindHint).toBe('range-bar');
    expect(request.instruction).toContain('只画这一张图');
    expect(request.instruction).toContain('两组四天的波动范围');
    expect(request.instruction).toContain('必须出图');
    expect(request.instruction).toContain('不要出现本轮学生要自己产出的答案');
    expect(context).toEqual({ userId: 'u1', sessionId: 's1', taskId: 't1' });
    expect(options).toEqual({ lessonPlan: false });
  });

  it('模型给了合法 kindHint 时优先用它', async () => {
    mockDesignBoard.mockResolvedValue({ figure: FIGURE, reason: 'ok' });
    await planVisualFigure({
      ...baseInput(),
      intent: { need: true, relation: 'range', focus: '区间', kindHint: 'split-compare' },
    });
    expect(mockDesignBoard.mock.calls[0][0].kindHint).toBe('split-compare');
  });

  it('绘图节点拒绝或失败 → fail-open，不抛出', async () => {
    mockDesignBoard.mockResolvedValue({ figure: null, reason: 'declined' });
    await expect(planVisualFigure(baseInput())).resolves.toEqual({ figure: null, reason: 'declined' });

    mockDesignBoard.mockRejectedValue(new Error('boom'));
    await expect(planVisualFigure(baseInput())).resolves.toEqual({ figure: null, reason: 'visual-plan failed' });
  });
});

describe('intentFromOpportunity', () => {
  it('kindHint → relation，focus 取编排层理由，kindHint 原样保留', () => {
    expect(intentFromOpportunity({
      kindHint: 'position-line',
      ruleWhy: '学生在用文字描述空间位置关系',
      matched: ['甲在乙前'],
    })).toEqual({
      need: true,
      relation: 'position',
      focus: '学生在用文字描述空间位置关系',
      kindHint: 'position-line',
    });
  });

  it('无 kindHint → structure；无 ruleWhy → 用命中线索拼焦点', () => {
    const intent = intentFromOpportunity({ kindHint: null, ruleWhy: null, matched: ['架子', '案板边'] });
    expect(intent?.relation).toBe('structure');
    expect(intent?.focus).toBe('架子；案板边');
    expect(intent?.kindHint).toBeNull();
  });

  it('没有机会 → 不还原意图；焦点截到 120 字', () => {
    expect(intentFromOpportunity(null)).toBeNull();
    const long = '结'.repeat(200);
    expect(intentFromOpportunity({ kindHint: 'tree', ruleWhy: long })?.focus).toHaveLength(120);
  });
});

describe('shouldDeferWholeStructureFigure', () => {
  it('点名/建构阶段 + 无板 + 整课结构 → 暂不出图（防剧透）', () => {
    expect(shouldDeferWholeStructureFigure({ phase: 'orient', hasBoard: false, reason: 'task-structure' })).toBe(true);
    expect(shouldDeferWholeStructureFigure({ phase: 'build', hasBoard: false, reason: 'task-structure' })).toBe(true);
  });

  it('整合后 / 有板 / 学生驱动的时机 → 不拦', () => {
    expect(shouldDeferWholeStructureFigure({ phase: 'integrate', hasBoard: false, reason: 'task-structure' })).toBe(false);
    expect(shouldDeferWholeStructureFigure({ phase: 'build', hasBoard: true, reason: 'task-structure' })).toBe(false);
    expect(shouldDeferWholeStructureFigure({ phase: 'build', hasBoard: false, reason: 'position-description' })).toBe(false);
    expect(shouldDeferWholeStructureFigure({ phase: null, hasBoard: false, reason: 'task-structure' })).toBe(false);
  });
});
