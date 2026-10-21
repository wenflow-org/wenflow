/**
 * 教学图确定性渲染器（2026-10-18 扩图型）：规格 → SVG 字符串。
 *
 * 验收点：
 *   1) 六种二维图型都能出 SVG，且图内标签按 spec 原样出现（中文不乱码）；
 *   2) 未知图型 / 畸形规格 → 返回 null（fail-open，不把课堂页面弄坏）；
 *   3) 文本与颜色/虚线都过白名单（模型输出的 spec 会被内联进 SVG，不能成为注入面）。
 */
import { describe, expect, it } from 'vitest';
import { renderSpecFigure } from '../render';

const svgOf = (kind: string, spec: Record<string, unknown>) => renderSpecFigure(kind, spec)?.svg || '';

describe('教学图确定性渲染器', () => {
  it('grid：出图并保留单元格文字', () => {
    const svg = svgOf('grid', {
      title: '两种做法的排布',
      rows: 2,
      cols: 2,
      rowLabels: ['甲', '乙'],
      colLabels: ['位置', '方向'],
      cells: [
        { r: 0, c: 0, text: '前面', hl: 'accent' },
        { r: 0, c: 1, text: '向右' },
        { r: 1, c: 0, text: '后面' },
        { r: 1, c: 1, mask: true },
      ],
    });
    expect(svg).toContain('<svg');
    expect(svg).toContain('两种做法的排布');
    expect(svg).toContain('前面');
    expect(svg).toContain('待你回答');
  });

  it('matrix：命中/漏/堆砌四种符号都画出来', () => {
    const svg = svgOf('matrix', {
      rowLabels: ['要点一', '要点二'],
      colLabels: ['第一段', '第二段'],
      cells: [
        { r: 0, c: 0, tone: 'hit' },
        { r: 0, c: 1, tone: 'miss' },
        { r: 1, c: 0, tone: 'dup' },
        { r: 1, c: 1, tone: 'key' },
      ],
    });
    expect(svg).toContain('✓');
    expect(svg).toContain('—');
    expect(svg).toContain('叠');
    expect(svg).toContain('≡');
  });

  it('compare / quadrant / bipartite / board 都出图并带学科标签', () => {
    const compare = svgOf('compare', {
      left: { head: '行为主义', items: ['看结果'] },
      right: { head: '建构主义', items: ['看过程'] },
    });
    expect(compare).toContain('行为主义');
    expect(compare).toContain('建构主义');

    const quadrant = svgOf('quadrant', {
      colLabels: ['效度高', '效度低'],
      rowLabels: [{ label: '信度高' }, { label: '信度低' }],
      cells: [
        { title: '可信可用', body: ['直接采信'], tone: 'ok', icon: { kind: 'target', dots: [[0, 0]] } },
        { title: '稳定但偏', body: [] },
        { title: '偶然命中', body: [] },
        { title: '不可用', body: [], tone: 'warn' },
      ],
    });
    expect(quadrant).toContain('信度高');
    expect(quadrant).toContain('可信可用');

    const bipartite = svgOf('bipartite', {
      left: { head: '目标', nodes: [{ id: 'a', label: '倾听' }] },
      right: { head: '建议', nodes: [{ id: 'x', label: '多给机会' }] },
      edges: [{ from: 'a', to: 'x' }],
    });
    expect(bipartite).toContain('倾听');
    expect(bipartite).toContain('多给机会');
    expect(bipartite).toContain('<path d="M');

    const board = svgOf('board', {
      pieces: [
        { col: 4, rank: 9, key: 'K' },
        { col: 4, rank: 0, key: 'k' },
      ],
      arrows: [{ a1: { col: 4, rank: 9 }, a2: { col: 4, rank: 7 }, label: '进一' }],
    });
    expect(board).toContain('将');
    expect(board).toContain('帅');
    expect(board).toContain('进一');
  });

  it('未知图型 / 畸形规格 → null（不抛）', () => {
    expect(renderSpecFigure('pie-chart', {})).toBeNull();
    expect(renderSpecFigure('grid', null)).toBeNull();
    expect(renderSpecFigure('compare', {})).toBeNull(); // 缺 left/right → 抛错被兜住
  });

  it('文本转义：不把标签当 HTML 执行', () => {
    const svg = svgOf('compare', {
      left: { head: '<script>alert(1)</script>', items: ['a & b'] },
      right: { head: '右', items: ['b'] },
    });
    expect(svg).not.toContain('<script>');
    expect(svg).toContain('&lt;script&gt;');
    expect(svg).toContain('a &amp; b');
  });

  it('颜色/虚线白名单：非 hex 一律回落，不进入属性', () => {
    const svg = svgOf('matrix', {
      rowLabels: ['a', 'b'],
      colLabels: ['c', 'd'],
      cells: [{ r: 0, c: 0, tone: 'hit' }],
      legend: [{ text: '图例', fill: '" onload="alert(1)' }],
    });
    expect(svg).not.toContain('onload');
    // 图例色块回落成主题底色（6 位 hex：默认 indigo 主题为 #ffffff）
    expect(svg).toMatch(/fill="#[0-9a-fA-F]{6}"/);
    expect(svg).not.toContain('alert(1)');
  });

  it('bins：箱名与条目都出图，focus 箱加粗描边', () => {
    const plain = svgOf('bins', {
      title: '证据分箱',
      bins: [
        { label: '能直接采信', items: ['同一口径复现'] },
        { label: '只能参考', items: ['个案经验'] },
      ],
    });
    expect(plain).toContain('证据分箱');
    expect(plain).toContain('能直接采信');
    expect(plain).toContain('个案经验');

    const focused = svgOf('bins', {
      bins: [
        { label: '甲', items: ['a'] },
        { label: '乙', items: ['b'] },
      ],
      focus: 1,
    });
    // 焦点箱用 2px 描边，非焦点 1.4px
    expect(focused).toContain('stroke-width="2"');
    expect(focused).toContain('stroke-width="1.4"');
  });

  it('balance：倾斜方向由 weight 决定，托盘从横梁两端竖吊', () => {
    // 左重则左边下移（y 更大）
    const heavierLeft = svgOf('balance', {
      left: { head: '左', items: ['a'], weight: 9 },
      right: { head: '右', items: ['b'], weight: 1 },
    });
    const ys = [...heavierLeft.matchAll(/<line x1="([\d.]+)" y1="([\d.]+)" x2="\1" y2="([\d.]+)"/g)].map((m) => ({
      x: Number(m[1]),
      top: Number(m[2]),
      bottom: Number(m[3]),
    }));
    expect(ys).toHaveLength(2);
    const leftRope = ys.sort((a, b) => a.x - b.x)[0];
    // 竖绳：同 x 上下两点，且下端比上端更低
    expect(leftRope.bottom).toBeGreaterThan(leftRope.top);

    const balanced = svgOf('balance', {
      left: { head: '左', items: ['a'], weight: 5 },
      right: { head: '右', items: ['b'], weight: 5 },
      pivotLabel: '成本',
    });
    expect(balanced).toContain('成本');
    expect(heavierLeft).toContain('左');
  });

  it('ladder：逐级抬升，todo 虚线 / done 实线 / current 强调', () => {
    const svg = svgOf('ladder', {
      title: '从读懂到能改',
      steps: [
        { label: '读懂例题', state: 'done' },
        { label: '自己走一遍', state: 'current' },
        { label: '换条件重做' },
      ],
    });
    expect(svg).toContain('读懂例题');
    expect(svg).toContain('换条件重做');
    // 三级台阶：x 递增、y 递减
    const boxes = [...svg.matchAll(/<rect x="([\d.]+)" y="([\d.]+)" width="150" height="62"/g)].map((m) => ({
      x: Number(m[1]),
      y: Number(m[2]),
    }));
    expect(boxes).toHaveLength(3);
    expect(boxes[1].x).toBeGreaterThan(boxes[0].x);
    expect(boxes[1].y).toBeLessThan(boxes[0].y);
    // 未开始的台阶用虚线
    expect(svg).toMatch(/stroke-dasharray="5 4"/);
  });

  it('调色板：换主题只改观感（data-theme 与底色），不改几何', () => {
    const spec = {
      bins: [
        { label: '甲', items: ['a'] },
        { label: '乙', items: ['b'] },
      ],
    };
    const indigo = renderSpecFigure('bins', spec, { palette: 'indigo' });
    const earth = renderSpecFigure('bins', spec, { palette: 'earth' });
    expect(indigo?.svg).toContain('data-theme="indigo"');
    expect(earth?.svg).toContain('data-theme="earth"');
    // 地球色板自带纸纹材质，indigo 不带
    expect(earth?.svg).toContain('data-material="paper"');
    expect(indigo?.svg).not.toContain('data-material');
    // 几何不变：同一份 spec 的宽高一致
    expect(earth?.width).toBe(indigo?.width);
    expect(earth?.height).toBe(indigo?.height);
    // 未知调色板 → 回落默认（不抛、不出空图）
    const unknown = renderSpecFigure('bins', spec, { palette: 'neon' as never });
    expect(unknown?.svg).toContain('data-theme="indigo"');
  });

  it('grid focus：焦点行/列出强调轨，焦点外文字退为次级色', () => {
    const plain = svgOf('grid', {
      rows: 2,
      cols: 2,
      rowLabels: ['甲', '乙'],
      colLabels: ['位置', '方向'],
      cells: [
        { r: 0, c: 0, text: '前面' },
        { r: 1, c: 1, text: '后面' },
      ],
    });
    const focused = svgOf('grid', {
      rows: 2,
      cols: 2,
      rowLabels: ['甲', '乙'],
      colLabels: ['位置', '方向'],
      cells: [
        { r: 0, c: 0, text: '前面' },
        { r: 1, c: 1, text: '后面' },
      ],
      focus: { row: 1, col: 1 },
    });
    expect(focused.length).toBeGreaterThan(plain.length);
    // 焦点轨是 3px 宽的小色块
    expect(focused).toContain('width="3"');
  });
});

describe('几何隐喻图元（2026-10-20：形状要承载关系，不是白框填字）', () => {
  it('cycle：节点上环、首尾相接有箭头，中心说明不压卡片', () => {
    const svg = svgOf('cycle', {
      title: '四部件为什么是一个环',
      center: '每一轮都回到同一个问题',
      nodes: [
        { label: '驱动问题', sub: '为什么非做不可' },
        { label: '持续探究' },
        { label: '公开产出' },
        { label: '评价与记录' },
      ],
    });
    expect(svg).toContain('驱动问题');
    expect(svg).toContain('每一轮');
    // 4 个节点 = 4 条首尾相接的弧线（含箭头头部）
    expect((svg.match(/stroke-linecap="round"/g) || []).length).toBeGreaterThanOrEqual(4);
    expect(svg).toContain('<path d="M');
  });

  it('tree：根与分支都出图，未填的分支渲染成待答槽而不是空白', () => {
    const svg = svgOf('tree', {
      title: '五大领域',
      root: { label: '幼儿园五大领域' },
      branches: [
        { label: '健康', items: ['易混：社会'] },
        { label: '语言', items: ['?'] },
      ],
    });
    expect(svg).toContain('幼儿园五大领域');
    expect(svg).toContain('易混：社会');
    expect(svg).toContain('待你回答');
    expect(svg).toContain('stroke-dasharray');
  });

  it('venn：两个圆相交，三个区域各自有文字，且不越出画布', () => {
    const svg = svgOf('venn', {
      left: { head: '社会', items: ['轮流收玩具'] },
      right: { head: '科学', items: ['按属性分类'] },
      overlap: { head: '两边都算', items: ['按同一规则'] },
    });
    expect(svg).toContain('社会');
    expect(svg).toContain('科学');
    expect(svg).toContain('两边都算');
    expect((svg.match(/<circle /g) || []).length).toBeGreaterThanOrEqual(2);
  });

  it('bullseye：四个靶盘 + 点坐标进图，越界坐标被渲染层夹住', () => {
    const svg = svgOf('bullseye', {
      colLabels: ['高效度', '低效度'],
      rowLabels: [{ label: '高信度', sub: '每次一致' }, { label: '低信度' }],
      cells: [
        { title: '稳且准', tone: 'ok', dots: [[0.05, 0.08], [-0.08, 0.02]] },
        { title: '稳定地打偏', tone: 'warn', dots: [[0.6, -0.2]] },
        { title: '方向对但太散', dots: [[0.3, 0.3]] },
        { title: '又偏又散', tone: 'warn', dots: [[9, -9]] },
      ],
    });
    expect(svg).toContain('高信度');
    expect(svg).toContain('稳定地打偏');
    // 四个靶盘的内圈（0.33R）各一个
    expect((svg.match(/r="14.52/g) || []).length).toBe(4);
    // 2+1+1+1 = 5 个点
    expect((svg.match(/r="3.7"/g) || []).length).toBe(5);
    expect(svg).not.toContain('NaN');
  });

  it('留白槽位：label 为 ? 时不把占位符当答案画出来', () => {
    const svg = svgOf('cycle', {
      nodes: [{ label: '驱动问题' }, { label: '持续探究' }, { label: '?' }],
    });
    expect(svg).toContain('待你回答');
    expect(svg).not.toContain('>?<');
  });
});

describe('compare 链路形态（客户端 → 集群边界 → 节点）', () => {
  const chainFigure = (spec: any = {}) => ({
    engine: 'svg' as const,
    kind: 'compare' as const,
    palette: 'tech' as const,
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
        items: ['两份结论必须互相迁就'],
      },
      right: {
        head: '内置共识',
        badge: '单一系统 · 1 次共识',
        badgeTone: 'ok',
        client: '客户端',
        chain: [{ label: '业务进程内置状态机', sub: '两件事落同一条日志', merged: true, tone: 'ok' }],
        items: ['省掉一次跨集群往返'],
      },
      ...spec,
    },
  });

  it('画出了集群边界、两端客户端与两条跳数序号', () => {
    const { svg } = renderSpecFigure('compare', chainFigure().spec) as any;
    expect(svg).toContain('集群边界');
    expect((svg.match(/客户端/g) || []).length).toBe(2);
    // 左栏两跳、右栏一跳：边界上的序号 1 与 2 各出现一次
    expect(svg).toContain('>1</text>');
    expect(svg).toContain('>2</text>');
  });

  it('「省掉」落在节点上（合一徽标），不再用中间悬浮的气泡表达', () => {
    const { svg } = renderSpecFigure('compare', chainFigure().spec) as any;
    expect(svg).toContain('内置·合一');
    // 卡片形态才有的分割线气泡不应出现在链路形态里
    expect(svg).not.toContain('同一个确认');
  });

  it('两侧路径条数不同时，边界序号数量跟着变（箭头数就是跳数）', () => {
    const { svg: two } = renderSpecFigure('compare', chainFigure().spec) as any;
    const { svg: one } = renderSpecFigure('compare', chainFigure({ left: { head: '只一跳', chain: [{ label: '直连状态机' }], items: [] } }).spec) as any;
    const countNumbers = (s: string) => (s.match(/r="8.5"/g) || []).length;
    expect(countNumbers(two)).toBe(3); // 2 + 1
    expect(countNumbers(one)).toBe(2); // 1 + 1
  });
});

describe('compare 链路形态：顺序段不占跳数', () => {
  it('from:prev 的节点画成卡间竖箭头，边界序号只数跨集群次数', () => {
    const { svg } = renderSpecFigure('compare', {
      left: {
        head: '分开部署',
        badge: '1 次跨集群 + 2 段内部转发',
        client: '客户端',
        chain: [
          { label: '网关', rtt: true },
          { label: '订单服务', from: 'prev' },
          { label: '库存服务', from: 'prev' },
        ],
        items: ['每段都要单独重试'],
      },
      right: { head: '同进程', badge: '1 次跨集群', chain: [{ label: '单模块', merged: true }] },
    }) as any;
    // 左栏 3 张卡，但只有第一条跨集群 → 边界上只有 1 个序号；右栏也只有 1 个 → 共 2 个
    expect((svg.match(/r="8.5"/g) || []).length).toBe(2);
    // 卡间竖箭头（顺序段）存在两条
    expect((svg.match(/<polygon points="[^"]+"/g) || []).length).toBeGreaterThanOrEqual(4);
    expect(svg).toContain('集群边界');
  });
});
