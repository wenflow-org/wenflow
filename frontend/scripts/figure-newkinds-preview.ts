// split-compare / state-strip 两张样张：渲染成独立 HTML 页供 Chrome 截图目检
// 用法（在 frontend 目录）：node node_modules/vite-node/vite-node.mjs scripts/figure-newkinds-preview.ts
import fs from 'node:fs';
import path from 'node:path';
import { renderSpecFigure } from '@/components/teaching-figure/render';

const cases: Array<[string, Record<string, unknown>]> = [
  ['split-compare', {
    title: '配速换算：先除还是先换算',
    left: {
      head: '常见错法', tone: 'warn',
      rows: [
        { label: '60 ÷ 400', sub: '把 400 米当 0.4 千米直接除' },
        { label: '得 0.15 分/千米' },
        { label: '越跑越快？', sub: '单位和答案对不上' },
      ],
    },
    right: {
      head: '正确做法', tone: 'ok',
      rows: [
        { label: '400 ÷ 1000 = 0.4 千米', sub: '先把米换算成千米' },
        { label: '60 ÷ 0.4 = 150 秒/千米' },
        { label: '= 2.5 分/千米', sub: '单位全程跟人走' },
      ],
    },
    delta: { label: '分叉在第一步：先换算单位，再去除', at: 1 },
  }],
  ['state-strip', {
    title: 'TCP 三次握手：连接怎么建立',
    frames: [
      { label: 'SYN', tone: 'neutral', items: ['客户端 → SYN_SENT', '服务端 LISTEN'] },
      { label: 'SYN+ACK', tone: 'accent', items: ['服务端 → SYN_RCVD', '客户端收到后才确认'] },
      { label: 'ACK', tone: 'ok', items: ['双方 ESTABLISHED', '可以传数据'] },
    ],
    note: '每一步都是一次状态迁移，走完不回头；少一步对方就不知道你听见了',
  }],
];

const outDir = path.resolve('figure-out/newkinds-pages');
fs.mkdirSync(outDir, { recursive: true });
cases.forEach(([kind, spec], i) => {
  const out = renderSpecFigure(kind, spec);
  if (!out) throw new Error(kind + ' 渲染返回 null');
  const html = '<!doctype html><meta charset="utf-8"><body style="margin:0;padding:12px;background:#fff">' + out.svg + '</body>';
  fs.writeFileSync(path.join(outDir, `${i + 1}.html`), html);
  console.log(kind, out.width + 'x' + out.height);
});
