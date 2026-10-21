// 渲染回归基线：同一批 spec 在改动前后各跑一次，比较 width/height 与文本序列（几何不应漂移）
import fs from 'node:fs';
import path from 'node:path';
import { renderSpecFigure } from '@/components/teaching-figure/render';

const specs: Array<[string, string, Record<string, unknown>]> = [
  ['grid', 'g1', {
    rows: 2, cols: 2, rowLabels: ['甲', '乙'], colLabels: ['位置', '方向'],
    cells: [{ r: 0, c: 0, text: '前面' }, { r: 0, c: 1, text: '向右' }, { r: 1, c: 0, text: '后面' }],
  }],
  ['matrix', 'm1', {
    rowLabels: ['要点一', '要点二'], colLabels: ['第一段', '第二段'],
    cells: [{ r: 0, c: 0, tone: 'hit' }, { r: 0, c: 1, tone: 'miss' }, { r: 1, c: 0, tone: 'dup' }, { r: 1, c: 1, tone: 'key' }],
  }],
  ['compare', 'c1', {
    left: { head: '行为主义', items: ['看结果', '给反馈'] },
    right: { head: '建构主义', items: ['看过程'] },
    divider: '分歧：\n学习发生在哪里',
  }],
  ['quadrant', 'q1', {
    colLabels: ['效度高', '效度低'], rowLabels: [{ label: '信度高' }, { label: '信度低' }],
    cells: [
      { title: '可信可用', body: ['可以据此'], tone: 'ok' },
      { title: '稳定但偏', body: [] },
      { title: '偶然命中', body: [] },
      { title: '不可用', body: [], tone: 'warn' },
    ],
  }],
  ['bipartite', 'b1', {
    left: { head: '目标', nodes: [{ id: 'a', label: '倾听' }, { id: 'b', label: '表达' }] },
    right: { head: '建议', nodes: [{ id: 'x', label: '多给机会' }] },
    edges: [{ from: 'a', to: 'x' }, { from: 'b', to: 'x' }],
  }],
  ['board', 'd1', {
    pieces: [{ col: 4, rank: 9, key: 'K' }, { col: 4, rank: 0, key: 'k' }],
    arrows: [{ a1: { col: 4, rank: 9 }, a2: { col: 4, rank: 7 }, label: '进一' }],
  }],
];

const out: Record<string, unknown> = {};
for (const [kind, id, spec] of specs) {
  const r = renderSpecFigure(kind, spec);
  out[id] = r ? { kind, width: r.width, height: r.height, texts: [...r.svg.matchAll(/>([^<>]{1,40})<\/text>/g)].map((m) => m[1]) } : { kind, failed: true };
}
const target = process.argv[2] || 'outputs/learn-visual-aids-20261017/style-lab/baseline.json';
fs.mkdirSync(path.dirname(path.resolve(target)), { recursive: true });
fs.writeFileSync(path.resolve(target), JSON.stringify(out, null, 1));
console.log('written', target);
