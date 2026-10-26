/* eslint-disable @typescript-eslint/no-explicit-any -- 探针/测试：LLM I/O 与 JSON 载荷形状内在动态（对齐 verify-from-zero 先例） */
/**
 * teaching-turn `figure` 块归一化（2026-09-27 双通道重构 Scope B：位置线图）。
 *
 * 契约：`kind: position-line` + 至少一个有效 mark 才保留；数值域由代码统一推导
 * （模型的 min/max 不得把取值挡在域外）；非法项丢弃、数组截断、标签超长丢弃该条。
 */
const mockCallPrompt = jest.fn();

jest.mock('../../../composers/prompt-composer', () => ({ callPrompt: mockCallPrompt }));

import { teachingTurnAgentHandler, type TeachingTurnInput } from '../index';

const input: TeachingTurnInput = {
  messages: [{ role: 'user', content: '甲在乙后面 20 米，两人都向东走' }],
  learner: {} as TeachingTurnInput['learner'],
  scenario: { subject: '数学', topic: '追及问题', taskTitle: '摆位置线', taskDescription: '把关系摆成一条线', taskType: 'practice' },
  knowledge: { points: [] },
};

const basePayload = {
  reply: '先把你说的关系摆成一条线：甲在后面，乙在前面，都朝右。',
  analysis: {
    cognitiveLevel: 'understand',
    levelScore: 2,
    understanding: 0.6,
    confusionPoints: [],
    engagement: 0.8,
    emotionalState: 'neutral',
    loadIndex: 0.4,
    loadBasis: 'semantic',
  },
  knowledge: { currentPoint: '位置线', points: [{ name: '位置线', status: 'learning', progress: 50 }] },
  pedagogy: { strategies: ['explain'] },
  control: { isCompletionCandidate: false, shouldTriggerPeer: false },
};

async function runWithFigure(raw: any): Promise<any> {
  mockCallPrompt.mockReset();
  mockCallPrompt.mockImplementation(async (spec: any) => ({
    success: true,
    output: spec.normalizeOutput({ ...basePayload, figure: raw }, input),
    runtimeEnvelope: null,
    debug: {},
  }));
  const output = await teachingTurnAgentHandler(input);
  return (output.internal?.ext as any)?.teaching;
}


describe('teaching-turn figure 归一化（位置线）', () => {
  beforeEach(() => mockCallPrompt.mockReset());

  it('位置线保留：marks 按 at 升序、engine/kind 归一、域覆盖全部取值', async () => {
    const teaching = await runWithFigure({
      kind: 'position-line',
      axis: { min: 0, max: 100, unit: ' 米 ', ticks: [{ at: 0, label: '起点' }] },
      marks: [
        { at: 60, label: '乙', dir: 'right' },
        { at: 20, label: '甲', dir: 'right' },
      ],
      spans: [{ from: 60, to: 20, label: '相距 40 米' }],
      guides: [{ at: 90, label: '追及点' }],
      caption: ' 两人都朝右 ',
    });
    expect(teaching.figure.engine).toBe('svg');
    expect(teaching.figure.kind).toBe('position-line');
    expect(teaching.figure.marks.map((m: any) => m.label)).toEqual(['甲', '乙']);
    expect(teaching.figure.spans[0]).toEqual({ from: 20, to: 60, label: '相距 40 米' });
    expect(teaching.figure.axis.unit).toBe('米');
    expect(teaching.figure.caption).toBe('两人都朝右');
    // 域覆盖：min < 20、max > 90（含 4% 余量）
    expect(teaching.figure.axis.min).toBeLessThan(20);
    expect(teaching.figure.axis.max).toBeGreaterThan(90);
  });

  it('出图理由 why：保留并去控制字符；超长截到 60 字；缺失则不写该键', async () => {
    const withWhy = await runWithFigure({
      kind: 'position-line',
      marks: [{ at: 20, label: '甲', dir: 'right' }],
      why: '  位置关系用线一眼可核，读数比文字快  ',
    });
    expect(withWhy.figure.why).toBe('位置关系用线一眼可核，读数比文字快');

    const longWhy = await runWithFigure({
      kind: 'position-line',
      marks: [{ at: 20, label: '甲', dir: 'right' }],
      why: '很'.repeat(80),
    });
    expect(longWhy.figure.why).toHaveLength(60);

    const noWhy = await runWithFigure({
      kind: 'position-line',
      marks: [{ at: 20, label: '甲', dir: 'right' }],
    });
    expect(noWhy.figure).not.toHaveProperty('why');
  });

  it('模型的 min/max 不得把取值挡在域外（域按并集扩）', async () => {
    const teaching = await runWithFigure({
      kind: 'position-line',
      axis: { min: 0, max: 50, unit: '米' },
      marks: [
        { at: 10, label: '甲', dir: 'right' },
        { at: 80, label: '乙', dir: 'right' },
      ],
    });
    expect(teaching.figure.axis.max).toBeGreaterThan(80);
    expect(teaching.figure.axis.min).toBeLessThan(10);
  });

  it('缺 axis 也能出图：域由取值推导，单位归 null', async () => {
    const teaching = await runWithFigure({
      marks: [{ at: 3, label: '甲' }, { at: 7, label: '乙' }],
    });
    expect(teaching.figure.axis.unit).toBeNull();
    expect(teaching.figure.axis.min).toBeLessThan(3);
    expect(teaching.figure.axis.max).toBeGreaterThan(7);
  });

  it('dir 非法归 none；同位置 mark 去重；spans 两端归一为 from<to', async () => {
    const teaching = await runWithFigure({
      marks: [
        { at: 5, label: '甲', dir: 'up' },
        { at: 5, label: '重复' },
        { at: 9, label: '乙', dir: 'LEFT' },
      ],
      spans: [{ from: 9, to: 5, label: '差 4' }],
    });
    expect(teaching.figure.marks).toEqual([
      { at: 5, label: '甲', dir: 'none' },
      { at: 9, label: '乙', dir: 'left' },
    ]);
    expect(teaching.figure.spans).toEqual([{ from: 5, to: 9, label: '差 4' }]);
  });

  it('非法输入整块丢弃：非对象 / 其他 kind / 无有效 mark / 无数字取值', async () => {
    expect((await runWithFigure('甲在乙后面')).figure).toBeUndefined();
    expect((await runWithFigure({ kind: 'bar-chart', marks: [{ at: 1, label: '甲' }] })).figure).toBeUndefined();
    expect((await runWithFigure({ marks: [{ at: 'x', label: '甲' }] })).figure).toBeUndefined();
    expect((await runWithFigure({ marks: [{ at: 1, label: '   ' }] })).figure).toBeUndefined();
    expect((await runWithFigure({ marks: [] })).figure).toBeUndefined();
  });

  it('标签超长丢弃该条；数组超上限截断；单点域不除零', async () => {
    const teaching = await runWithFigure({
      marks: [
        { at: 1, label: '这个标签长到超过了十六个字的上限所以应被丢弃' },
        { at: 2, label: '甲' },
        ...Array.from({ length: 8 }, (_, i) => ({ at: 10 + i, label: `P${i}` })),
      ],
      guides: Array.from({ length: 6 }, (_, i) => ({ at: 20 + i, label: `G${i}` })),
    });
    expect(teaching.figure.marks.length).toBeLessThanOrEqual(6);
    expect(teaching.figure.marks.some((m: any) => m.label.includes('上限'))).toBe(false);
    expect(teaching.figure.guides.length).toBeLessThanOrEqual(4);

    const single = await runWithFigure({ marks: [{ at: 42, label: '甲' }] });
    expect(single.figure.axis.max).toBeGreaterThan(single.figure.axis.min);
  });
});

describe('teaching-turn figure 归一化（2026-10-18 扩图型）', () => {
  beforeEach(() => mockCallPrompt.mockReset());

  it('matrix：保留合法 tone，越界/非法格丢弃', async () => {
    const teaching = await runWithFigure({
      kind: 'matrix',
      caption: '评分点对账',
      spec: {
        title: '评分点 × 作答',
        rowLabels: ['要点 A', '要点 B'],
        colLabels: ['第一段', '第二段'],
        cells: [
          { r: 0, c: 0, tone: 'hit' },
          { r: 1, c: 1, tone: 'dup' },
          { r: 5, c: 0, tone: 'hit' },
          { r: 0, c: 0, tone: 'rainbow' },
        ],
        legend: [{ text: '✓ 已写到', fill: '#e6f4f1' }, { text: '坏色', fill: 'url(#x)' }],
      },
    });
    expect(teaching.figure.kind).toBe('matrix');
    expect(teaching.figure.spec.cells).toEqual([
      { r: 0, c: 0, tone: 'hit' },
      { r: 1, c: 1, tone: 'dup' },
    ]);
    expect(teaching.figure.spec.legend).toEqual([{ text: '✓ 已写到', fill: '#e6f4f1' }]);
    expect(teaching.figure.caption).toBe('评分点对账');
  });

  it('matrix：行列不足两个 → 整块丢弃', async () => {
    expect(
      (await runWithFigure({ kind: 'matrix', spec: { rowLabels: ['只有一行'], colLabels: ['a', 'b'], cells: [{ r: 0, c: 0, tone: 'hit' }] } }))
        .figure,
    ).toBeUndefined();
  });



  it('位置线：时间轴上不许用跨度标「幅度/差值」（跨量纲混画）', async () => {
    const bad = await runWithFigure({
      kind: 'position-line',
      axis: { min: 0, max: 7, unit: '天', ticks: [{ at: 1, label: '周一' }, { at: 7, label: '周日' }] },
      marks: [{ at: 1, label: '第一天', dir: 'none' }],
      spans: [{ from: 2, to: 6, label: '同组日间波动幅度 0.7 个点' }],
    });
    expect(bad.figure).toBeUndefined();

    // 同一条时间轴上标「时长/相隔」是合法语义 → 保留
    const ok = await runWithFigure({
      kind: 'position-line',
      axis: { min: 0, max: 600, unit: 'ms' },
      marks: [{ at: 0, label: 'A 发出', dir: 'right' }, { at: 100, label: 'B 发出', dir: 'right' }, { at: 500, label: 'A 返回', dir: 'none' }],
      spans: [{ from: 100, to: 250, label: 'B 请求耗时 150ms' }],
    });
    expect(ok.figure.kind).toBe('position-line');
  });

  it('位置线：只有最高/最低两个点 + 一条跨度、没有刻度 → 整块丢弃（伪装成位置线的区间条）', async () => {
    const bad = await runWithFigure({
      kind: 'position-line',
      marks: [{ at: 0, label: '最低那天', dir: 'none' }, { at: 1, label: '最高那天', dir: 'none' }],
      spans: [{ from: 0, to: 1, label: '这七天自己晃出的幅度' }],
    });
    expect(bad.figure).toBeUndefined();

    // 追及题的两个对象（甲/乙）不是区间端点 → 保留
    const ok = await runWithFigure({
      kind: 'position-line',
      marks: [{ at: 20, label: '甲', dir: 'right' }, { at: 60, label: '乙', dir: 'right' }],
      spans: [{ from: 20, to: 60, label: '相距 40 米' }],
    });
    expect(ok.figure.kind).toBe('position-line');
  });

  it('轴单位只收短单位：注释/半截括号一律丢弃，不印在左上角', async () => {
    const bad = await runWithFigure({
      kind: 'position-line',
      axis: { min: 0, max: 10, unit: '（示意，非真实数值', ticks: [{ at: 3, label: 'x' }] },
      marks: [{ at: 3, label: '甲', dir: 'none' }],
    });
    expect(bad.figure.axis.unit).toBeNull();

    const ok = await runWithFigure({
      kind: 'position-line',
      axis: { min: 0, max: 10, unit: '个百分点', ticks: [{ at: 3, label: 'x' }] },
      marks: [{ at: 3, label: '甲', dir: 'none' }],
    });
    expect(ok.figure.axis.unit).toBe('个百分点');
  });

  it('quadrant：四格缺一即丢弃；靶盘点越界丢弃', async () => {
    const cells = [
      { title: '高信高效', body: ['可直接用'], tone: 'ok', icon: { kind: 'target', dots: [[0, 0], [40, 0]] } },
      { title: '高信低效', body: ['口径不对'], tone: 'warn' },
      { title: '低信高效', body: [] },
      { title: '低信低效', body: [] },
    ];
    const ok = await runWithFigure({ kind: 'quadrant', spec: { colLabels: ['效度高', '效度低'], rowLabels: [{ label: '信度高' }], cells } });
    expect(ok.figure.spec.cells).toHaveLength(4);
    expect(ok.figure.spec.cells[0].icon.dots).toEqual([[0, 0]]);

    const bad = await runWithFigure({ kind: 'quadrant', spec: { cells: cells.slice(0, 3) } });
    expect(bad.figure).toBeUndefined();
  });


  it('bipartite：只保留两端存在的连线；没有连线即丢弃', async () => {
    const ok = await runWithFigure({
      kind: 'bipartite',
      spec: {
        left: { head: '目标', nodes: [{ id: 'a', label: '倾听' }, { id: 'b', label: '表达' }] },
        right: { head: '建议', nodes: [{ id: 'x', label: '多给机会' }] },
        edges: [{ from: 'a', to: 'x' }, { from: 'a', to: 'ghost' }],
      },
    });
    expect(ok.figure.spec.edges).toEqual([{ from: 'a', to: 'x' }]);

    const bad = await runWithFigure({
      kind: 'bipartite',
      spec: { left: { nodes: [{ id: 'a', label: '甲' }] }, right: { nodes: [{ id: 'x', label: '乙' }] }, edges: [] },
    });
    expect(bad.figure).toBeUndefined();
  });

  it('bipartite：没有连线的孤岛节点剪掉（外审 #7/#13：内层列表悬空，最该见的共用关系没画）', async () => {
    const ok = await runWithFigure({
      kind: 'bipartite',
      spec: {
        left: { nodes: [{ id: 'a', label: 'a' }, { id: 'b', label: 'b' }] },
        right: {
          nodes: [
            { id: 'outer', label: '外层列表' },
            { id: 'inner1', label: '内层 [1,2]' },
            { id: 'inner2', label: '内层 [3]' },
          ],
        },
        edges: [{ from: 'a', to: 'outer' }, { from: 'b', to: 'outer' }],
      },
    });
    expect(ok.figure.spec.right.nodes).toEqual([{ id: 'outer', label: '外层列表' }]);

    // 剪完一侧为空 = 没有对照关系，整张作废
    const bad = await runWithFigure({
      kind: 'bipartite',
      spec: {
        left: { nodes: [{ id: 'a', label: 'a' }] },
        right: { nodes: [{ id: 'x', label: 'x' }, { id: 'y', label: 'y' }] },
        edges: [{ from: 'a', to: 'x' }],
      },
    });
    expect(bad.figure.spec.right.nodes).toEqual([{ id: 'x', label: 'x' }]);
  });


  it('board：坐标越界/非法棋子键丢弃；棋子不足两个即丢弃', async () => {
    const ok = await runWithFigure({
      kind: 'board',
      spec: {
        pieces: [
          { col: 4, rank: 9, key: 'K' },
          { col: 4, rank: 0, key: 'k' },
          { col: 9, rank: 9, key: 'R' },
          { col: 2, rank: 2, key: 'Z' },
        ],
        arrows: [{ a1: { col: 4, rank: 9 }, a2: { col: 4, rank: 7 }, label: '进一' }],
      },
    });
    expect(ok.figure.spec.pieces).toEqual([
      { col: 4, rank: 9, key: 'K' },
      { col: 4, rank: 0, key: 'k' },
    ]);
    expect(ok.figure.spec.arrows).toEqual([{ a1: { col: 4, rank: 9 }, a2: { col: 4, rank: 7 }, label: '进一' }]);

    const bad = await runWithFigure({ kind: 'board', spec: { pieces: [{ col: 4, rank: 9, key: 'K' }] } });
    expect(bad.figure).toBeUndefined();
  });


  it('balance：两侧都要有标题与条目；weight 越界丢弃、focus 只认 side', async () => {
    const ok = await runWithFigure({
      kind: 'balance',
      spec: {
        title: '两种做法哪边压得住',
        left: { head: '先讲后练', items: ['概念清楚', '练得少'], weight: 6 },
        right: { head: '先练后讲', items: ['暴露问题', '容易挫败'], weight: 4 },
        pivotLabel: '课堂时间',
        focus: 'RIGHT',
      },
    });
    expect(ok.figure.spec.left.weight).toBe(6);
    expect(ok.figure.spec.right.weight).toBe(4);
    expect(ok.figure.spec.focus).toBe('right');
    expect(ok.figure.spec.pivotLabel).toBe('课堂时间');

    // 任一侧无条目 → 丢弃
    expect(
      (await runWithFigure({ kind: 'balance', spec: { left: { head: '左', items: ['a'] }, right: { head: '右', items: [] } } }))
        .figure,
    ).toBeUndefined();
    // weight 越界（>10）被丢；非法 focus 被丢
    const loose = await runWithFigure({
      kind: 'balance',
      spec: {
        left: { head: '左', items: ['a'], weight: 99 },
        right: { head: '右', items: ['b'] },
        focus: 'middle',
      },
    });
    expect(loose.figure.spec.left.weight).toBeUndefined();
    expect(loose.figure.spec.focus).toBeUndefined();
  });


  it('cycle：3~6 个节点；"?" 归一成留白槽；不足三个节点整块丢弃', async () => {
    const ok = await runWithFigure({
      kind: 'cycle',
      spec: {
        title: '四部件是一个环',
        center: '每一轮都回到同一个问题',
        nodes: [
          { label: '驱动问题', sub: '为什么非做不可' },
          { label: '持续探究' },
          { label: '公开产出', mask: true },
          { label: '评价与记录' },
        ],
      },
    });
    expect(ok.figure.spec.nodes).toHaveLength(4);
    expect(ok.figure.spec.nodes[2]).toEqual({ label: '?', mask: true });
    expect(ok.figure.spec.center).toBe('每一轮都回到同一个问题');

    const few = await runWithFigure({ kind: 'cycle', spec: { nodes: [{ label: '甲' }, { label: '乙' }] } });
    expect(few.figure).toBeUndefined();
    const many = await runWithFigure({
      kind: 'cycle',
      spec: { nodes: Array.from({ length: 9 }, (_, i) => ({ label: `第 ${i + 1} 步` })) },
    });
    expect(many.figure.spec.nodes).toHaveLength(6);
  });

  it('tree：根必需、分支 2~6 个、每支最多两条要点；"?" 要点保留为槽', async () => {
    const ok = await runWithFigure({
      kind: 'tree',
      spec: {
        root: { label: '幼儿园五大领域', sub: '同一层' },
        branches: [
          { label: '健康', items: ['易混：社会', '易混：生活'] },
          { label: '语言', items: ['?'] },
          { label: '艺术', items: ['易混：语言', '多余第三条', '多余第四条'] },
        ],
      },
    });
    expect(ok.figure.spec.root.label).toBe('幼儿园五大领域');
    expect(ok.figure.spec.branches).toHaveLength(3);
    expect(ok.figure.spec.branches[1].items).toEqual(['?']);
    expect(ok.figure.spec.branches[2].items).toEqual(['易混：语言', '多余第三条']);

    expect((await runWithFigure({ kind: 'tree', spec: { branches: [{ label: '甲' }, { label: '乙' }] } })).figure).toBeUndefined();
    expect((await runWithFigure({ kind: 'tree', spec: { root: { label: '根' }, branches: [{ label: '甲' }] } })).figure).toBeUndefined();
  });

  it('venn：两侧必须都有标题；交集可缺省；例子超上限截断', async () => {
    const ok = await runWithFigure({
      kind: 'venn',
      spec: {
        left: { head: '社会', items: ['轮流收玩具', '按约定归位'] },
        right: { head: '科学', items: ['按属性分类'] },
        overlap: { head: '两边都算', items: ['按同一规则', '第二条', '第三条'] },
      },
    });
    expect(ok.figure.spec.left.head).toBe('社会');
    expect(ok.figure.spec.overlap.items).toEqual(['按同一规则', '第二条']);

    const noRight = await runWithFigure({ kind: 'venn', spec: { left: { head: '甲' } } });
    expect(noRight.figure).toBeUndefined();
  });

  it('bullseye：四格必须齐；dots 归一化到 [-1,1]，非法点丢弃', async () => {
    const cells = [
      { title: '稳且准', tone: 'ok', dots: [[0.1, 0.2], [9, -9]] },
      { title: '稳定地打偏', tone: 'warn', dots: [[0.7, -0.2]] },
      { title: '方向对但太散', dots: [['x', 1], [0.3, 0.3]] },
      { title: '又偏又散', tone: 'warn', dots: [] },
    ];
    const ok = await runWithFigure({
      kind: 'bullseye',
      spec: { colLabels: ['高效度', '低效度'], rowLabels: [{ label: '高信度', sub: '每次一致' }, { label: '低信度' }], cells },
    });
    expect(ok.figure.spec.cells).toHaveLength(4);
    // 越界被夹到边缘
    expect(ok.figure.spec.cells[0].dots).toEqual([[0.1, 0.2], [1, -1]]);
    // 非法点被丢
    expect(ok.figure.spec.cells[2].dots).toEqual([[0.3, 0.3]]);
    expect(ok.figure.spec.cells[3].dots).toBeUndefined();

    const three = await runWithFigure({
      kind: 'bullseye',
      spec: { colLabels: ['a', 'b'], rowLabels: [{ label: '上' }, { label: '下' }], cells: cells.slice(0, 3) },
    });
    expect(three.figure).toBeUndefined();
  });

  it('palette：白名单内保留，非法值不上图；focus 越界丢弃', async () => {
    const earth = await runWithFigure({
      kind: 'quadrant',
      palette: ' Earth ',
      spec: {
        colLabels: ['效度高', '效度低'],
        rowLabels: [{ label: '信度高' }],
        cells: [{ title: '高信高效' }, { title: '高信低效' }, { title: '低信高效' }, { title: '低信低效' }],
      },
    });
    expect(earth.figure.palette).toBe('earth');

    const neon = await runWithFigure({
      kind: 'quadrant',
      palette: 'neon',
      spec: {
        colLabels: ['效度高', '效度低'],
        rowLabels: [{ label: '信度高' }],
        cells: [{ title: '高信高效' }, { title: '高信低效' }, { title: '低信高效' }, { title: '低信低效' }],
      },
    });
    expect(neon.figure.palette).toBeUndefined();

    const focusOk = await runWithFigure({
      kind: 'venn',
      spec: { left: { head: '甲', items: ['x'] }, right: { head: '乙', items: ['y'] } },
    });
    expect(focusOk.figure.spec.focus).toBeUndefined();
  });

  it('未知图型整块丢弃；spec 与顶层字段两种写法都接受', async () => {
    expect((await runWithFigure({ kind: 'pie-chart', spec: { rows: 1, cols: 1 } })).figure).toBeUndefined();

    const topLevel = await runWithFigure({
      kind: 'venn',
      left: { head: '左', items: ['a'] },
      right: { head: '右', items: ['b'] },
    });
    expect(topLevel.figure.kind).toBe('venn');
  });

  it('kill switch：TEACHING_FIGURE_SPEC_DISABLED=1 时只保留位置线', async () => {
    const previous = process.env.TEACHING_FIGURE_SPEC_DISABLED;
    process.env.TEACHING_FIGURE_SPEC_DISABLED = '1';
    try {
      const specFigure = await runWithFigure({
        kind: 'venn',
        spec: { left: { head: '左', items: ['a'] }, right: { head: '右', items: ['b'] } },
      });
      expect(specFigure.figure).toBeUndefined();
      const line = await runWithFigure({ marks: [{ at: 1, label: '甲' }, { at: 2, label: '乙' }] });
      expect(line.figure.kind).toBe('position-line');
    } finally {
      if (previous === undefined) delete process.env.TEACHING_FIGURE_SPEC_DISABLED;
      else process.env.TEACHING_FIGURE_SPEC_DISABLED = previous;
    }
  });
});



describe('位置线：group（归类括号）与 spans（跨度）分工', () => {
  const run = async (extra: Record<string, unknown>) => runWithFigure({
    kind: 'position-line',
    axis: { min: 0, max: 4, unit: '米' },
    marks: [
      { at: 1, label: '第一道' },
      { at: 2, label: '第二道' },
      { at: 3, label: '第三道' },
    ],
    ...extra,
  } as never);

  it('group 原样保留，且端点并入数值域', async () => {
    const out = await run({ group: { from: 1, to: 3, label: '同一个毛病' } });
    expect(out.figure.group).toEqual({ from: 1, to: 3, label: '同一个毛病' });
    expect(out.figure.axis.min).toBeLessThanOrEqual(1);
    expect(out.figure.axis.max).toBeGreaterThanOrEqual(3);
  });

  it('group 端点颠倒自动纠正；缺 label 或 from===to 丢弃', async () => {
    const flipped = await run({ group: { from: 3, to: 1, label: '同一类' } });
    expect(flipped.figure.group).toEqual({ from: 1, to: 3, label: '同一类' });
    expect((await run({ group: { from: 1, to: 3 } })).figure.group).toBeUndefined();
    expect((await run({ group: { from: 2, to: 2, label: 'x' } })).figure.group).toBeUndefined();
  });
});

describe('位置线的轴必须是量，不能是序号（2026-10-20 实跑：把三道题画成位置线）', () => {
  it('unit 是「题/个/条/种」这类计数 → 整张图丢弃', async () => {
    for (const unit of ['题', '题号', '个', '条', '种', '类']) {
      const out = await runWithFigure({
        kind: 'position-line',
        axis: { min: 0, max: 4, unit, ticks: [{ at: 1 }, { at: 2 }, { at: 3 }] },
        marks: [{ at: 1, label: '第一道' }, { at: 2, label: '第二道' }],
      } as never);
      expect(out.figure).toBeUndefined();
    }
  });

  it('真正的一维量（米/秒/℃/元）照常出图', async () => {
    for (const unit of ['米', '秒', '℃', '元']) {
      const out = await runWithFigure({
        kind: 'position-line',
        axis: { min: 0, max: 100, unit },
        marks: [{ at: 20, label: '甲' }, { at: 80, label: '乙' }],
      } as never);
      expect(out.figure?.kind).toBe('position-line');
    }
  });
});

describe('teaching-turn figure 归一化（range-bar，2026-10-21 外审 #4~#7）', () => {
  beforeEach(() => mockCallPrompt.mockReset());

  it('区间条：2~4 行、from/to 顺序归一、tone 白名单、unit 走短单位', async () => {
    const teaching = await runWithFigure({
      kind: 'range-bar',
      title: '四天各自的波动范围',
      unit: '%',
      rows: [
        { label: '新组', from: 3.8, to: 3.1, tone: 'accent' },
        { label: '旧组', from: 2.9, to: 3.6, tone: 'rainbow' },
      ],
      marks: [{ at: 0.5, label: '汇报的均值差' }],
    });
    expect(teaching.figure.kind).toBe('range-bar');
    expect(teaching.figure.spec.rows[0]).toEqual({ label: '新组', from: 3.1, to: 3.8, tone: 'accent' });
    expect(teaching.figure.spec.rows[1].tone).toBeUndefined();
    expect(teaching.figure.spec.unit).toBe('%');
    expect(teaching.figure.spec.marks[0].label).toBe('汇报的均值差');
  });

  it('区间条：不足两行 / 缺数字 / from===to → 整块丢弃', async () => {
    const one = await runWithFigure({
      kind: 'range-bar',
      rows: [{ label: '新组', from: 1, to: 2 }],
    });
    expect(one.figure).toBeUndefined();

    const noNumber = await runWithFigure({
      kind: 'range-bar',
      rows: [{ label: '新组', from: '一点一', to: 2 }, { label: '旧组', from: 1, to: 2 }],
    });
    expect(noNumber.figure).toBeUndefined();
  });
});

describe('退役图型（用户 2026-10-23：「这不叫图，叫制表信息」）', () => {
  it('grid / compare / bins / ladder 一律拒绝，即使 spec 完全合法', async () => {
    const grid = await runWithFigure({
      kind: 'grid',
      spec: { rows: 1, cols: 2, cells: [{ r: 0, c: 0, text: '3 m/s' }, { r: 0, c: 1, text: '6 m/s' }] },
    });
    expect(grid.figure).toBeUndefined();

    const compare = await runWithFigure({
      kind: 'compare',
      spec: { left: { head: '左', chain: [{ label: 'a' }] }, right: { head: '右', chain: [{ label: 'b' }] } },
    });
    expect(compare.figure).toBeUndefined();

    const bins = await runWithFigure({ kind: 'bins', spec: { bins: [{ head: '甲', items: ['x'] }, { head: '乙', items: ['y'] }] } });
    expect(bins.figure).toBeUndefined();

    const ladder = await runWithFigure({ kind: 'ladder', spec: { steps: [{ label: '一级' }, { label: '二级' }] } });
    expect(ladder.figure).toBeUndefined();
  });
});

describe('cartesian-plot：二维坐标图（2026-10-23 平抛课实测）', () => {
  const base = {
    x: { label: '水平距离 / m', min: 0, max: 3, ticks: [0, 1, 2, 3] },
    y: { label: '高度 / m', min: 0, max: 1, ticks: [0, 0.5, 1] },
  };

  it('抛物线 + 频闪点 + 等时刻辅助线：保留并原样带出', async () => {
    const ok = await runWithFigure({
      kind: 'cartesian-plot',
      spec: {
        ...base,
        title: '平抛频闪：3 m/s vs 6 m/s',
        series: [
          { name: '3 m/s', form: 'parabola', a: -0.55, b: 0, c: 1, tone: 'ok' },
          { name: '6 m/s', form: 'parabola', a: -0.55, b: 0, c: 1, tone: 'accent', dots: true },
        ],
        guides: [{ axis: 'y', at: 0.8, label: 't=0.4 s' }],
        vectors: [{ at: [0, 1], dx: 0.6, dy: 0, label: 'v₀' }],
        marks: [{ at: [3, 0], label: '落地', tone: 'accent' }],
      },
    });
    expect(ok.figure.kind).toBe('cartesian-plot');
    expect(ok.figure.spec.series).toHaveLength(2);
    expect(ok.figure.spec.series[1].form).toBe('parabola');
    expect(ok.figure.spec.guides).toEqual([{ axis: 'y', at: 0.8, label: 't=0.4 s' }]);
    expect(ok.figure.spec.vectors).toHaveLength(1);
    expect(ok.figure.spec.marks).toHaveLength(1);
  });

  it('轴区间缺失/反向、系列为空 → 整张丢弃；越界辅助线与点不画', async () => {
    expect((await runWithFigure({ kind: 'cartesian-plot', spec: { ...base, x: { min: 3, max: 0 }, series: [{ name: 'a', points: [[0, 1], [1, 2]] }] } })).figure).toBeUndefined();
    expect((await runWithFigure({ kind: 'cartesian-plot', spec: { ...base, series: [] } })).figure).toBeUndefined();
    const bad = await runWithFigure({
      kind: 'cartesian-plot',
      spec: { ...base, series: [{ name: 'a', points: [[0, 1], [1, 2]] }], guides: [{ axis: 'y', at: 9, label: '越界' }] },
    });
    expect(bad.figure.spec.guides).toBeUndefined();
  });

  it('抛物线缺系数 / 散点无点 → 该系列丢弃；全丢则整张作废', async () => {
    const one = await runWithFigure({
      kind: 'cartesian-plot',
      spec: {
        ...base,
        series: [
          { name: '坏', form: 'parabola' },
          { name: '好', points: [[0, 1], [1, 0.6]] },
        ],
      },
    });
    expect(one.figure.spec.series).toHaveLength(1);

    const none = await runWithFigure({ kind: 'cartesian-plot', spec: { ...base, series: [{ name: '坏', form: 'scatter' }] } });
    expect(none.figure).toBeUndefined();
  });
});

describe('concept-map：概念结构图（2026-10-23 用户定调：要概念可视化，不是出题）', () => {
  it('节点 + 带名字的边保留；没有关系名的边丢弃；孤岛节点剪掉', async () => {
    const ok = await runWithFigure({
      kind: 'concept-map',
      spec: {
        title: '光合作用：两个阶段怎么接上',
        nodes: [
          { id: 'light', label: '光反应', sub: '类囊体膜', tone: 'accent', layer: 0 },
          { id: 'atp', label: 'ATP / NADPH', sub: '能量与还原力', layer: 1 },
          { id: 'dark', label: '暗反应', sub: '叶绿体基质', layer: 2 },
          { id: 'ghost', label: '孤岛概念' },
        ],
        edges: [
          { from: 'light', to: 'atp', label: '产生' },
          { from: 'atp', to: 'dark', label: '供给' },
          { from: 'light', to: 'dark' },
        ],
      },
    });
    expect(ok.figure.kind).toBe('concept-map');
    expect(ok.figure.spec.nodes.map((n: any) => n.id)).toEqual(['light', 'atp', 'dark']);
    expect(ok.figure.spec.edges).toHaveLength(2);

    const noEdges = await runWithFigure({ kind: 'concept-map', spec: { nodes: [{ id: 'a', label: '甲' }, { id: 'b', label: '乙' }] } });
    expect(noEdges.figure).toBeUndefined();
  });

  it('边端点不存在 / 自环 → 丢弃；只剩一条边仍成立', async () => {
    const one = await runWithFigure({
      kind: 'concept-map',
      spec: {
        nodes: [{ id: 'a', label: '甲' }, { id: 'b', label: '乙' }],
        edges: [
          { from: 'a', to: 'b', label: '导致' },
          { from: 'a', to: 'a', label: '自环' },
          { from: 'a', to: 'zzz', label: '悬空' },
        ],
      },
    });
    expect(one.figure.spec.edges).toEqual([{ from: 'a', to: 'b', label: '导致' }]);
  });
});

describe('split-compare：正误并排对比（2026-10-26 动作诊所）', () => {
  it('左右面板 + delta 保留；空 rows 面板整图拒绝', async () => {
    const ok = await runWithFigure({
      kind: 'split-compare',
      spec: {
        title: '换算：先除还是先换算',
        left: { head: '常见错法', tone: 'warn', rows: [{ label: '60 ÷ 400', sub: '把秒当分钟除' }, { label: '得 0.15 分/米' }] },
        right: { head: '正确做法', tone: 'ok', rows: [{ label: '60 × 400 ÷ 1000', sub: '先把米换算成千米' }, { label: '得 24 分/千米' }] },
        delta: { label: '分叉在第一步：先换算再除', at: 1 },
      },
    });
    expect(ok.figure.kind).toBe('split-compare');
    expect(ok.figure.spec.left.head).toBe('常见错法');
    expect(ok.figure.spec.right.rows).toHaveLength(2);
    expect(ok.figure.spec.delta).toEqual({ label: '分叉在第一步：先换算再除', at: 1 });

    const empty = await runWithFigure({
      kind: 'split-compare',
      spec: { left: { head: 'A', rows: [{ label: '甲' }] }, right: { head: 'B', rows: [] } },
    });
    expect(empty.figure).toBeUndefined();
  });

  it('delta.at 越界丢弃；head 缺失整图拒绝；行 label 缺失该行丢弃', async () => {
    const trimmed = await runWithFigure({
      kind: 'split-compare',
      spec: {
        left: { head: '错', rows: [{ label: '甲' }, { label: '乙' }] },
        right: { head: '对', rows: [{ label: '甲' }, { label: '乙' }] },
        delta: { label: '分叉', at: 9 },
      },
    });
    expect(trimmed.figure.spec.delta).toEqual({ label: '分叉' });

    const noHead = await runWithFigure({
      kind: 'split-compare',
      spec: { left: { rows: [{ label: '甲' }] }, right: { head: '对', rows: [{ label: '甲' }] } },
    });
    expect(noHead.figure).toBeUndefined();
  });
});

describe('state-strip：不回头的进程分帧（2026-10-26）', () => {
  it('2~5 帧保留；items 截到 3 条、去重；单帧拒绝', async () => {
    const ok = await runWithFigure({
      kind: 'state-strip',
      spec: {
        title: 'TCP 三次握手',
        frames: [
          { label: 'SYN', tone: 'neutral', items: ['客户端 SYN_SENT', '服务端 LISTEN', '第一次', '多余第四条'] },
          { label: 'SYN+ACK', items: ['服务端 SYN_RCVD', '服务端 SYN_RCVD'] },
          { label: 'ACK', tone: 'ok', items: ['双方 ESTABLISHED'] },
        ],
        note: '每一步都是状态迁移，走完不回头',
      },
    });
    expect(ok.figure.kind).toBe('state-strip');
    expect(ok.figure.spec.frames).toHaveLength(3);
    expect(ok.figure.spec.frames[0].items).toEqual(['客户端 SYN_SENT', '服务端 LISTEN', '第一次']);
    expect(ok.figure.spec.frames[1].items).toEqual(['服务端 SYN_RCVD']);

    const one = await runWithFigure({ kind: 'state-strip', spec: { frames: [{ label: '只有一步', items: ['x'] }] } });
    expect(one.figure).toBeUndefined();
  });
});
