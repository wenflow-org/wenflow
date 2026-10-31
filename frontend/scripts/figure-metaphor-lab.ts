// 几何隐喻对照稿：用产品同一个渲染器画「关系 → 形状」的五个典型（2026-10-20 用户点名案例）
// 用法（frontend 目录）：node node_modules/vite-node/vite-node.mjs scripts/figure-metaphor-lab.ts [out.html]
import fs from 'node:fs';
import path from 'node:path';
import { renderSpecFigure } from '@/components/teaching-figure/render';

const cases: Array<{ kind: string; label: string; why: string; spec: Record<string, unknown> }> = [
  {
    kind: 'cycle',
    label: 'PBL 四部件 → 闭环',
    why: '四个部件不是四行数据，而是一轮探究要回到同一个问题上；格子表看不出「回到起点」，环可以。',
    spec: {
      title: '四部件为什么是一个环，而不是一张表',
      center: '每一轮都回到\n同一个真实问题',
      nodes: [
        { label: '驱动问题', sub: '为什么非做不可' },
        { label: '持续探究', sub: '查几轮、记下来' },
        { label: '公开产出', sub: '做给谁看' },
        { label: '评价与记录', sub: '凭什么说真做了' },
      ],
      note: '课上留白：右下角那格先空着，让学生自己说「凭什么」。',
    },
  },
  {
    kind: 'bullseye',
    label: '信度 × 效度 → 四个靶盘',
    why: '「稳不稳」和「准不准」是两个几何量：点聚不聚、偏不偏。表格只能写形容词，靶盘能直接看到。',
    spec: {
      title: '信度（稳不稳）× 效度（准不准）',
      colLabels: ['高效度：打在靶心上', '低效度：稳定地打偏'],
      rowLabels: [{ label: '高信度', sub: '每次测都一致' }, { label: '低信度', sub: '忽高忽低' }],
      cells: [
        { title: '稳且准', desc: '每次都落在靶心附近', tone: 'ok', dots: [[0.05, 0.08], [-0.08, 0.02], [0.02, -0.06]] },
        { title: '稳定地打偏（最危险）', desc: '数字极稳，但测的不是那回事', tone: 'warn', dots: [[0.62, -0.2], [0.68, -0.12], [0.6, -0.28]] },
        { title: '方向对但太散', desc: '围着靶心，单次误差很大', dots: [[-0.35, 0.4], [0.42, 0.3], [-0.1, -0.45], [0.3, -0.55]] },
        { title: '又偏又散', desc: '既没对准，每次还乱跳', tone: 'warn', dots: [[0.7, 0.5], [-0.6, -0.45], [0.55, -0.6], [-0.5, 0.55]] },
      ],
      note: '为什么「稳定地打偏」比「又偏又散」更容易骗过人——先让学生答，再讲。',
    },
  },
  {
    kind: 'bipartite',
    label: '目标 × 建议 → 二分连线',
    why: '「一条建议同时服务两个目标」是拓扑关系；打勾矩阵要学生在脑子里数勾，交叉线一眼就能看出分叉。',
    spec: {
      title: '一条建议往往拉着两条目标线',
      left: { head: '教育建议（具体活动）', nodes: [{ id: 'a', label: '扣扣子比赛' }, { id: 'b', label: '值日生分餐' }, { id: 'c', label: '整理玩具柜' }] },
      right: { head: '服务的《指南》目标', nodes: [{ id: 'x', label: '手部精细动作' }, { id: 'y', label: '基本生活自理' }, { id: 'z', label: '做事有条理' }] },
      edges: [
        { from: 'a', to: 'x' },
        { from: 'a', to: 'y', dash: '4 3' },
        { from: 'b', to: 'y' },
        { from: 'c', to: 'z' },
        { from: 'b', to: 'z', dash: '4 3' },
      ],
      note: '虚线那条是「顺便也练到」，实线是这条活动的主目标。',
    },
  },
  {
    kind: 'tree',
    label: '五大领域 → 辐射树',
    why: '「一个总概念长出哪五个子概念、每个最容易和谁混」是派生关系；并排五列白框看不出「同一层」。',
    spec: {
      title: '五大领域：同一层，但边界会互相咬',
      root: { label: '幼儿园五大领域', sub: '同一层级的五个块' },
      branches: [
        { label: '健康', items: ['易混：社会（都讲习惯）'] },
        { label: '语言', items: ['易混：艺术（都讲表达）'] },
        { label: '社会', items: ['易混：健康（都讲规则）'] },
        { label: '科学', items: ['易混：数学（都讲数）'] },
        { label: '艺术', items: ['?'] },
      ],
      note: '最后一条的邻居先让学生自己填：艺术最容易和谁混？',
    },
  },
  {
    kind: 'venn',
    label: '易混动作词 → 双圆交集',
    why: '边界问题要画重叠：哪部分只属于 A、哪部分只属于 B、哪部分两边都算。并排两栏会把重叠吃掉。',
    spec: {
      title: '「整理」到底算哪个领域',
      left: { head: '社会', items: ['轮流收玩具', '按约定归位'] },
      right: { head: '科学', items: ['按属性分类', '比较多少'] },
      overlap: { head: '两边都算', items: ['按同一规则排'] },
      note: '同一个动作词落在两个领域时，判据是「这次强调的是规则，还是分类」。',
    },
  },
];

const blocks = cases
  .map(({ kind, label, why, spec }) => {
    const r = renderSpecFigure(kind, spec, { palette: 'indigo' });
    return `<section><header><b>${kind}</b><span>${label}</span></header><p class="why">${why}</p>${
      r ? r.svg : '<p style="color:#b91c1c">渲染失败</p>'
    }</section>`;
  })
  .join('\n');

const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<title>几何隐喻对照</title>
<style>
  body{margin:0;padding:24px;background:#f6f7f9;font-family:"PingFang SC","Microsoft YaHei",system-ui,sans-serif;color:#1f2430}
  h1{font-size:18px;margin:0 0 6px}
  .lead{margin:0 0 20px;font-size:13px;color:#5b6474;line-height:1.7}
  section{background:#fff;border:1px solid #e3e7ef;border-radius:12px;padding:14px 16px;margin-bottom:18px;overflow-x:auto}
  header{display:flex;align-items:baseline;gap:10px;margin-bottom:6px}
  header b{font:12px/1.6 ui-monospace,Consolas,monospace;color:#4f46e5}
  header span{font-size:13px;color:#1f2430;font-weight:600}
  .why{margin:0 0 10px;font-size:12.5px;color:#5b6474;line-height:1.7}
  svg{display:block;max-width:none}
</style></head><body>
<h1>关系 → 形状：五个该画几何、不该画白框的典型</h1>
<p class="lead">同一份产品渲染器（frontend/src/components/teaching-figure/render.ts）出图。判据一句话：<b>SVG 的理由是画出表格画不出来的拓扑与几何；能写成三行白字的，就不该动用图。</b></p>
${blocks}
</body></html>`;

const out = path.resolve(process.argv[2] || '../outputs/learn-visual-aids-20261017/metaphor-lab.html');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, html);
console.log('written', out);
