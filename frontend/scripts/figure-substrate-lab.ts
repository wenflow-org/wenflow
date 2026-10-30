// 材质实验：SVG 原生材质（零字节依赖） vs 扩散生成材质底（贴图）
// 用法（在 frontend 目录）：node node_modules/vite-node/vite-node.mjs scripts/figure-substrate-lab.ts
import fs from 'node:fs';
import path from 'node:path';
import { renderSpecFigure } from '@/components/teaching-figure/render';

const spec = {
  title: '逐条对账：写到了 / 漏 / 堆砌',
  rowLabels: ['自然·地形', '自然·水源', '社会·交通', '社会·劳动力'],
  colLabels: ['第一段', '第二段', '第三段'],
  cells: [
    { r: 0, c: 0, tone: 'hit' },
    { r: 0, c: 1, tone: 'miss' },
    { r: 1, c: 0, tone: 'hit' },
    { r: 1, c: 2, tone: 'dup' },
    { r: 2, c: 1, tone: 'hit' },
    { r: 3, c: 1, tone: 'key' },
    { r: 3, c: 2, tone: 'key' },
  ],
  legend: [
    { text: '✓ 已写到', fill: '#e6f4f1' },
    { text: '— 漏', fill: '#f3f4f7' },
    { text: '叠 重复堆砌', fill: '#fdf3e6' },
  ],
  focus: { row: 0 },
};

const native = [
  { id: 'plain', label: '无材质（现状）', svg: renderSpecFigure('matrix', spec, { palette: 'earth' })!.svg },
  { id: 'paper', label: 'SVG 原生纸纹（feTurbulence）', svg: renderSpecFigure('matrix', spec, { palette: 'earth', material: 'paper' })!.svg },
  { id: 'grid', label: 'SVG 原生网格纸（pattern）', svg: renderSpecFigure('matrix', spec, { palette: 'earth', material: 'grid' })!.svg },
];

const raster = [
  { id: 'paper', label: '扩散底：旧纸（内容压在白卡上）' },
  { id: 'grid', label: '扩散底：网格纸' },
  { id: 'board', label: '扩散底：黑板' },
  { id: 'wood', label: '扩散底：木桌' },
];

const nativeBlocks = native
  .map(
    (t) => `<section class="tile">
  <h2>${t.id} · ${t.label}</h2>
  <div class="sheet">${t.svg}</div>
</section>`,
  )
  .join('\n');

const plainSvg = renderSpecFigure('matrix', spec, { palette: 'earth' })!.svg;
const rasterBlocks = raster
  .map(
    (t) => `<section class="tile">
  <h2>${t.id} · ${t.label}</h2>
  <div class="stage" style="background-image:url(textures/${t.id}.png);background-size:cover;background-position:center">
    <div class="sheet">${plainSvg}</div>
  </div>
</section>`,
  )
  .join('\n');

const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<title>材质实验</title>
<style>
  body{margin:0;padding:24px;background:#eceef2;font-family:"PingFang SC","Microsoft YaHei",system-ui,sans-serif;color:#1f2430}
  h1{font-size:18px;margin:0 0 6px}
  h3{font-size:13px;margin:22px 0 10px;color:#3730a3}
  .lead{margin:0 0 8px;font-size:13px;color:#5b6474;max-width:920px;line-height:1.7}
  .tile{margin:0 0 18px}
  .tile h2{font-size:12px;margin:0 0 6px;color:#3730a3;font-family:ui-monospace,Consolas,monospace}
  .sheet{display:inline-block;background:#fff;border-radius:12px;padding:12px 14px;box-shadow:0 2px 10px rgba(15,23,42,.08)}
  .stage{padding:22px;border-radius:14px;box-shadow:inset 0 0 0 1px rgba(15,23,42,.06)}
  .sheet svg{display:block}
</style></head><body>
<h1>材质实验：原生 SVG 纹理 vs 扩散贴图</h1>
<p class="lead">同样是「让画面不那么像后台仪表盘」。原生那组只多几百字节、可离线、可确定性重放；扩散那组每张约 1 MB，且底纹只能出现在内容卡片之外（文字必须压在近白面上）。</p>
<h3>一、SVG 原生材质（推荐路线）</h3>
${nativeBlocks}
<h3>二、扩散生成材质底（对照）</h3>
${rasterBlocks}
</body></html>`;

const out = path.resolve('../outputs/learn-visual-aids-20261017/style-lab/substrate.html');
fs.writeFileSync(out, html);
console.log('written', out);
