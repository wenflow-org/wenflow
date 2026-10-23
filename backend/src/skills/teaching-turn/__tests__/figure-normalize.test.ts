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

describe('网格列标题对齐（2026-10-23 外审：缺一个表头会让后面的标题整体左移）', () => {
  it('列标题少于列数时补空串：第二个标题仍落在第二列', async () => {
    const out = await runWithFigure({
      kind: 'grid',
      rows: 2,
      cols: 3,
      colLabels: ['外层 id(a) vs id(b)', '是否波及 a'],
      cells: [{ r: 0, c: 0, text: '相同' }, { r: 0, c: 1, text: '相同' }, { r: 0, c: 2, text: '会' }],
    });
    expect(out.figure?.kind).toBe('grid');
    expect(out.figure.spec.colLabels).toEqual(['外层 id(a) vs id(b)', '是否波及 a', '']);
  });

  it('行标题少于行数时同样补齐', async () => {
    const out = await runWithFigure({
      kind: 'grid',
      rows: 2,
      cols: 1,
      rowLabels: ['第一行'],
      cells: [{ r: 0, c: 0, text: '甲' }, { r: 1, c: 0, text: '乙' }],
    });
    expect(out.figure.spec.rowLabels).toEqual(['第一行', '']);
  });
});

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

  it('grid：全空网格丢弃（填表不是图）；有内容的保留', async () => {
    const blank = await runWithFigure({ kind: 'grid', spec: { rows: 2, cols: 2, cells: [] } });
    expect(blank.figure).toBeUndefined();

    const partly = await runWithFigure({
      kind: 'grid',
      spec: {
        rows: 2,
        cols: 2,
        rowLabels: ['甲', '乙'],
        colLabels: ['位置', '方向'],
        cells: [
          { r: 0, c: 0, text: '前面', hl: 'accent' },
          { r: 0, c: 1, text: '向右' },
          { r: 1, c: 0, mask: true },
          { r: 1, c: 1, text: '这个格子里的字太长了超过了二十六个字的上限因此这一条应当被丢掉' },
        ],
      },
    });
    expect(partly.figure.kind).toBe('grid');
    expect(partly.figure.spec.cells).toEqual([
      { r: 0, c: 0, text: '前面', hl: 'accent' },
      { r: 0, c: 1, text: '向右' },
      { r: 1, c: 0, mask: true },
    ]);
  });

  it('compare：左右都要有标题与条目；tone 非法回落默认（左中性/右强调）', async () => {
    const ok = await runWithFigure({
      kind: 'compare',
      spec: {
        left: { head: '行为主义', items: ['看结果', '给反馈'], chain: [{ label: '看结果' }] },
        right: { head: '建构主义', items: ['看过程'] },
        leftTone: 'rainbow',
      },
    });
    expect(ok.figure.spec.left.items).toEqual(['看结果', '给反馈']);
    // 左栏常放反例：默认不再刷成「通过绿」，给中性；右栏留强调色
    expect(ok.figure.spec.leftTone).toBe('neutral');
    expect(ok.figure.spec.rightTone).toBe('accent');

    const warn = await runWithFigure({
      kind: 'compare',
      spec: {
        left: { head: '反例', items: ['x'], chain: [{ label: 'x' }] },
        right: { head: '正解', items: ['y'] },
        leftTone: 'warn',
        divider: '汇报的差值是 0.5 个点，比同组自身晃动还小，这句话故意写得很长用来验证截断',
      },
    });
    expect(warn.figure.spec.leftTone).toBe('warn');
    expect(warn.figure.spec.divider).toHaveLength(24);

    const bad = await runWithFigure({ kind: 'compare', spec: { left: { head: '左', items: [] }, right: { head: '右', items: ['x'] } } });
    expect(bad.figure).toBeUndefined();
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

  it('bins：2~4 个箱子、至少一箱有内容；空箱丢弃、focus 越界丢弃', async () => {
    const ok = await runWithFigure({
      kind: 'bins',
      spec: {
        title: '把证据分到三个箱子里',
        bins: [
          { label: '能直接采信', items: [{ label: '同一口径复现' }, { label: '样本够大', mark: '强' }], tone: 'ok' },
          { label: '只能参考', items: ['个案经验'] },
          { label: '不能用', items: [] },
        ],
        focus: 1,
      },
    });
    expect(ok.figure.spec.bins).toHaveLength(3);
    expect(ok.figure.spec.bins[0].items).toEqual([
      { label: '同一口径复现' },
      { label: '样本够大', mark: '强' },
    ]);
    expect(ok.figure.spec.focus).toBe(1);

    // 只有一个箱子 / 全空 → 丢弃
    expect((await runWithFigure({ kind: 'bins', spec: { bins: [{ label: '甲', items: ['a'] }] } })).figure).toBeUndefined();
    expect(
      (await runWithFigure({ kind: 'bins', spec: { bins: [{ label: '甲', items: [] }, { label: '乙', items: [] }] } })).figure,
    ).toBeUndefined();
    // 越界 focus 被丢，图本身仍保留
    const over = await runWithFigure({
      kind: 'bins',
      spec: { bins: [{ label: '甲', items: ['a'] }, { label: '乙', items: [] }], focus: 9 },
    });
    expect(over.figure.spec.focus).toBeUndefined();
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

  it('ladder：2~6 级；state 非法即丢该字段，steps 不足两级整块丢弃', async () => {
    const ok = await runWithFigure({
      kind: 'ladder',
      spec: {
        title: '从读懂到能改',
        steps: [
          { label: '读懂例题', state: 'done', sub: '第 1 课时' },
          { label: '自己走一遍', state: 'CURRENT' },
          { label: '换条件重做', state: 'rainbow' },
        ],
        focus: 2,
      },
    });
    expect(ok.figure.spec.steps).toEqual([
      { label: '读懂例题', sub: '第 1 课时', state: 'done' },
      { label: '自己走一遍', state: 'current' },
      { label: '换条件重做' },
    ]);
    expect(ok.figure.spec.focus).toBe(2);

    expect((await runWithFigure({ kind: 'ladder', spec: { steps: [{ label: '只有一级' }] } })).figure).toBeUndefined();
    const capped = await runWithFigure({
      kind: 'ladder',
      spec: { steps: Array.from({ length: 9 }, (_, i) => ({ label: `第 ${i + 1} 级` })) },
    });
    expect(capped.figure.spec.steps).toHaveLength(6);
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

  it('palette：白名单内保留，非法值不上图；focus 行/列越界丢弃', async () => {
    const earth = await runWithFigure({
      kind: 'ladder',
      palette: ' Earth ',
      spec: { steps: [{ label: '第一级' }, { label: '第二级' }] },
    });
    expect(earth.figure.palette).toBe('earth');

    const neon = await runWithFigure({
      kind: 'ladder',
      palette: 'neon',
      spec: { steps: [{ label: '第一级' }, { label: '第二级' }] },
    });
    expect(neon.figure.palette).toBeUndefined();

    const focusOk = await runWithFigure({
      kind: 'grid',
      spec: {
        rows: 2,
        cols: 2,
        cells: [
          { r: 0, c: 0, text: '甲' },
          { r: 1, c: 1, text: '乙' },
        ],
        focus: { row: 1, col: 1 },
      },
    });
    expect(focusOk.figure.spec.focus).toEqual({ row: 1, col: 1 });

    const focusBad = await runWithFigure({
      kind: 'grid',
      spec: {
        rows: 2,
        cols: 2,
        cells: [
          { r: 0, c: 0, text: '甲' },
          { r: 1, c: 1, text: '乙' },
        ],
        focus: { row: 9, col: 9, side: 'left' },
      },
    });
    expect(focusBad.figure.spec.focus).toBeUndefined();
  });

  it('未知图型整块丢弃；spec 与顶层字段两种写法都接受', async () => {
    expect((await runWithFigure({ kind: 'pie-chart', spec: { rows: 1, cols: 1 } })).figure).toBeUndefined();

    const topLevel = await runWithFigure({
      kind: 'compare',
      left: { head: '左', items: ['a'], chain: [{ label: 'a' }] },
      right: { head: '右', items: ['b'] },
    });
    expect(topLevel.figure.kind).toBe('compare');
  });

  it('kill switch：TEACHING_FIGURE_SPEC_DISABLED=1 时只保留位置线', async () => {
    const previous = process.env.TEACHING_FIGURE_SPEC_DISABLED;
    process.env.TEACHING_FIGURE_SPEC_DISABLED = '1';
    try {
      const specFigure = await runWithFigure({
        kind: 'compare',
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

describe('compare 链路形态（架构/请求路径对比）', () => {
  it('只给 chain 不给 items 也成立：跳数是信息本身，不靠条目凑版面', async () => {
    const out = await runWithFigure({
      kind: 'compare',
      spec: {
        left: {
          head: '外置协调',
          badge: '2 套集群 · 2 次独立共识',
          badgeTone: 'warn',
          client: '客户端',
          chain: [
            { label: '共识一：协调集群', sub: '定路由、选主', tone: 'warn' },
            { label: '共识二：存储节点', sub: '写日志与数据', tone: 'warn' },
          ],
        },
        right: {
          head: '内置共识',
          badge: '单一系统 · 1 次共识',
          badgeTone: 'ok',
          chain: [{ label: '业务进程内置状态机', sub: '两件事落同一条日志', merged: true, tone: 'ok' }],
        },
      },
    });
    expect(out.figure.kind).toBe('compare');
    expect(out.figure.spec.left.chain).toHaveLength(2);
    expect(out.figure.spec.right.chain[0].merged).toBe(true);
    expect(out.figure.spec.left.badge).toBe('2 套集群 · 2 次独立共识');
    expect(out.figure.spec.right.badgeTone).toBe('ok');
    expect(out.figure.spec.left.client).toBe('客户端');
    // items 允许为空（旧契约要求必须有条目，链路形态下不成立）
    expect(out.figure.spec.left.items).toEqual([]);
  });

  it('boundaryLabel：随内容传（组件异步边界），不给则保持默认（渲染器回落集群边界）', async () => {
    const out = await runWithFigure({
      kind: 'compare',
      spec: {
        left: { head: '错误现状', boundaryLabel: '组件异步边界', chain: [{ label: '请求发出' }] },
        right: { head: '应有形状', chain: [{ label: '带号请求' }] },
      },
    });
    expect(out.figure.spec.left.boundaryLabel).toBe('组件异步边界');
    expect(out.figure.spec.right.boundaryLabel).toBeUndefined();

    const tooLong = await runWithFigure({
      kind: 'compare',
      spec: {
        left: { head: '左', boundaryLabel: '这是一个非常非常长的边界说明文字', chain: [{ label: '一跳' }] },
        right: { head: '右', chain: [{ label: '一跳' }] },
      },
    });
    expect(String(tooLong.figure.spec.left.boundaryLabel).length).toBeLessThanOrEqual(10);
  });

  it('链节点缺 label 丢弃；全部无效且无 items → 整块丢弃', async () => {
    const out = await runWithFigure({
      kind: 'compare',
      spec: {
        left: { head: '左', chain: [{ sub: '没有标签' }, { label: '有效一跳' }] },
        right: { head: '右', items: ['有条目'] },
      },
    });
    expect(out.figure.spec.left.chain).toHaveLength(1);
    expect(out.figure.spec.left.chain[0].label).toBe('有效一跳');

    const bad = await runWithFigure({ kind: 'compare', spec: { left: { head: '左', chain: [] }, right: { head: '右' } } });
    expect(bad.figure).toBeUndefined();
  });

  it('链长上限 4 跳（再多就不是「对比几条路径」而是画布线图了）', async () => {
    const out = await runWithFigure({
      kind: 'compare',
      spec: {
        left: { head: '左', chain: Array.from({ length: 7 }, (_, i) => ({ label: `第${i + 1}跳` })) },
        right: { head: '右', chain: [{ label: '一跳' }] },
      },
    });
    expect(out.figure.spec.left.chain).toHaveLength(4);
  });
});

describe('compare 链路形态：顺序段与往返', () => {
  it('from:"prev" 承接上一张卡；第一个节点不能承接（回落成客户端直连）', async () => {
    const out = await runWithFigure({
      kind: 'compare',
      spec: {
        left: {
          head: '分开部署',
          chain: [
            { label: '网关', from: 'prev' },
            { label: '订单服务', from: 'prev' },
          ],
        },
        right: { head: '同进程', chain: [{ label: '单模块' }] },
      },
    });
    // 第一个节点的 from 无意义，必须被丢掉，否则渲染层找不到「上一张卡」
    expect(out.figure.spec.left.chain[0].from).toBeUndefined();
    expect(out.figure.spec.left.chain[1].from).toBe('prev');
  });

  it('rtt:true 保留（表示这一跳要等回话，不是单向投递）', async () => {
    const out = await runWithFigure({
      kind: 'compare',
      spec: {
        left: { head: '左', chain: [{ label: '网关', rtt: true }] },
        right: { head: '右', chain: [{ label: '单模块' }] },
      },
    });
    expect(out.figure.spec.left.chain[0].rtt).toBe(true);
    expect(out.figure.spec.right.chain[0].rtt).toBeUndefined();
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

describe('条目对象形态与显式并联（2026-10-22 真课丢图）', () => {
  it('compare 条目写成 {label} 对象时照收，不再整栏清空导致丢图', async () => {
    const out = await runWithFigure({
      kind: 'compare',
      left: { head: '一般过去', items: [{ label: '只锁定过去那一下' }, { text: '与现在断开' }], chain: [{ label: '过去' }] },
      right: { head: '现在完成', items: [{ value: '结果延续到现在' }] },
      divider: '有没有碰到 NOW',
    });
    expect(out.figure?.kind).toBe('compare');
    expect(out.figure.spec.left.items).toEqual(['只锁定过去那一下', '与现在断开']);
    expect(out.figure.spec.right.items).toEqual(['结果延续到现在']);
  });

  it('链路里显式的 from:"client" 要保留（渲染器缺省=串联后，扇出只能靠它表达）', async () => {
    const out = await runWithFigure({
      kind: 'compare',
      left: {
        head: '客户端并联',
        client: '浏览器',
        chain: [{ label: '请求一' }, { label: '请求二', from: 'client' }],
      },
      right: { head: '顺序链路', client: '浏览器', chain: [{ label: '请求' }, { label: '响应回来' }] },
    });
    expect(out.figure.spec.left.chain[1].from).toBe('client');
    expect(out.figure.spec.right.chain[1].from).toBeUndefined();
  });
});

describe('纯两栏文字对照不再出图（2026-10-23 外部视觉评审）', () => {
  it('没有链路的两栏对照整块丢弃', async () => {
    const out = await runWithFigure({
      kind: 'compare',
      left: { head: 'b = a', items: ['改 b 会带动 a'] },
      right: { head: 'b = a[:]', items: ['改外层不影响 a'] },
      divider: '外层是否新盒子',
    });
    expect(out.figure).toBeUndefined();
  });

  it('至少一侧带链路时照出', async () => {
    const out = await runWithFigure({
      kind: 'compare',
      left: { head: '外置协调', client: '客户端', chain: [{ label: 'ZooKeeper' }, { label: '业务库' }] },
      right: { head: '内置共识', client: '客户端', chain: [{ label: 'Raft 状态机', merged: true }] },
    });
    expect(out.figure?.kind).toBe('compare');
    expect(out.figure.spec.left.chain).toHaveLength(2);
  });
});

describe('对照栏头过长不再丢整张图（2026-10-22 晚实测）', () => {
  it('19–26 字的栏头照收；超长截到 26 字而不是整侧作废', async () => {
    const out = await runWithFigure({
      kind: 'compare',
      left: { head: '一般过去时：只锁定过去那一下，与现在断开', items: ['I lost my key.'], chain: [{ label: '过去' }] },
      right: { head: '现在完成时：动作发生在过去但结果一路延续到现在并影响此刻', items: ['I have lost my key.'] },
      divider: '有没有碰到 NOW',
    });
    expect(out.figure?.kind).toBe('compare');
    expect(out.figure.spec.left.head).toBe('一般过去时：只锁定过去那一下，与现在断开');
    expect(Array.from(out.figure.spec.right.head as string).length).toBe(26);
  });
});
