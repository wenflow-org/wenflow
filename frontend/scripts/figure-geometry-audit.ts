/**
 * 几何审计第一步：把图库全部 SSR 渲染成一个静态页 + 一份索引，交给浏览器量。
 *
 * 本机没有 playwright 依赖（frontend/node_modules 是主树 junction，不该为审计装包），
 * 所以量像素这一步走 ZCode 内置浏览器：起个静态服务器 → 打开 geometry-audit.html →
 * 在页面里跑 measurement 脚本（见文件末尾注释）→ 把结果写回 geometry-audit.json。
 *
 * 用法（frontend 目录）：
 *   node node_modules/vite-node/vite-node.mjs scripts/figure-geometry-audit.ts [figures.json]
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createSSRApp, h } from 'vue';
import { renderToString } from 'vue/server-renderer';
import TeachingFigure from '../src/components/TeachingFigure.vue';

const SRC = process.argv[2] || new URL('../figure-out/figures.json', import.meta.url).pathname.replace(/^\/(\w:)/, '$1');
const OUT_DIR = new URL('../figure-out/', import.meta.url).pathname.replace(/^\/(\w:)/, '$1');

const FIGURE_CSS = (() => {
  const sfc = readFileSync(new URL('../src/components/TeachingFigure.vue', import.meta.url), 'utf8');
  return [...sfc.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n');
})();

interface GalleryItem {
  sessionId: string;
  topic: string | null;
  user: string | null;
  at: string | number | null;
  figure: any;
}

const items = (JSON.parse(readFileSync(SRC, 'utf8')) as GalleryItem[]).filter((it) => it.figure);

/** 同一份 spec 只量一次（重复下发会拉高计数，也会让页面变重） */
const seen = new Set<string>();
const unique: GalleryItem[] = [];
for (const it of items) {
  const key = JSON.stringify(it.figure);
  if (seen.has(key)) continue;
  seen.add(key);
  unique.push(it);
}

const rendered: string[] = [];
for (let i = 0; i < unique.length; i++) {
  rendered.push(
    await renderToString(
      createSSRApp({ render: () => h('div', { class: 'slot', 'data-i': i }, [h(TeachingFigure, { figure: unique[i].figure })]) }),
    ),
  );
}

const page = `<!doctype html><html><head><meta charset="utf-8"><style>
body{margin:0;background:#fff;font-family:system-ui,-apple-system,"Segoe UI",sans-serif}
.slot{width:640px;margin:0 0 8px}
${FIGURE_CSS}
</style></head><body>${rendered.join('\n')}</body></html>`;

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(OUT_DIR + 'geometry-audit.html', page, 'utf8');
writeFileSync(
  OUT_DIR + 'geometry-audit-items.json',
  JSON.stringify(
    unique.map((it, i) => ({ i, kind: it.figure?.kind || 'position-line', title: it.figure?.title || null, user: it.user, sessionId: it.sessionId })),
    null,
    1,
  ),
  'utf8',
);
console.log(`rendered ${unique.length} unique figures (from ${items.length}) → ${OUT_DIR}geometry-audit.html`);

/* 页面里跑的测量脚本（在 ZCode 内置浏览器里 evaluate 这一段）：

(() => {
  const out = [];
  const eps = 1.0; // 亚像素舍入容差：0.5px 设备坐标换算回画布会放大成 <1px
  for (const slot of document.querySelectorAll('.slot')) {
    const svg = slot.querySelector('svg');
    if (!svg) { out.push({ i: +slot.dataset.i, error: 'no svg' }); continue; }
    const vb = (svg.getAttribute('viewBox') || '').split(/\s+/).map(Number);
    const W = vb[2] || svg.clientWidth, H = vb[3] || svg.clientHeight;
    const boxes = [];
    for (const t of svg.querySelectorAll('text')) {
      const content = (t.textContent || '').trim();
      if (!content) continue;
      let b; try { b = t.getBBox(); } catch { continue; }
      boxes.push({ content, x1: b.x, y1: b.y, x2: b.x + b.width, y2: b.y + b.height, w: b.width, h: b.height });
    }
    const outside = boxes.filter((b) => b.x1 < -eps || b.y1 < -eps || b.x2 > W + eps || b.y2 > H + eps)
      .map((b) => ({ content: b.content, box: [b.x1, b.y1, b.x2, b.y2].map((n) => Math.round(n * 10) / 10), view: [W, H] }));
    const overlaps = [];
    for (let a = 0; a < boxes.length; a++) for (let c = a + 1; c < boxes.length; c++) {
      const A = boxes[a], C = boxes[c];
      const iw = Math.min(A.x2, C.x2) - Math.max(A.x1, C.x1);
      const ih = Math.min(A.y2, C.y2) - Math.max(A.y1, C.y1);
      if (iw <= 1 || ih <= 1) continue;
      const smaller = Math.min(A.w * A.h, C.w * C.h);
      const ratio = smaller > 0 ? (iw * ih) / smaller : 0;
      if (ratio >= 0.25) overlaps.push({ a: A.content, b: C.content, ratio: Math.round(ratio * 100) / 100 });
    }
    const ellipsis = boxes.filter((b) => /…$|\.\.\.$/.test(b.content)).map((b) => b.content);
    out.push({ i: +slot.dataset.i, texts: boxes.length, view: [W, H], outside, overlaps, ellipsis });
  }
  return out;
})()
*/
