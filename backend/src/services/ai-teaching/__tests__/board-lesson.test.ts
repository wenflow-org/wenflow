/* eslint-disable @typescript-eslint/no-explicit-any -- 测试内构造 spec 载荷 */
/**
 * 板书 × 课堂阶段协议（2026-11-26）。
 *
 * 要钉住的行为（每条对应实录里的一个失败形态）：
 *  1) 材料回退链：材料本体缺失时，章节原文 / 资料投影要能到绘图员手里（实录：task.material=null → 一屏勾叉）；
 *  2) 空壳矩阵：稀疏无文字、全部同 tone、key 占比过高都算空壳；有文字就不算；
 *  3) 按段露出：骨架态 → 逐行 → 全图，版本号互不相同（否则「板没变不重发」会吞掉新露出）；
 *  4) 轴冻结：重画改了行列就不换板；行列没变时分段标记随板保留；
 *  5) 指称修正：「「列名」那一行」按标签原文改回「那一列」。
 */
import { openBoard, isDegenerateFirstBoard, describeBoardForTeacher } from '../board-state';
import {
  boardSegmentCount,
  describeMatrixRows,
  fixBoardAxisDeixis,
  isAxisCompatible,
  isDegenerateMatrixFigure,
  resolveBoardMaterial,
  revealBoardTo,
} from '../board-lesson';

const BIO_TABLE = {
  kind: 'matrix',
  spec: {
    title: '有氧呼吸三个阶段',
    rowLabels: ['第一阶段 糖酵解', '第二阶段 柠檬酸循环', '第三阶段 氧化磷酸化'],
    colLabels: ['场所', '反应物', '产物', '能量'],
    rowSegments: [1, 2, 3],
    cells: [
      { r: 0, c: 0, t: '细胞质基质' }, { r: 0, c: 1, t: 'C₆H₁₂O₆' }, { r: 0, c: 2, t: '2 丙酮酸 + 4[H]' }, { r: 0, c: 3, t: '少量' },
      { r: 1, c: 0, t: '线粒体基质' }, { r: 1, c: 1, t: '2 丙酮酸 + 6 H₂O' }, { r: 1, c: 2, t: '6 CO₂ + 20[H]' }, { r: 1, c: 3, t: '少量' },
      { r: 2, c: 0, t: '线粒体内膜' }, { r: 2, c: 1, t: '24[H] + 6 O₂' }, { r: 2, c: 2, t: '12 H₂O' }, { r: 2, c: 3, t: '大量' },
    ],
  },
};

describe('board-lesson：材料回退链', () => {
  it('材料本体在 → 直接用', () => {
    expect(resolveBoardMaterial({ taskMaterialPayload: '阶段｜场所｜产物' })).toBe('阶段｜场所｜产物');
    expect(resolveBoardMaterial({ taskMaterialPayload: '   ' })).toBeNull();
  });

  it('材料本体缺失 → 章节原文窗口（带资料名与章节名）', () => {
    const material = resolveBoardMaterial({
      excerpts: [
        { materialName: '细胞呼吸课件', sectionTitle: '三、有氧呼吸', excerpt: '第二阶段：丙酮酸和水彻底分解成 CO₂ 和 [H]' },
        { excerpt: '' },
      ],
    });
    expect(material).toBe('【细胞呼吸课件 · 三、有氧呼吸】\n第二阶段：丙酮酸和水彻底分解成 CO₂ 和 [H]');
  });

  it('章节也没有 → 路径资料投影（tldr + 要点）', () => {
    const material = resolveBoardMaterial({
      materials: [{ title: '教材同步讲义', tldr: '有氧呼吸三个阶段', keyPoints: [{ text: 'CO₂ 在第二阶段产生' }, { text: null }] }],
    });
    expect(material).toBe('【教材同步讲义】\n有氧呼吸三个阶段\nCO₂ 在第二阶段产生');
    expect(resolveBoardMaterial({})).toBeNull();
  });

  it('超长材料截断留痕', () => {
    const material = resolveBoardMaterial({ taskMaterialPayload: 'x'.repeat(50), maxChars: 10 });
    expect(material).toBe('xxxxxxxxxx…');
  });
});

describe('board-lesson：空壳矩阵', () => {
  const labels = { rowLabels: ['a', 'b'], colLabels: ['x', 'y'] };

  it('实录 caseA：key/hit/miss 混合、无文字 → 空壳', () => {
    expect(isDegenerateMatrixFigure({ kind: 'matrix', spec: { ...labels, cells: [{ r: 0, c: 0, tone: 'key' }, { r: 0, c: 1, tone: 'hit' }, { r: 1, c: 0, tone: 'key' }, { r: 1, c: 1, tone: 'miss' }] } })).toBe(true);
  });

  it('实录 caseB：稀疏（4×4 只打了 4 个勾）、无文字 → 空壳', () => {
    expect(isDegenerateMatrixFigure({ kind: 'matrix', spec: { rowLabels: ['1', '2'], colLabels: ['x', 'y'], cells: [{ r: 0, c: 0, tone: 'hit' }] } })).toBe(true);
  });

  it('全部同 tone（全 hit / 全 key）→ 空壳；key 占比 > 40% → 空壳', () => {
    expect(isDegenerateMatrixFigure({ kind: 'matrix', spec: { ...labels, cells: [{ r: 0, c: 0, tone: 'hit' }, { r: 0, c: 1, tone: 'hit' }, { r: 1, c: 0, tone: 'hit' }, { r: 1, c: 1, tone: 'hit' }] } })).toBe(true);
    expect(isDegenerateMatrixFigure({ kind: 'matrix', spec: { rowLabels: ['1', '2', '3'], colLabels: ['x'], cells: [{ r: 0, c: 0, tone: 'key' }, { r: 1, c: 0, tone: 'key' }, { r: 2, c: 0, tone: 'hit' }] } })).toBe(true);
  });

  it('带文字的对照表 → 有内容，不算空壳；非矩阵不受影响', () => {
    expect(isDegenerateMatrixFigure(BIO_TABLE)).toBe(false);
    expect(isDegenerateMatrixFigure({ kind: 'matrix', spec: { ...labels, cells: [{ r: 0, c: 0, t: '线粒体基质', tone: 'key' }, { r: 0, c: 1, t: '线粒体内膜' }] } })).toBe(false);
    expect(isDegenerateMatrixFigure({ kind: 'concept-map', spec: {} })).toBe(false);
    expect(isDegenerateMatrixFigure(null)).toBe(false);
  });

  it('isDegenerateFirstBoard：首版按新判据；非首版不判', () => {
    const sparse = openBoard('t', { kind: 'matrix', spec: { rowLabels: ['1', '2'], colLabels: ['x', 'y'], cells: [{ r: 0, c: 0, tone: 'hit' }] } }, { conceal: 'takeaway' });
    expect(isDegenerateFirstBoard(sparse)).toBe(true);
    expect(isDegenerateFirstBoard(openBoard('t', BIO_TABLE, { conceal: 'takeaway' }))).toBe(false);
    expect(isDegenerateFirstBoard({ ...sparse, revision: 2 })).toBe(false);
  });
});

describe('board-lesson：按段露出（一块板管一节课）', () => {
  const board = openBoard('task-1', BIO_TABLE, { conceal: 'takeaway' });

  it('骨架态：只有行列名，格子全空', () => {
    const skeleton = revealBoardTo(board, 0);
    const spec = skeleton.figure!.maskedSpec as any;
    expect(spec.cells).toEqual([]);
    expect(spec.rowRevealed).toEqual([false, false, false]);
    expect(spec.rowLabels).toEqual(BIO_TABLE.spec.rowLabels);
    expect(boardSegmentCount(spec)).toBe(3);
  });

  it('讲一段露一行：第 2 段时前两行可见、第三行还不存在', () => {
    const spec = revealBoardTo(board, 2).figure!.maskedSpec as any;
    expect(spec.rowRevealed).toEqual([true, true, false]);
    expect(spec.cells.filter((cell: any) => cell.r === 2)).toEqual([]);
    expect(spec.cells.filter((cell: any) => cell.r === 1).map((cell: any) => cell.t)).toEqual(['线粒体基质', '2 丙酮酸 + 6 H₂O', '6 CO₂ + 20[H]', '少量']);
  });

  it('全图态与完整板面一致；原板不被改动', () => {
    const full = revealBoardTo(board, 3).figure!.maskedSpec as any;
    expect(full.rowRevealed).toEqual([true, true, true]);
    expect(full.cells).toHaveLength(12);
    expect((board.figure!.maskedSpec as any).rowRevealed).toBeUndefined();
    expect((board.figure!.maskedSpec as any).cells).toHaveLength(12);
  });

  it('不同露出程度是不同版本（否则「板没变不重发」会吞掉新一轮露出）', () => {
    const revisions = [0, 1, 2, 3, 3].map((level) => revealBoardTo(board, level).revision);
    expect(revisions).toEqual([10, 11, 12, 13, 13]);
    expect(new Set(revisions.slice(0, 4)).size).toBe(4);
  });

  it('state-strip：骨架态保留帧名、帧内快照讲到才出现', () => {
    const strip = openBoard('t', {
      kind: 'state-strip',
      spec: { frames: [{ label: '答一', items: ['定义：勇敢是不退'] }, { label: '顶回', items: ['反例：持盾而退也勇敢'] }], frameSegments: [1, 2] },
    }, { conceal: 'takeaway' });
    const skeleton = revealBoardTo(strip, 0).figure!.maskedSpec as any;
    expect(skeleton.frames.map((frame: any) => frame.label)).toEqual(['答一', '顶回']);
    expect(skeleton.frames[0].items).toEqual([]);
    const second = revealBoardTo(strip, 1).figure!.maskedSpec as any;
    expect(second.frames[0].items).toEqual(['定义：勇敢是不退']);
    expect(second.frames[1].items).toEqual([]);
  });

  it('没有分段信息的板原样返回', () => {
    const plain = openBoard('t', { kind: 'matrix', spec: { ...BIO_TABLE.spec, rowSegments: undefined, cells: BIO_TABLE.spec.cells.map((cell) => ({ r: cell.r, c: cell.c, t: cell.t })) } }, { conceal: 'takeaway' });
    expect(revealBoardTo(plain, 1)).toBe(plain);
    expect(boardSegmentCount(plain.figure!.maskedSpec)).toBe(0);
  });

  // 2026-11-26 工程外审：段数此前取最大值——段号带洞时比教学段多算一段，最后一段永远露不出来。
  it('段数按不同段号计数，并封顶 4（带洞段号不多算、超限不越界）', () => {
    expect(boardSegmentCount({ rowSegments: [1, 1, 2, 2] })).toBe(2);
    expect(boardSegmentCount({ rowSegments: [1, 1, 3, 3] })).toBe(2);
    expect(boardSegmentCount({ rowSegments: [1, 2, 3, 4, 5, 6] })).toBe(4);
    expect(boardSegmentCount({ frameSegments: [1, 2, 2] })).toBe(2);
  });

  it('老师看到的板面描述：逐行可读，未露出的行明说「还没讲到、板上为空」', () => {
    const skeletonText = describeBoardForTeacher(revealBoardTo(board, 0));
    expect(skeletonText).toContain('行「第一阶段 糖酵解」：还没讲到，板上这一行是空的');
    expect(skeletonText).not.toContain('线粒体基质');
    const secondText = describeBoardForTeacher(revealBoardTo(board, 2));
    expect(secondText).toContain('行「第二阶段 柠檬酸循环」：场所=线粒体基质｜反应物=2 丙酮酸 + 6 H₂O｜产物=6 CO₂ + 20[H]｜能量=少量');
    expect(secondText).toContain('行「第三阶段 氧化磷酸化」：还没讲到');
    expect(secondText).not.toContain('线粒体内膜');
  });

  it('只有状态符号的格子按原义描述（key 不再被读成 ≡）', () => {
    expect(describeMatrixRows({ rowLabels: ['甲', '乙'], colLabels: ['x', 'y'], cells: [{ r: 0, c: 0, tone: 'key' }, { r: 0, c: 1, tone: 'hit' }, { r: 1, c: 0, tone: 'miss' }, { r: 1, c: 1, tone: 'dup' }] })).toEqual([
      '- 行「甲」：x=关键｜y=✓',
      '- 行「乙」：x=—｜y=叠',
    ]);
  });
});

describe('board-lesson：轴冻结', () => {
  it('matrix：行列名相同才算同一块板', () => {
    const before = { kind: 'matrix', spec: { rowLabels: ['a', 'b'], colLabels: ['x', 'y'], cells: [] } };
    expect(isAxisCompatible(before, { kind: 'matrix', spec: { rowLabels: ['a', 'b'], colLabels: ['x', 'y'], cells: [{ r: 0, c: 0, t: '改了内容' }] } })).toBe(true);
    expect(isAxisCompatible(before, { kind: 'matrix', spec: { rowLabels: ['a', 'b', 'c'], colLabels: ['x', 'y'], cells: [] } })).toBe(false);
    expect(isAxisCompatible(before, { kind: 'matrix', spec: { rowLabels: ['a', 'b'], colLabels: ['x', 'z'], cells: [] } })).toBe(false);
    expect(isAxisCompatible(before, { kind: 'state-strip', spec: {} })).toBe(false);
  });

  it('state-strip：帧名相同才算同一块板；其它图型看首层键集合', () => {
    expect(isAxisCompatible({ kind: 'state-strip', spec: { frames: [{ label: '一' }, { label: '二' }] } }, { kind: 'state-strip', spec: { frames: [{ label: '一' }, { label: '二' }], note: 'x' } })).toBe(true);
    expect(isAxisCompatible({ kind: 'state-strip', spec: { frames: [{ label: '一' }] } }, { kind: 'state-strip', spec: { frames: [{ label: '1' }] } })).toBe(false);
    expect(isAxisCompatible({ kind: 'concept-map', spec: { nodes: [], edges: [] } }, { kind: 'concept-map', spec: { nodes: [{}], edges: [], takeaway: 'x' } })).toBe(true);
    expect(isAxisCompatible({ kind: 'concept-map', spec: { nodes: [], edges: [] } }, { kind: 'concept-map', spec: { nodes: [] } })).toBe(false);
    expect(isAxisCompatible(null, { kind: 'cycle', spec: {} })).toBe(true);
  });
});

describe('board-lesson：指称修正', () => {
  const board = openBoard('t', {
    kind: 'matrix',
    spec: {
      rowLabels: ['第一阶段', '第二阶段', '第三阶段'],
      colLabels: ['场所', '[H] 的角色', 'CO₂ 来源'],
      cells: [{ r: 0, c: 0, t: '细胞质基质' }, { r: 1, c: 0, t: '线粒体基质' }, { r: 2, c: 0, t: '线粒体内膜' }],
    },
  }, { conceal: 'takeaway' });

  it('实录 caseA：「「[H] 的角色」那一行」是列 → 改成「那一列」', () => {
    const result = fixBoardAxisDeixis('你先看板上「[H] 的角色」那一行，三行分别是怎么变的？', board);
    expect(result.reply).toBe('你先看板上「[H] 的角色」那一列，三行分别是怎么变的？');
    expect(result.fixed).toEqual(['[H] 的角色：行→列']);
  });

  it('行名被叫成「列」→ 改回「行」；指对了的不动', () => {
    expect(fixBoardAxisDeixis('看「第二阶段」这一列，场所是线粒体基质。', board).reply).toBe('看「第二阶段」这一行，场所是线粒体基质。');
    expect(fixBoardAxisDeixis('看「第二阶段」这一行，再看「场所」这一列。', board).reply).toBe('看「第二阶段」这一行，再看「场所」这一列。');
    expect(fixBoardAxisDeixis('看「场所」这一列。', board).fixed).toEqual([]);
  });

  it('没有引号的泛指、非矩阵板、空回复都不改', () => {
    expect(fixBoardAxisDeixis('那一行你再看一眼。', board).reply).toBe('那一行你再看一眼。');
    expect(fixBoardAxisDeixis('看「[H] 的角色」那一行', null).reply).toBe('看「[H] 的角色」那一行');
    expect(fixBoardAxisDeixis('', board).reply).toBe('');
  });

  it('既是行名又是列名的标签（有歧义）不改', () => {
    const ambiguous = openBoard('t', { kind: 'matrix', spec: { rowLabels: ['阶段', '场所'], colLabels: ['阶段', '产物'], cells: [{ r: 0, c: 0, t: 'x' }] } }, { conceal: 'takeaway' });
    expect(fixBoardAxisDeixis('看「阶段」那一行', ambiguous).reply).toBe('看「阶段」那一行');
  });
});
