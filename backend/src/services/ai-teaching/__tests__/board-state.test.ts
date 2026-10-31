/* eslint-disable @typescript-eslint/no-explicit-any -- 测试内构造 spec 载荷 */
/**
 * 共享白板两态（2026-10-27）：一份 spec → 提问态 / 揭晓态。
 *
 * 验收点：
 *  1) 提问态必须把「答案位」挖空、把结论藏起来（不泄题）；
 *  2) 揭晓态必须与原始 spec 完全一致（学生答对后能看全）；
 *  3) 老师可见描述只能包含板上真实可见的内容，且明确标出空槽与未揭晓结论（图文不一致的根治点）；
 *  4) 没有留白的图直接以揭晓态上板（不制造假空槽）。
 */
import {
  deriveBoardFigure,
  openBoard,
  revealBoard,
  updateBoard,
  boardSpecForRender,
  boardFigureForRender,
  describeBoardForTeacher,
  diffBoardStages,
  countBoardSlots,
} from '../board-state';

const splitCompare = {
  kind: 'split-compare',
  spec: {
    title: '配速换算',
    left: { head: '你的走法', tone: 'warn', rows: [{ label: '60 ÷ 400 = 0.15' }, { label: '0.15 分钟/千米' }] },
    right: { head: '正确做法', tone: 'ok', rows: [{ label: '1 ÷ 0.4 = 2.5' }, { label: '2.5 分钟/千米' }] },
    delta: { label: '分叉在第一步：先换算', at: 1 },
  },
};

const conceptMap = {
  kind: 'concept-map',
  spec: {
    title: '光合作用',
    nodes: [{ id: 'a', label: '光反应' }, { id: 'b', label: '暗反应' }],
    edges: [{ from: 'a', to: 'b', label: '供给 ATP' }],
    takeaway: '光反应造能量，暗反应用能量',
  },
};

const stateStrip = {
  kind: 'state-strip',
  spec: {
    title: '三次握手',
    frames: [
      { label: 'SYN', items: ['客户端 SYN_SENT'] },
      { label: 'ACK', items: ['双方 ESTABLISHED'] },
    ],
  },
};

const cartesian = {
  kind: 'cartesian-plot',
  spec: {
    x: { min: 0, max: 4, label: 't/s' },
    y: { min: 0, max: 10, label: 'v' },
    series: [{ name: 'v=2.5t', form: 'linear', k: 2.5, b: 0 }],
    marks: [{ at: [2, 5], label: 't=2s, v=5' }],
    guides: [{ axis: 'y', at: 5, label: 'v=5' }],
  },
};

const noBlank = {
  kind: 'quadrant',
  spec: { title: '优先级', colLabels: ['紧急', '不紧急'], rowLabels: [{ label: '重要' }, { label: '不重要' }], cells: [{ title: '马上做' }] },
};

describe('board-state：两态构造', () => {
  it('split-compare：右栏答案挖空、delta 藏起、左栏事实保留', () => {
    const f = deriveBoardFigure(splitCompare);
    const right = (f.maskedSpec.right as any).rows.map((r: any) => r.label);
    const left = (f.maskedSpec.left as any).rows.map((r: any) => r.label);
    expect(left[0]).toContain('60 ÷ 400');
    expect(right.every((l: string) => l === '？')).toBe(true);
    // 结论整条从提问态撤掉（只留一个 ? 的横幅没有信息量），揭晓时由 fullSpec 补回
    expect(f.maskedSpec.delta).toBeUndefined();
    expect((f.fullSpec.delta as any).label).toBe('分叉在第一步：先换算');
    expect(f.hiddenTakeaway).toBe('分叉在第一步：先换算');
    expect(f.slots).toBeGreaterThan(0);
    expect(f.stage).toBe('setup');
  });

  it('concept-map：关系名挖空、takeaway 从提问态移除但记录为揭晓项', () => {
    const f = deriveBoardFigure(conceptMap);
    expect((f.maskedSpec.edges as any[])[0].label).toBe('？');
    expect(f.maskedSpec.takeaway).toBeUndefined();
    expect(f.hiddenTakeaway).toContain('光反应造能量');
    // 节点是骨架，必须保留
    expect((f.maskedSpec.nodes as any[]).map((n) => n.label)).toEqual(['光反应', '暗反应']);
  });

  it('state-strip：帧名保留、帧内状态挖空', () => {
    const f = deriveBoardFigure(stateStrip);
    const frames = f.maskedSpec.frames as any[];
    expect(frames.map((x) => x.label)).toEqual(['SYN', 'ACK']);
    expect(frames[0].items).toEqual(['？']);
  });

  it('cartesian：点标签与带数值的辅助线挖空，曲线保留', () => {
    const f = deriveBoardFigure(cartesian);
    expect((f.maskedSpec.marks as any[])[0].label).toBe('？');
    expect((f.maskedSpec.guides as any[])[0].label).not.toMatch(/5/);
    expect((f.maskedSpec.series as any[])[0].name).toBe('v=2.5t');
  });

  it('提问态撤掉所有副标注（模型会把结论写进 sub），揭晓态补回', () => {
    const withSub = {
      kind: 'split-compare',
      spec: {
        left: { head: '你的走法', rows: [{ label: '60 ÷ 400 = 0.15', sub: '秒没换成分钟' }] },
        right: { head: '正确做法', rows: [{ label: '1 ÷ 0.4 = 2.5', sub: '先换算' }] },
      },
    };
    const f = deriveBoardFigure(withSub);
    expect((f.maskedSpec.left as any).rows[0].sub).toBeUndefined();
    expect((f.maskedSpec.right as any).rows[0].sub).toBeUndefined();
    expect((f.fullSpec.left as any).rows[0].sub).toBe('秒没换成分钟');
  });

  it('没有留白的图型：以揭晓态上板（不制造假空槽）', () => {
    const f = deriveBoardFigure(noBlank);
    expect(f.slots).toBe(0);
    const board = openBoard('t1', noBlank);
    expect(board.figure!.stage).toBe('revealed');
  });

  it('揭晓态与原始 spec 完全一致（学生答对后能看全）', () => {
    const board = openBoard('t1', conceptMap);
    const revealed = revealBoard(board, '关系补上了');
    const spec = boardSpecForRender(revealed) as any;
    expect(spec.edges[0].label).toBe('供给 ATP');
    expect(spec.takeaway).toContain('光反应造能量');
    expect(revealed.lastReveal!.summary).toBe('关系补上了');
  });
});

describe('board-state：老师可见描述（图文不一致的根治点）', () => {
  it('提问态描述只含可见内容，空槽标出，结论标未揭晓', () => {
    const board = openBoard('t1', splitCompare);
    const text = describeBoardForTeacher(board);
    expect(text).toContain('提问态');
    expect(text).toContain('空槽');
    expect(text).toContain('60 ÷ 400');          // 左栏事实可见
    expect(text).not.toContain('1 ÷ 0.4');        // 右栏答案不可见
    expect(text).toContain('未揭晓');
    expect(text).not.toContain('分叉在第一步');    // 结论不可见
  });

  it('揭晓态描述把答案与结论都放出来', () => {
    const board = revealBoard(openBoard('t1', splitCompare));
    const text = describeBoardForTeacher(board);
    expect(text).toContain('已揭晓');
    expect(text).toContain('1 ÷ 0.4');
    expect(text).toContain('分叉在第一步');
  });

  it('无板时明确告知「纯语言推进、不要假设图」', () => {
    const text = describeBoardForTeacher({ taskId: 't', figure: null, revision: 0 });
    expect(text).toContain('暂无板书');
    expect(text).toContain('不要提及或假设任何图');
  });

  it('两态差异能量化「揭晓时补了什么」', () => {
    const diff = diffBoardStages(deriveBoardFigure(splitCompare));
    const paths = diff.map((d) => d.path);
    expect(paths.some((p) => p.includes('right.rows'))).toBe(true);
    expect(paths).toContain('takeaway');
    expect(diff.find((d) => d.path === 'takeaway')!.after).toContain('分叉在第一步');
  });

  it('槽位计数：只数真正的空槽，不数普通问号文案', () => {
    expect(countBoardSlots({ a: '？', b: '为什么？' })).toBe(1);
    expect(countBoardSlots({ a: '？', b: '?' })).toBe(2);
  });
});

describe('board-state：渲染出口', () => {
  it('提问态下发 maskedSpec，揭晓态下发 fullSpec', () => {
    const board = openBoard('t1', conceptMap);
    expect((boardSpecForRender(board) as any).edges[0].label).toBe('？');
    const revealed = revealBoard(board);
    expect((boardSpecForRender(revealed) as any).edges[0].label).toBe('供给 ATP');
    expect(boardFigureForRender(revealed)!.kind).toBe('concept-map');
  });
});

/**
 * 减负口径（2026-10-27 用户定调）：白板不是做题区。
 *
 * 验收点：
 *  1) none / takeaway 两档必须把材料、步骤、副标注完整上板（0 个问号）；
 *  2) takeaway 只藏结论句——那是「老师问、学生说」的部分，也是唯一还算泄题的东西；
 *  3) 每种口径的老师描述都要换成对应规则，不能还留着「不要替学生补空槽」这种做题区指令。
 */
describe('board-state：减负模式（conceal）', () => {
  const withSubs = {
    kind: 'split-compare',
    spec: {
      title: '配速换算',
      left: {
        head: '直接除',
        tone: 'warn',
        rows: [
          { label: '60 ÷ 400 = 0.15', sub: '秒除以米，单位没换' },
          { label: '读成 0.15 分钟/千米', sub: '把秒当分钟' },
        ],
      },
      right: {
        head: '先换单位',
        tone: 'ok',
        rows: [
          { label: '400 m = 0.4 km', sub: '先把米换成千米' },
          { label: '1 ÷ 0.4 = 2.5', sub: '分钟/千米' },
        ],
      },
      delta: { label: '分叉在第二步：单位', at: 2 },
    },
  };

  it('none：材料、副标注、结论全部上板，0 个空槽', () => {
    const f = deriveBoardFigure(withSubs, { conceal: 'none' });
    expect(f.conceal).toBe('none');
    expect(f.slots).toBe(0);
    expect(f.stage).toBe('revealed');
    expect((f.maskedSpec.left as any).rows[0].sub).toBe('秒除以米，单位没换');
    expect((f.maskedSpec as any).delta.label).toContain('分叉在第二步');
    expect(f.hiddenTakeaway).toBeNull();
    expect(JSON.stringify(f.maskedSpec)).not.toContain('？');
  });

  it('takeaway：材料与副标注照发，只把结论句留在对话里', () => {
    const f = deriveBoardFigure(withSubs, { conceal: 'takeaway' });
    expect((f.maskedSpec.left as any).rows[1].sub).toBe('把秒当分钟');
    expect((f.maskedSpec as any).delta).toBeUndefined();
    expect(f.hiddenTakeaway).toContain('分叉在第二步');
    expect(JSON.stringify(f.maskedSpec)).not.toContain('？');
  });

  it('full：仍是旧口径（挖答案位 + 撤副标注 + 藏结论），不受本次改动影响', () => {
    const f = deriveBoardFigure(withSubs, { conceal: 'full' });
    expect((f.maskedSpec as any).right.rows[0].label).toBe('？');
    expect((f.maskedSpec.left as any).rows[0].sub).toBeUndefined();
    expect(f.slots).toBe(2);
    expect(f.stage).toBe('setup');
  });

  it('老师描述：减负口径换成「禁止复述板面」，不再出现「空槽待学生补」', () => {
    const none = describeBoardForTeacher(openBoard('t', withSubs, { conceal: 'none' }));
    expect(none).toContain('完整板书');
    expect(none).toContain('严禁用文字复述板上已有的内容');
    expect(none).not.toContain('空槽待学生补');
    expect(none).toContain('分叉在第二步');

    const takeaway = describeBoardForTeacher(openBoard('t', withSubs, { conceal: 'takeaway' }));
    expect(takeaway).toContain('未上板');
    expect(takeaway).toContain('留给学生说');
    expect(takeaway).not.toContain('分叉在第二步');
  });

  it('下发 spec：none 发完整、takeaway 发无结论的完整、full 按阶段发', () => {
    const none = boardSpecForRender(openBoard('t', withSubs, { conceal: 'none' }))!;
    expect((none as any).delta.label).toContain('分叉');
    const take = boardSpecForRender(openBoard('t', withSubs, { conceal: 'takeaway' }))!;
    expect((take as any).delta).toBeUndefined();
    expect((take as any).left.rows[0].sub).toBeDefined();
    const full = boardSpecForRender(openBoard('t', withSubs, { conceal: 'full' }))!;
    expect((full as any).right.rows[0].label).toBe('？');
  });

  it('换板：同结构换新数据，版本递增且沿用原口径', () => {
    const board = openBoard('t', withSubs, { conceal: 'takeaway' });
    const next = updateBoard(board, {
      kind: 'split-compare',
      spec: {
        ...withSubs.spec,
        title: '配速换算（800 m 4 min）',
        left: { ...withSubs.spec.left, rows: [{ label: '240 ÷ 800 = 0.3' }] },
      },
    });
    expect(next.revision).toBe(board.revision + 1);
    expect(next.figure!.conceal).toBe('takeaway');
    expect((next.figure!.maskedSpec.left as any).rows[0].label).toBe('240 ÷ 800 = 0.3');
    expect((next.figure!.maskedSpec as any).delta).toBeUndefined();
  });
});
