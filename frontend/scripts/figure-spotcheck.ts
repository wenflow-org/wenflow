// 抽检页：只放指定序号的图，避免整页滚动截图失真
// 用法：node node_modules/vite-node/vite-node.mjs scripts/figure-spotcheck.ts 269,289,321,458
import fs from 'node:fs';
import path from 'node:path';
import { renderSpecFigure } from '@/components/teaching-figure/render';

const [, , idxArg] = process.argv;
const idxs = String(idxArg || '').split(',').map((s) => Number(s.trim()) - 1).filter((n) => Number.isInteger(n));
const items = JSON.parse(fs.readFileSync(path.resolve('figure-out/figures.json'), 'utf8')) as any[];
const sfc = fs.readFileSync(new URL('../src/components/TeachingFigure.vue', import.meta.url), 'utf8');
const css = [...sfc.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n');

const cards = idxs.map((i) => {
  const it = items[i];
  const fig = it?.figure || {};
  const r = renderSpecFigure(fig.kind, fig.spec ?? fig, { palette: (fig.palette || 'indigo') as never });
  const svg = r ? r.svg : '<p style="color:#b91c1c">渲染失败</p>';
  return `<section class="card"><h2>#${i + 1} · ${fig.kind} · ${it?.user || ''}</h2>
<p class="cap">${(fig.caption || '').replace(/</g, '&lt;')}</p><div class="canvas">${svg}</div></section>`;
}).join('\n');

const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>figure spotcheck</title>
<style>${css}
body{margin:0;padding:16px;background:#eef0f5;font-family:"PingFang SC","Microsoft YaHei",system-ui,sans-serif}
.card{background:#fff;border:1px solid #e3e7ef;border-radius:12px;padding:12px 14px;margin:0 0 14px}
.card h2{font:600 13px/1.6 ui-monospace,Consolas,monospace;color:#4b5563;margin:0 0 4px}
.cap{font-size:13px;color:#5b6474;margin:0 0 8px}
.canvas svg{display:block;max-width:100%;height:auto}
</style></head><body>${cards}</body></html>`;

const out = path.resolve('figure-out/spotcheck.html');
fs.writeFileSync(out, html);
console.log('written', out, idxs.map((i) => `#${i + 1}`).join(' '));
