/** 把每条图渲染成独立 HTML（每页一张、左上角、白底），给浏览器逐页截图用。 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createSSRApp, h } from 'vue';
import { renderToString } from 'vue/server-renderer';
import TeachingFigure from '../src/components/TeachingFigure.vue';

const SRC = process.argv[2];
const OUT = process.argv[3];
if (!SRC || !OUT) throw new Error('用法: figure-pages.ts <items.json> <outDir>');
const items = JSON.parse(readFileSync(SRC, 'utf8'));
const CSS = (() => {
  const sfc = readFileSync(new URL('../src/components/TeachingFigure.vue', import.meta.url), 'utf8');
  return [...sfc.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n');
})();
mkdirSync(OUT, { recursive: true });
let i = 0;
for (const it of items) {
  const html = await renderToString(createSSRApp({ render: () => h('div', { class: 'slot' }, [h(TeachingFigure, { figure: it.figure })]) }));
  writeFileSync(
    `${OUT}/${i}.html`,
    `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:#fff}.slot{width:840px;padding:8px}${CSS}</style>${html}`,
    'utf8',
  );
  i += 1;
}
console.log('pages', i, '→', OUT);
