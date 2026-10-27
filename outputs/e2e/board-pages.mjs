/**
 * 把评审条目（items.json）逐条渲染成独立 HTML 页，供 render-pngs.mjs 截图。
 *
 * 渲染器是前端同一份确定性代码（frontend/src/components/teaching-figure/render.ts），
 * 先用 esbuild 打成 figure-out/render.bundle.mjs：
 *   cd frontend && npx esbuild src/components/teaching-figure/render.ts \
 *     --bundle --format=esm --platform=node --outfile=figure-out/render.bundle.mjs
 * SVG 自带 <style>，页面只需要一个白底容器。
 *
 * 用法：node outputs/e2e/board-pages.mjs <items.json> <pagesDir>
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const [itemsArg, outArg] = process.argv.slice(2);
if (!itemsArg || !outArg) throw new Error('用法: board-pages.mjs <items.json> <pagesDir>');

const items = JSON.parse(fs.readFileSync(path.resolve(ROOT, itemsArg), 'utf8'));
const outDir = path.resolve(ROOT, outArg);
fs.mkdirSync(outDir, { recursive: true });

const bundle = path.join(ROOT, 'frontend/figure-out/render.bundle.mjs');
const { renderSpecFigure } = await import(pathToFileURL(bundle).href);

let ok = 0;
let fail = 0;
items.forEach((it, i) => {
  const r = renderSpecFigure(it.figure?.kind, it.figure?.spec, {});
  if (!r) {
    fail += 1;
    console.warn(`✗ ${it.user || i}: 渲染返回 null（kind=${it.figure?.kind}）`);
    return;
  }
  const html = `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:#fff}.slot{width:${r.width}px;padding:8px}</style><div class="slot">${r.svg}</div>`;
  fs.writeFileSync(path.join(outDir, `${i}.html`), html, 'utf8');
  ok += 1;
});
console.log(JSON.stringify({ ok, fail, outDir }, null, 2));
