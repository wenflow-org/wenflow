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

  it('grid 列标题参与列宽：长标题把画布撑开，不被压成一条', () => {
    const cells = [
      { r: 0, c: 0, text: '会' },
      { r: 0, c: 1, text: '会' },
    ];
    const short = renderSpecFigure('grid', { rows: 1, cols: 2, colLabels: ['甲', '乙'], cells });
    const long = renderSpecFigure('grid', { rows: 1, cols: 2, colLabels: ['外层 id(a) vs id(b)', '是否波及 a'], cells });
    expect(long!.width).toBeGreaterThan(short!.width);
    expect(long!.svg).toContain('外层 id(a) vs id(b)');
  });

  it('grid 列标题超长改省略号：不出界、也不与邻列压住', () => {
    const huge = '这是一条非常非常非常长的列标题用来测试截断逻辑是否生效';
    const out = renderSpecFigure('grid', { rows: 1, cols: 1, colLabels: [huge], cells: [{ r: 0, c: 0, text: '会' }] });
    expect(out!.svg).toContain('…');
    expect(out!.svg).not.toContain(huge);
  });

  it('matrix 列宽跟着列标题走：9 字标题整句保留，不被截成「…」', () => {
    const svg = svgOf('matrix', {
      rowLabels: ['甲', '乙'],
      colLabels: ['问的是动作还是时长', '呈现超出记录强度'],
      cells: [
        { r: 0, c: 0, tone: 'hit' },
        { r: 0, c: 1, tone: 'hit' },
        { r: 1, c: 0, tone: 'miss' },
        { r: 1, c: 1, tone: 'dup' },
      ],
    });
    expect(svg).toContain('问的是动作还是时长');
    expect(svg).toContain('呈现超出记录强度');
  });

  it('tree：分支框与根源框不再相撞（旧布局两分支时压进根框 13px）', () => {
    const svg = svgOf('tree', {
      root: { label: 'outer[:] 之后' },
      branches: [
        { label: '外层：新盒子', items: ['复制出来了'] },
        { label: '内层：同一对象', items: ['还是同一个对象'] },
      ],
    });
    const rects = [...svg.matchAll(/<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)" rx="(\d+)"/g)].map((m) => ({
      x: Number(m[1]), y: Number(m[2]), w: Number(m[3]), h: Number(m[4]), rx: Number(m[5]),
    }));
    const root = rects.find((r) => r.rx === 12);
    const branches = rects.filter((r) => r.rx === 10);
    expect(root).toBeTruthy();
    expect(branches.length).toBe(2);
    for (const b of branches) {
      const gap = b.x > root!.x ? b.x - (root!.x + root!.w) : root!.x - (b.x + b.w);
      expect(gap).toBeGreaterThanOrEqual(8);
    }
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

  it('compare 桥接框：长文案按框宽折行，不再捅穿矩形（走查 #16）', () => {
    const svg = svgOf('compare', {
      left: { head: '反例', items: ['a'] },
      right: { head: '正解', items: ['b'] },
      divider: '汇报的差值是 0.5 个点，比同组自身晃动还小',
    });
    // 框宽 ≈ 140：一行最多十来个字，长句必须拆成多行
    const dividerLines = Array.from(svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g))
      .map((m) => m[1])
      .filter((line) => line.includes('汇报') || line.includes('个点') || line.includes('晃动'));
    expect(dividerLines.length).toBeGreaterThan(1);
    for (const line of dividerLines) expect(line.length).toBeLessThanOrEqual(14);
    // 「0.5」必须完整落在同一行：切成「0 / .5」就成了两个数（2026-10-21 目检 #22）
    expect(dividerLines.some((line) => line.includes('0.5'))).toBe(true);
    for (const line of dividerLines) expect(line.startsWith('.')).toBe(false);
  });

  it('compare 条目：长句折成两行，不截成半句（目检 #6）', () => {
    const svg = svgOf('compare', {
      left: { head: '错误现状', items: ['this.list = res.data 根本不执行'] },
      right: { head: '应有形状', items: ['先写入 this.list，视图立刻渲染一次', '再发现过期、把列表改回去'] },
    });
    const texts = Array.from(svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)).map((m) => m[1]);
    const joined = texts.join('');
    // 两句都要完整出现（省略号说明又被 fitText 截断了）
    expect(joined).toContain('先写入 this.list');
    expect(joined).toContain('渲染一次');
    expect(joined).toContain('把列表改回去');
    expect(joined).not.toContain('…');
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
    // 三级台阶：x 递增、y 递减（底高 68：62 会让步名与子标题的 bbox 相压）
    const boxes = [...svg.matchAll(/<rect x="([\d.]+)" y="([\d.]+)" width="150" height="68"/g)].map((m) => ({
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

describe('compare 链路形态（客户端 → 集群边界 → 节点）', () => {  const chainFigure = (spec: Record<string, unknown> = {}) => ({
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
          { label: '共识二：存储节点', sub: '写日志与数据', tone: 'warn', from: 'client' },
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
    const { svg } = renderSpecFigure('compare', chainFigure().spec) as { svg: string };
    expect(svg).toContain('集群边界');
    expect((svg.match(/客户端/g) || []).length).toBe(2);
    // 左栏两跳、右栏一跳：边界上的序号 1 与 2 各出现一次
    expect(svg).toContain('>1</text>');
    expect(svg).toContain('>2</text>');
  });

  it('「省掉」落在节点上（合一徽标），不再用中间悬浮的气泡表达', () => {
    const { svg } = renderSpecFigure('compare', chainFigure().spec) as { svg: string };
    expect(svg).toContain('内置·合一');
    // 卡片形态才有的分割线气泡不应出现在链路形态里
    expect(svg).not.toContain('同一个确认');
  });

  it('两侧路径条数不同时，边界序号数量跟着变（箭头数就是跳数）', () => {
    const { svg: two } = renderSpecFigure('compare', chainFigure().spec) as { svg: string };
    const { svg: one } = renderSpecFigure('compare', chainFigure({ left: { head: '只一跳', chain: [{ label: '直连状态机' }], items: [] } }).spec) as { svg: string };
    const countNumbers = (s: string) => (s.match(/r="8.5"/g) || []).length;
    expect(countNumbers(two)).toBe(3); // 2 + 1
    expect(countNumbers(one)).toBe(2); // 1 + 1
  });

  it('边界文案可随内容改：同进程请求链不再硬显示「集群边界」（外部评审 #3）', () => {
    const { svg } = renderSpecFigure(
      'compare',
      chainFigure({
        left: {
          head: '错误现状',
          client: '搜索框',
          boundaryLabel: '组件异步边界',
          chain: [{ label: '请求发出', sub: '什么都没记' }],
          items: [],
        },
      }).spec,
    ) as { svg: string };
    expect(svg).toContain('组件异步边界');
    // 右栏没给 boundaryLabel → 保持旧默认，架构图观感不变
    expect(svg).toContain('集群边界');
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
    }) as { svg: string };
    // 左栏 3 张卡，但只有第一条跨集群 → 边界上只有 1 个序号；右栏也只有 1 个 → 共 2 个
    expect((svg.match(/r="8.5"/g) || []).length).toBe(2);
    // 卡间竖箭头（顺序段）存在两条
    expect((svg.match(/<polygon points="[^"]+"/g) || []).length).toBeGreaterThanOrEqual(4);
    expect(svg).toContain('集群边界');
  });
});

describe('range-bar（数值区间并排，2026-10-21）', () => {
  it('每组一行、标签与端点数值都在，参考点画虚线', () => {
    const svg = renderSpecFigure('range-bar', {
      title: '四天各自的波动范围',
      unit: '%',
      rows: [
        { label: '新组', from: 3.1, to: 3.8, tone: 'accent' },
        { label: '旧组', from: 2.9, to: 3.6, tone: 'neutral' },
      ],
      marks: [{ at: 0.5, label: '汇报的均值差' }],
    });
    expect(svg).not.toBeNull();
    const out = svg!.svg;
    expect(out).toContain('新组');
    expect(out).toContain('旧组');
    expect(out).toContain('3.1%');
    expect(out).toContain('3.8%');
    expect(out).toContain('汇报的均值差');
    expect(out).toContain('stroke-dasharray');
  });

  it('不足两行返回 null（fail-open）', () => {
    expect(renderSpecFigure('range-bar', { rows: [{ label: '新组', from: 1, to: 2 }] })).toBeNull();
  });
});

describe('compare 链路：缺省 from 即串联（2026-10-22 真课 47 跳全缺 from）', () => {
  const render = (chain: Record<string, unknown>[]) =>
    renderSpecFigure('compare', {
      left: { head: '外置协调', client: '客户端', chain },
      right: { head: '内置共识', items: ['省一次往返'] },
      divider: '差的就是边界',
    })!;

  const hopBadges = (svg: string) =>
    [...svg.matchAll(/class="t-micro"[^>]*>([^<]*)</g)].map((m) => m[1]);

  it('第二跳不写 from → 从上一张卡竖向连下来，只占一次边界跳数', () => {
    const svg = render([{ label: '请求发出' }, { label: '响应回来' }]).svg;
    expect(hopBadges(svg)).toEqual(['1']);
  });

  it('显式 from:"client" 才并联扇出，两跳各占一个边界序号', () => {
    const svg = render([{ label: '请求发出' }, { label: '响应回来', from: 'client' }]).svg;
    expect(hopBadges(svg)).toEqual(['1', '2']);
  });

  it('显式 from:"prev" 与缺省等价（旧写法仍然有效）', () => {
    const svg = render([{ label: '请求发出' }, { label: '响应回来', from: 'prev' }]).svg;
    expect(hopBadges(svg)).toEqual(['1']);
  });
});

describe('cartesian-plot（2026-10-23：平抛该画频闪轨迹，不是表格）', () => {
  const base = {
    x: { label: '水平距离 / m', min: 0, max: 3, ticks: [0, 1, 2, 3] },
    y: { label: '高度 / m', min: 0, max: 1, ticks: [0, 0.5, 1] },
  };

  it('两条抛物线 + 频闪点 + 等时刻虚线：都画出来，且全在画布内', () => {
    const out = renderSpecFigure('cartesian-plot', {
      ...base,
      title: '平抛频闪：3 m/s vs 6 m/s',
      series: [
        { name: '3 m/s', form: 'parabola', a: -0.55, b: 0, c: 1, tone: 'ok' },
        { name: '6 m/s', form: 'parabola', a: -0.55, b: 0, c: 1, tone: 'accent', dots: true },
      ],
      guides: [{ axis: 'y', at: 0.8, label: 't = 0.4 s' }],
      marks: [{ at: [3, 0], label: '落地', tone: 'accent' }],
    });
    expect(out).not.toBeNull();
    const svg = out!.svg;
    expect(svg).toContain('平抛频闪');
    expect(svg).toContain('t = 0.4 s');
    expect(svg).toContain('落地');
    // 两条曲线 + 频闪点：至少有 2 条 path 与若干 circle
    expect(svg.match(/<path/g)!.length).toBeGreaterThanOrEqual(2);
    expect(svg.match(/<circle/g)!.length).toBeGreaterThanOrEqual(4);
    // 所有坐标不越界（裁剪在前端就生效，不靠浏览器兜底）
    for (const m of svg.matchAll(/(?:cx|cy|x1|x2|y1|y2)="(-?\d+(?:\.\d+)?)"/g)) {
      const v = Number(m[1]);
      expect(v).toBeGreaterThanOrEqual(-1);
      expect(v).toBeLessThanOrEqual(Math.max(out!.width, out!.height) + 1);
    }
  });

  it('缺轴/无系列 → null（fail-open）', () => {
    expect(renderSpecFigure('cartesian-plot', { x: { min: 0, max: 1 }, y: { min: 0, max: 1 } })).toBeNull();
    expect(renderSpecFigure('cartesian-plot', { series: [] })).toBeNull();
  });
});

describe('cartesian-plot 面积（2026-10-23 广度扫测：v-t 图下面积=位移）', () => {
  it('areas 画出阴影并保留标签；线性曲线按区间取样，不是整段定义域', () => {
    const out = renderSpecFigure('cartesian-plot', {
      x: { label: '时间 / s', min: 0, max: 6, ticks: [0, 2, 4, 6] },
      y: { label: '速度', min: 0, max: 5, ticks: [0, 5] },
      series: [{ name: '速度', form: 'linear', k: 0.8, b: 0 }],
      areas: [{ from: 0, to: 4, series: '速度', label: '位移 = 面积' }],
    });
    expect(out).not.toBeNull();
    expect(out!.svg).toContain('位移 = 面积');
    // 青色/主题强调色的半透明填充
    expect(out!.svg).toMatch(/fill-opacity="0\.14"/);
  });
});

describe('concept-map（2026-10-23：概念与知识可视化，不是出题）', () => {
  it('节点、关系名、takeaway 都画出来；自动分层后不越界', () => {
    const out = renderSpecFigure('concept-map', {
      title: '光合作用：两个阶段怎么接上',
      nodes: [
        { id: 'light', label: '光反应', sub: '类囊体膜', tone: 'accent' },
        { id: 'atp', label: 'ATP / NADPH', sub: '能量与还原力' },
        { id: 'dark', label: '暗反应', sub: '叶绿体基质' },
      ],
      edges: [
        { from: 'light', to: 'atp', label: '产生' },
        { from: 'atp', to: 'dark', label: '供给' },
      ],
      takeaway: '光反应造能量，暗反应用能量把 CO₂ 变成糖',
    });
    expect(out).not.toBeNull();
    const svg = out!.svg;
    expect(svg).toContain('光反应');
    expect(svg).toContain('供给');
    expect(svg).toContain('光反应造能量');
    for (const m of svg.matchAll(/(?:cx|cy|x1|x2|y1|y2|x|y)="(-?\d+(?:\.\d+)?)"/g)) {
      const v = Number(m[1]);
      expect(v).toBeGreaterThanOrEqual(-1);
      expect(v).toBeLessThanOrEqual(Math.max(out!.width, out!.height) + 1);
    }
  });

  it('没有边 → null', () => {
    expect(renderSpecFigure('concept-map', { nodes: [{ id: 'a', label: '甲' }], edges: [] })).toBeNull();
  });
});

describe('split-compare（2026-10-26：正误并排，行行对齐）', () => {
  it('两栏行对齐、delta.at 高亮分叉行、底部说明画出', () => {
    const out = renderSpecFigure('split-compare', {
      title: '换算：先除还是先换算',
      left: { head: '常见错法', tone: 'warn', rows: [{ label: '60 ÷ 400', sub: '把秒当分钟除' }, { label: '得 0.15' }] },
      right: { head: '正确做法', tone: 'ok', rows: [{ label: '60 × 400 ÷ 1000', sub: '先把米换算成千米' }, { label: '得 24' }] },
      delta: { label: '分叉在第一步：先换算再除', at: 1 },
    });
    expect(out).not.toBeNull();
    const svg = out!.svg;
    expect(svg).toContain('常见错法');
    expect(svg).toContain('把秒当分钟除');
    expect(svg).toContain('先把米换算成千米');
    expect(svg).toContain('分叉在第一步');
    expect(svg).toContain('vs');
    // delta.at=1：第一行（y≈bodyTop..bodyTop+46 区间）内应出现强调描边矩形
    const hi = (svg.match(/stroke="#[0-9a-f]+"/g) || []).length;
    expect(hi).toBeGreaterThan(0);
  });

  it('rows 全空 / 缺面板 → null', () => {
    expect(renderSpecFigure('split-compare', { left: { head: 'A', rows: [] }, right: { head: 'B', rows: [{ label: '甲' }] } })).toBeNull();
    expect(renderSpecFigure('split-compare', { left: { head: 'A', rows: [{ label: '甲' }] } })).toBeNull();
  });

  it('长栏头不截成歧义半句（英语时态实拍）', () => {
    const out = renderSpecFigure('split-compare', {
      left: { head: '现在完成时 have finished', tone: 'ok', rows: [{ label: 'have finished' }, { label: '结果留到现在' }] },
      right: { head: '一般过去时 finished', tone: 'warn', rows: [{ label: 'finished' }, { label: '动作在过去' }] },
    });
    expect(out).not.toBeNull();
    const keyTexts = [...out!.svg.matchAll(/<text[^>]*class="t-key"[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]);
    const joined = keyTexts.join('').replace(/\s/g, '');
    expect(joined).toContain('现在完成时havefinished');
    expect(joined).toContain('一般过去时finished');
  });
});

describe('state-strip（2026-10-26：不回头的进程分帧）', () => {
  it('帧序号、帧名、帧内要点、帧间箭头、note 都画出', () => {
    const out = renderSpecFigure('state-strip', {
      title: 'TCP 三次握手',
      frames: [
        { label: 'SYN', items: ['客户端 SYN_SENT', '服务端 LISTEN'] },
        { label: 'SYN+ACK', tone: 'accent', items: ['服务端 SYN_RCVD'] },
        { label: 'ACK', tone: 'ok', items: ['双方 ESTABLISHED'] },
      ],
      note: '每一步都是状态迁移，走完不回头',
    });
    expect(out).not.toBeNull();
    const svg = out!.svg;
    expect(svg).toContain('TCP 三次握手');
    expect(svg).toContain('SYN_SENT');
    expect(svg).toContain('SYN_RCVD');
    expect(svg).toContain('每一步都是状态迁移');
    // 帧间箭头（2 个）与帧序号
    expect(svg).toContain('l-8 -4');
    expect(svg).toContain('>1<');
    for (const m of svg.matchAll(/(?:cx|cy|x1|x2|y1|y2|x|y)="(-?\d+(?:\.\d+)?)"/g)) {
      const v = Number(m[1]);
      expect(v).toBeGreaterThanOrEqual(-1);
      expect(v).toBeLessThanOrEqual(Math.max(out!.width, out!.height) + 1);
    }
  });

  it('少于 2 帧 → null', () => {
    expect(renderSpecFigure('state-strip', { frames: [{ label: '单帧', items: ['x'] }] })).toBeNull();
  });

  it('4 帧 + 长帧名按帧宽折行，不横穿相邻帧（2026-10-27 盲评实拍）', () => {
    const labels = [
      '公元前361年·孝公求贤',
      '公元前356年·南门立木',
      '公元前356年·第一次变法',
      '公元前350年·第二次变法',
    ];
    const out = renderSpecFigure('state-strip', {
      title: '变法怎么落地',
      frames: labels.map((label) => ({ label, items: ['一帧一个动作'] })),
    });
    expect(out).not.toBeNull();
    const keyTexts = [...out!.svg.matchAll(/<text[^>]*class="t-key"[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]);
    // 至少有一帧被拆成两行（4 个标签 → 5 个以上文本节点）
    expect(keyTexts.length).toBeGreaterThan(labels.length);
    // 每个文本节点都在帧宽能容纳的字数内（按 14.5px 字号折算约 7 个汉字）
    for (const t of keyTexts) {
      expect(Array.from(t).length).toBeLessThanOrEqual(8);
    }
    // 标签内容没有丢
    expect(keyTexts.join('')).toBe(labels.join(''));
  });

  it('帧内长条目不被截断（原先每项只留 2 行）', () => {
    const item = '商鞅网开一面，未加惩处，太子照旧，百姓看在眼里';
    const out = renderSpecFigure('state-strip', {
      title: '变法怎么落地',
      frames: [
        { label: '前356年·第一次变法', items: [item] },
        { label: '前350年·第二次变法', items: ['推行县制，编定户口'] },
      ],
    });
    expect(out).not.toBeNull();
    const bodyText = [...out!.svg.matchAll(/<text[^>]*class="t-small"[^>]*>([^<]*)<\/text>/g)]
      .map((m) => m[1])
      .join('');
    expect(bodyText.replace(/\s/g, '')).toContain(item.replace(/\s/g, ''));
  });
});
