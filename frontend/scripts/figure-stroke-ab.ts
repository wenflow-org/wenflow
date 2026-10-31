// 线宽 A/B：同一张图，按「知识类 skill 的既定设计系统」把描边从 1.15/1.7 提到 1.5/2.1 对比（2026-10-20）
// 用法：node node_modules/vite-node/vite-node.mjs scripts/figure-stroke-ab.ts [out.html]
import fs from 'node:fs';
import path from 'node:path';
import { renderSpecFigure } from '@/components/teaching-figure/render';

const cases: Array<{ kind: string; spec: Record<string, unknown> }> = [
  {
    kind: 'cycle',
    spec: {
      title: '四部件是一个环',
      center: '每一轮都回到同一个问题',
      nodes: [
        { label: '驱动问题', sub: '为什么非做不可' },
        { label: '持续探究', sub: '查几轮、记下来' },
        { label: '公开产出', sub: '做给谁看' },
        { label: '评价与记录', sub: '?' },
      ],
    },
  },
  {
    kind: 'bullseye',
    spec: {
      title: '信度（稳不稳）× 效度（准不准）',
      colLabels: ['高效度', '低效度'],
      rowLabels: [{ label: '高信度', sub: '每次一致' }, { label: '低信度', sub: '忽高忽低' }],
      cells: [
        { title: '稳且准', tone: 'ok', dots: [[0.05, 0.08], [-0.08, 0.02]] },
        { title: '稳定地打偏', tone: 'warn', dots: [[0.62, -0.2], [0.68, -0.12]] },
        { title: '方向对但太散', dots: [[-0.35, 0.4], [0.42, 0.3]] },
        { title: '又偏又散', tone: 'warn', dots: [[0.7, 0.5], [-0.6, -0.45]] },
      ],
    },
  },
];

/** 只改描边宽度：模拟"把基础线宽提一档"的效果（不改任何几何）。 */
const withStrokes = (svg: string, stroke: number, strong: number) =>
  svg
    .replace(/stroke-width="1\.15"/g, `stroke-width="${stroke}"`)
    .replace(/stroke-width="1\.7"/g, `stroke-width="${strong}"`);

const variants = [
  { name: '当前 1.15 / 1.7', stroke: 1.15, strong: 1.7 },
  { name: '参考 skill 1.5 / 2.1', stroke: 1.5, strong: 2.1 },
  { name: '偏重 1.9 / 2.6', stroke: 1.9, strong: 2.6 },
];

const blocks = cases
  .map(({ kind, spec }) => {
    const cells = variants
      .map((v) => {
        const r = renderSpecFigure(kind, spec, { palette: 'indigo' });
        const svg = r ? withStrokes(r.svg, v.stroke, v.strong) : '渲染失败';
        return `<figure><figcaption>${v.name}</figcaption>${svg}</figure>`;
      })
      .join('\n');
    return `<section><header><b>${kind}</b><span>线宽对照（1:1，与课堂内同尺寸）</span></header><div class="row">${cells}</div></section>`;
  })
  .join('\n');

const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<title>线宽 A/B</title>
<style>
  body{margin:0;padding:24px;background:#f6f7f9;font-family:"PingFang SC","Microsoft YaHei",system-ui,sans-serif;color:#1f2430}
  h1{font-size:17px;margin:0 0 6px}
  .lead{margin:0 0 18px;font-size:13px;color:#5b6474;line-height:1.7}
  section{background:#fff;border:1px solid #e3e7ef;border-radius:12px;padding:14px 16px;margin-bottom:18px;overflow-x:auto}
  header{display:flex;gap:10px;align-items:baseline;margin-bottom:10px}
  header b{font:12px/1.6 ui-monospace,Consolas,monospace;color:#4f46e5}
  header span{font-size:12.5px;color:#5b6474}
  .row{display:flex;gap:18px;align-items:flex-start}
  figure{margin:0;flex:none}
  figcaption{font-size:11.5px;color:#7b8494;margin-bottom:6px}
  svg{display:block}
</style></head><body>
<h1>描边宽度对照：同一张图、同一套配色，只改线宽</h1>
<p class="lead">参考来源：知识类 SVG skill（architecture-diagram）把组件描边定在 1.5px；Nature 图注规范给的是"最终尺寸 0.25–1pt"；Mermaid 官方对默认样式的自评是"粗描边 + 每个形状一个颜色"会跟正文抢注意力。这里只验证一件事：1.15px 在 100% 缩放下是不是太"纸片"。</p>
${blocks}
</body></html>`;

const out = path.resolve(process.argv[2] || '../outputs/learn-visual-aids-20261017/stroke-ab.html');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, html);
console.log('written', out);
