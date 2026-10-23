/**
 * 把 figure-out/figures.json 渲染成一份**单文件**评审页（无脚本、无外链，可直接发出去）。
 *
 * 为什么不再用浏览器截图存页面：截图里的样式来自 dev server 注入，改一次渲染器就得重抓；
 * 这里走同一套组件 + 同一个渲染器做 SSR，页面内容和真实课堂看到的一致，跑一次就是最新的。
 *
 * 用法（frontend 目录）：node node_modules/vite-node/vite-node.mjs scripts/figure-review-html.ts
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createSSRApp, h } from 'vue';
import { renderToString } from 'vue/server-renderer';
import TeachingFigure from '../src/components/TeachingFigure.vue';

/**
 * 组件样式直接从 SFC 源文件取。
 * 不能用 `?inline`：SSR 渲染出来的节点没有 scope 属性，`?inline` 在 vite-node 下也拿不到
 * scoped 块，位置线图会整套掉样式（轴线变 stroke:none、标签变 16px 黑字）——2026-10-21 实测。
 * 评审页只有这一个组件，按类名全局注入即可。
 */
const FIGURE_CSS = (() => {
  const sfc = readFileSync(new URL('../src/components/TeachingFigure.vue', import.meta.url), 'utf8');
  return [...sfc.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n');
})();

interface GalleryItem {
  sessionId: string;
  topic: string | null;
  user: string | null;
  at: string | number | null;
  figure: Record<string, unknown>;
  source?: {
    trigger?: string;
    reason?: string | null;
    kindHint?: string | null;
    ruleWhy?: string | null;
    matched?: string[];
  } | null;
  context?: { student?: string; teacher?: string };
}

const REASON_LABEL: Record<string, string> = {
  'ascii-structure': '上一轮用字符画了结构',
  'position-description': '学生刚描述完位置关系',
  'time-order': '学生在描述事件先后',
  'structure-content': '上一轮在讲结构化关系',
  'task-structure': '任务本身就是结构化关系',
  'recap-cadence': '连续多轮没出图，收一张',
};

const textBlock = (label: string, text: string | undefined, cls: string) =>
  text
    ? h('div', { class: `ctx ctx--${cls}` }, [
        h('span', { class: 'ctx__label' }, label),
        h('span', { class: 'ctx__text' }, text),
      ])
    : null;

/** 出图动机：主证据来自代码判据（谁触发、命中哪段原文、建议什么图型），模型自述降级 */
const motiveBlock = (item: GalleryItem) => {
  const src = item.source;
  const modelWhy = typeof item.figure.why === 'string' ? (item.figure.why as string) : '';
  const actualKind = String((item.figure as { kind?: string }).kind ?? '');
  if (!src && !modelWhy) {
    return h('div', { class: 'motive motive--empty' }, [
      h('span', { class: 'motive__label' }, '动机'),
      h('span', {}, '旧数据未记录（代码留痕从 2026-10-21 起写入）'),
    ]);
  }
  const triggerText = src
    ? src.trigger === 'opportunity'
      ? src.ruleWhy || REASON_LABEL[src.reason || ''] || src.reason || '编排层给了出图时机'
      : '模型自己判断要画（编排层没给时机）'
    : '';
  const matchedText = src?.matched?.length ? src.matched.join('、') : '';
  const hintText = src?.kindHint
    ? src.kindHint === actualKind
      ? `建议 ${src.kindHint} → 采用`
      : `建议 ${src.kindHint} → 模型改用 ${actualKind}`
    : '';
  return h('div', { class: 'motive' }, [
    triggerText
      ? h('div', { class: 'motive__row' }, [h('span', { class: 'motive__label' }, '为什么调用'), h('span', {}, triggerText)])
      : null,
    matchedText
      ? h('div', { class: 'motive__row' }, [h('span', { class: 'motive__label' }, '命中依据'), h('span', {}, matchedText)])
      : null,
    hintText
      ? h('div', { class: 'motive__row' }, [h('span', { class: 'motive__label' }, '图型'), h('span', {}, hintText)])
      : null,
    modelWhy
      ? h('div', { class: 'motive__row motive__row--soft' }, [h('span', { class: 'motive__label' }, '模型自述'), h('span', {}, modelWhy)])
      : null,
  ]);
};

const card = (item: GalleryItem, i: number) =>
  h('div', { class: 'item' }, [
    h('div', { class: 'meta' }, [
      h('b', String((item.figure as { kind?: string }).kind ?? '?')),
      ` · #${i + 1} · ${item.user ?? '—'} · ${item.topic ?? '—'}`,
    ]),
    motiveBlock(item),
    textBlock('学生', item.context?.student, 'student'),
    textBlock('老师', item.context?.teacher, 'teacher'),
    h(TeachingFigure, { figure: item.figure as never }),
  ]);

const BASE_CSS = `
body { margin: 0; padding: 20px; background: #f6f7f9; font-family: "PingFang SC", "Microsoft YaHei", system-ui, sans-serif; color: #1f2430; }
h1 { font-size: 18px; margin: 0 0 4px; }
.hint { font-size: 13px; color: #7b8494; margin-bottom: 16px; }
.grid { display: grid; grid-template-columns: 1fr; gap: 16px; max-width: 1180px; }
.item { background: #fff; border: 1px solid #e3e7ef; border-radius: 12px; padding: 14px; overflow: auto; }
.meta { font: 12px/1.7 ui-monospace, Consolas, monospace; color: #7b8494; margin-bottom: 8px; word-break: break-all; }
.meta b { color: #4a5568; font-weight: 600; }
.ctx { display: flex; gap: 8px; margin-bottom: 8px; font-size: 13px; line-height: 1.65; }
.ctx__label { flex: none; font-size: 11px; font-weight: 600; color: #7b8494; border: 1px solid #e3e7ef; border-radius: 4px; padding: 1px 5px; height: 18px; line-height: 16px; }
.ctx--student .ctx__text { color: #4a5568; }
.ctx__text { color: #1f2430; }
.ctx--teacher .ctx__text {
  display: -webkit-box; -webkit-line-clamp: 6; -webkit-box-orient: vertical; overflow: hidden;
}
.motive { background: #f7f5ff; border: 1px solid #e6e1fb; border-radius: 8px; padding: 8px 10px; margin-bottom: 10px; font-size: 13px; line-height: 1.6; }
.motive__row { display: flex; gap: 8px; }
.motive__label { flex: none; color: #6d5bd0; font-weight: 600; }
.motive__row + .motive__row { margin-top: 2px; }
.motive__row--soft { color: #6b7280; }
.motive__row--soft .motive__label { color: #8b93a7; }
.motive--empty { background: #f4f5f7; border-color: #e3e7ef; color: #7b8494; }
.empty { color: #b42318; }
svg { display: block; max-width: 100%; height: auto; }
/* 评审页是静态快照，没有放大层——「点击放大」留着会被当成点了没反应 */
.teaching-figure__hint { display: none !important; }
`;

const HINT =
  '这些是库里真实下发过的 spec，用产品同一个渲染器重画；每张上方是它所处的那一轮（紧邻的学生发言 + 老师这条回复，老师正文最多显示 6 行）。'
  + '紫色块是出图动机：谁触发的、命中哪段原文、建议什么图型；模型自述另起一行。';

const esc = (x: unknown) => String(x ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const SRC = process.env.REVIEW_SRC || 'figures.json';
const items = JSON.parse(readFileSync(new URL(`../figure-out/${SRC}`, import.meta.url), 'utf8')) as GalleryItem[];
const TITLE = process.env.REVIEW_TITLE || '课堂教学图图库';
const HINT_TEXT = process.env.REVIEW_HINT || HINT;

const root = {
  render: () =>
    h('div', {}, [
      h('h1', {}, TITLE),
      h('div', { class: 'hint' }, HINT_TEXT),
      h('div', { class: 'grid' }, items.map(card)),
    ]),
};

const body = await renderToString(createSSRApp(root));
const html = `<!doctype html>
<html lang="zh-CN"><head>
<meta charset="utf-8">
<title>${esc(TITLE)}</title>
<style>${BASE_CSS}</style>
<style>${FIGURE_CSS}</style>
</head>
<body>${body}</body></html>`;

const targets = process.env.REVIEW_OUT
  ? [new URL(`../../outputs/${process.env.REVIEW_OUT}`, import.meta.url)]
  : [
      new URL('../../outputs/teaching-figures-review.html', import.meta.url),
      new URL('../figure-out/review.html', import.meta.url),
    ];
for (const path of targets) writeFileSync(path, html, 'utf8');
console.log(`wrote ${items.length} figures, ${Math.round(html.length / 1024)}KB`);
