/**
 * 教学图确定性渲染器（前端）：结构化规格 → 自包含 SVG 字符串。
 *
 * 来源：离线验证稿 `.zcode/skills/learn-visual-aids/scripts/render.mjs`（89 张图跑过几何/内容双重检查）。
 * 2026-10-19 增加**视觉语言层**（`style.ts`）：调色板 / 字阶 / 线宽 / 焦点强调 / 新图元（bins·balance·ladder）。
 *
 * 三条不变量：
 *   ① 同一份 spec 永远画出同一张图（无随机、无联网、无时间）；
 *   ② 模型给的值只进**文本**与**白名单属性**（颜色只认 hex、虚线只认数字），<style> 用 `.tfx` 作用域；
 *   ③ 版式判据（宽高、避让）与主题无关——换主题只改观感，不改几何。
 */

import { resolveTheme, materialForPalette, type FigurePalette, type FigureTheme } from './style';

/* 当前主题：渲染入口设置、结束后复位。渲染全程同步（组件 computed 内调用），不存在交叉执行。 */
let T: FigureTheme = resolveTheme('indigo');
let MAT: RenderOptions['material'] = 'none';
let uid = 0;

export interface RenderedFigure {
  svg: string;
  width: number;
  height: number;
}

export interface RenderOptions {
  palette?: FigurePalette;
  /**
   * 画布材质（可选，默认 none）。只做**底纹**，不承载任何信息：
   * - paper：暖白纸纹（feTurbulence 极低透明度），用于人文/地理类，缓解纯白界面的冷硬；
   * - grid：淡网格纸，用于需要「按格子对齐」的内容（矩阵/坐标）。
   * 刻意只提供浅色材质：深色底（黑板）需要整套反白配色，在会话内联场景里过于抢眼。
   */
  material?: 'none' | 'paper' | 'grid';
}

/** 粗估文本宽度：CJK 1em，ASCII 0.56em。用于排版避让，不追求像素级。 */
function est(text: unknown, size: number): number {
  let w = 0;
  for (const ch of String(text ?? '')) {
    w += /[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/.test(ch) ? size : size * 0.56;
  }
  return w;
}

/** 按字数硬换行（桥接框这类固定宽度的窄栏没有溢出空间，只能折行）。 */
function wrapChars(text: string, maxChars: number): string[] {
  const chars = Array.from(String(text ?? ''));
  const out: string[] = [];
  for (let i = 0; i < chars.length; i += maxChars) out.push(chars.slice(i, i + maxChars).join(''));
  return out.length ? out : [''];
}

function esc(s: unknown): string {
  return String(s ?? '')
    // 有意匹配控制字符区间并清掉（模型输出清洗，非残留控制码）
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** 颜色白名单：只认 hex（后端已过滤一次，这里是二道防线）。 */
function color(value: unknown, fallback: string): string {
  return typeof value === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(value.trim()) ? value.trim() : fallback;
}

/** 虚线白名单：只认数字与空格/逗号。 */
function dash(value: unknown): string {
  return typeof value === 'string' && /^[0-9][0-9\s,.]{0,18}$/.test(value.trim()) ? value.trim() : '';
}

/** 纯色 → 透明色（焦点底色用）：只接受 6 位 hex。 */
function tint(hex: string, alpha: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

function shadowId(): string {
  uid += 1;
  return `tfx-sh${uid}`;
}

function shadowDef(id: string): string {
  if (!T.shadow) return '';
  return `<defs><filter id="${id}" x="-12%" y="-12%" width="124%" height="130%">
  <feDropShadow dx="0" dy="1.5" stdDeviation="2.2" flood-color="${T.ink}" flood-opacity="0.12"/>
</filter></defs>`;
}

/**
 * 画布壳：字阶与配色全部走主题。
 * 作用域用 `.tfx`，同一页多张图不互相染样式；font-family 只作用于本图。
 */
function wrap(body: string, w: number, h: number, material: RenderOptions['material'] = MAT): string {
  const base = material === 'paper' ? '#fdfaf4' : '#ffffff';
  let materialLayer = '';
  if (material === 'paper') {
    // 纸纹：极低透明度的分形噪声 + 边缘轻微暖晕；只影响观感，不影响对比度（文字仍在 7:1 以上）
    materialLayer = `<defs>
  <filter id="tfx-grain"><feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed="11"/><feColorMatrix type="saturate" values="0"/></filter>
  <radialGradient id="tfx-vign" cx="50%" cy="45%" r="75%">
    <stop offset="55%" stop-color="#000" stop-opacity="0"/><stop offset="100%" stop-color="#7a5c33" stop-opacity="0.045"/>
  </radialGradient>
</defs>
<rect x="0" y="0" width="${w}" height="${h}" fill="${base}"/>
<rect x="0" y="0" width="${w}" height="${h}" filter="url(#tfx-grain)" opacity="0.045"/>
<rect x="0" y="0" width="${w}" height="${h}" fill="url(#tfx-vign)"/>`;
  } else if (material === 'grid') {
    materialLayer = `<defs>
  <pattern id="tfx-grid" width="12" height="12" patternUnits="userSpaceOnUse">
    <path d="M12 0H0V12" fill="none" stroke="${T.line}" stroke-width="0.6" opacity="0.55"/>
  </pattern>
</defs>
<rect x="0" y="0" width="${w}" height="${h}" fill="${base}"/>
<rect x="0" y="0" width="${w}" height="${h}" fill="url(#tfx-grid)"/>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" class="tfx" data-theme="${T.id}" ${
    material !== 'none' ? `data-material="${material}"` : ''
  }>
<style>
  .tfx text{font-family:"PingFang SC","Microsoft YaHei","Segoe UI",system-ui,sans-serif;fill:${T.ink}}
  .tfx .t-hero{font-size:${T.fontHero}px;font-weight:700;letter-spacing:-0.2px}
  .tfx .t-title{font-size:${T.fontTitle}px;font-weight:650}
  .tfx .t-key{font-size:${T.fontKey}px;font-weight:650}
  .tfx .t-label{font-size:${T.fontBody}px}
  .tfx .t-small{font-size:${T.fontSmall}px;fill:${T.muted}}
  .tfx .t-tiny{font-size:${T.fontMicro}px;fill:${T.faint}}
</style>
${materialLayer}
${body}
</svg>`;
}

/* ---------------- 基础图元 ---------------- */

function rect(
  x: number,
  y: number,
  w: number,
  h: number,
  {
    r = T.radius,
    fill = T.surface,
    stroke = T.line,
    sw = T.stroke,
    dash: dashAttr = '',
    filter = '',
  }: Record<string, unknown> = {},
): string {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"${
    dashAttr ? ` stroke-dasharray="${dashAttr}"` : ''
  }${filter ? ` filter="url(#${filter})"` : ''}/>`;
}

function text(x: number, y: number, s: unknown, cls = 't-label', anchor = 'middle', extra = ''): string {
  return `<text x="${x}" y="${y}" class="${cls}" text-anchor="${anchor}" ${extra}>${esc(s)}</text>`;
}

/** 标题：一条短强调线放在标题下方——廉价但有效的「结构感」，不增加任何信息。 */
function titleBlock(title: string | null | undefined, x = 12): string[] {
  if (!title) return [];
  return [
    text(x, T.fontTitle + 6, title, 't-title', 'start'),
    `<rect x="${x}" y="${T.fontTitle + 12}" width="22" height="2.5" rx="1.25" fill="${T.accent}"/>`,
  ];
}

/** 正交/直线箭头（带箭头头部） */
function arrow(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  { color: strokeColor = T.lineStrong, dash: dashAttr = '', sw = 1.4, head = true, curve = null } = {} as {
    color?: string;
    dash?: string;
    sw?: number;
    head?: boolean;
    curve?: { cx: number; cy: number } | null;
  },
): string {
  const d = curve ? `M${x1} ${y1} Q${curve.cx} ${curve.cy} ${x2} ${y2}` : `M${x1} ${y1} L${x2} ${y2}`;
  let headPath = '';
  if (head) {
    const angle = Math.atan2(y2 - (curve ? curve.cy : y1), x2 - (curve ? curve.cx : x1));
    const L = 8;
    const W = 4.2;
    const ax = x2 - L * Math.cos(angle);
    const ay = y2 - L * Math.sin(angle);
    const px = W * Math.sin(angle);
    const py = -W * Math.cos(angle);
    headPath = `<path d="M${x2} ${y2} L${ax + px} ${ay + py} L${ax - px} ${ay - py} Z" fill="${strokeColor}"/>`;
  }
  return `<path d="${d}" fill="none" stroke="${strokeColor}" stroke-width="${sw}"${
    dashAttr ? ` stroke-dasharray="${dashAttr}"` : ''
  } stroke-linecap="round"/>${headPath}`;
}

/** 按估算宽度折行（CJK 按字断行，ASCII 尽量不切断单词）。 */
function wrapLines(str: unknown, maxW: number, size: number): string[] {
  const out: string[] = [];
  let cur = '';
  for (const ch of String(str ?? '')) {
    if (est(cur + ch, size) > maxW && cur) {
      out.push(cur);
      cur = ch === ' ' ? '' : ch;
    } else cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

/* ---------------- 一、网格（二维排布，每格是内容） ---------------- */

function renderGrid({ title, cells = [], rows, cols, rowLabels = [], colLabels = [], note, focus }: any): RenderedFigure {
  const labelW = rowLabels.length ? Math.max(44, Math.ceil(Math.max(...rowLabels.map((l: string) => est(l, 12)))) + 16) : 0;
  const headH = colLabels.length ? 30 : 0;
  const titleH = title ? T.fontTitle + 18 : 0;

  let maxText = 0;
  for (const c of cells) maxText = Math.max(maxText, est(c.text ?? '', T.fontBody));
  const cw = Math.max(56, Math.ceil(maxText) + 26);
  const ch = 40;
  const colW = () => Math.max(56, Math.round(cw));
  const colX = (c: number) => {
    let x = 0;
    for (let i = 0; i < c; i++) x += colW();
    return x;
  };
  const colsTotalW = colX(cols);

  const gridW = labelW + colsTotalW + 24;
  const titleW = title ? 12 + est(title, T.fontTitle) + 16 : 0;
  const noteLines = note ? wrapLines(note, 620, T.fontSmall) : [];
  const noteW = noteLines.length ? Math.max(...noteLines.map((l: string) => est(l, T.fontSmall))) + 24 : 0;
  const w = Math.ceil(Math.max(gridW, titleW, noteW));
  const h = titleH + headH + rows * ch + (noteLines.length ? noteLines.length * 18 + 8 : 0) + 12;

  const ox = Math.round((w - gridW) / 2) + 12 + labelW;
  const oy = 12 + titleH + headH;
  const map = new Map(cells.map((c: any) => [`${c.r},${c.c}`, c]));
  const parts: string[] = [...titleBlock(title)];
  const focusRow = Number.isInteger(focus?.row) ? focus.row : null;
  const focusCol = Number.isInteger(focus?.col) ? focus.col : null;

  colLabels.forEach((lab: string, c: number) => {
    const cwi = colW();
    const isFocus = focusCol === c;
    parts.push(
      text(ox + colX(c) + cwi / 2, 12 + titleH + 19, lab, isFocus ? 't-key' : 't-small', 'middle', isFocus ? `fill="${T.accentInk}"` : ''),
    );
  });
  rowLabels.forEach((lab: string, r: number) => {
    const isFocus = focusRow === r;
    parts.push(
      text(ox - 10, oy + r * ch + ch / 2 + 4, lab, isFocus ? 't-key' : 't-small', 'end', isFocus ? `fill="${T.accentInk}"` : ''),
    );
  });

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cell: any = map.get(`${r},${c}`);
      const cwi = colW();
      const x = ox + colX(c);
      const y = oy + r * ch;
      const isFocus = (focusRow !== null && focusRow === r) || (focusCol !== null && focusCol === c);
      const hasFocus = focusRow !== null || focusCol !== null;
      let fill = T.surface;
      let stroke = T.line;
      let dashAttr = '';
      let txtColor = hasFocus && !isFocus ? T.muted : T.ink;
      if (cell?.mask) {
        fill = T.surface;
        stroke = tint(T.accent, 0.45);
        dashAttr = '5 4';
      }
      if (cell?.ghost) {
        fill = T.soft;
        stroke = T.line;
        dashAttr = '4 3';
        txtColor = T.faint;
      }
      if (cell?.hl === 'accent') fill = T.accentSoft;
      if (cell?.hl === 'warn') fill = T.warnSoft;
      if (cell?.hl === 'ok') fill = T.okSoft;
      if (isFocus && !cell?.mask) fill = cell?.hl ? fill : tint(T.accent, 0.07);
      parts.push(rect(x + 1.5, y + 1.5, cwi - 3, ch - 3, { r: 7, fill, stroke, sw: isFocus ? T.strokeStrong : T.stroke, dash: dashAttr }));
      if (isFocus) {
        parts.push(`<rect x="${x + 1.5}" y="${y + 5}" width="3" height="${ch - 10}" rx="1.5" fill="${T.accent}"/>`);
      }
      if (cell?.mask) {
        parts.push(
          `<text x="${x + cwi / 2}" y="${y + ch / 2 + 4.5}" text-anchor="middle" style="font-size:${T.fontSmall}px;fill:${T.accent}">待你回答</text>`,
        );
      } else if (cell?.text) {
        parts.push(
          `<text x="${x + cwi / 2}" y="${y + ch / 2 + 4.5}" class="${isFocus ? 't-key' : 't-label'}" text-anchor="middle" fill="${txtColor}">${esc(
            cell.text,
          )}</text>`,
        );
      }
      if (cell?.mark) {
        parts.push(text(x + cwi - 8, y + 14, cell.mark, 't-tiny', 'end', `fill="${color(cell.markColor, T.warn)}"`));
      }
    }
  }
  noteLines.forEach((ln: string, i: number) => {
    parts.push(text(12, oy + rows * ch + 20 + i * 18, ln, 't-small', 'start'));
  });

  return { svg: wrap(parts.join('\n'), w, h), width: w, height: h };
}

/* ---------------- 二、棋盘（二维空间） ---------------- */

const GLYPH: Record<string, string> = {
  R: '车',
  N: '马',
  B: '象',
  A: '士',
  K: '将',
  C: '炮',
  P: '卒',
  r: '车',
  n: '马',
  b: '相',
  a: '仕',
  k: '帅',
  c: '炮',
  p: '兵',
};

function renderBoard({ title, pieces = [], files = [], arrows = [], marks = [], note, size = 46, panelLabel }: any): RenderedFigure {
  const padL = 30;
  const padR = 30;
  const sizeCjk = T.fontSmall;
  const headH = title || panelLabel ? T.fontTitle + 20 : 10;
  const padT = headH + Math.round(size * 0.52) + 8;
  const bottomLabelExtra = (arrows || []).some(
    (a: any) => a.a1 && a.a2 && a.a1.rank === a.a2.rank && Math.max(a.a1.rank, a.a2.rank) >= 8 && a.label,
  )
    ? 34
    : 0;
  const padB = 26 + bottomLabelExtra;

  const boardW = padL + 8 * size + padR;
  const titleW = title ? 12 + est(title, T.fontTitle) + 14 : 0;
  const panelW = panelLabel ? est(panelLabel, T.fontMicro) + 16 + 14 : 0;
  const w0 = Math.max(boardW, titleW + panelW);
  const noteLines = note ? wrapLines(note, Math.max(360, w0 - 24), sizeCjk) : [];
  const noteW = noteLines.length ? Math.max(...noteLines.map((l: string) => est(l, sizeCjk))) + 24 : 0;
  const w = Math.ceil(Math.max(w0, noteW));
  const boardX = Math.round((w - 8 * size) / 2);
  const h = padT + 9 * size + padB + (noteLines.length ? noteLines.length * 17 + 8 : 0);

  const at = (col: number, rank: number) => ({ x: boardX + col * size, y: padT + rank * size });

  const parts: string[] = [...titleBlock(title)];
  if (panelLabel) {
    parts.push(
      `<rect x="${w - 12 - est(panelLabel, T.fontMicro) - 16}" y="8" width="${est(panelLabel, T.fontMicro) + 16}" height="18" rx="9" fill="${T.accentSoft}"/>`,
      text(w - 12 - 8, 21, panelLabel, 't-tiny', 'end', `fill="${T.accentInk}"`),
    );
  }

  for (const f of files) {
    const x = at(f.col, 0).x;
    const fill = f.tone === 'warn' ? tint(T.warn, 0.1) : f.tone === 'ok' ? tint(T.ok, 0.1) : tint(T.accent, 0.09);
    parts.push(`<rect x="${x - size / 2}" y="${padT - size / 2}" width="${size}" height="${9 * size}" fill="${fill}"/>`);
    if (f.label) {
      parts.push(
        text(x, padT - size / 2 - 6, f.label, 't-tiny', 'middle', `fill="${f.tone === 'warn' ? T.warn : T.accent}"`),
      );
    }
  }

  for (let r = 0; r <= 9; r++) {
    const a = at(0, r);
    const b = at(8, r);
    parts.push(`<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="${T.line}" stroke-width="${T.stroke}"/>`);
  }
  for (let c = 0; c <= 8; c++) {
    const a = at(c, 0);
    const b = at(c, 9);
    parts.push(`<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="${T.line}" stroke-width="${T.stroke}"/>`);
  }
  const riverTop = at(0, 4).y;
  const riverBottom = at(0, 5).y;
  parts.push(`<rect x="${at(0, 4).x}" y="${riverTop + 1}" width="${8 * size}" height="${size - 2}" fill="${T.surface}"/>`);
  parts.push(`<line x1="${at(0, 4).x}" y1="${riverTop}" x2="${at(8, 4).x}" y2="${riverTop}" stroke="${T.line}" stroke-width="${T.stroke}"/>`);
  parts.push(`<line x1="${at(0, 5).x}" y1="${riverBottom}" x2="${at(8, 5).x}" y2="${riverBottom}" stroke="${T.line}" stroke-width="${T.stroke}"/>`);
  parts.push(text(at(2, 0).x, riverTop + size / 2 + 4, '楚 河', 't-tiny', 'middle', `fill="${T.faint}"`));
  parts.push(text(at(6, 0).x, riverTop + size / 2 + 4, '汉 界', 't-tiny', 'middle', `fill="${T.faint}"`));

  const diag = (c1: number, r1: number, c2: number, r2: number) => {
    const a = at(c1, r1);
    const b = at(c2, r2);
    parts.push(`<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="${T.line}" stroke-width="${T.stroke}"/>`);
  };
  diag(3, 0, 5, 2);
  diag(5, 0, 3, 2);
  diag(3, 7, 5, 9);
  diag(5, 7, 3, 9);

  for (const a of arrows) {
    const strokeColor = a.tone === 'warn' ? T.warn : a.tone === 'ok' ? T.ok : T.accent;
    if (a.a1 && a.a2) {
      const p1 = at(a.a1.col, a.a1.rank);
      const p2 = at(a.a2.col, a.a2.rank);
      const horiz = a.a1.rank === a.a2.rank;
      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      const len = Math.hypot(dx, dy) || 1;
      const adjacent = len < size * 1.5;
      const shrink = adjacent ? size * 0.18 : size * 0.46;
      const x1 = p1.x + (dx / len) * shrink;
      const y1 = p1.y + (dy / len) * shrink;
      const x2 = p2.x - (dx / len) * shrink;
      const y2 = p2.y - (dy / len) * shrink;
      const curve = adjacent ? { cx: (x1 + x2) / 2, cy: Math.min(y1, y2) - size * 0.9 } : null;
      parts.push(arrow(x1, y1, x2, y2, { color: strokeColor, dash: dash(a.dash) || '6 4', sw: 2, curve }));
      if (a.label) {
        const lw = est(a.label, T.fontMicro) + 12;
        const mx = (x1 + x2) / 2;
        const my = (y1 + y2) / 2;
        const bottomRows = Math.max(a.a1.rank, a.a2.rank) >= 8;
        let lx = mx;
        let ly = horiz ? (bottomRows ? my + 26 : my - 16) : my;
        if (adjacent) ly = Math.max(y1, y2) + 30;
        if (!horiz) lx = mx + size * 0.7 + lw / 2;
        if (lx - lw / 2 < 8) lx = mx + size * 0.7 + lw / 2;
        if (lx + lw / 2 > w - 8) lx = mx - size * 0.7 - lw / 2;
        parts.push(
          `<rect x="${lx - lw / 2}" y="${ly - 9}" width="${lw}" height="18" rx="5" fill="${T.surface}" stroke="${strokeColor}" stroke-opacity=".45"/>`,
          text(lx, ly + 4, a.label, 't-tiny', 'middle', `fill="${strokeColor}"`),
        );
      }
      continue;
    }
    const x = at(a.col, 0).x;
    const y1 = at(a.col, a.from).y;
    const y2 = at(a.col, a.to).y;
    parts.push(arrow(x, y1 - size * 0.28, x, y2 + size * 0.28, { color: strokeColor, dash: dash(a.dash) || '6 4', sw: 2 }));
    if (a.label) {
      const ly = (y1 + y2) / 2;
      const lw = est(a.label, T.fontMicro) + 12;
      const right = x + size * 0.62 + lw / 2;
      let lx = a.side === 'left' ? x - size * 0.62 - lw / 2 : right;
      if (a.side !== 'left' && right + lw / 2 > w - 10) lx = x - size * 0.62 - lw / 2;
      if (lx - lw / 2 < 8 || lx + lw / 2 > w - 8) lx = x;
      parts.push(
        `<rect x="${lx - lw / 2}" y="${ly - 9}" width="${lw}" height="18" rx="5" fill="${T.surface}" stroke="${strokeColor}" stroke-opacity=".45"/>`,
        text(lx, ly + 4, a.label, 't-tiny', 'middle', `fill="${strokeColor}"`),
      );
    }
  }

  for (const m of marks || []) {
    const p = at(m.col, m.rank);
    parts.push(
      `<circle cx="${p.x}" cy="${p.y}" r="${size * 0.44}" fill="none" stroke="${color(m.color, T.warn)}" stroke-width="2" stroke-dasharray="4 3"/>`,
    );
  }

  for (const pc of pieces) {
    const p = at(pc.col, pc.rank);
    const red = pc.key === pc.key.toLowerCase();
    const fill = pc.hl === 'warn' ? T.warnSoft : pc.hl === 'accent' ? T.accentSoft : T.surface;
    const stroke = red ? '#b02a2a' : '#23283a';
    parts.push(`<circle cx="${p.x}" cy="${p.y}" r="${size * 0.4}" fill="${fill}" stroke="${stroke}" stroke-width="1.6"/>`);
    parts.push(
      `<text x="${p.x}" y="${p.y + size * 0.13}" text-anchor="middle" fill="${stroke}" style="font-size:${Math.round(
        size * 0.42,
      )}px;font-weight:650">${GLYPH[pc.key] || ''}</text>`,
    );
  }

  noteLines.forEach((ln: string, i: number) => {
    parts.push(text(12, padT + 9 * size + size * 0.5 + 16 + bottomLabelExtra + i * 17, ln, 't-small', 'start'));
  });

  return { svg: wrap(parts.join('\n'), w, h), width: w, height: h };
}

/* ---------------- 三、对比（两条并排的分支） ---------------- */

const COMPARE_TONES: Record<string, { color: string; soft: string; ink: string }> = {
  ok: { color: T.ok, soft: T.okSoft, ink: T.ok },
  accent: { color: T.accent, soft: T.accentSoft, ink: T.accentInk },
  warn: { color: T.warn, soft: T.warnSoft, ink: T.warn },
  neutral: { color: T.muted, soft: T.soft, ink: T.muted },
};

/**
 * 链路形态的 compare（2026-10-20 实跑教训）。
 *
 * 为什么不能只画两栏文字卡：学生卡住的不是「ZK 重、Raft 轻」这句话，而是**代价落在哪一跳上**。
 * 文字卡把「两套集群 / 两次独立共识」压成一句副标题，画面里一个集群、一条网络线都没有——
 * 那还不如直接读段落。这里把关系摆成几何：客户端在**集群边界之外**，每穿过一次边界就是一次网络往返，
 * 边界上的序号就是跳数；省掉一次共识的那一栏，边界上就少一个序号、节点里多一枚「内置·合一」。
 * 差异因此落在**线段和节点**上，而不是飘在两栏中间的一句气泡里。
 */
function renderCompareChain({ title, left, right, note, leftTone = 'ok', rightTone = 'accent', focus }: any): RenderedFigure {
  const panelW = 330;
  const gap = 16;
  const padX = 14;
  const W = padX * 2 + panelW * 2 + gap;
  const titleH = title ? T.fontTitle + 20 : 0;
  // 栏头留够两行（标题+徽标）+ 区域标签骑边的高度，否则「集群边界」会压到徽标
  const headH = 66;
  const bodyTop = titleH + headH;
  // 节点高度按真实文字算：标签最多两行、副标题最多两行，
  // 固定 52px 会把「元数据变更与业务写入落同一条 Log」这类副标题截成半句。
  const nodeGap = 12;
  const nodeXOff = 58;
  // 卡左内衬 26：跳数圆圈骑在边界上（r=8.5），留 16 会让箭头尖和圆圈叠在一起
  const nodePad = 26;
  const nodeW = panelW - nodeXOff - nodePad * 2;

  const nodesOf = (side: any): any[] => (Array.isArray(side?.chain) ? side.chain : []);
  const itemsOf = (side: any): string[] => (Array.isArray(side?.items) ? side.items : []);
  // 每张卡按自己的文字量取高：统一高度会让只有两行字的卡空出半张脸，
  // 而三行字的卡又贴到边框——卡片高度跟内容走，两栏各自堆叠。
  const measureNode = (node: any) => {
    const textW = nodeW - 24;
    const labelLines = wrapLines(String(node?.label || ''), textW, T.fontBody).slice(0, 2).length;
    const subLines = node?.sub ? wrapLines(String(node.sub), textW, T.fontMicro).slice(0, 2).length : 0;
    // 合一徽标固定在卡片底部一行：它会占掉 18px，但不抢标题宽度（否则长名字会被挤成两行半）
    return 22 + labelLines * 17 + subLines * 14 + (node?.merged ? 18 : 0);
  };
  const layoutOf = (side: any) => {
    const nodes = nodesOf(side);
    const heights = nodes.map(measureNode);
    const offsets: number[] = [];
    let acc = 0;
    heights.forEach((h) => { offsets.push(acc); acc += h + nodeGap; });
    return { heights, offsets, total: heights.length ? acc - nodeGap : 0 };
  };
  const leftLayout = layoutOf(left);
  const rightLayout = layoutOf(right);
  const rowsH = Math.max(leftLayout.total, rightLayout.total);
  const itemRows = Math.max(itemsOf(left).length, itemsOf(right).length);
  const itemsH = itemRows ? 14 + itemRows * 17 : 0;
  // 边界框底部留 18px 标签条：节点卡贴着框底时，「集群边界」四个字会被压掉
  const borderH = (rowsH || 60) + 18;
  const bodyH = borderH + 16 + itemsH;
  const noteLines = note ? wrapLines(note, W - padX * 2, T.fontSmall) : [];
  const h = Math.ceil(bodyTop + bodyH + 10 + (noteLines.length ? noteLines.length * 18 + 10 : 0));

  const parts: string[] = [...titleBlock(title, padX)];

  const panel = (side: any, layout: { heights: number[]; offsets: number[]; total: number }, x: number, toneName: string, sideKey: 'left' | 'right') => {
    const tone = COMPARE_TONES[toneName] || COMPARE_TONES.neutral;
    const nodes = nodesOf(side);
    const items = itemsOf(side);
    const isFocus = focus === sideKey;

    // 栏头：结论在上、徽标在下——并排会让「18 字标题 + 24 字徽标」挤成一行
    parts.push(text(x, titleH + 16, side.head, 't-key', 'start', `fill="${isFocus ? tone.ink : T.ink}"`));
    const badgeTone = COMPARE_TONES[side.badgeTone] || tone;
    if (side.badge) parts.push(text(x, titleH + 34, side.badge, 't-micro', 'start', `fill="${badgeTone.ink}"`));

    // 集群边界：客户端画在框**外**，箭头穿过边框 = 一次跨集群往返
    const borderX = x + nodeXOff;
    const borderW = panelW - nodeXOff;
    parts.push(rect(borderX, bodyTop, borderW, borderH, {
      r: 10,
      fill: tint(tone.color, 0.05),
      stroke: tone.color,
      sw: isFocus ? T.strokeStrong : 1.2,
    }));
    // 区域标签骑在边框**顶边**上：放框底会被读成只圈住最后一张卡（外部视觉审校实测）
    const labelW = est('集群边界', T.fontMicro) + 16;
    parts.push(rect(borderX + 12, bodyTop - 18, labelW, 16, { r: 8, fill: T.surface, stroke: tone.color, sw: 1 }));
    parts.push(text(borderX + 12 + labelW / 2, bodyTop - 6.5, '集群边界', 't-tiny', 'middle', `fill="${tone.ink}"`));

    const stackTop = bodyTop + Math.max(0, (rowsH - layout.total) / 2);
    const client = side.client || '客户端';
    const clientW = 50;
    const clientH = 26;
    // 客户端左移 6px：跳数圆圈骑在边界上，否则它会压住客户端的右边框
    const clientX = x - 6;
    const firstCy = stackTop + (layout.heights[0] || 60) / 2;
    parts.push(rect(clientX, firstCy - clientH / 2, clientW, clientH, { r: 7, fill: T.surface, stroke: T.lineStrong, sw: T.stroke }));
    parts.push(text(clientX + clientW / 2, firstCy + 4, client, 't-tiny', 'middle'));

    // 每一跳从客户端出发穿过边界：第 1 跳直连，第 2 跳起走左侧竖干再横进
    const trunkX = clientX + clientW + 8;
    const directIdx = nodes.map((n: any, i: number) => (n.from === 'prev' ? -1 : i)).filter((i: number) => i >= 0);
    const lastDirect = directIdx.length ? directIdx[directIdx.length - 1] : 0;
    const lastCy = stackTop + layout.offsets[lastDirect] + (layout.heights[lastDirect] || 60) / 2;
    if (directIdx.length > 1) {
      parts.push(`<line x1="${trunkX}" y1="${firstCy}" x2="${trunkX}" y2="${lastCy}" stroke="${tone.color}" stroke-width="1.4" opacity="0.55"/>`);
    }
    nodes.forEach((node: any, i: number) => {
      const nh = layout.heights[i] || 60;
      const ny = stackTop + layout.offsets[i];
      const cy = ny + nh / 2;
      const nodeTone = COMPARE_TONES[node.tone] || tone;
      const entryX = borderX + nodePad;
      if (node.from === 'prev') {
        // 顺序链路：从上一张卡底下拉一条竖箭头下来，**不跨边界、不占跳数**
        const prev = i - 1;
        const prevBottom = stackTop + layout.offsets[prev] + (layout.heights[prev] || 60);
        const ax = entryX + 26;
        parts.push(`<line x1="${ax}" y1="${prevBottom}" x2="${ax}" y2="${ny - 3}" stroke="${tone.color}" stroke-width="1.7"/>`);
        parts.push(`<polygon points="${ax - 4.6},${ny - 10} ${ax},${ny - 1} ${ax + 4.6},${ny - 10}" fill="${tone.color}"/>`);
      } else {
        // 竖干 → 边界：这段就是一次网络往返
        parts.push(`<line x1="${trunkX}" y1="${cy}" x2="${entryX - 8}" y2="${cy}" stroke="${tone.color}" stroke-width="1.7"/>`);
        // 跳数标在**边界上**：数一眼边界上的序号，就是这条路径跨了几次集群
        const bx = borderX;
        const hopNo = nodes.slice(0, i + 1).filter((n: any) => n.from !== 'prev').length;
        parts.push(`<circle cx="${bx}" cy="${cy}" r="8.5" fill="${T.surface}" stroke="${tone.color}" stroke-width="1.6"/>`);
        parts.push(text(bx, cy + 3.6, String(hopNo), 't-micro', 'middle', `fill="${tone.ink}"`));
        parts.push(`<polygon points="${entryX - 11},${cy - 4.6} ${entryX - 1},${cy} ${entryX - 11},${cy + 4.6}" fill="${tone.color}"/>`);
        // rtt：这条请求要等回话，箭头补一个反向的（往返，不是单向投递）
        // rtt：这一跳不是单向投递——同一个箭头上再补一个朝客户端的方向，
        // 表示「发出去、还要等它回来」；另画一条回程线会和跳数圆圈挤在一起。
        if (node.rtt) {
          parts.push(`<polygon points="${trunkX + 19},${cy - 4.2} ${trunkX + 11},${cy} ${trunkX + 19},${cy + 4.2}" fill="${tone.color}"/>`);
        }
      }

      parts.push(rect(entryX, ny, nodeW, nh, {
        r: 8,
        fill: node.merged ? T.okSoft : T.surface,
        stroke: nodeTone.color,
        sw: node.merged ? 1.5 : T.stroke,
      }));
      const textW = nodeW - 24;
      const labelLines = wrapLines(String(node.label || ''), textW, T.fontBody).slice(0, 2);
      const subLines = node.sub ? wrapLines(String(node.sub), textW, T.fontMicro).slice(0, 2) : [];
      const textH = labelLines.length * 17 + subLines.length * 14;
      const textCy = node.merged ? ny + (nh - 18) / 2 : cy;
      let ty = textCy - textH / 2 + 12;
      labelLines.forEach((ln: string) => { parts.push(text(entryX + 12, ty, ln, 't-label', 'start')); ty += 17; });
      subLines.forEach((ln: string, si: number) => { parts.push(text(entryX + 12, ty + 2 + si * 14, ln, 't-tiny', 'start', `fill="${T.muted}"`)); });
      if (node.merged) {
        const pw = est('内置·合一', T.fontMicro) + 18;
        const px = entryX + nodeW - pw - 10;
        const py = ny + nh - 24;
        parts.push(rect(px, py, pw, 18, { r: 9, fill: T.okSoft, stroke: T.ok, sw: 1 }));
        parts.push(text(px + pw / 2, py + 13, '内置·合一', 't-tiny', 'middle', `fill="${T.ok}"`));
      }
    });

    // 痛点 / 收口：贴着本栏底部，说的是这一栏的结论
    if (items.length) {
      const iy = bodyTop + borderH + 14;
      items.forEach((it: string, i: number) => {
        parts.push(`<circle cx="${x + 4}" cy="${iy + i * 17 - 3.5}" r="2.6" fill="${tone.color}"/>`);
        parts.push(text(x + 13, iy + i * 17, it, 't-tiny', 'start', `fill="${T.muted}"`));
      });
    }
  };

  panel(left, leftLayout, padX, leftTone, 'left');
  panel(right, rightLayout, padX + panelW + gap, rightTone, 'right');

  noteLines.forEach((ln: string, i: number) => {
    parts.push(text(padX, h - 8 - (noteLines.length - 1 - i) * 18, ln, 't-small', 'start'));
  });

  return { svg: wrap(parts.join('\n'), W, h), width: W, height: h };
}

function renderCompare({ title, left, right, divider, note, leftTone = 'ok', rightTone = 'accent', focus }: any): RenderedFigure {
  // 两侧给了请求链路 → 走拓扑模式：跳数由边界上的序号和箭头本身表达
  if ((Array.isArray(left?.chain) && left.chain.length) || (Array.isArray(right?.chain) && right.chain.length)) {
    return renderCompareChain({ title, left, right, note, leftTone, rightTone, focus });
  }
  const colW = 268;
  const gap = 156;
  const padX = 16;
  const w = padX * 2 + colW * 2 + gap;
  const itemH = 36;
  const rows = Math.max(left.items.length, right.items.length);
  const h = (title ? T.fontTitle + 20 : 0) + 54 + rows * itemH + 16 + (note ? 26 : 0);
  const TONES: Record<string, { color: string; soft: string; ink: string }> = {
    ok: { color: T.ok, soft: T.okSoft, ink: T.ok },
    accent: { color: T.accent, soft: T.accentSoft, ink: T.accentInk },
    neutral: { color: T.muted, soft: T.soft, ink: T.muted },
    warn: { color: T.warn, soft: T.warnSoft, ink: T.warn },
  };

  const parts: string[] = [];
  let y = 0;
  if (title) {
    parts.push(...titleBlock(title, padX));
    y = T.fontTitle + 20;
  }

  const headY = y + 8;
  const cols = [
    { x: padX, ...(TONES[leftTone] || TONES.ok), data: left, tone: leftTone },
    { x: padX + colW + gap, ...(TONES[rightTone] || TONES.accent), data: right, tone: rightTone },
  ];
  for (const col of cols) {
    const isFocus = focus === (col === cols[0] ? 'left' : 'right');
    parts.push(
      rect(col.x, headY, colW, 36, { r: 9, fill: col.soft, stroke: col.color, sw: isFocus ? T.strokeStrong : 1.3 }),
    );
    // 焦点侧：顶部加一条强调轨（信号，不增加信息）
    if (isFocus) parts.push(`<rect x="${col.x + 10}" y="${headY - 3}" width="${colW - 20}" height="3" rx="1.5" fill="${col.color}"/>`);
    parts.push(text(col.x + colW / 2, headY + 23, col.data.head, 't-key', 'middle', `fill="${col.ink}"`));
    if (col.data.sub) parts.push(text(col.x + colW / 2, headY + 50, col.data.sub, 't-tiny'));
    col.data.items.forEach((it: string, i: number) => {
      const iy = headY + 60 + i * itemH;
      parts.push(rect(col.x + 8, iy, colW - 16, itemH - 8, { r: 7, fill: T.surface, stroke: T.line, sw: T.stroke }));
      parts.push(`<circle cx="${col.x + 24}" cy="${iy + (itemH - 8) / 2}" r="3" fill="${col.color}"/>`);
      parts.push(text(col.x + 36, iy + (itemH - 8) / 2 + 4.5, it, 't-label', 'start'));
    });
  }

  if (divider) {
    const cx = padX + colW + gap / 2;
    const cy = headY + 40 + (rows * itemH) / 2;
    parts.push(
      `<line x1="${cx}" y1="${headY + 4}" x2="${cx}" y2="${h - (note ? 32 : 8)}" stroke="${T.line}" stroke-dasharray="5 5"/>`,
    );
    // 桥接框宽度由栏间距决定；文字必须按框宽换行，否则长句直接捅穿矩形（2026-10-21 走查 #16）
    const boxW = gap - 16;
    const maxDividerChars = Math.max(6, Math.floor((boxW - 16) / (T.fontMicro * 0.95)));
    const lines = divider.split('\n').flatMap((line: string) => wrapChars(line, maxDividerChars));
    const shown = lines.length > 4
      ? lines.slice(0, 4).map((l: string, i: number) => (i === 3 ? l.slice(0, -1) + '…' : l))
      : lines;
    const bw = Math.min(gap - 16, Math.max(96, Math.max(...shown.map((l: string) => est(l, T.fontMicro))) + 20));
    const bh = 14 + shown.length * 16;
    parts.push(rect(cx - bw / 2, cy - bh / 2, bw, bh, { r: 9, fill: T.surface, stroke: T.line }));
    shown.forEach((l: string, i: number) => parts.push(text(cx, cy - bh / 2 + 18 + i * 16, l, 't-tiny')));
  }
  if (note) parts.push(text(padX, h - 8, note, 't-small', 'start'));

  return { svg: wrap(parts.join('\n'), w, h), width: w, height: h };
}

/* ---------------- 四、二分连线图（多对多关系） ---------------- */

function renderBipartite({ title, left, right, edges = [], note, width = 640, focus }: any): RenderedFigure {
  const TONE: Record<string, { color: string; soft: string }> = {
    accent: { color: T.accent, soft: T.accentSoft },
    ok: { color: T.ok, soft: T.okSoft },
    warn: { color: T.warn, soft: T.warnSoft },
    neutral: { color: T.muted, soft: T.soft },
  };
  const titleH = title ? T.fontTitle + 20 : 0;
  const headH = 30;
  const rowH = 54;
  const nodeH = 36;
  const rw = 180;
  const lx = 24;
  const rx = width - 24 - rw;
  const rows = Math.max(left.nodes.length, right.nodes.length);
  const noteLines = note ? wrapLines(note, width - 24, T.fontSmall) : [];
  const hasDashedEdge = edges.some((e: any) => dash(e.dash));
  const legendH = hasDashedEdge ? 18 : 0;
  const h = titleH + headH + rows * rowH + (noteLines.length ? noteLines.length * 18 + 12 : 0) + legendH + 12;

  const parts: string[] = [...titleBlock(title)];
  const headY = titleH + 16;
  parts.push(text(lx + rw / 2, headY, left.head || '', 't-small'));
  parts.push(text(rx + rw / 2, headY, right.head || '', 't-small'));

  const top = titleH + headH;
  const nodeY = (i: number) => top + i * rowH;
  const byId = new Map<string, { n: any; side: 'L' | 'R'; i: number }>();
  left.nodes.forEach((n: any, i: number) => byId.set(n.id, { n, side: 'L', i }));
  right.nodes.forEach((n: any, i: number) => byId.set(n.id, { n, side: 'R', i }));
  const focusIds = new Set<string>(Array.isArray(focus) ? focus.map((f: unknown) => String(f)) : []);

  // 连线画在节点下面：交叉处干净
  for (const e of edges) {
    const a = byId.get(e.from);
    const b = byId.get(e.to);
    if (!a || !b) continue;
    const t = TONE[e.tone || (a.side === 'L' ? a.n.tone : b.n.tone) || 'accent'] || TONE.accent;
    const isFocusEdge = focusIds.has(e.from) || focusIds.has(e.to);
    const x1 = lx + rw;
    const y1 = nodeY(a.i) + nodeH / 2;
    const x2 = rx;
    const y2 = nodeY(b.i) + nodeH / 2;
    const cx = (x1 + x2) / 2;
    parts.push(
      `<path d="M${x1} ${y1} C${cx} ${y1}, ${cx} ${y2}, ${x2} ${y2}" fill="none" stroke="${t.color}" stroke-width="${
        isFocusEdge ? 2.6 : 1.8
      }"${dash(e.dash) ? ` stroke-dasharray="${dash(e.dash)}"` : ''} stroke-linecap="round" opacity="${
        isFocusEdge ? 1 : 0.72
      }"/>`,
    );
  }

  const node = (n: any, i: number, x: number) => {
    const t = TONE[n.tone || 'neutral'] || TONE.neutral;
    const y = nodeY(i);
    const isFocus = focusIds.has(String(n.id));
    parts.push(
      rect(x, y, rw, nodeH, {
        r: 9,
        fill: n.tone ? t.soft : isFocus ? tint(T.accent, 0.07) : T.surface,
        stroke: isFocus ? T.accent : n.tone ? t.color : T.line,
        sw: isFocus ? T.strokeStrong : n.tone ? 1.5 : T.stroke,
      }),
    );
    parts.push(
      text(x + rw / 2, y + nodeH / 2 + 4.5, n.label, isFocus || n.tone ? 't-key' : 't-label', 'middle', n.tone ? `fill="${t.color}"` : ''),
    );
  };
  left.nodes.forEach((n: any, i: number) => node(n, i, lx));
  right.nodes.forEach((n: any, i: number) => node(n, i, rx));

  noteLines.forEach((ln: string, i: number) =>
    parts.push(text(12, h - 8 - legendH - (noteLines.length - 1 - i) * 18, ln, 't-small', 'start')),
  );

  // 虚线有语义就必须有图例（知识类 skill 的通行做法：虚线=次要/条件性关系，不能让学生猜）
  if (hasDashedEdge) {
    const ly = h - 8;
    const right = width - 12;
    parts.push(text(right, ly, '虚线 = 次要 / 附带关系', 't-tiny', 'end'));
    const labelW = est('虚线 = 次要 / 附带关系', T.fontMicro);
    const dashX = right - labelW - 30;
    parts.push(`<path d="M${dashX} ${ly - 4} h18" stroke="${T.lineStrong}" stroke-width="1.4" stroke-dasharray="4 3"/>`);
    parts.push(`<path d="M${dashX - 34} ${ly - 4} h18" stroke="${T.lineStrong}" stroke-width="1.4"/>`);
    parts.push(text(dashX - 40, ly, '实线', 't-tiny', 'end'));
  }
  return { svg: wrap(parts.join('\n'), width, h), width, height: h };
}

/* ---------------- 五、四象限 ---------------- */

function renderQuadrant({ title, colLabels = [], rowLabels = [], cells = [], note }: any): RenderedFigure {
  const TONE: Record<string, { color: string; soft: string }> = {
    ok: { color: T.ok, soft: T.okSoft },
    warn: { color: T.warn, soft: T.warnSoft },
    neutral: { color: T.muted, soft: T.soft },
    muted: { color: T.faint, soft: T.soft },
  };
  const W = 680;
  const padL = 108;
  const cw = 264;
  const gapX = 14;
  const chh = 106;
  const top = 68;
  const gapY = 14;
  const titleH = title ? T.fontTitle + 20 : 0;
  const h = titleH + top + chh * 2 + gapY + (note ? 30 : 0) + 10;

  const parts: string[] = [...titleBlock(title)];
  const xs = [padL + 8, padL + 8 + cw + gapX];
  colLabels.forEach((lab: string, c: number) => parts.push(text(xs[c] + cw / 2, titleH + 50, lab, 't-small')));
  rowLabels.forEach((lab: any, r: number) => {
    parts.push(text(padL, titleH + top + r * (chh + gapY) + chh / 2 - 2, lab.label, 't-key', 'end'));
    if (lab.sub) parts.push(text(padL, titleH + top + r * (chh + gapY) + chh / 2 + 15, lab.sub, 't-tiny', 'end'));
  });

  cells.forEach((cell: any, idx: number) => {
    const x = xs[idx % 2];
    const y = titleH + top + Math.floor(idx / 2) * (chh + gapY);
    const t = TONE[cell.tone || 'neutral'] || TONE.neutral;
    parts.push(rect(x, y, cw, chh, { r: 11, fill: t.soft, stroke: t.color, sw: cell.tone === 'warn' ? 1.8 : 1.3 }));

    if (cell.icon && cell.icon.kind === 'target') {
      const cx = x + 48;
      const cy = y + chh / 2;
      parts.push(`<circle cx="${cx}" cy="${cy}" r="30" fill="${T.surface}" stroke="${T.line}" stroke-width="${T.stroke}"/>`);
      parts.push(`<circle cx="${cx}" cy="${cy}" r="19" fill="none" stroke="${T.line}" stroke-width="1"/>`);
      parts.push(`<circle cx="${cx}" cy="${cy}" r="8" fill="none" stroke="${t.color}" stroke-width="1.2"/>`);
      for (const d of cell.icon.dots || []) {
        parts.push(`<circle cx="${cx + d[0]}" cy="${cy + d[1]}" r="3" fill="${t.color}" opacity=".9"/>`);
      }
    }

    const tx = x + 96;
    parts.push(text(tx, y + 30, cell.title || '', 't-key', 'start', `fill="${t.color}"`));
    (cell.body || []).forEach((ln: string, i: number) => parts.push(text(tx, y + 52 + i * 18, ln, 't-small', 'start')));
  });

  if (note) parts.push(text(12, h - 8, note, 't-small', 'start'));
  return { svg: wrap(parts.join('\n'), W, h), width: W, height: h };
}

/* ---------------- 六、对照表（2D 命中矩阵） ---------------- */

function renderMatrix({ title, rowLabels, colLabels, cells, note, legend = [], focus }: any): RenderedFigure {
  const labelW = Math.max(...rowLabels.map((l: string) => est(l, 12))) + 22;
  const cw = 94;
  const ch = 36;
  const headH = 42;

  const matrixW = 14 + labelW + colLabels.length * cw + 14;
  const titleW = title ? 12 + est(title, T.fontTitle) + 12 : 0;
  const noteW = note ? 12 + est(note, T.fontSmall) + 12 : 0;
  const legendW = legend.reduce((sum: number, l: any) => sum + 15 + est(l.text, T.fontMicro) + 16, 12);
  const w = Math.ceil(Math.max(matrixW, titleW, noteW, legendW));

  const h = (title ? T.fontTitle + 18 : 0) + headH + rowLabels.length * ch + 26 + (note ? 22 : 0) + (legend.length ? 22 : 0);

  const parts: string[] = [];
  let oy = 0;
  if (title) {
    parts.push(...titleBlock(title));
    oy = T.fontTitle + 18;
  }

  const ox = Math.round((w - matrixW) / 2) + 14;
  const focusRow = Number.isInteger(focus?.row) ? focus.row : null;
  const focusCol = Number.isInteger(focus?.col) ? focus.col : null;

  // 焦点行/列：表头用强调色 + 底色 + 左侧强调轨；非焦点文字降为次级色（层次靠「退后」，不靠加大）
  if (focusRow !== null) {
    parts.push(
      `<rect x="${ox}" y="${oy + headH + focusRow * ch}" width="${labelW + colLabels.length * cw}" height="${ch}" fill="${tint(
        T.accent,
        0.06,
      )}"/>`,
    );
    parts.push(
      `<rect x="${ox - labelW}" y="${oy + headH + focusRow * ch + 4}" width="3" height="${ch - 8}" rx="1.5" fill="${T.accent}"/>`,
    );
  }
  if (focusCol !== null) {
    parts.push(
      `<rect x="${ox + labelW + focusCol * cw}" y="${oy + headH - 8}" width="${cw}" height="${rowLabels.length * ch + 8}" fill="${tint(
        T.accent,
        0.06,
      )}"/>`,
    );
  }

  const hasFocus = focusRow !== null || focusCol !== null;
  colLabels.forEach((lab: string, c: number) => {
    const cx = ox + labelW + c * cw + cw / 2;
    const lines = lab.split('\n');
    const isFocus = focusCol === c;
    lines.forEach((l: string, i: number) =>
      parts.push(
        text(cx, oy + 18 + i * 14, l, isFocus ? 't-key' : 't-small', 'middle', isFocus ? `fill="${T.accentInk}"` : ''),
      ),
    );
  });
  rowLabels.forEach((lab: string, r: number) => {
    const isFocus = focusRow === r;
    const dim = hasFocus && !isFocus;
    parts.push(
      text(
        ox + labelW - 12,
        oy + headH + r * ch + ch / 2 + 4,
        lab,
        isFocus ? 't-key' : 't-label',
        'end',
        isFocus ? `fill="${T.accentInk}"` : dim ? `fill="${T.muted}"` : '',
      ),
    );
  });

  const map = new Map(cells.map((c: any) => [`${c.r},${c.c}`, c]));
  for (let r = 0; r < rowLabels.length; r++) {
    for (let c = 0; c < colLabels.length; c++) {
      const cell: any = map.get(`${r},${c}`);
      const x = ox + labelW + c * cw;
      const y = oy + headH + r * ch;
      const tone = cell?.tone;
      const fill =
        tone === 'hit' ? T.okSoft : tone === 'miss' ? T.soft : tone === 'dup' ? T.warnSoft : tone === 'key' ? T.accentSoft : T.surface;
      const stroke = tone === 'hit' ? tint(T.ok, 0.35) : tone === 'dup' ? tint(T.warn, 0.35) : tone === 'key' ? tint(T.accent, 0.35) : T.line;
      parts.push(rect(x + 2, y + 2, cw - 4, ch - 4, { r: 6, fill, stroke, sw: T.stroke }));
      const glyph = tone === 'hit' ? '✓' : tone === 'miss' ? '—' : tone === 'dup' ? '叠' : tone === 'key' ? '≡' : '';
      if (glyph) {
        const gcolor = tone === 'hit' ? T.ok : tone === 'dup' ? T.warn : tone === 'key' ? T.accent : T.faint;
        parts.push(
          `<text x="${x + cw / 2}" y="${y + ch / 2 + 5}" text-anchor="middle" style="font-size:${T.fontBody}px;font-weight:600;fill:${gcolor}">${glyph}</text>`,
        );
      }
    }
  }

  const ly = h - 8;
  if (note) parts.push(text(12, h - (legend.length ? 26 : 8), note, 't-small', 'start'));
  if (legend.length) {
    let lx = 12;
    for (const l of legend) {
      parts.push(
        `<rect x="${lx}" y="${ly - 9}" width="10" height="10" rx="3" fill="${color(l.fill, T.surface)}" stroke="${color(l.stroke, T.lineStrong)}" stroke-width="1"/>`,
      );
      parts.push(text(lx + 15, ly, l.text, 't-tiny', 'start'));
      lx += 15 + est(l.text, T.fontMicro) + 16;
    }
  }

  return { svg: wrap(parts.join('\n'), w, h), width: w, height: h };
}

/* ---------------- 七、收纳箱（分类/归位：条目的「所属」是容器关系） ---------------- */

/**
 * bins：每个箱子是一个容器，条目**画在箱子里面**。
 * 与 compare 的区别：compare 是两条并列分支（对等），bins 是「这些东西归到哪一堆」（包含关系）。
 * 用形状承载语义——学生一眼看到的是「谁在谁里面」，而不是两列等宽的卡片。
 */
/**
 * bins 条目 chip 的最小宽度。
 * 版式：chip 左内衬 30 起排文字，右侧标记 end 锚在 chip 右内衬 8 处，两者至少留 8px 空隙。
 * chipW ≥ 30 + 文字 + 8 + 标记 + 8，binW = chipW + 20（左右各 10）。
 */
function binsItemWidth(item: unknown): number {
  const isObj = item !== null && typeof item === 'object';
  const label = isObj ? (item as any).label : item;
  const mark = isObj ? (item as any).mark : null;
  return 66 + est(label, T.fontBody) + (mark ? est(mark, T.fontMicro) : 0);
}

function renderBins({ title, bins = [], note, focus }: any): RenderedFigure {
  const binGap = 18;
  const padX = 14;
  const headH = 34;
  const chipH = 30;
  const chipGap = 8;

  const binW = Math.max(
    150,
    ...bins.map((b: any) => Math.max(est(b.label, T.fontKey) + 44, ...(b.items || []).map(binsItemWidth), 120)),
  );
  const maxItems = Math.max(1, ...bins.map((b: any) => (b.items || []).length));
  const bodyH = maxItems * (chipH + chipGap) + 14;
  const titleH = title ? T.fontTitle + 20 : 0;
  const noteLines = note ? wrapLines(note, bins.length * (binW + binGap) + padX, T.fontSmall) : [];
  const w = Math.ceil(padX * 2 + bins.length * binW + (bins.length - 1) * binGap);
  const h = titleH + headH + bodyH + (noteLines.length ? noteLines.length * 18 + 12 : 0) + 8;

  const parts: string[] = [...titleBlock(title, padX)];
  const sid = shadowId();
  parts.push(shadowDef(sid));

  bins.forEach((bin: any, bi: number) => {
    const x = padX + bi * (binW + binGap);
    const y = titleH;
    const tone =
      bin.tone === 'warn'
        ? { color: T.warn, soft: T.warnSoft }
        : bin.tone === 'ok'
          ? { color: T.ok, soft: T.okSoft }
          : { color: T.accent, soft: T.accentSoft };
    const isFocus = Number.isInteger(focus) ? focus === bi : false;

    // 容器：体是**浅底**、条目是白卡片——层级来自「容器在下、条目在上」，不是靠描边
    parts.push(rect(x, y, binW, headH + bodyH, { r: 12, fill: tint(tone.color, 0.05), stroke: tone.color, sw: isFocus ? 2 : 1.4, filter: isFocus ? sid : '' }));
    parts.push(`<path d="M${x + 1} ${y + headH} h${binW - 2}" stroke="${tone.color}" stroke-width="1.4" opacity=".45"/>`);
    parts.push(`<rect x="${x + 1}" y="${y + 1}" width="${binW - 2}" height="${headH - 1}" rx="11" fill="${tone.soft}"/>`);
    parts.push(text(x + binW / 2, y + 22, bin.label, 't-key', 'middle', `fill="${tone.color}"`));

    (bin.items || []).forEach((item: any, i: number) => {
      const label = typeof item === 'string' ? item : item.label;
      const mark = typeof item === 'object' ? item.mark : null;
      const iy = y + headH + 8 + i * (chipH + chipGap);
      const iw = binW - 20;
      parts.push(rect(x + 10, iy, iw, chipH, { r: 7, fill: T.surface, stroke: T.line, sw: T.stroke }));
      parts.push(`<circle cx="${x + 21}" cy="${iy + chipH / 2}" r="2.6" fill="${tone.color}"/>`);
      parts.push(text(x + 30, iy + chipH / 2 + 4.5, label, 't-label', 'start'));
      if (mark) parts.push(text(x + 10 + iw - 8, iy + chipH / 2 + 4, mark, 't-tiny', 'end', `fill="${tone.color}"`));
    });
  });

  noteLines.forEach((ln: string, i: number) => {
    parts.push(text(padX, titleH + headH + bodyH + 18 + i * 18, ln, 't-small', 'start'));
  });

  return { svg: wrap(parts.join('\n'), w, h), width: w, height: h };
}

/* ---------------- 八、天平（权衡：两边各自的分量） ---------------- */

/**
 * balance：一个支点 + 一根横梁 + 两个托盘。倾斜方向表示哪边更重（`weight` 由代码换算成倾角）。
 * 与 compare 的区别：compare 说「有什么不同」，balance 说「哪边压得住」——用于取舍/权衡类内容。
 * 几何要点：托盘从横梁端点**竖绳吊下**，随梁一起升降（真实天平的样子）；
 * 若把两个托盘画在同一水平线上、只把绳子画斜，看起来像 A 字架而不是天平。
 */
function renderBalance({ title, left, right, pivotLabel, note, focus }: any): RenderedFigure {
  const W = 620;
  const padX = 20;
  const titleH = title ? T.fontTitle + 20 : 0;
  const cx = W / 2;
  const armY = titleH + 60;
  const L = 178;
  const panW = 208;
  const panH = 34;
  const rope = 52;
  const itemH = 26;

  const lw = Number(left.weight) || 0;
  const rw = Number(right.weight) || 0;
  // >0 表示左边更重（左边下沉）。倾角随分量差放大：差得少也要看得出方向，差得多也不夸张成跷跷板。
  const diff = lw - rw;
  const lean = diff === 0 ? 0 : Math.sign(diff) * (0.04 + 0.09 * Math.min(1, Math.abs(diff) / 10));
  const dy = L * Math.sin(lean);
  const leftX = cx - L * Math.cos(lean);
  const leftY = armY + dy;
  const rightX = cx + L * Math.cos(lean);
  const rightY = armY - dy;

  const panTopL = leftY + rope;
  const panTopR = rightY + rope;

  // 每侧的条目装进一张浅卡片：卡宽随内容走（托盘宽是最小值），但不得探进中间的支架
  const layout = (data: any, x: number, beamY: number, panTop: number, tone: string, soft: string, isFocus: boolean) => {
    const items: string[] = data.items || [];
    const need = Math.max(0, ...items.map((it) => est(it, T.fontSmall) + 34));
    const cardW = Math.min(Math.max(panW, need), 280);
    const cardX = Math.round(Math.min(Math.max(x - cardW / 2, padX), W - padX - cardW));
    const cardY = Math.round(panTop + panH + (data.sub ? 28 : 18));
    const cardH = Math.max(1, items.length) * itemH + 14;
    return { data, x, beamY, panTop, tone, soft, isFocus, items, cardW, cardX, cardY, cardH };
  };

  const sides = [
    layout(
      left,
      leftX,
      leftY,
      panTopL,
      focus === 'right' ? T.muted : T.accent,
      focus === 'right' ? T.soft : T.accentSoft,
      focus !== 'right',
    ),
    layout(
      right,
      rightX,
      rightY,
      panTopR,
      focus === 'left' ? T.muted : T.accent,
      focus === 'left' ? T.soft : T.accentSoft,
      focus !== 'left',
    ),
  ];

  const contentBottom = Math.max(...sides.map((s) => s.cardY + s.cardH));
  const standBaseY = Math.max(armY + 96, contentBottom - 20);
  const noteLines = note ? wrapLines(note, W - padX * 2, T.fontSmall) : [];
  const h = contentBottom + (noteLines.length ? noteLines.length * 18 + 18 : 16);

  const parts: string[] = [...titleBlock(title, padX)];

  // 支架（在托盘后面）
  parts.push(
    `<path d="M${cx - 32} ${standBaseY} L${cx} ${armY + 2} L${cx + 32} ${standBaseY} Z" fill="${T.soft}" stroke="${T.line}" stroke-width="${T.stroke}"/>`,
  );

  for (const side of sides) {
    parts.push(
      `<line x1="${side.x}" y1="${side.beamY}" x2="${side.x}" y2="${side.panTop}" stroke="${T.lineStrong}" stroke-width="${T.stroke}"/>`,
    );
    parts.push(
      rect(side.x - panW / 2, side.panTop, panW, panH, {
        r: 9,
        fill: side.soft,
        stroke: side.tone,
        sw: side.isFocus ? T.strokeStrong : 1.2,
      }),
    );
    parts.push(text(side.x, side.panTop + 22, side.data.head, 't-key', 'middle', `fill="${side.tone}"`));
    if (side.data.sub) parts.push(text(side.x, side.panTop + 50, side.data.sub, 't-tiny'));

    // 托盘上的东西：卡片承载，避免条目像散落的注释
    parts.push(rect(side.cardX, side.cardY, side.cardW, side.cardH, { r: 8, fill: T.surface, stroke: T.line, sw: T.stroke }));
    side.items.forEach((it, i) => {
      const iy = side.cardY + 16 + i * itemH;
      parts.push(`<circle cx="${side.cardX + 14}" cy="${iy - 4}" r="2.4" fill="${side.tone}" opacity=".75"/>`);
      parts.push(text(side.cardX + 24, iy, it, 't-label', 'start'));
    });
  }

  // 横梁压在绳子之上、托盘之上，视觉上「托住」两端
  parts.push(`<line x1="${leftX}" y1="${leftY}" x2="${rightX}" y2="${rightY}" stroke="${T.lineStrong}" stroke-width="2.6" stroke-linecap="round"/>`);
  parts.push(`<circle cx="${cx}" cy="${armY}" r="5" fill="${T.surface}" stroke="${T.lineStrong}" stroke-width="${T.strokeStrong}"/>`);
  if (pivotLabel) parts.push(text(cx, standBaseY + 18, pivotLabel, 't-tiny', 'middle'));

  noteLines.forEach((ln: string, i: number) => {
    parts.push(text(padX, contentBottom + 24 + i * 18, ln, 't-small', 'start'));
  });

  return { svg: wrap(parts.join('\n'), W, h), width: W, height: h };
}

/* ---------------- 九、阶梯（层级/进度：位置本身就是信息） ---------------- */

/**
 * ladder：从左下往右上的台阶，每级一个阶段。`state` 决定实心/描边/虚线。
 * 与 matrix 的区别：不比较两维，只表达「先到哪、再到哪」——层级与进度的形状。
 */
function renderLadder({ title, steps = [], note, focus }: any): RenderedFigure {
  const stepW = 150;
  const stepH = 62;
  const rise = 34;
  const padX = 20;
  const titleH = title ? T.fontTitle + 20 : 0;
  const baseY = titleH + 40 + (steps.length - 1) * rise + stepH;
  const w = Math.ceil(padX * 2 + steps.length * stepW + (steps.length - 1) * 8);
  const noteLines = note ? wrapLines(note, w - padX * 2, T.fontSmall) : [];
  const h = baseY + (noteLines.length ? noteLines.length * 18 + 16 : 18);

  const parts: string[] = [...titleBlock(title, padX)];
  const sid = shadowId();
  parts.push(shadowDef(sid));

  steps.forEach((step: any, i: number) => {
    const x = padX + i * (stepW + 8);
    const y = baseY - stepH - i * rise;
    const state = step.state || (focus === i ? 'current' : 'todo');
    const filled = state === 'done' || state === 'current';
    const color = state === 'current' ? T.accent : state === 'done' ? T.ok : T.line;
    const fill = state === 'current' ? T.accentSoft : state === 'done' ? T.okSoft : T.surface;
    parts.push(
      rect(x, y, stepW, stepH, {
        r: 9,
        fill,
        stroke: color,
        sw: state === 'current' ? T.strokeStrong : T.stroke,
        dash: state === 'todo' ? '5 4' : '',
        filter: state === 'current' ? sid : '',
      }),
    );
    // 状态不只靠颜色：当前级加左侧竖轨、已完成级加勾（红绿之外的双编码，色盲可读）
    if (state === 'current') {
      parts.push(`<rect x="${x}" y="${y + 4}" width="3" height="${stepH - 8}" rx="1.5" fill="${T.accent}"/>`);
    }
    if (state === 'done') {
      parts.push(text(x + stepW - 12, y + 22, '✓', 't-tiny', 'end', `fill="${T.ok}"`));
    }
    parts.push(text(x + 14, y + 22, `${i + 1}`, 't-tiny', 'start', `fill="${color}"`));
    parts.push(text(x + 14, y + 42, step.label, state === 'todo' ? 't-label' : 't-key', 'start'));
    if (step.sub) parts.push(text(x + stepW - 12, y + stepH - 10, step.sub, 't-tiny', 'end'));
    void filled;
  });

  // 台阶本身就是「上行」的形状，再加箭头是多余墨水——省掉
  noteLines.forEach((ln: string, i: number) => {
    parts.push(text(padX, baseY + 26 + i * 18, ln, 't-small', 'start'));
  });

  return { svg: wrap(parts.join('\n'), w, h), width: w, height: h };
}

/* ---------------- 十、留白槽位（课内用：答案位置画成待填） ---------------- */

/**
 * 槽位判据：`?` / `？` / 空白 + mask:true 都算「这里留给学生」。
 * 2026-10-20 用户点名的失败模式：图上标着「不写结论（课内用）」，格子里却把答案全填好了——
 * 图把思考步骤替学生做完了。槽位由渲染器统一画成虚线待填，模型只负责标出「哪格该空」。
 */
function isSlot(value: unknown, mask?: boolean): boolean {
  if (mask === true) return true;
  if (value === undefined || value === null) return false;
  const s = String(value).trim();
  return s === '?' || s === '？' || s === '…' || s === '待定';
}

function slotRect(x: number, y: number, w: number, h: number): string[] {
  return [
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="7" fill="${T.surface}" stroke="${T.lineStrong}" stroke-width="1.1" stroke-dasharray="4 4"/>`,
    text(x + w / 2, y + h / 2 + 4, '待你回答', 't-tiny', 'middle', `fill="${T.faint}"`),
  ];
}

/* ---------------- 十一、闭环（阶段回流：读成「回到起点」） ---------------- */

/**
 * cycle：节点摆在一个环上，箭头首尾相接。
 * 与 ladder 的区别：ladder 说「先到哪、再到哪」（终点明确），cycle 说「走完要回到起点」（闭环）。
 * 用于 PBL 四部件、行动研究、迭代流程这类「每一轮都回到同一个问题」的结构。
 */
function renderCycle({ title, center, nodes = [], note }: any): RenderedFigure {
  const n = Math.max(3, nodes.length);
  const pillW = Math.max(132, ...nodes.map((x: any) => est(x.label, T.fontKey) + 34), ...nodes.map((x: any) => est(x.sub, T.fontMicro) + 28));
  const pillH = 56;
  const R = Math.max(128, Math.ceil((pillW + 30) / (2 * Math.sin(Math.PI / n))));
  const pad = 24;
  const titleH = title ? T.fontTitle + 20 : 0;
  const W = Math.ceil(pillW + R * 2 + pad * 2);
  const cx = W / 2;
  const cy = titleH + pad + R + pillH / 2 + 6;
  const noteLines = note ? wrapLines(note, W - pad * 2, T.fontSmall) : [];
  const h = Math.ceil(cy + R + pillH / 2 + pad + (noteLines.length ? noteLines.length * 18 + 14 : 0));

  const pts = nodes.map((node: any, i: number) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / nodes.length;
    return { node, x: cx + R * Math.cos(a), y: cy + R * Math.sin(a) };
  });

  /** 从 pill 中心朝目标方向射出时的椭圆边界点（把箭头停在卡片边上，而不是压住文字） */
  const edge = (from: { x: number; y: number }, to: { x: number; y: number }, rx: number, ry: number) => {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    const k = 1 / Math.hypot(ux / rx, uy / ry);
    return { x: from.x + ux * k, y: from.y + uy * k };
  };

  const parts: string[] = [...titleBlock(title, pad)];
  const sid = shadowId();
  parts.push(shadowDef(sid));

  // 先画箭头（压在卡片下面）
  for (let i = 0; i < pts.length; i += 1) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const s = edge(a, b, pillW / 2 + 5, pillH / 2 + 5);
    const e = edge(b, a, pillW / 2 + 9, pillH / 2 + 9);
    const mx = (s.x + e.x) / 2;
    const my = (s.y + e.y) / 2;
    // 控制点沿「外法线」推出去一点：箭头向外拱，环的形状才看得出来
    const ox = mx - cx;
    const oy = my - cy;
    const ol = Math.hypot(ox, oy) || 1;
    parts.push(
      arrow(s.x, s.y, e.x, e.y, {
        color: T.accent,
        sw: 1.5,
        curve: { cx: mx + (ox / ol) * 26, cy: my + (oy / ol) * 26 },
      }),
    );
  }

  for (const p of pts) {
    const tone = p.node.tone === 'warn' ? T.warn : p.node.tone === 'ok' ? T.ok : T.accent;
    const soft = p.node.tone === 'warn' ? T.warnSoft : p.node.tone === 'ok' ? T.okSoft : T.accentSoft;
    const x = p.x - pillW / 2;
    const y = p.y - pillH / 2;
    parts.push(rect(x, y, pillW, pillH, { r: 11, fill: T.surface, stroke: tone, sw: T.strokeStrong, filter: sid }));
    parts.push(`<rect x="${x + 1}" y="${y + 1}" width="5" height="${pillH - 2}" rx="2.5" fill="${soft}"/>`);
    if (isSlot(p.node.label, p.node.mask)) {
      parts.push(...slotRect(x + 14, y + 12, pillW - 28, pillH - 24));
      continue;
    }
    parts.push(text(p.x, p.y + 2, p.node.label, 't-key', 'middle', `fill="${tone}"`));
    if (p.node.sub) {
      // 副行也遵守留白：模型常把 "?" 放在 sub 上（主标签已经写了部件名）
      const subSlot = isSlot(p.node.sub, false);
      parts.push(text(p.x, p.y + 19, subSlot ? '待你回答' : p.node.sub, 't-tiny', 'middle', subSlot ? `fill="${T.faint}"` : ''));
    }
  }

  if (center) {
    // 中心文字只能占用左右两张卡之间的空隙：按那个宽度折行，否则会压到卡片上
    const centerW = Math.max(70, 2 * (R - pillW / 2) - 26);
    const lines = wrapLines(center, centerW, T.fontSmall);
    lines.forEach((ln: string, i: number) =>
      parts.push(text(cx, cy + 4 + (i - (lines.length - 1) / 2) * 17, ln, 't-small', 'middle')),
    );
  }

  noteLines.forEach((ln: string, i: number) => {
    parts.push(text(pad, h - 8 - (noteLines.length - 1 - i) * 18, ln, 't-small', 'start'));
  });

  return { svg: wrap(parts.join('\n'), W, h), width: W, height: h };
}

/* ---------------- 十二、辐射树（一个上位概念长出一层下位） ---------------- */

/**
 * tree：根节点在中心，分支向外辐射，分支下挂要点。
 * 与 bins 的区别：bins 是「把东西放进已有的箱子」（容器隐喻），tree 是「一个总概念长出哪些子概念」（派生隐喻）。
 * 用于五大领域、词根词缀、分类体系这类「先有根、再有枝」的内容。
 */
function renderTree({ title, root, branches = [], note }: any): RenderedFigure {
  const itemsMax = 2;
  const branchW = Math.max(
    148,
    ...branches.map((b: any) => est(b.label, T.fontKey) + 32),
    ...branches.map((b: any) => Math.max(0, ...(b.items || []).slice(0, itemsMax).map((it: string) => est(it, T.fontMicro))) + 24),
  );
  const branchH = 44;
  const rootW = Math.max(140, est(root?.label, T.fontKey) + 34);
  const rootH = 54;
  const n = Math.max(2, branches.length);
  const R = Math.max(150, Math.ceil((branchW + 34) / (2 * Math.sin(Math.PI / n))));
  const pad = 26;
  const titleH = title ? T.fontTitle + 20 : 0;
  const itemLineH = 15;
  const branchBlockH = branchH + itemsMax * itemLineH + 6;

  const W = Math.ceil(branchW + R * 2 + pad * 2);
  const cx = W / 2;
  const cy = titleH + pad + R + branchBlockH / 2;
  const noteLines = note ? wrapLines(note, W - pad * 2, T.fontSmall) : [];
  const h = Math.ceil(cy + R + branchBlockH / 2 + pad + (noteLines.length ? noteLines.length * 18 + 14 : 0) + 8);

  const parts: string[] = [...titleBlock(title, pad)];
  const sid = shadowId();
  parts.push(shadowDef(sid));

  const pts = branches.map((b: any, i: number) => {
    // 单数/两个分支时从左右张开，其余均匀铺满一圈
    const a = n === 2 ? (i === 0 ? Math.PI : 0) : -Math.PI / 2 + (i * 2 * Math.PI) / n;
    return { b, x: cx + R * Math.cos(a), y: cy + R * Math.sin(a) };
  });

  for (const p of pts) {
    const dx = p.x - cx;
    const dy = p.y - cy;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    const kRoot = 1 / Math.hypot(ux / (rootW / 2 + 4), uy / (rootH / 2 + 4));
    const kBranch = 1 / Math.hypot(ux / (branchW / 2 + 6), uy / (branchH / 2 + 6));
    parts.push(
      arrow(cx + ux * kRoot, cy + uy * kRoot, p.x - ux * kBranch, p.y - uy * kBranch, {
        color: T.lineStrong,
        sw: 1.3,
      }),
    );
  }

  // 根
  parts.push(rect(cx - rootW / 2, cy - rootH / 2, rootW, rootH, { r: 12, fill: T.accentSoft, stroke: T.accent, sw: T.strokeStrong, filter: sid }));
  parts.push(text(cx, cy + 2, root?.label || '', 't-key', 'middle', `fill="${T.accentInk}"`));
  if (root?.sub) parts.push(text(cx, cy + 19, root.sub, 't-tiny', 'middle'));

  for (const p of pts) {
    const x = p.x - branchW / 2;
    const y = p.y - branchBlockH / 2;
    const tone = p.b.tone === 'warn' ? T.warn : p.b.tone === 'ok' ? T.ok : T.accent;
    parts.push(rect(x, y, branchW, branchH, { r: 10, fill: T.surface, stroke: tone, sw: 1.35 }));
    if (isSlot(p.b.label, p.b.mask)) {
      parts.push(...slotRect(x + 8, y + 8, branchW - 16, branchH - 16));
    } else {
      parts.push(text(p.x, y + 20, p.b.label, 't-key', 'middle', `fill="${tone}"`));
      if (p.b.sub) parts.push(text(p.x, y + 36, isSlot(p.b.sub, false) ? '待你回答' : p.b.sub, 't-tiny', 'middle'));
    }
    (p.b.items || []).slice(0, itemsMax).forEach((it: string, i: number) => {
      const iy = y + branchH + 12 + i * itemLineH;
      if (isSlot(it, false)) {
        parts.push(`<rect x="${x + 10}" y="${iy - 11}" width="${branchW - 20}" height="15" rx="4" fill="${T.surface}" stroke="${T.lineStrong}" stroke-width="1" stroke-dasharray="3 3"/>`);
        parts.push(text(x + branchW / 2, iy, '待你回答', 't-tiny', 'middle', `fill="${T.faint}"`));
      } else {
        parts.push(`<circle cx="${x + 12}" cy="${iy - 4}" r="2" fill="${tone}" opacity=".7"/>`);
        parts.push(text(x + 19, iy, it, 't-tiny', 'start'));
      }
    });
  }

  noteLines.forEach((ln: string, i: number) => {
    parts.push(text(pad, h - 8 - (noteLines.length - 1 - i) * 18, ln, 't-small', 'start'));
  });

  return { svg: wrap(parts.join('\n'), W, h), width: W, height: h };
}

/* ---------------- 十三、双圆交集（易混/重叠的两个概念） ---------------- */

/**
 * venn：两个相交的圆，三个区域各写一组例子。
 * 与 compare 的区别：compare 是「左右两栏对照」（互斥），venn 是「哪部分重叠、哪部分各自独有」。
 * 用于易混概念（社会 vs 健康、艺术 vs 语言）、同一动作词落在两个领域这类「边界」问题。
 */
function renderVenn({ title, left, right, overlap, note }: any): RenderedFigure {
  const r = 130;
  // 圆心距 0.52r：透镜区约 0.96r 宽、两侧独有区约 1.04r，三块宽度接近，长标签也不打架
  const d = Math.round(r * 0.52);
  const pad = 26;
  const titleH = title ? T.fontTitle + 20 : 0;
  const W = Math.ceil(2 * (d + r) + pad * 2);
  const cx = W / 2;
  const cy = titleH + pad + r + 12;
  const noteLines = note ? wrapLines(note, W - pad * 2, T.fontSmall) : [];
  const h = Math.ceil(cy + r + pad + 16 + (noteLines.length ? noteLines.length * 18 + 16 : 0));

  const lx = cx - d;
  const rx = cx + d;
  const parts: string[] = [...titleBlock(title, pad)];

  parts.push(`<circle cx="${lx}" cy="${cy}" r="${r}" fill="${tint(T.accent, 0.07)}" stroke="${T.accent}" stroke-width="1.4"/>`);
  parts.push(`<circle cx="${rx}" cy="${cy}" r="${r}" fill="${tint(T.ok, 0.07)}" stroke="${T.ok}" stroke-width="1.4"/>`);

  /**
   * 两侧文字块：只占「独有区」（宽约 1.24r），并且**整体垂直居中**。
   * 2026-10-20 实跑教训：把块从 cy-r*0.46 往下排 4 条，长条目一折行就压进透镜区，
   * 跟交集文字叠在一起——所以先算高度再居中，条目上限 3 条、每条至多 2 行。
   */
  const sideMaxW = Math.round(r * 0.8);
  const blockLines = (items: string[]) =>
    items.slice(0, 3).map((it) => wrapLines(it, sideMaxW, T.fontMicro).slice(0, 2));
  const block = (x: number, head: string | undefined, items: string[], tone: string) => {
    const out: string[] = [];
    const groups = blockLines(items);
    const lineH = 14;
    const gap = 8;
    // 标题钉在圆的上半部（cy-0.52r）往下排，与透镜标题错开基线：
    // 三块若都垂直居中，会读成「一行三列」，维恩图就退化成并排标签了。
    let y = cy - r * 0.52;
    if (head) {
      out.push(text(x, y, head, 't-key', 'middle', `fill="${tone}"`));
      y += 20;
    }
    for (const lines of groups) {
      lines.forEach((ln, j) => out.push(text(x, y + j * lineH, ln, 't-tiny', 'middle')));
      y += lines.length * lineH + gap;
    }
    return out;
  };

  // 块心压到「独有区」中央（0.45r 外偏）：三块标题才不会挤在同一条线上
  parts.push(...block(lx - r * 0.45, left?.head, left?.items || [], T.accentInk));
  parts.push(...block(rx + r * 0.45, right?.head, right?.items || [], T.ok));

  // 交集：透镜区已有 0.96r 宽，标题按它折行（原来写死一行，7 个汉字就会压到两侧标题上）
  if (overlap) {
    const lensW = Math.max(70, Math.round(2 * (r - d) * 0.86));
    const headLines = wrapLines(overlap.head || '两者都算', lensW, T.fontKey).slice(0, 2);
    headLines.forEach((ln, i) => parts.push(text(cx, cy - r * 0.12 + i * 18, ln, 't-key', 'middle', `fill="${T.ink}"`)));
    (overlap.items || []).slice(0, 2).forEach((it: string, i: number) => {
      const lines = wrapLines(it, lensW, T.fontMicro).slice(0, 2);
      lines.forEach((ln, j) => parts.push(text(cx, cy + 22 + i * 28 + j * 13, ln, 't-tiny', 'middle')));
    });
  }

  noteLines.forEach((ln: string, i: number) => {
    parts.push(text(pad, h - 8 - (noteLines.length - 1 - i) * 18, ln, 't-small', 'start'));
  });

  return { svg: wrap(parts.join('\n'), W, h), width: W, height: h };
}

/* ---------------- 十四、靶盘组（稳不稳 × 准不准的几何原型） ---------------- */

/**
 * bullseye：2×2 四个靶盘，点落在哪儿 = 稳不稳/准不准。
 * 为什么不复用 quadrant：quadrant 的靶盘只是可选小图标，模型十个有九个不画；
 * 「信度×效度」这类内容的第一性问题就是几何分布，把它做成独立图型，模型只需要给点坐标。
 * 点坐标取 [-1,1] 归一化（0,0 = 靶心），由模型给、代码换算，避免像素级坐标进入提示词。
 */
function renderBullseye({ title, colLabels = [], rowLabels = [], cells = [], note }: any): RenderedFigure {
  const cellW = 300;
  const cellH = 152;
  const gapX = 16;
  const gapY = 18;
  const padL = 104;
  const pad = 18;
  const titleH = title ? T.fontTitle + 20 : 0;
  const W = Math.ceil(padL + cellW * 2 + gapX + pad);
  const top = titleH + 40;
  const noteLines = note ? wrapLines(note, W - pad * 2, T.fontSmall) : [];
  const h = Math.ceil(top + cellH * 2 + gapY + (noteLines.length ? noteLines.length * 18 + 18 : 10));

  const parts: string[] = [...titleBlock(title, pad)];
  const xs = [padL, padL + cellW + gapX];
  colLabels.forEach((lab: string, c: number) => parts.push(text(xs[c] + cellW / 2, titleH + 30, lab, 't-key')));
  rowLabels.forEach((lab: any, r: number) => {
    const y = top + r * (cellH + gapY) + cellH / 2;
    parts.push(text(padL - 18, y - 2, lab?.label ?? String(lab), 't-key', 'end'));
    if (lab?.sub) parts.push(text(padL - 18, y + 16, lab.sub, 't-tiny', 'end'));
  });

  cells.slice(0, 4).forEach((cell: any, idx: number) => {
    const x = xs[idx % 2];
    const y = top + Math.floor(idx / 2) * (cellH + gapY);
    const tone = cell.tone === 'ok' ? T.ok : cell.tone === 'warn' ? T.warn : cell.tone === 'accent' ? T.accent : T.muted;
    const soft = cell.tone === 'ok' ? T.okSoft : cell.tone === 'warn' ? T.warnSoft : cell.tone === 'accent' ? T.accentSoft : T.soft;
    parts.push(rect(x, y, cellW, cellH, { r: 12, fill: soft, stroke: tone, sw: cell.tone === 'warn' ? 1.8 : 1.2 }));

    const tx = x + 54;
    const ty = y + cellH / 2;
    const R = 44;
    parts.push(`<circle cx="${tx}" cy="${ty}" r="${R}" fill="${T.surface}" stroke="${T.line}" stroke-width="${T.stroke}"/>`);
    parts.push(`<circle cx="${tx}" cy="${ty}" r="${R * 0.66}" fill="none" stroke="${T.line}" stroke-width="1"/>`);
    parts.push(`<circle cx="${tx}" cy="${ty}" r="${R * 0.33}" fill="${tint(tone, 0.1)}" stroke="${tone}" stroke-width="1.2"/>`);
    parts.push(`<circle cx="${tx}" cy="${ty}" r="2.4" fill="${tone}"/>`);

    (cell.dots || []).forEach((p: number[]) => {
      const dx = Number(p?.[0]);
      const dy = Number(p?.[1]);
      if (!Number.isFinite(dx) || !Number.isFinite(dy)) return;
      const px = tx + Math.max(-1, Math.min(1, dx)) * (R - 7);
      const py = ty + Math.max(-1, Math.min(1, dy)) * (R - 7);
      parts.push(`<circle cx="${px}" cy="${py}" r="3.7" fill="${tone}"/>`);
    });

    const bx = x + 108;
    parts.push(text(bx, y + 34, cell.title || '', 't-key', 'start', `fill="${tone}"`));
    wrapLines(cell.desc, cellW - 122, T.fontSmall)
      .slice(0, 3)
      .forEach((ln: string, i: number) => parts.push(text(bx, y + 58 + i * 18, ln, 't-small', 'start')));
  });

  noteLines.forEach((ln: string, i: number) => {
    parts.push(text(pad, h - 10 - (noteLines.length - 1 - i) * 18, ln, 't-small', 'start'));
  });

  return { svg: wrap(parts.join('\n'), W, h), width: W, height: h };
}

/* ---------------- 区间条（数值范围并排） ---------------- */

/**
 * 区间条（2026-10-21 外审 #4~#7/#13~#15）。
 *
 * 每组「从 A 到 B」占一行，条的长度就是区间本身。位置线只有一根轴，把波动幅度
 * 横着画在日期轴上会被读成「周二到周六 = 0.7 个点」——量纲错位。这里让每组有独立轨道，
 * 共同的数值域只决定横向对齐，不冒充时间。
 */
function renderRangeBar({ title, unit, rows = [], marks = [], note }: any): RenderedFigure | null {
  // 至少两条区间才有「并排比较」的意义；单条区间退回文字讲
  if (!Array.isArray(rows) || rows.length < 2) return null;
  const padX = 16;
  const labelW = 132;
  const rowH = 48;
  const bandH = 16;
  const titleH = title ? T.fontTitle + 20 : 0;
  const top = titleH + 16;
  const w = 640;
  const plotX = padX + labelW;
  const plotW = w - plotX - padX - 8;
  const bodyH = rows.length * rowH;
  const axisY = top + bodyH + 10;
  const noteH = note ? 26 : 0;
  const h = axisY + 24 + noteH;

  const values = rows.flatMap((r: any) => [Number(r.from), Number(r.to)]).concat(marks.map((m: any) => Number(m.at)));
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const pad = hi > lo ? (hi - lo) * 0.08 : Math.max(Math.abs(hi) * 0.1, 1);
  const min = lo - pad;
  const max = hi + pad;
  const xOf = (v: number) => plotX + ((v - min) / (max - min)) * plotW;
  const fmt = (v: unknown) => {
    const n = Number(v);
    return Number.isFinite(n) ? String(Math.round(n * 100) / 100) : '';
  };

  const TONE: Record<string, { fill: string; stroke: string; ink: string }> = {
    accent: { fill: T.accentSoft, stroke: T.accent, ink: T.accentInk },
    ok: { fill: T.okSoft, stroke: T.ok, ink: T.ok },
    warn: { fill: T.warnSoft, stroke: T.warn, ink: T.warn },
    neutral: { fill: T.soft, stroke: T.muted, ink: T.muted },
  };

  const parts: string[] = [...titleBlock(title, padX)];

  rows.forEach((row: any, i: number) => {
    const y = top + i * rowH;
    const tone = TONE[row.tone] || TONE.accent;
    const x1 = xOf(Number(row.from));
    const x2 = xOf(Number(row.to));
    parts.push(text(padX, y + bandH + 6, row.label, 't-label', 'start'));
    parts.push(rect(x1, y + 4, Math.max(6, x2 - x1), bandH, { r: bandH / 2, fill: tone.fill, stroke: tone.stroke, sw: 1.2 }));
    // 端点数值贴在两端的条内/条外：短条时挪到条右侧，避免两个数字叠在一起
    const spanW = x2 - x1;
    const valueText = `${fmt(row.from)}${unit || ''} – ${fmt(row.to)}${unit || ''}`;
    if (spanW >= est(valueText, T.fontMicro) + 12) {
      parts.push(text((x1 + x2) / 2, y + 4 + bandH / 2 + 4, valueText, 't-tiny', 'middle'));
    } else {
      parts.push(text(x2 + 8, y + 4 + bandH / 2 + 4, valueText, 't-tiny', 'start'));
    }
  });

  // 共享数值轴：只画端点刻度，避免把区间条读成时间轴
  parts.push(`<line x1="${plotX}" y1="${axisY}" x2="${plotX + plotW}" y2="${axisY}" stroke="${T.line}" stroke-width="1"/>`);
  parts.push(text(plotX, axisY + 16, `${fmt(min)}${unit || ''}`, 't-tiny', 'start'));
  parts.push(text(plotX + plotW, axisY + 16, `${fmt(max)}${unit || ''}`, 't-tiny', 'end'));

  // 参考点（如「汇报的均值差」）：虚线穿过所有轨道
  marks.forEach((mark: any) => {
    const x = xOf(Number(mark.at));
    parts.push(`<line x1="${x}" y1="${top}" x2="${x}" y2="${axisY}" stroke="${T.accent}" stroke-width="1" stroke-dasharray="4 4"/>`);
    if (mark.label) parts.push(text(x, top - 4, mark.label, 't-tiny', 'middle', `fill="${T.accentInk}"`));
  });

  if (note) parts.push(text(padX, h - 8, note, 't-small', 'start'));
  return { svg: wrap(parts.join('\n'), w, h), width: w, height: h };
}

/* ---------------- 分派 ---------------- */

/**
 * 按图型分派。任何异常都返回 null（fail-open：宁可不画，也不要把课堂页面弄坏）。
 * 未知 kind 同样返回 null——白名单在后端已过滤一次，这里是二道防线。
 */
export function renderSpecFigure(
  kind: string,
  spec: Record<string, unknown> | null | undefined,
  options: RenderOptions = {},
): RenderedFigure | null {
  if (!spec || typeof spec !== 'object') return null;
  const previous = T;
  const previousMat = MAT;
  T = resolveTheme(options.palette);
  MAT = options.material ?? materialForPalette(options.palette);
  uid = 0;
  try {
    switch (kind) {
      case 'grid':
        return renderGrid(spec);
      case 'matrix':
        return renderMatrix(spec);
      case 'compare':
        return renderCompare(spec);
      case 'quadrant':
        return renderQuadrant(spec);
      case 'bipartite':
        return renderBipartite(spec);
      case 'board':
        return renderBoard(spec);
      case 'bins':
        return renderBins(spec);
      case 'balance':
        return renderBalance(spec);
      case 'ladder':
        return renderLadder(spec);
      case 'cycle':
        return renderCycle(spec);
      case 'tree':
        return renderTree(spec);
      case 'venn':
        return renderVenn(spec);
      case 'bullseye':
        return renderBullseye(spec);
      case 'range-bar':
        return renderRangeBar(spec);
      default:
        return null;
    }
  } catch {
    return null;
  } finally {
    T = previous;
    MAT = previousMat;
  }
}
