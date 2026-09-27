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
