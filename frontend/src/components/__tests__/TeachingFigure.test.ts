/**
 * TeachingFigure 组件：多图型分派（2026-10-18 扩图型）。
 *
 * 验收点：`position-line` 仍走原 Vue 模板；其余图型走确定性渲染器产出的 SVG 字符串，
 * 且真的出现在 DOM 里（v-html 路径可用）、caption 正常显示。
 */
import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import TeachingFigure from '../TeachingFigure.vue';

const positionLine = {
  engine: 'svg',
  kind: 'position-line',
  axis: { min: 0, max: 100, unit: '米', ticks: [{ at: 0, label: '起点' }] },
  marks: [
    { at: 20, label: '甲', dir: 'right' as const },
    { at: 60, label: '乙', dir: 'right' as const },
  ],
  spans: [{ from: 20, to: 60, label: '相距 40 米' }],
  guides: [{ at: 80, label: '追及点' }],
  caption: '两人都朝右',
};

const specs = {
  grid: {
    rows: 2,
    cols: 2,
    rowLabels: ['甲', '乙'],
    colLabels: ['位置', '方向'],
    cells: [{ r: 0, c: 0, text: '前面' }, { r: 0, c: 1, text: '向右' }],
  },
  matrix: {
    rowLabels: ['要点一', '要点二'],
    colLabels: ['第一段', '第二段'],
    cells: [{ r: 0, c: 0, tone: 'hit' }, { r: 1, c: 1, tone: 'dup' }],
  },
  compare: { left: { head: '行为主义', items: ['看结果'] }, right: { head: '建构主义', items: ['看过程'] } },
  quadrant: {
    colLabels: ['效度高', '效度低'],
    rowLabels: [{ label: '信度高' }, { label: '信度低' }],
    cells: [
      { title: '可信可用', body: ['直接采信'], tone: 'ok' },
      { title: '稳定但偏', body: [] },
      { title: '偶然命中', body: [] },
      { title: '不可用', body: [], tone: 'warn' },
    ],
  },
  bipartite: {
    left: { head: '目标', nodes: [{ id: 'a', label: '倾听' }] },
    right: { head: '建议', nodes: [{ id: 'x', label: '多给机会' }] },
    edges: [{ from: 'a', to: 'x' }],
  },
  board: {
    pieces: [
      { col: 4, rank: 9, key: 'K' },
      { col: 4, rank: 0, key: 'k' },
    ],
    arrows: [{ a1: { col: 4, rank: 9 }, a2: { col: 4, rank: 7 }, label: '进一' }],
  },
  bins: {
    bins: [
      { label: '能直接采信', items: ['同一口径复现'], tone: 'ok' },
      { label: '只能参考', items: ['个案经验'] },
    ],
    focus: 1,
  },
  balance: {
    left: { head: '先讲后练', items: ['概念清楚'], weight: 6 },
    right: { head: '先练后讲', items: ['暴露问题'], weight: 4 },
    pivotLabel: '课堂时间',
  },
  ladder: {
    steps: [
      { label: '读懂例题', state: 'done' },
      { label: '自己走一遍', state: 'current' },
      { label: '换条件重做' },
    ],
  },
  cycle: {
    center: '每一轮都回到同一个问题',
    nodes: [{ label: '驱动问题' }, { label: '持续探究' }, { label: '公开产出' }, { label: '?' }],
  },
  tree: {
    root: { label: '幼儿园五大领域' },
    branches: [{ label: '健康', items: ['易混：社会'] }, { label: '语言', items: ['?'] }],
  },
  venn: {
    left: { head: '社会', items: ['轮流收玩具'] },
    right: { head: '科学', items: ['按属性分类'] },
    overlap: { head: '两边都算', items: ['按同一规则'] },
  },
  bullseye: {
    colLabels: ['高效度', '低效度'],
    rowLabels: [{ label: '高信度' }, { label: '低信度' }],
    cells: [
      { title: '稳且准', tone: 'ok', dots: [[0.05, 0.08]] },
      { title: '稳定地打偏', tone: 'warn', dots: [[0.6, -0.2]] },
      { title: '方向对但太散', dots: [[0.3, 0.3]] },
      { title: '又偏又散', tone: 'warn', dots: [[-0.5, 0.5]] },
    ],
  },
};

describe('TeachingFigure 多图型', () => {
  it('位置线仍走原模板（不经过 v-html）', () => {
    const wrapper = mount(TeachingFigure, { props: { figure: positionLine } });
    expect(wrapper.classes()).not.toContain('teaching-figure--spec');
    expect(wrapper.text()).toContain('相距 40 米');
    expect(wrapper.text()).toContain('两人都朝右');
    expect(wrapper.find('.tf-axis').exists()).toBe(true);
  });

  for (const [kind, spec] of Object.entries(specs)) {
    it(`${kind}：渲染出内联 SVG`, () => {
      const wrapper = mount(TeachingFigure, { props: { figure: { engine: 'svg', kind, caption: `${kind} 说明`, spec } } });
      expect(wrapper.classes()).toContain('teaching-figure--spec');
      expect(wrapper.find('.teaching-figure svg').exists()).toBe(true);
      expect(wrapper.text()).toContain(`${kind} 说明`);
    });
  }

  it('没有名字的参考线不画：图上不留没有指称对象的竖虚线', () => {
    const wrapper = mount(TeachingFigure, {
      props: {
        figure: {
          ...positionLine,
          guides: [{ at: 80, label: '追及点' }, { at: 50, label: null }],
        },
      },
    });
    const guides = wrapper.findAll('line.tf-guide');
    expect(guides).toHaveLength(1);
    expect(wrapper.text()).toContain('追及点');
  });

  it('靠边的参考线标签改用内侧对齐，不顶出画布', () => {
    const wrapper = mount(TeachingFigure, {
      props: {
        figure: {
          ...positionLine,
          guides: [{ at: 99, label: '最后写视图：屏幕停在「北京」' }],
        },
      },
    });
    const label = wrapper.find('.tf-guide-label');
    expect(label.attributes('text-anchor')).toBe('end');
    expect(label.attributes('x')).toBe('707.32');
  });

  it('畸形 spec 不渲染空壳（fail-open）', () => {
    const wrapper = mount(TeachingFigure, { props: { figure: { engine: 'svg', kind: 'compare', caption: null, spec: {} } } });
    expect(wrapper.find('svg').exists()).toBe(false);
  });

  it('位置线也吃学科配色：earth 注入颜色令牌 + 纸面底（同一节课里两条通道观感一致）', () => {
    const wrapper = mount(TeachingFigure, { props: { figure: { ...positionLine, palette: 'earth' } } });
    const svgStyle = wrapper.find('svg').attributes('style') || '';
    expect(svgStyle).toContain('--tf-accent: #1f6f5c');
    expect(svgStyle).toContain('--tf-ink: #2b241c');
    // jsdom 会把颜色序列化成 rgb()：earth 纸面 = #fffdf9
    expect(wrapper.find('figure').attributes('style') || '').toContain('background: rgb(255, 253, 249)');
  });

  it('无 palette 的位置线不注入令牌、不加纸面底（老消息零变化）', () => {
    const wrapper = mount(TeachingFigure, { props: { figure: positionLine } });
    expect(wrapper.find('svg').attributes('style')).toBeUndefined();
    expect(wrapper.find('figure').attributes('style')).toBeUndefined();
  });
});
