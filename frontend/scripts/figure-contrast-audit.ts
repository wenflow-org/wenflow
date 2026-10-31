// 调色板对比度审计：文字 ≥4.5:1、非文字（描边/图形）≥3:1（WCAG 2.1 AA / Nature 图注规范同口径）
// 用法：node node_modules/vite-node/vite-node.mjs scripts/figure-contrast-audit.ts
import { FIGURE_PALETTE_KEYS, resolveTheme } from '@/components/teaching-figure/style';

const hex = (h: string) => h.replace('#', '');
const rgb = (h: string) => {
  const s = hex(h);
  const n = s.length === 3 ? s.split('').map((c) => c + c).join('') : s;
  return [parseInt(n.slice(0, 2), 16), parseInt(n.slice(2, 4), 16), parseInt(n.slice(4, 6), 16)];
};
const lin = (c: number) => {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
};
const lum = (h: string) => {
  const [r, g, b] = rgb(h);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
};
const ratio = (a: string, b: string) => {
  const la = lum(a);
  const lb = lum(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
};

const pairs: Array<[string, (t: any) => string, (t: any) => string, number]> = [
  ['正文 ink / surface', (t) => t.ink, (t) => t.surface, 4.5],
  ['次级 muted / surface', (t) => t.muted, (t) => t.surface, 4.5],
  ['三级 faint / surface', (t) => t.faint, (t) => t.surface, 3],
  ['accentInk / accentSoft', (t) => t.accentInk, (t) => t.accentSoft, 4.5],
  ['ok / okSoft', (t) => t.ok, (t) => t.okSoft, 4.5],
  ['warn / warnSoft', (t) => t.warn, (t) => t.warnSoft, 4.5],
  ['accent 线条 / surface', (t) => t.accent, (t) => t.surface, 3],
  ['line 描边 / surface', (t) => t.line, (t) => t.surface, 1.6],
  ['lineStrong 描边 / surface', (t) => t.lineStrong, (t) => t.surface, 3],
];

let failures = 0;
for (const key of FIGURE_PALETTE_KEYS) {
  const t = resolveTheme(key);
  const rows: string[] = [];
  for (const [label, fa, fb, min] of pairs) {
    const fg = (fa as any)(t) as string;
    const bg = (fb as any)(t) as string;
    const r = ratio(fg, bg);
    const ok = r >= min;
    if (!ok && min >= 4.5) failures += 1;
    rows.push(`${ok ? '✓' : '✗'} ${label.padEnd(24)} ${fg} on ${bg}  ${r.toFixed(2)}:1 (≥${min})`);
  }
  console.log(`\n[${key}]`);
  console.log(rows.join('\n'));
}
console.log(`\n文字级未达标：${failures}`);
