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

/** 按字数换行（桥接框这类固定宽度的窄栏没有溢出空间，只能折行）。 */
function wrapChars(text: string, maxChars: number): string[] {
  const chars = Array.from(String(text ?? ''));
  const out: string[] = [];
  let i = 0;
  while (i < chars.length) {
    if (chars.length - i <= maxChars) {
      out.push(chars.slice(i).join(''));
      break;
    }
    let end = i + maxChars;
    // 不从 ASCII 词/数字中间切：「0.5」被切成「0 / .5」就变成两个数了
    if (/[0-9A-Za-z._%]/.test(chars[end - 1]) && /[0-9A-Za-z._%]/.test(chars[end])) {
      let back = end;
      while (back > i && /[0-9A-Za-z._%]/.test(chars[back - 1])) back--;
      if (back > i) end = back;
    } else {
      // 优先在空格处断行（回退不超过窗口的四成，免得末行只剩一两个字）
      let space = -1;
      for (let k = end; k > i + Math.max(1, Math.floor(maxChars * 0.6)); k--) {
        if (chars[k - 1] === ' ') {
          space = k - 1;
          break;
        }
      }
      if (space > i) end = space;
    }
    if (end <= i) end = i + maxChars;
    // 行首不留收尾标点：把「，；。：、）」这类字符拉回上一行（CJK 排版的避头点）
    while (end < chars.length && /[，。；：、）」』”！？…]/.test(chars[end])) end += 1;
    out.push(chars.slice(i, end).join('').trim());
    i = end;
  }
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
  .tfx text{font-family:"PingFang SC","Microsoft YaHei","Segoe UI",system-ui,sans-serif;fill:${T.ink};paint-order:stroke;stroke:#ffffff;stroke-width:3px;stroke-linejoin:round}
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
  /** 断行；若断点落在 ASCII 词/数字中间，把整个词挪到下一行 */
  const flush = (next: string) => {
    const isWord = (c: string) => /[0-9A-Za-z._%]/.test(c);
    if (cur && isWord(cur[cur.length - 1]) && isWord(next)) {
      let k = cur.length;
      while (k > 0 && isWord(cur[k - 1])) k--;
      if (k > 0) {
        out.push(cur.slice(0, k).trimEnd());
        cur = cur.slice(k);
        return;
      }
    }
    out.push(cur.trimEnd());
    cur = '';
  };
  for (const ch of String(str ?? '')) {
    if (cur && est(cur + ch, size) > maxW) {
      flush(ch);
      if (ch !== ' ' || cur) cur += ch;
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trimEnd());
  return out;
}

/**
 * 按行数均分的折行：先按宽度粗切，再按行数重排。
 * 否则一行 note 会切成「…只认主活动 / 落科」——末行只剩两三个字（2026-10-22 夜间跑批实测）。
 */
function balancedWrap(str: unknown, maxW: number, size: number): string[] {
  const lines = wrapLines(str, maxW, size);
  if (lines.length < 2) return lines;
  const total = Array.from(String(str ?? '')).length;
  // V4 修复（外盲评：SYN_SENT 被截成 SYN_SE）：均分重排时英文词/数字/下划线是
  // 不可拆单元——放不下整个词就换行，绝不从词中间切
  return wrapCharsKeepTokens(String(str ?? ''), Math.max(6, Math.ceil(total / lines.length)));
}

/** 与 wrapChars 同按「均分字符数」断行，但 ASCII 词（含 _ . %）整词不拆。 */
function wrapCharsKeepTokens(str: string, maxChars: number): string[] {
  const isWord = (c: string) => /[0-9A-Za-z._%]/.test(c);
  const units: string[] = [];
  let tok = '';
  for (const ch of str) {
    if (tok && isWord(ch) === isWord(tok[0]) && isWord(ch)) tok += ch;
    else if (tok && isWord(ch)) { units.push(tok); tok = ch; }
    else if (tok && isWord(tok[0])) { units.push(tok); tok = ch; }
    else { tok += ch; }
  }
  if (tok) units.push(tok);
  // 连串非词字符（中文/标点）仍可逐字断：拆成单字符单元
  const atoms: string[] = [];
  for (const u of units) {
    if (isWord(u[0])) atoms.push(u);
    else for (const c of u) atoms.push(c);
  }
  const out: string[] = [];
  let line = '';
  for (const a of atoms) {
    if (line && Array.from(line + a).length > maxChars && !isWord(a[0])) {
      out.push(line.trimEnd());
      line = a === ' ' ? '' : a;
    } else if (line && Array.from(line + a).length > maxChars && isWord(a[0])) {
      // 词放不下：整词换行
      out.push(line.trimEnd());
      line = a;
    } else line += a;
  }
  if (line.trim()) out.push(line.trimEnd());
  return out.filter((l) => l.length);
}

/**
 * 单行文本收进给定宽度：超宽就截断加省略号（用估宽而不是字数，CJK/ASCII 混排才准）。
 * 用在**固定宽度容器**里（对账卡条目、阶梯步名这类框宽由布局决定的地方）：
 * 宁可显示「输入「北京」，发出…」，也不让字捅出边框。
 */
function fitText(str: unknown, maxW: number, size: number): string {
  const text = String(str ?? '');
  if (est(text, size) <= maxW) return text;
  let out = '';
  for (const ch of text) {
    if (est(out + ch + '…', size) > maxW) break;
    out += ch;
  }
  return out ? out + '…' : text.slice(0, 1) + '…';
}

/* ---------------- 一、网格（二维排布，每格是内容） ---------------- */

/**
 * 各图型的输入形状（2026-10-30 类型化）：spec 来自后端 JSON、天然松散，
 * 做法是「已知字段按渲染实际用法具体化，其余保持 unknown」。叶子字段大量走
 * esc/est/text 这类 unknown 入参（不引入任何新的运行时收窄），只有进算术、
 * Map 键、白名单索引（TONE/GLYPH）的字段才收成 number/string。
 */
type GridCell = {
  r?: number;
  c?: number;
  text?: unknown;
  mask?: unknown;
  ghost?: unknown;
  hl?: unknown;
  mark?: unknown;
  markColor?: unknown;
};

type GridSpec = {
  title?: string;
  cells?: GridCell[];
  rows: number;
  cols: number;
  rowLabels?: string[];
  colLabels?: string[];
  note?: string;
  focus?: { row?: number; col?: number };
};

function renderGrid({ title, cells = [], rows, cols, rowLabels = [], colLabels = [], note, focus }: GridSpec): RenderedFigure {
  const labelW = rowLabels.length ? Math.max(44, Math.ceil(Math.max(...rowLabels.map((l: string) => est(l, 12)))) + 16) : 0;
  const headH = colLabels.length ? 30 : 0;
  const titleH = title ? T.fontTitle + 18 : 0;

  let maxText = 0;
  for (const c of cells) maxText = Math.max(maxText, est(c.text ?? '', T.fontBody));
  const ch = 40;
  /** 列宽要同时容下格内文字与列标题；标题再长也有上限，超出走省略号（否则两列标题会压在一起） */
  const colWArr = Array.from({ length: cols }, (_: unknown, c: number) => {
    const lab = colLabels[c] ? Math.min(Math.ceil(est(colLabels[c], T.fontSmall)) + 14, 200) : 0;
    return Math.max(56, Math.ceil(maxText) + 26, lab);
  });
  const colWAt = (c: number) => colWArr[c] ?? colWArr[0] ?? 56;
  const colX = (c: number) => {
    let x = 0;
    for (let i = 0; i < c; i++) x += colWAt(i);
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
  const map = new Map(cells.map((c) => [`${c.r},${c.c}`, c]));
  const parts: string[] = [...titleBlock(title)];
  const focusRow = Number.isInteger(focus?.row) ? focus?.row ?? null : null;
  const focusCol = Number.isInteger(focus?.col) ? focus?.col ?? null : null;

  colLabels.forEach((lab: string, c: number) => {
    const cwi = colWAt(c);
    const isFocus = focusCol === c;
    parts.push(
      text(
        ox + colX(c) + cwi / 2,
        12 + titleH + 19,
        fitText(lab, cwi - 8, T.fontSmall),
        isFocus ? 't-key' : 't-small',
        'middle',
        isFocus ? `fill="${T.accentInk}"` : '',
      ),
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
      const cell = map.get(`${r},${c}`);
      const cwi = colWAt(c);
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

type BoardPoint = { col: number; rank: number };
type BoardPiece = { col: number; rank: number; key: string; hl?: unknown };
type BoardFile = { col: number; label?: unknown; tone?: unknown };
type BoardArrow = {
  a1?: BoardPoint;
  a2?: BoardPoint;
  label?: unknown;
  tone?: unknown;
  dash?: unknown;
  col: number;
  from: number;
  to: number;
  side?: unknown;
};
type BoardMark = { col: number; rank: number; color?: unknown };

type BoardSpec = {
  title?: string;
  pieces?: BoardPiece[];
  files?: BoardFile[];
  arrows?: BoardArrow[];
  marks?: BoardMark[];
  note?: string;
  size?: number;
  panelLabel?: string;
};

function renderBoard({ title, pieces = [], files = [], arrows = [], marks = [], note, size = 46, panelLabel }: BoardSpec): RenderedFigure {
  const padL = 30;
  const padR = 30;
  const sizeCjk = T.fontSmall;
  const headH = title || panelLabel ? T.fontTitle + 20 : 10;
  const padT = headH + Math.round(size * 0.52) + 8;
  const bottomLabelExtra = (arrows || []).some(
    (a) => a.a1 && a.a2 && a.a1.rank === a.a2.rank && Math.max(a.a1.rank, a.a2.rank) >= 8 && a.label,
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
/** compare 链路侧栏：chain 节点 / items / 徽标都是模型给的松散 JSON。 */
type CompareChainNode = {
  label?: unknown;
  sub?: unknown;
  merged?: unknown;
  from?: unknown;
  rtt?: unknown;
  /** 直接进 COMPARE_TONES 白名单索引，所以收成 string */
  tone: string;
};

type CompareSide = {
  head?: unknown;
  sub?: unknown;
  badge?: unknown;
  badgeTone: string;
  client?: unknown;
  boundaryLabel?: unknown;
  items: string[];
  chain?: CompareChainNode[];
};

type CompareChainSpec = {
  title?: string;
  left: CompareSide;
  right: CompareSide;
  note?: string;
  leftTone?: string;
  rightTone?: string;
  focus?: string;
};

function renderCompareChain({ title, left, right, note, leftTone = 'ok', rightTone = 'accent', focus }: CompareChainSpec): RenderedFigure {
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

  const nodesOf = (side: CompareSide): CompareChainNode[] => (Array.isArray(side?.chain) ? side.chain : []);
  const itemsOf = (side: CompareSide): string[] => (Array.isArray(side?.items) ? side.items : []);
  // 每张卡按自己的文字量取高：统一高度会让只有两行字的卡空出半张脸，
  // 而三行字的卡又贴到边框——卡片高度跟内容走，两栏各自堆叠。
  const measureNode = (node: CompareChainNode) => {
    const textW = nodeW - 24;
    const labelLines = wrapLines(String(node?.label || ''), textW, T.fontBody).slice(0, 2).length;
    const subLines = node?.sub ? wrapLines(String(node.sub), textW, T.fontMicro).slice(0, 2).length : 0;
    // 合一徽标固定在卡片底部一行：它会占掉 18px，但不抢标题宽度（否则长名字会被挤成两行半）
    return 22 + labelLines * 17 + subLines * 14 + (node?.merged ? 18 : 0);
  };
  const layoutOf = (side: CompareSide) => {
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

  const panel = (side: CompareSide, layout: { heights: number[]; offsets: number[]; total: number }, x: number, toneName: string, sideKey: 'left' | 'right') => {
    const tone = COMPARE_TONES[toneName] || COMPARE_TONES.neutral;
    const nodes = nodesOf(side);
    const items = itemsOf(side);
    const isFocus = focus === sideKey;

    // 栏头：结论在上、徽标在下——并排会让「18 字标题 + 24 字徽标」挤成一行
    parts.push(text(x, titleH + 16, side.head, 't-key', 'start', `fill="${isFocus ? tone.ink : T.ink}"`));
    const badgeTone = COMPARE_TONES[side.badgeTone] || tone;
    if (side.badge) parts.push(text(x, titleH + 34, side.badge, 't-micro', 'start', `fill="${badgeTone.ink}"`));

    // 边界：客户端画在框**外**，箭头穿过边框 = 一次跨界往返。
    // 标签由内容决定（架构=集群边界；同进程请求链=组件异步边界），默认保持旧文案。
    const boundaryLabel = String(side.boundaryLabel || '集群边界');
    const borderX = x + nodeXOff;
    const borderW = panelW - nodeXOff;
    parts.push(rect(borderX, bodyTop, borderW, borderH, {
      r: 10,
      fill: tint(tone.color, 0.05),
      stroke: tone.color,
      sw: isFocus ? T.strokeStrong : 1.2,
    }));
    // 区域标签骑在边框**顶边**上：放框底会被读成只圈住最后一张卡（外部视觉审校实测）
    const labelW = est(boundaryLabel, T.fontMicro) + 16;
    parts.push(rect(borderX + 12, bodyTop - 18, labelW, 16, { r: 8, fill: T.surface, stroke: tone.color, sw: 1 }));
    parts.push(text(borderX + 12 + labelW / 2, bodyTop - 6.5, boundaryLabel, 't-tiny', 'middle', `fill="${tone.ink}"`));

    const stackTop = bodyTop + Math.max(0, (rowsH - layout.total) / 2);
    const client = side.client || '客户端';
    const clientW = 50;
    const clientH = 26;
    // 客户端左移 6px：跳数圆圈骑在边界上，否则它会压住客户端的右边框
    const clientX = x - 6;
    const firstCy = stackTop + (layout.heights[0] || 60) / 2;
    parts.push(rect(clientX, firstCy - clientH / 2, clientW, clientH, { r: 7, fill: T.surface, stroke: T.lineStrong, sw: T.stroke }));
    parts.push(text(clientX + clientW / 2, firstCy + 4, client, 't-tiny', 'middle'));

    // 每一跳从客户端出发穿过边界：第 1 跳直连，第 2 跳起走左侧竖干再横进。
    // 缺省即串联（2026-10-22）：真课 10 张链路图 47 跳**没有一跳**写 from，
    // 结果每跳都从客户端并联射出，「响应回来」也画成往外发。要并联扇出必须显式写 from:'client'。
    const isSerial = (node: CompareChainNode, i: number) => i > 0 && (node?.from === 'prev' || node?.from == null);
    const trunkX = clientX + clientW + 8;
    const directIdx = nodes.map((n, i) => (isSerial(n, i) ? -1 : i)).filter((i: number) => i >= 0);
    const lastDirect = directIdx.length ? directIdx[directIdx.length - 1] : 0;
    const lastCy = stackTop + layout.offsets[lastDirect] + (layout.heights[lastDirect] || 60) / 2;
    if (directIdx.length > 1) {
      parts.push(`<line x1="${trunkX}" y1="${firstCy}" x2="${trunkX}" y2="${lastCy}" stroke="${tone.color}" stroke-width="1.4" opacity="0.55"/>`);
    }
    nodes.forEach((node, i) => {
      const nh = layout.heights[i] || 60;
      const ny = stackTop + layout.offsets[i];
      const cy = ny + nh / 2;
      const nodeTone = COMPARE_TONES[node.tone] || tone;
      const entryX = borderX + nodePad;
      if (isSerial(node, i)) {
        // 顺序链路：从上一张卡底下拉一条竖箭头下来，**不跨边界、不占跳数**
        const prev = i - 1;
        const prevBottom = stackTop + layout.offsets[prev] + (layout.heights[prev] || 60);
        const ax = entryX + 26;
        parts.push(`<line x1="${ax}" y1="${prevBottom}" x2="${ax}" y2="${ny - 3}" stroke="${tone.color}" stroke-width="1.7"/>`);
        parts.push(`<polygon points="${ax - 4.6},${ny - 10} ${ax},${ny - 1} ${ax + 4.6},${ny - 10}" fill="${tone.color}"/>`);
      } else {
        // 竖干 → 边界：这段就是一次网络往返
        parts.push(`<line x1="${trunkX}" y1="${cy}" x2="${entryX - 8}" y2="${cy}" stroke="${tone.color}" stroke-width="1.7"/>`);
        // 跳数标在**边界上**：数一眼边界上的序号，就是这条路径跨了几次集群。
        // 先垫一圈白底：边界线到徽标前就断开，读作「线上的一次跨集群」，而不是数字压着线。
        const bx = borderX;
        const hopNo = nodes.slice(0, i + 1).filter((n, k) => !isSerial(n, k)).length;
        parts.push(`<circle cx="${bx}" cy="${cy}" r="11.5" fill="${T.surface}"/>`);
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

type CompareSpec = {
  title?: string;
  left: CompareSide;
  right: CompareSide;
  divider?: string;
  note?: string;
  leftTone?: string;
  rightTone?: string;
  focus?: string;
};

function renderCompare({ title, left, right, divider, note, leftTone = 'ok', rightTone = 'accent', focus }: CompareSpec): RenderedFigure {
  // 两侧给了请求链路 → 走拓扑模式：跳数由边界上的序号和箭头本身表达
  if ((Array.isArray(left?.chain) && left.chain.length) || (Array.isArray(right?.chain) && right.chain.length)) {
    return renderCompareChain({ title, left, right, note, leftTone, rightTone, focus });
  }
  const colW = 268;
  const gap = 156;
  const padX = 16;
  const w = padX * 2 + colW * 2 + gap;
  // 条目允许三行：两行时 19 字的因果句仍会被截掉最后一个动作（2026-10-22 夜间跑批 #269）
  const itemTextW = colW - 46;
  const rows = Math.max(left.items.length, right.items.length);
  const itemLineCount = (side: CompareSide) =>
    (Array.isArray(side?.items) ? side.items : []).reduce(
      (max: number, it: unknown) => Math.max(max, Math.min(3, wrapLines(String(it ?? ''), itemTextW, T.fontBody).length)),
      1,
    );
  const itemH = 36 + (Math.max(itemLineCount(left), itemLineCount(right)) - 1) * 16;
  // 标题与副标题也允许两行：19 字的标题单行会被截成「…先做前…」，正好丢掉结论（夜间跑批 #269）
  const wrapMax = (str: unknown, maxW: number, size: number, maxLines: number) => {
    const raw = wrapLines(str, maxW, size);
    if (raw.length <= maxLines) return raw;
    return [...raw.slice(0, maxLines - 1), fitText(raw.slice(maxLines - 1).join(''), maxW, size)];
  };
  const headLinesOf = (side: CompareSide) => wrapMax(side?.head ?? '', colW - 24, T.fontKey, 2);
  const subLinesOf = (side: CompareSide) => (side?.sub ? wrapMax(side.sub, colW - 24, T.fontMicro, 2) : []);
  const headH = 36 + (Math.max(headLinesOf(left).length, headLinesOf(right).length) - 1) * 18;
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
  const subLineCount = Math.max(subLinesOf(left).length, subLinesOf(right).length);
  const subBlock = subLineCount ? 14 + (subLineCount - 1) * 14 : 0;
  const bodyTop = headY + headH + 10 + subBlock;
  const h = bodyTop + rows * itemH + 16 + (note ? 26 : 0);
  const cols = [
    { x: padX, ...(TONES[leftTone] || TONES.ok), data: left, tone: leftTone },
    { x: padX + colW + gap, ...(TONES[rightTone] || TONES.accent), data: right, tone: rightTone },
  ];
  for (const col of cols) {
    const isFocus = focus === (col === cols[0] ? 'left' : 'right');
    parts.push(
      rect(col.x, headY, colW, headH, { r: 9, fill: col.soft, stroke: col.color, sw: isFocus ? T.strokeStrong : 1.3 }),
    );
    // 焦点侧：顶部加一条强调轨（信号，不增加信息）
    if (isFocus) parts.push(`<rect x="${col.x + 10}" y="${headY - 3}" width="${colW - 20}" height="3" rx="1.5" fill="${col.color}"/>`);
    const heads = headLinesOf(col.data);
    heads.forEach((line: string, li: number) => {
      const ly = headY + 23 + (li - (heads.length - 1) / 2) * 18;
      parts.push(text(col.x + colW / 2, ly, line, 't-key', 'middle', `fill="${col.ink}"`));
    });
    subLinesOf(col.data).forEach((line: string, li: number) => {
      parts.push(text(col.x + colW / 2, headY + headH + 14 + li * 14, line, 't-tiny'));
    });
    col.data.items.forEach((it: string, i: number) => {
      const iy = bodyTop + i * itemH;
      const cy = iy + (itemH - 8) / 2;
      parts.push(rect(col.x + 8, iy, colW - 16, itemH - 8, { r: 7, fill: T.surface, stroke: T.line, sw: T.stroke }));
      parts.push(`<circle cx="${col.x + 24}" cy="${cy}" r="3" fill="${col.color}"/>`);
      const raw = wrapLines(String(it ?? ''), itemTextW, T.fontBody);
      const lines = raw.length <= 3 ? raw : [...raw.slice(0, 2), fitText(raw.slice(2).join(''), itemTextW, T.fontBody)];
      lines.forEach((line: string, li: number) => {
        const y = cy + 4.5 + (li - (lines.length - 1) / 2) * 16;
        parts.push(text(col.x + 36, y, line, 't-label', 'start'));
      });
    });
  }

  if (divider) {
    const cx = padX + colW + gap / 2;
    const cy = bodyTop + (rows * itemH) / 2 - 4;
    parts.push(
      `<line x1="${cx}" y1="${headY + 4}" x2="${cx}" y2="${h - (note ? 32 : 8)}" stroke="${T.line}" stroke-dasharray="5 5"/>`,
    );
    // 桥接框宽度由栏间距决定；文字必须按框宽换行，否则长句直接捅穿矩形（2026-10-21 走查 #16）
    const boxW = gap - 16;
    const maxDividerChars = Math.max(6, Math.floor((boxW - 16) / (T.fontMicro * 0.95)));
    // 均衡换行：先按框宽粗切，再按行数重排。否则 20 字的一句话会切成
    //「…波动还 / 小」，末行只剩一个字（2026-10-21 目检 #22）。
    const lines = String(divider).split('\n').flatMap((line: string) => {
      const rough = wrapChars(line, maxDividerChars);
      if (rough.length < 2) return rough;
      const total = Array.from(line).length;
      return wrapChars(line, Math.max(6, Math.ceil(total / rough.length)));
    });
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

type BiNode = { id: string; label?: unknown; tone?: string };
type BiSide = { nodes: BiNode[]; head?: unknown };
type BiEdge = { from: string; to: string; tone?: string; dash?: unknown };

type BipartiteSpec = {
  title?: string;
  left: BiSide;
  right: BiSide;
  edges?: BiEdge[];
  note?: string;
  width?: number;
  focus?: unknown;
};

function renderBipartite({ title, left, right, edges = [], note, width = 640, focus }: BipartiteSpec): RenderedFigure {
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
  const hasDashedEdge = edges.some((e) => dash(e.dash));
  const legendH = hasDashedEdge ? 18 : 0;
  const h = titleH + headH + rows * rowH + (noteLines.length ? noteLines.length * 18 + 12 : 0) + legendH + 12;

  const parts: string[] = [...titleBlock(title)];
  const headY = titleH + 16;
  parts.push(text(lx + rw / 2, headY, left.head || '', 't-small'));
  parts.push(text(rx + rw / 2, headY, right.head || '', 't-small'));

  const top = titleH + headH;
  const nodeY = (i: number) => top + i * rowH;
  const byId = new Map<string, { n: BiNode; side: 'L' | 'R'; i: number }>();
  left.nodes.forEach((n, i) => byId.set(n.id, { n, side: 'L', i }));
  right.nodes.forEach((n, i) => byId.set(n.id, { n, side: 'R', i }));
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

  const node = (n: BiNode, i: number, x: number) => {
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
  left.nodes.forEach((n, i) => node(n, i, lx));
  right.nodes.forEach((n, i) => node(n, i, rx));

  noteLines.forEach((ln: string, i: number) =>
    parts.push(text(12, h - 8 - legendH - (noteLines.length - 1 - i) * 18, ln, 't-small', 'start')),
  );

  // 虚线有语义就必须有图例（知识类 skill 的通行做法：虚线=次要/条件性关系，不能让学生猜）
  if (hasDashedEdge) {
    const ly = h - 8;
    const right = width - 12;
    const dashLegend = '虚线 = 次要 / 附带关系';
    parts.push(text(right, ly, dashLegend, 't-tiny', 'end'));
    const labelW = est(dashLegend, T.fontMicro);
    const dashX = right - labelW - 30;
    parts.push(`<path d="M${dashX} ${ly - 4} h18" stroke="${T.lineStrong}" stroke-width="1.4" stroke-dasharray="4 3"/>`);
    parts.push(`<path d="M${dashX - 34} ${ly - 4} h18" stroke="${T.lineStrong}" stroke-width="1.4"/>`);
    parts.push(text(dashX - 40, ly, '实线', 't-tiny', 'end'));
  }
  return { svg: wrap(parts.join('\n'), width, h), width, height: h };
}

/* ---------------- 五、四象限 ---------------- */

type QuadRowLabel = { label?: unknown; sub?: unknown };
type QuadCell = { tone?: string; icon?: { kind?: unknown; dots?: number[][] }; title?: unknown; body?: string[] };

type QuadrantSpec = {
  title?: string;
  colLabels?: string[];
  rowLabels?: QuadRowLabel[];
  cells?: QuadCell[];
  note?: string;
};

function renderQuadrant({ title, colLabels = [], rowLabels = [], cells = [], note }: QuadrantSpec): RenderedFigure {
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
  colLabels.forEach((lab: string, c: number) => parts.push(text(xs[c] + cw / 2, titleH + 50, fitText(lab, cw - 8, T.fontSmall), 't-small')));
  rowLabels.forEach((lab, r: number) => {
    parts.push(text(padL, titleH + top + r * (chh + gapY) + chh / 2 - 2, lab.label, 't-key', 'end'));
    if (lab.sub) parts.push(text(padL, titleH + top + r * (chh + gapY) + chh / 2 + 15, lab.sub, 't-tiny', 'end'));
  });

  cells.forEach((cell, idx: number) => {
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

type MatrixCell = { r?: number; c?: number; tone?: string };
type MatrixLegendItem = { text?: unknown; fill?: unknown; stroke?: unknown };

type MatrixSpec = {
  title?: string;
  rowLabels: string[];
  colLabels: string[];
  cells: MatrixCell[];
  note?: string;
  legend?: MatrixLegendItem[];
  focus?: { row?: number; col?: number };
};

function renderMatrix({ title, rowLabels, colLabels, cells, note, legend = [], focus }: MatrixSpec): RenderedFigure {
  const labelW = Math.max(...rowLabels.map((l: string) => est(l, 12))) + 22;
  /** 列宽先看清列标题要多少（8 字以上按 94px 就装不下），再夹在 94–190 之间 */
  const cwLabel = colLabels.reduce(
    (m: number, l: string) => Math.max(m, Math.ceil(Math.max(...String(l).split('\n').map((x: string) => est(x, T.fontSmall)))) + 14),
    0,
  );
  const cw = Math.max(94, Math.min(190, cwLabel));
  const ch = 36;
  const headH = 42;

  const matrixW = 14 + labelW + colLabels.length * cw + 14;
  const titleW = title ? 12 + est(title, T.fontTitle) + 12 : 0;
  const noteW = note ? 12 + est(note, T.fontSmall) + 12 : 0;
  const legendW = legend.reduce((sum: number, l: MatrixLegendItem) => sum + 15 + est(l.text, T.fontMicro) + 16, 12);
  const w = Math.ceil(Math.max(matrixW, titleW, noteW, legendW));

  const h = (title ? T.fontTitle + 18 : 0) + headH + rowLabels.length * ch + 26 + (note ? 22 : 0) + (legend.length ? 22 : 0);

  const parts: string[] = [];
  let oy = 0;
  if (title) {
    parts.push(...titleBlock(title));
    oy = T.fontTitle + 18;
  }

  const ox = Math.round((w - matrixW) / 2) + 14;
  const focusRow = Number.isInteger(focus?.row) ? focus?.row ?? null : null;
  const focusCol = Number.isInteger(focus?.col) ? focus?.col ?? null : null;

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
        text(cx, oy + 18 + i * 14, fitText(l, cw - 6, T.fontSmall), isFocus ? 't-key' : 't-small', 'middle', isFocus ? `fill="${T.accentInk}"` : ''),
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

  const map = new Map(cells.map((c) => [`${c.r},${c.c}`, c]));
  for (let r = 0; r < rowLabels.length; r++) {
    for (let c = 0; c < colLabels.length; c++) {
      const cell = map.get(`${r},${c}`);
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
  const label = isObj ? (item as { label?: unknown }).label : item;
  const mark = isObj ? (item as { mark?: unknown }).mark : null;
  return 66 + est(label, T.fontBody) + (mark ? est(mark, T.fontMicro) : 0);
}

type BinEntry = string | { label?: unknown; mark?: unknown };
type Bin = { label?: unknown; tone?: string; items?: BinEntry[] };

type BinsSpec = { title?: string; bins?: Bin[]; note?: string; focus?: number };

function renderBins({ title, bins = [], note, focus }: BinsSpec): RenderedFigure {
  const binGap = 18;
  const padX = 14;
  const headH = 34;
  const chipH = 30;
  const chipGap = 8;

  const binW = Math.max(
    150,
    ...bins.map((b) => Math.max(est(b.label, T.fontKey) + 44, ...(b.items || []).map(binsItemWidth), 120)),
  );
  const maxItems = Math.max(1, ...bins.map((b) => (b.items || []).length));
  const bodyH = maxItems * (chipH + chipGap) + 14;
  const titleH = title ? T.fontTitle + 20 : 0;
  // note 的可用宽度是画布减去两侧内衬；此前用「分箱宽 + 单侧内衬」，末行会捅出右边界
  const binsW = bins.length * binW + (bins.length - 1) * binGap;
  const noteLines = note ? balancedWrap(note, binsW, T.fontSmall) : [];
  const noteW = noteLines.length ? Math.max(...noteLines.map((l: string) => est(l, T.fontSmall))) : 0;
  const w = Math.ceil(Math.max(padX * 2 + binsW, noteW + padX * 2));
  const h = titleH + headH + bodyH + (noteLines.length ? noteLines.length * 18 + 12 : 0) + 8;

  const parts: string[] = [...titleBlock(title, padX)];
  const sid = shadowId();
  parts.push(shadowDef(sid));

  bins.forEach((bin, bi: number) => {
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

    (bin.items || []).forEach((item, i: number) => {
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
type BalanceSide = { head?: unknown; sub?: unknown; weight?: number; items?: string[] };

type BalanceSpec = {
  title?: string;
  left: BalanceSide;
  right: BalanceSide;
  pivotLabel?: string;
  note?: string;
  focus?: string;
};

function renderBalance({ title, left, right, pivotLabel, note, focus }: BalanceSpec): RenderedFigure {
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
  const layout = (data: BalanceSide, x: number, beamY: number, panTop: number, tone: string, soft: string, isFocus: boolean) => {
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
type LadderStep = { label?: unknown; sub?: unknown; state?: string };

type LadderSpec = { title?: string; steps?: LadderStep[]; note?: string; focus?: number };

function renderLadder({ title, steps = [], note, focus }: LadderSpec): RenderedFigure {
  // 步名长度决定卡片宽度：此前固定 150px，九字以上直接捅出边框（外审实拍 #3/#4）。
  // 超过两行的步名收到两行 + 省略号，卡片高度同步加一行。
  const labelLines: string[][] = steps.map((step) => {
    const lines = wrapLines(step.label, 200, T.fontKey);
    if (lines.length <= 2) return lines;
    return [lines[0], fitText(lines.slice(1).join(''), 200, T.fontKey)];
  });
  const widest = Math.max(0, ...labelLines.flat().map((line) => est(line, T.fontKey)));
  const stepW = Math.min(240, Math.max(150, widest + 30));
  // 子标题单行时会被截断（「卡在______，手当时没有下一个动作…」），允许两行并按行数加高。
  // 底高 68 而不是 62：62 时步名与子标题的基线只差 10px，两行 bbox 会压在一起（夜间跑批 #58/#503）。
  const subLines: string[][] = steps.map((step) => {
    if (!step.sub) return [];
    const lines = wrapLines(step.sub, stepW - 24, T.fontMicro);
    if (lines.length <= 2) return lines;
    return [lines[0], fitText(lines.slice(1).join(''), stepW - 24, T.fontMicro)];
  });
  const labelWrap = labelLines.some((lines) => lines.length > 1);
  const extraSub = Math.max(0, ...subLines.map((lines) => lines.length - 1));
  const stepH = 68 + (labelWrap ? 22 : 0) + extraSub * 14;
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

  steps.forEach((step, i: number) => {
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
    labelLines[i].forEach((line, li) => {
      parts.push(text(x + 14, y + 42 + li * 18, line, state === 'todo' ? 't-label' : 't-key', 'start'));
    });
    subLines[i].forEach((line, li) => {
      const sy = y + stepH - 10 - (subLines[i].length - 1 - li) * 14;
      parts.push(text(x + stepW - 12, sy, line, 't-tiny', 'end'));
    });
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
type CycleNode = { label?: unknown; sub?: unknown; tone?: string; mask?: boolean };

type CycleSpec = { title?: string; center?: string; nodes?: CycleNode[]; note?: string };

function renderCycle({ title, center, nodes = [], note }: CycleSpec): RenderedFigure {
  const n = Math.max(3, nodes.length);
  const pillW = Math.max(132, ...nodes.map((x) => est(x.label, T.fontKey) + 34), ...nodes.map((x) => est(x.sub, T.fontMicro) + 28));
  const pillH = 56;
  const R = Math.max(128, Math.ceil((pillW + 30) / (2 * Math.sin(Math.PI / n))));
  const pad = 24;
  const titleH = title ? T.fontTitle + 20 : 0;
  const W = Math.ceil(pillW + R * 2 + pad * 2);
  const cx = W / 2;
  const cy = titleH + pad + R + pillH / 2 + 6;
  const noteLines = note ? wrapLines(note, W - pad * 2, T.fontSmall) : [];
  const h = Math.ceil(cy + R + pillH / 2 + pad + (noteLines.length ? noteLines.length * 18 + 14 : 0));

  const pts = nodes.map((node, i: number) => {
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
    const x = p.x - pillW / 2;
    const y = p.y - pillH / 2;
    parts.push(rect(x, y, pillW, pillH, { r: 11, fill: T.surface, stroke: tone, sw: T.strokeStrong, filter: sid }));
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
type TreeNode = { label?: unknown; sub?: unknown; tone?: string; mask?: boolean; items?: string[] };

type TreeSpec = { title?: string; root?: TreeNode; branches?: TreeNode[]; note?: string };

function renderTree({ title, root, branches = [], note }: TreeSpec): RenderedFigure {
  const itemsMax = 2;
  const branchW = Math.max(
    148,
    ...branches.map((b) => est(b.label, T.fontKey) + 32),
    ...branches.map((b) => Math.max(0, ...(b.items || []).slice(0, itemsMax).map((it: string) => est(it, T.fontMicro))) + 24),
  );
  const branchH = 44;
  const rootW = Math.max(140, est(root?.label, T.fontKey) + 34);
  const rootH = 54;
  const n = Math.max(2, branches.length);
  // 半径必须同时让开根源框与分支框的一半再加间隙：旧公式只按分支宽算，
  // 两个分支时会和根源框相撞（rootW=140/branchW=186 时压 13px，2026-10-23 外审实拍）。
  const R = Math.max(150, Math.ceil(rootW / 2 + branchW / 2 + 26));
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

  const pts = branches.map((b, i: number) => {
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
type VennGroup = { head?: string; items?: string[] };

type VennSpec = { title?: string; left?: VennGroup; right?: VennGroup; overlap?: VennGroup; note?: string };

function renderVenn({ title, left, right, overlap, note }: VennSpec): RenderedFigure {
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
    items.slice(0, 3).map((it) => balancedWrap(it, sideMaxW, T.fontMicro).slice(0, 2));
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
type BullRowLabel = { label?: unknown; sub?: unknown };
type BullCell = { tone?: string; dots?: number[][]; title?: unknown; desc?: unknown };

type BullseyeSpec = {
  title?: string;
  colLabels?: string[];
  rowLabels?: BullRowLabel[];
  cells?: BullCell[];
  note?: string;
};

function renderBullseye({ title, colLabels = [], rowLabels = [], cells = [], note }: BullseyeSpec): RenderedFigure {
  const cellW = 300;
  const cellH = 152;
  const gapX = 16;
  const gapY = 18;
  // V6 修复（外盲评：行标签「低」被裁掉）：padL 按最长行标签动态给
  const rowLabelW = Math.max(0, ...rowLabels.map((lab) => est(lab?.label ?? String(lab), T.fontKey)));
  const padL = Math.max(104, Math.ceil(rowLabelW) + 26);
  const pad = 18;
  const titleH = title ? T.fontTitle + 20 : 0;
  const W = Math.ceil(padL + cellW * 2 + gapX + pad);
  const top = titleH + 40;
  const noteLines = note ? wrapLines(note, W - pad * 2, T.fontSmall) : [];
  const h = Math.ceil(top + cellH * 2 + gapY + (noteLines.length ? noteLines.length * 18 + 18 : 10));

  const parts: string[] = [...titleBlock(title, pad)];
  const xs = [padL, padL + cellW + gapX];
  colLabels.forEach((lab: string, c: number) =>
    parts.push(text(xs[c] + cellW / 2, titleH + 30, fitText(lab, cellW - 10, T.fontKey), 't-key')),
  );
  rowLabels.forEach((lab, r: number) => {
    const y = top + r * (cellH + gapY) + cellH / 2;
    parts.push(text(padL - 18, y - 2, fitText(lab?.label ?? String(lab), padL - 26, T.fontKey), 't-key', 'end'));
    if (lab?.sub) parts.push(text(padL - 18, y + 16, lab.sub, 't-tiny', 'end'));
  });

  cells.slice(0, 4).forEach((cell, idx: number) => {
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
type RangeRow = { from?: number; to?: number; label?: unknown; tone: string };
type RangeMark = { at?: number; label?: unknown };

type RangeBarSpec = { title?: string; unit?: string; rows?: RangeRow[]; marks?: RangeMark[]; note?: string };

function renderRangeBar({ title, unit, rows = [], marks = [], note }: RangeBarSpec): RenderedFigure | null {
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
  // note 以前是单行直排：长句直接穿出右边界（2026-10-22 夜间跑批实测 24px）
  const noteLines = note ? balancedWrap(note, w - padX * 2, T.fontSmall) : [];
  const noteH = noteLines.length ? noteLines.length * 18 + 8 : 0;
  const h = axisY + 24 + noteH;

  const values = rows.flatMap((r) => [Number(r.from), Number(r.to)]).concat(marks.map((m) => Number(m.at)));
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

  rows.forEach((row, i: number) => {
    const y = top + i * rowH;
    const tone = TONE[row.tone] || TONE.accent;
    const x1 = xOf(Number(row.from));
    const x2 = xOf(Number(row.to));
    parts.push(text(padX, y + bandH + 6, row.label, 't-label', 'start'));
    parts.push(rect(x1, y + 4, Math.max(6, x2 - x1), bandH, { r: bandH / 2, fill: tone.fill, stroke: tone.stroke, sw: 1.2 }));
    // 端点数值贴在两端的条内/条外：短条时挪到条外，右侧放不下就翻到左侧，避免压出画布
    const spanW = x2 - x1;
    const valueText = `${fmt(row.from)}${unit || ''} – ${fmt(row.to)}${unit || ''}`;
    const valueW = est(valueText, T.fontMicro);
    if (spanW >= valueW + 12) {
      parts.push(text((x1 + x2) / 2, y + 4 + bandH / 2 + 4, valueText, 't-tiny', 'middle'));
    } else if (x2 + 8 + valueW <= w - padX) {
      parts.push(text(x2 + 8, y + 4 + bandH / 2 + 4, valueText, 't-tiny', 'start'));
    } else {
      parts.push(text(Math.max(padX + labelW - 8, x1 - 8), y + 4 + bandH / 2 + 4, valueText, 't-tiny', 'end'));
    }
  });

  // 共享数值轴：只画端点刻度，避免把区间条读成时间轴
  parts.push(`<line x1="${plotX}" y1="${axisY}" x2="${plotX + plotW}" y2="${axisY}" stroke="${T.line}" stroke-width="1"/>`);
  parts.push(text(plotX, axisY + 16, `${fmt(min)}${unit || ''}`, 't-tiny', 'start'));
  parts.push(text(plotX + plotW, axisY + 16, `${fmt(max)}${unit || ''}`, 't-tiny', 'end'));

  // 参考点（如「汇报的均值差」）：虚线穿过所有轨道
  marks.forEach((mark) => {
    const x = xOf(Number(mark.at));
    parts.push(`<line x1="${x}" y1="${top}" x2="${x}" y2="${axisY}" stroke="${T.accent}" stroke-width="1" stroke-dasharray="4 4"/>`);
    if (mark.label) parts.push(text(x, top - 4, mark.label, 't-tiny', 'middle', `fill="${T.accentInk}"`));
  });

  noteLines.forEach((ln: string, i: number) => {
    parts.push(text(padX, axisY + 24 + 10 + i * 18, ln, 't-small', 'start'));
  });
  return { svg: wrap(parts.join('\n'), w, h), width: w, height: h };
}

/* ---------------- 二维坐标图 ---------------- */

/** 文字白描边（paint-order）：标签压在曲线/虚线上时仍可读，比挪位置确定。 */
const halo = (surface: string) => `paint-order="stroke" stroke="${surface}" stroke-width="3" stroke-linejoin="round"`;

const CURVE_SAMPLES = 48;

function fmtNum(v: number): string {
  if (!Number.isFinite(v)) return '';
  const r = Math.round(v * 1000) / 1000;
  return String(Number.isInteger(r) ? r : r.toFixed(2).replace(/\.?0+$/, ''));
}

/**
 * cartesian-plot：真正的二维坐标图（2026-10-23）。
 *
 * 学生要看的是「两条曲线在同一时刻处在同一高度」这种**只有空间能表达**的关系——
 * 横轴 x、纵轴 y、曲线、等时刻辅助线。模型只给轴域、表达式/数据点、辅助线与箭头，
 * 采样与排版全部由这里确定性完成（同一份 spec 永远画出同一张图）。
 */
type Pt = [number, number];
type FigAxis = { min?: number; max?: number; label?: unknown; ticks?: number[] };
type FigSeries = {
  name?: string;
  tone: string;
  axis?: string;
  form?: string;
  a?: number;
  b?: number;
  c?: number;
  k?: number;
  points?: Pt[];
  dots?: boolean;
  dotPoints?: Pt[];
};
type FigGuide = { axis?: string; at?: number; label?: unknown };
type FigBand = { from?: number; to?: number; tone: string; label?: unknown };
type FigArea = {
  series: string;
  series2?: string;
  from?: number;
  to?: number;
  tone: string;
  label?: unknown;
  baseline?: number;
};
type FigVector = { at: Pt; dx?: number; dy?: number; label?: unknown };
type FigMark = { at: Pt; tone: string; label?: unknown };

type CartesianSpec = {
  title?: string;
  x: FigAxis;
  y: FigAxis;
  y2: FigAxis;
  series?: FigSeries[];
  guides?: FigGuide[];
  bands?: FigBand[];
  areas?: FigArea[];
  vectors?: FigVector[];
  marks?: FigMark[];
};

function renderCartesianPlot({ title, x, y, y2, series = [], guides = [], bands = [], areas = [], vectors = [], marks = [] }: CartesianSpec): RenderedFigure | null {
  if (!x || !y || !(Number(x.max) > Number(x.min)) || !(Number(y.max) > Number(y.min))) {
    if (process.env.FIG_DEBUG) console.error('[cartesian] 轴域缺失');
    return null;
  }
  if (!Array.isArray(series) || !series.length) {
    if (process.env.FIG_DEBUG) console.error('[cartesian] 无系列');
    return null;
  }

  const TONE: Record<string, string> = { accent: T.accent, ok: T.ok, warn: T.warn, neutral: T.muted };
  // V7（外盲评：y 轴标题被截成「降水 /10…」）：左侧让位给轴标题，按实际文字宽度给
  const padL = Math.max(62, Math.ceil(est(y.label ?? '', T.fontMicro)) + 44);
  // V6 双轴（外盲评：气温降水同轴把气温压进 1/6 高度）：y2 有效且存在右轴系列时才启用
  const hasRight = Array.isArray(series) && series.some((sv) => sv?.axis === 'right');
  const y2ok = !!y2 && Number(y2.max) > Number(y2.min) && hasRight;
  const rightAxisW = y2ok ? 34 + (y2.label ? 12 : 0) : 0;
  // 右侧留出辅助线标签栏（写在画布外侧，绝不压在数据上）；宽度按最长标签动态给
  const padR = Math.max(
    24,
    Math.min(
      130,
      14 + Math.max(0, ...(Array.isArray(guides) ? guides.map((g) => (g.label ? est(g.label, T.fontMicro) : 0)) : [])),
    ),
  ) + rightAxisW;
  const padB = 44;
  const titleH = title ? T.fontTitle + 18 : 0;
  const plotW = 560;
  const plotH = 250;
  const w = padL + plotW + padR;
  // 图例按宽度换行：条目多时（曲线 + 频闪点）一行放不下，不能压到绘图区上
  const legendRowH = 17;
  const legendRows = (() => {
    if (series.length <= 1) return 0;
    let rows = 1;
    let used = 0;
    for (const s of series) {
      const need = 13 + est(s.name, T.fontSmall) + 18;
      if (used + need > plotW) {
        rows += 1;
        used = 0;
      }
      used += need;
    }
    return rows;
  })();
  const legendH = legendRows * legendRowH;
  const legendY = titleH + 12;
  const top = titleH + legendH + 20;
  const axisY = top + plotH;
  const h = axisY + padB;

  const x0 = Number(x.min);
  const x1 = Number(x.max);
  const y0 = Number(y.min);
  const y1 = Number(y.max);
  const px = (v: number) => padL + ((v - x0) / (x1 - x0)) * plotW;
  const py = (v: number) => axisY - ((v - y0) / (y1 - y0)) * plotH;

  const parts: string[] = [...titleBlock(title, 16)];

  // 图例：颜色与曲线一一对应；单系列不占版面（标题已说明）
  if (series.length > 1) {
    let lx = padL;
    let ly = legendY;
    series.forEach((s) => {
      const need = 13 + est(s.name, T.fontSmall) + 18;
      if (lx + need > padL + plotW) {
        lx = padL;
        ly += legendRowH;
      }
      const tone = TONE[s.tone] || T.accent;
      parts.push(`<circle cx="${lx + 4}" cy="${ly - 4}" r="4" fill="${tone}"/>`);
      parts.push(text(lx + 13, ly, s.axis === 'right' ? `${s.name}（右轴）` : s.name, 't-small', 'start'));
      lx += need;
    });
  }

  // 刻度网格（只画模型给了的刻度，缺省不脑补，避免把等距当结论）
  const xTicks: number[] = Array.isArray(x.ticks) ? x.ticks : [];
  const yTicks: number[] = Array.isArray(y.ticks) ? y.ticks : [];
  let lastXLabel = Number.NEGATIVE_INFINITY;
  for (const t of xTicks) {
    const gx = px(Number(t));
    parts.push(`<line x1="${gx}" y1="${top}" x2="${gx}" y2="${axisY}" stroke="${T.line}" stroke-width="0.8" opacity="0.55"/>`);
    if (gx - lastXLabel < 34) continue;
    lastXLabel = gx;
    parts.push(text(gx, axisY + 16, fmtNum(Number(t)), 't-tiny', 'middle'));
  }
  // 刻度太密时不印数字（只留网格线）：0.6 / 0.75 / 0.8 挤在一处会压字
  let lastYLabel = Number.NEGATIVE_INFINITY;
  for (const t of yTicks) {
    const gy = py(Number(t));
    parts.push(`<line x1="${padL}" y1="${gy}" x2="${padL + plotW}" y2="${gy}" stroke="${T.line}" stroke-width="0.8" opacity="0.55"/>`);
    if (Math.abs(gy - lastYLabel) < 15) continue;
    lastYLabel = gy;
    parts.push(text(padL - 8, gy + 3.5, fmtNum(Number(t)), 't-tiny', 'end'));
  }

  // 右轴（V6 双轴）：刻度标签靠右画，与左轴互不干扰
  if (y2ok) {
    const ry0 = Number(y2.min);
    const ry1 = Number(y2.max);
    const py2 = (v: number) => axisY - ((v - ry0) / (ry1 - ry0)) * plotH;
    const rTicks: number[] = Array.isArray(y2.ticks) ? y2.ticks : [];
    parts.push(`<line x1="${padL + plotW}" y1="${top}" x2="${padL + plotW}" y2="${axisY}" stroke="${T.lineStrong}" stroke-width="1.5"/>`);
    let lastRLabel = Number.NEGATIVE_INFINITY;
    for (const t of rTicks) {
      const gy = py2(Number(t));
      if (Math.abs(gy - lastRLabel) < 15) continue;
      lastRLabel = gy;
      parts.push(text(padL + plotW + 6, gy + 3.5, fmtNum(Number(t)), 't-tiny', 'start'));
    }
    if (y2.label) parts.push(text(padL + plotW + 20, top + 8, String(y2.label), 't-tiny', 'start', `fill="${T.muted}"`));
  }

  // 坐标轴
  parts.push(`<line x1="${padL}" y1="${top}" x2="${padL}" y2="${axisY}" stroke="${T.lineStrong}" stroke-width="1.5"/>`);
  parts.push(`<line x1="${padL}" y1="${axisY}" x2="${padL + plotW}" y2="${axisY}" stroke="${T.lineStrong}" stroke-width="1.5"/>`);
  if (x.label) parts.push(text(padL + plotW, axisY + 32, x.label, 't-tiny', 'end'));
  if (y.label) parts.push(text(padL - 46, top - 6, y.label, 't-tiny', 'start'));

  // 裁剪区：曲线越界不画到画布外（不靠猜域，直接裁）
  const clipId = `tfx-clip-${uid}`;
  parts.push(`<defs><clipPath id="${clipId}"><rect x="${padL}" y="${top}" width="${plotW}" height="${plotH}"/></clipPath></defs>`);

  const drawSeries = (s: FigSeries): string[] => {
    const tone = TONE[s.tone] || T.accent;
    const out: string[] = [];
    // 右轴系列用右轴的域与映射；左轴系列不变
    const useRight = !!y2ok && s.axis === 'right';
    const yDomain = useRight ? { min: Number(y2.min), max: Number(y2.max) } : { min: y0, max: y1 };
    const toY = useRight
      ? (v: number) => axisY - ((v - Number(y2.min)) / (Number(y2.max) - Number(y2.min))) * plotH
      : (v: number) => py(v);
    let pts: Array<[number, number]> = [];
    if (s.form === 'parabola') {
      const a = Number(s.a);
      const b = Number(s.b);
      const c = Number(s.c);
      for (let i = 0; i <= CURVE_SAMPLES; i += 1) {
        const vx = x0 + ((x1 - x0) * i) / CURVE_SAMPLES;
        pts.push([vx, a * vx * vx + b * vx + c]);
      }
    } else if (s.form === 'linear') {
      const k = Number(s.k);
      const b = Number(s.b);
      pts = [
        [x0, k * x0 + b],
        [x1, k * x1 + b],
      ];
    } else {
      pts = (Array.isArray(s.points) ? s.points : []).map((p) => [Number(p[0]), Number(p[1])]);
    }
    if (!pts.length) return out;
    // 只画落在轴域里的点：曲线冲出轴域时断成多段，不把坐标画到画布外
    const inRange = (v: number, lo: number, hi: number) => v >= lo - 1e-9 && v <= hi + 1e-9;
    const visible = pts.filter(([vx, vy]) => inRange(vx, x0, x1) && inRange(vy, y0, y1));
    if (s.form === 'scatter') {
      for (const [vx, vy] of visible) out.push(`<circle cx="${px(vx)}" cy="${py(vy)}" r="4" fill="${tone}"/>`);
      return out;
    }
    // V3 改造（外盲评 V1/V2 各点名一次：气温降水图缺柱）——柱状系列：每点一根从轴底
    // 到 y 值的柱，宽度按点距自适应（两根柱不重叠），tone 淡色填充 + 描边
    if (s.form === 'bars') {
      const nB = visible.length;
      const slot = nB > 1 ? Math.min(...visible.slice(1).map(([vx], i) => px(vx) - px(visible[i][0]))) : plotW / 4;
      const bw = Math.max(8, Math.min(slot * 0.62, 46));
      const baseY = py(Math.max(y0, Math.min(0, y1)));
      for (const [vx, vy] of visible) {
        const cx = px(vx);
        const by = py(vy);
        const h = Math.max(2, baseY - by);
        out.push('<rect x="' + (cx - bw / 2).toFixed(1) + '" y="' + by.toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + h.toFixed(1) + '" fill="' + tone + '" fill-opacity="0.32" stroke="' + tone + '" stroke-width="1.4"/>');
      }
      return out;
    }
    // 连续可见点切成段（中间越界就断开，避免一条直线横穿画布）
    const segments: Array<Array<[number, number]>> = [];
    let run: Array<[number, number]> = [];
    for (const p of pts) {
      if (inRange(p[0], x0, x1) && inRange(p[1], yDomain.min, yDomain.max)) run.push(p);
      else {
        if (run.length > 1) segments.push(run);
        run = [];
      }
    }
    if (run.length > 1) segments.push(run);
    for (const seg of segments) {
      const d = seg.map(([vx, vy], i) => `${i === 0 ? 'M' : 'L'}${px(vx).toFixed(1)} ${toY(vy).toFixed(1)}`).join(' ');
      out.push(`<path d="${d}" fill="none" stroke="${tone}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>`);
    }
    // 频闪点：等时刻采样点用实心点标出来——「每一拍都在同一高度」靠点对齐才看得见
    if (s.dots) {
      for (const [vx, vy] of visible) {
        out.push(`<circle cx="${px(vx)}" cy="${toY(vy)}" r="3.6" fill="${tone}" stroke="${T.surface}" stroke-width="1.2"/>`);
      }
    }
    // 频闪点属于同一条曲线：同色实心点，不另立图例
    if (Array.isArray(s.dotPoints)) {
      for (const raw of s.dotPoints) {
        const vx = Number(raw[0]);
        const vy = Number(raw[1]);
        if (!Number.isFinite(vx) || !Number.isFinite(vy)) continue;
        if (vx < x0 || vx > x1 || vy < yDomain.min || vy > yDomain.max) continue;
        out.push(`<circle cx="${px(vx)}" cy="${toY(vy)}" r="3.8" fill="${tone}" stroke="${T.surface}" stroke-width="1.2"/>`);
      }
    }
    return out;
  };

  // 面积先画（垫在曲线下面）：v-t 图里的位移、曲线围出的剩余，本身就是答案
  // 在 [lo, hi] 区间内按曲线取样：表达式类曲线两端各取一次/均匀取点，
  // 不能用「整段定义域的两个端点再筛」——轴域比面积区间宽时会被筛成一个点（2026-10-23 实拍：面积没画出来）
  const sampleCurveInRange = (s: FigSeries | undefined, lo: number, hi: number): Array<[number, number]> => {
    if (!s) return [];
    const a0 = Math.max(lo, x0);
    const a1 = Math.min(hi, x1);
    if (!(a1 > a0)) return [];
    if (s.form === 'parabola') {
      const a = Number(s.a);
      const b = Number(s.b);
      const c = Number(s.c);
      const n = 24;
      return Array.from({ length: n + 1 }, (_, i) => {
        const vx = a0 + ((a1 - a0) * i) / n;
        return [vx, a * vx * vx + b * vx + c];
      });
    }
    if (s.form === 'linear') {
      const k = Number(s.k);
      const b = Number(s.b);
      return [[a0, k * a0 + b], [a1, k * a1 + b]];
    }
    return (Array.isArray(s.points) ? s.points : [])
      .map((p): Pt => [Number(p[0]), Number(p[1])])
      .filter(([vx]: [number, number]) => vx >= a0 - 1e-9 && vx <= a1 + 1e-9);
  };
  const curveOf = (name: string) => series.find((s) => s.name === name) || series[0];

  parts.push(`<g clip-path="url(#${clipId})">`);
  // xBand：纵向高亮带垫在最底层——「看这一段」用色块说话，不靠文字标签硬指
  for (const band of Array.isArray(bands) ? bands : []) {
    const bx1 = px(Number(band.from));
    const bx2 = px(Number(band.to));
    const tone = TONE[band.tone] || T.accent;
    parts.push(`<rect x="${Math.min(bx1, bx2).toFixed(1)}" y="${top}" width="${Math.abs(bx2 - bx1).toFixed(1)}" height="${plotH}" fill="${tone}" fill-opacity="0.10"/>`);
    parts.push(`<line x1="${Math.min(bx1, bx2).toFixed(1)}" y1="${top}" x2="${Math.min(bx1, bx2).toFixed(1)}" y2="${axisY}" stroke="${tone}" stroke-width="1" stroke-dasharray="4 4" opacity="0.7"/>`);
    parts.push(`<line x1="${Math.max(bx1, bx2).toFixed(1)}" y1="${top}" x2="${Math.max(bx1, bx2).toFixed(1)}" y2="${axisY}" stroke="${tone}" stroke-width="1" stroke-dasharray="4 4" opacity="0.7"/>`);
    if (band.label) {
      const bw = est(band.label, T.fontMicro);
      const lx = Math.min(Math.max((bx1 + bx2) / 2, padL + bw / 2 + 2), padL + plotW - bw / 2 - 2);
      parts.push(text(lx, top + 12, band.label, 't-tiny', 'middle', `fill="${tone}"`));
    }
  }
  for (const area of Array.isArray(areas) ? areas : []) {
    const curve = curveOf(area.series);
    const pts = sampleCurveInRange(curve, Number(area.from), Number(area.to));
    if (pts.length < 2) continue;
    const tone = TONE[area.tone] || T.accent;
    const labelAt = (topPts: Array<[number, number]>, botY: number) => {
      if (!area.label) return;
      // 标签放在面积的几何中心（按区间中点取曲线高度，再取与基线的中点）
      const midX = (Number(area.from) + Number(area.to)) / 2;
      let curveY = topPts[0][1];
      for (let i = 1; i < topPts.length; i += 1) {
        const [x1p, y1p] = topPts[i];
        const [x0p, y0p] = topPts[i - 1];
        if (midX >= x0p && midX <= x1p) {
          const t = x1p === x0p ? 0 : (midX - x0p) / (x1p - x0p);
          curveY = y0p + (y1p - y0p) * t;
          break;
        }
      }
      const cx = px(midX);
      const cyMid = (py(curveY) + botY) / 2;
      const labelW = est(area.label, T.fontMicro);
      const anchor = cx + labelW / 2 > padL + plotW ? 'end' : 'middle';
      parts.push(text(anchor === 'end' ? cx - 4 : cx, cyMid + 4, area.label, 't-tiny', anchor, `fill="${tone}"`));
    };
    if (area.series2) {
      // 两线夹心：出生率 vs 死亡率的差、供需剩余——「差值」用色块胖瘦直接看
      const curve2 = curveOf(area.series2);
      const pts2 = sampleCurveInRange(curve2, Number(area.from), Number(area.to));
      if (pts2.length < 2) continue;
      const n = Math.max(pts.length, pts2.length);
      const topPath = pts.map(([vx, vy]) => `${px(vx).toFixed(1)} ${py(vy).toFixed(1)}`).join(' L');
      const bottomRev = [...pts2].reverse().map(([vx, vy]) => `${px(vx).toFixed(1)} ${py(vy).toFixed(1)}`).join(' L');
      parts.push(`<path d="M${topPath} L${bottomRev} Z" fill="${tone}" fill-opacity="0.16" stroke="none"/>`);
      const midTop = pts[Math.floor(n / 2)] ?? pts[pts.length - 1];
      const midBot = pts2[Math.floor(n / 2)] ?? pts2[pts2.length - 1];
      labelAt(pts, py((midTop[1] + midBot[1]) / 2));
      continue;
    }
    const baseY = area.baseline != null ? py(Number(area.baseline)) : axisY;
    const top = pts.map(([vx, vy]) => `${px(vx).toFixed(1)} ${py(vy).toFixed(1)}`).join(' L');
    const d = `M${px(pts[0][0]).toFixed(1)} ${baseY} L${top} L${px(pts[pts.length - 1][0]).toFixed(1)} ${baseY} Z`;
    parts.push(`<path d="${d}" fill="${tone}" fill-opacity="0.14" stroke="none"/>`);
    parts.push(`<line x1="${px(pts[0][0]).toFixed(1)}" y1="${baseY}" x2="${px(pts[0][0]).toFixed(1)}" y2="${py(pts[0][1]).toFixed(1)}" stroke="${tone}" stroke-width="1" stroke-dasharray="3 3" opacity="0.7"/>`);
    parts.push(`<line x1="${px(pts[pts.length - 1][0]).toFixed(1)}" y1="${baseY}" x2="${px(pts[pts.length - 1][0]).toFixed(1)}" y2="${py(pts[pts.length - 1][1]).toFixed(1)}" stroke="${tone}" stroke-width="1" stroke-dasharray="3 3" opacity="0.7"/>`);
    labelAt(pts, baseY);
  }
  for (const s of series) parts.push(...drawSeries(s));
  parts.push('</g>');

  // 等时刻辅助线：横向虚线 + 右侧时刻标签（就是「同一时刻两球同高」的证据）。
  // 若同一高度已经有带标签的落点标注，虚线不再重复印字（两个标签贴在一起会压字）。
  const markLabelYs = (Array.isArray(marks) ? marks : [])
    .filter((m) => m?.label)
    .map((m) => py(Number(m.at[1])));
  for (const g of guides) {
    if (g.axis === 'y') {
      const gy = py(Number(g.at));
      parts.push(`<line x1="${padL}" y1="${gy}" x2="${padL + plotW}" y2="${gy}" stroke="${T.muted}" stroke-width="1" stroke-dasharray="5 4" opacity="0.75"/>`);
      const duplicated = markLabelYs.some((my) => Math.abs(my - gy) < 8);
      if (g.label && !duplicated) parts.push(text(padL + plotW + 6, gy + 3.5, g.label, 't-tiny', 'start', halo(T.surface)));
    } else {
      const gx = px(Number(g.at));
      parts.push(`<line x1="${gx}" y1="${top}" x2="${gx}" y2="${axisY}" stroke="${T.muted}" stroke-width="1" stroke-dasharray="5 4" opacity="0.75"/>`);
      if (g.label) parts.push(text(gx + 3, top + 11, g.label, 't-tiny', 'start', halo(T.surface)));
    }
  }

  // 点上的矢量箭头：初速度、落地速度这类分量，箭头长度即大小
  const vectorLabelY: number[] = [];
  for (const v of vectors) {
    const [vx, vy] = v.at;
    const tx = px(vx + Number(v.dx));
    const ty = py(vy + Number(v.dy));
    parts.push(arrow(px(vx), py(vy), tx, ty, { color: T.lineStrong, sw: 1.8 }));
    if (v.label) {
      // 同一处起笔的多个箭头（两个初速度）标签会叠在一起：挨得太近就往下让一行
      let ly = ty - 5;
      while (vectorLabelY.some((prev) => Math.abs(prev - ly) < 12)) ly += 14;
      vectorLabelY.push(ly);
      parts.push(text(tx + 4, ly, v.label, 't-tiny', 'start', halo(T.surface)));
    }
  }

  // 关键点标注（落点等）：实心点 + 标签。
  // 点在轴上时标签要抬到点上方——贴轴下方会与刻度数字打架（2026-10-23 首张样例实拍）。
  for (const m of marks) {
    const [mx, my] = m.at;
    const tone = TONE[m.tone] || T.ink;
    const cx = px(mx);
    const cy = py(my);
    parts.push(`<circle cx="${cx}" cy="${cy}" r="4.2" fill="${tone}" stroke="${T.surface}" stroke-width="1.4"/>`);
    const labelW = est(m.label, T.fontMicro);
    const anchor = cx + 8 + labelW <= padL + plotW ? 'start' : 'end';
    const lx = anchor === 'start' ? cx + 8 : cx - 8;
    const nearAxis = cy > axisY - 26;
    parts.push(text(lx, nearAxis ? cy - 9 : cy + 16, m.label, 't-tiny', anchor, `${halo(T.surface)} fill="${tone}"`));
  }

  return { svg: wrap(parts.join('\n'), w, h), width: w, height: h };
}

/* ---------------- 概念图 ---------------- */

/**
 * concept-map：把**概念结构**摆出来（2026-10-23 用户定调：要概念可视化，不是出题）。
 *
 * 与 bipartite/tree 的差别在语义：节点是概念要素（概念/过程/量/条件），
 * 边是**带名字的关系**（产生/供给/构成/导致/对照）。版面按最长路径自动分层（上→下），
 * 边标签压在连线上并带白描边；孤岛节点后端已剪掉。
 */
/**
 * split-compare（2026-10-26）：正误并排对比画布。
 * 布局：左右两栏「同一步的两种走法」行行对齐（行高按两栏取大统一，保证第 n 行对第 n 行），
 * 中缝 vs 圆片；delta.at 在两栏对应行加强调描边；底部一条分叉说明。
 *
 * `placeholder:'none'`（2026-10-27 减负口径）：这块板是参考板不是考卷，
 * 一侧缺行时不补「?」空框——否则白板又变成一张挂着问号的题。
 */
type SplitRow = { label?: unknown; sub?: unknown };
type SplitSide = { rows: SplitRow[]; tone: string; head?: unknown };
type SplitDelta = { at?: number; label?: unknown };

type SplitCompareSpec = {
  title?: string;
  left: SplitSide;
  right: SplitSide;
  delta?: SplitDelta;
  placeholder?: string;
};

function renderSplitCompare({ title, left, right, delta, placeholder }: SplitCompareSpec): RenderedFigure | null {
  // 契约与归一化一致：两栏都必须有至少一行——空栏不是对比
  if (!left || !right || !Array.isArray(left.rows) || !left.rows.length || !Array.isArray(right.rows) || !right.rows.length) return null;
  const W = 620;
  const padX = 20;
  const titleH = title ? T.fontTitle + 20 : 6;
  const gapMid = 56;
  const colW = Math.round((W - padX * 2 - gapMid) / 2);
  // 栏头允许折两行（英语栏头「现在完成时 have finished」单行放不下，硬截会变成歧义半句）
  const headLinesOf = (col: SplitSide) => balancedWrap(String(col?.head ?? ''), colW - 24, T.fontKey).slice(0, 2);
  const headH = 12 + Math.max(1, headLinesOf(left).length, headLinesOf(right).length) * (T.fontKey + 3);
  const TONE: Record<string, { color: string; soft: string; ink: string }> = {
    ok: { color: T.ok, soft: T.okSoft, ink: T.ok },
    warn: { color: T.warn, soft: T.warnSoft, ink: T.warn },
    accent: { color: T.accent, soft: T.accentSoft, ink: T.accentInk },
    neutral: { color: T.muted, soft: T.soft, ink: T.muted },
  };
  const lt = TONE[left.tone] || TONE.warn;
  const rt = TONE[right.tone] || TONE.ok;
  const rowCount = Math.max(left.rows.length, right.rows.length);
  // 行高按两栏同一行取大（行行对齐是这张图的语义核心）：
  // label 可折三行（英文句子 40 字符放不进 238px 单行），sub 再占一行
  const labelWrap = (row?: SplitRow) => (row ? balancedWrap(String(row.label ?? ''), colW - 24, T.fontBody).slice(0, 3) : []);
  const subWrap = (row?: SplitRow) => (row && row.sub ? balancedWrap(row.sub, colW - 24, T.fontMicro).slice(0, 1) : []);
  const rowHs: number[] = [];
  for (let i = 0; i < rowCount; i += 1) {
    const a = left.rows[i];
    const b = right.rows[i];
    const labelLines = Math.max(1, labelWrap(a).length, labelWrap(b).length);
    const hasSub = Boolean((a && a.sub) || (b && b.sub));
    rowHs.push(Math.max(30, labelLines * 17 + (hasSub ? 14 : 0) + 12));
  }
  const bodyTop = titleH + headH + 10;
  const bodyH = rowHs.reduce((m, v) => m + v, 0) + 8;
  const deltaH = delta && delta.label ? 40 : 8;
  const h = bodyTop + bodyH + deltaH + 14;
  const parts: string[] = [...titleBlock(title)];
  const colTop = titleH + 6;

  const drawCol = (col: SplitSide, x: number, tone: { color: string; soft: string; ink: string }) => {
    parts.push(rect(x, colTop, colW, headH + bodyH + 4, { r: T.radius, fill: T.surface, stroke: T.line }));
    parts.push(rect(x, colTop, colW, headH, { r: T.radius, fill: tone.soft, stroke: 'none', sw: 0 }));
    // 圆角头部：盖一块矩形把下沿两个圆角补直
    parts.push('<rect x="' + x + '" y="' + (colTop + headH - 8) + '" width="' + colW + '" height="8" fill="' + tone.soft + '"/>');
    const hls = headLinesOf(col);
    hls.forEach((line, li) => {
      parts.push(text(x + colW / 2, colTop + 16 + li * (T.fontKey + 3), line, 't-key', 'middle', 'fill="' + tone.ink + '"'));
    });
    let y = bodyTop;
    for (let i = 0; i < rowCount; i += 1) {
      const row = col.rows[i];
      const rh = rowHs[i];
      const hi = delta && Number.isInteger(Number(delta.at)) && Number(delta.at) === i + 1;
      if (row) {
        // V7（外盲评：右栏 '?' 配绿色 ok 色调像「已完成」）：待填行一律中性虚线槽，不继承面板色
        const masked = String(row.label ?? '') === '?' || String(row.label ?? '') === '？';
        if (masked) {
          parts.push(rect(x + 6, y + 2, colW - 12, rh - 4, { r: 6, fill: 'none', stroke: T.faint, sw: 1.1, dash: '4 4' }));
          parts.push(text(x + colW / 2, y + rh / 2 + 5, '?', 't-label', 'middle', 'fill="' + T.faint + '"'));
        } else {
          if (hi) parts.push(rect(x + 6, y + 1, colW - 12, rh - 2, { r: 6, fill: tone.soft, stroke: tone.color, sw: 1.4 }));
          const lls = labelWrap(row);
          lls.forEach((line, li) => parts.push(text(x + 12, y + 18 + li * 17, line, 't-label', 'start', 'fill="' + T.ink + '"')));
          const sls = subWrap(row);
          sls.forEach((line) => parts.push(text(x + 12, y + 18 + lls.length * 17 + 2, line, 't-tiny', 'start', 'fill="' + T.muted + '"')));
        }
      } else {
        // V3 改造（外盲评：一侧只写一半/留白时行错位，分叉线指到空处）——缺行侧画
        // 「?」虚线空槽占位，行行对齐的语义不塌；学生要补的就是这一格。
        // 减负板（placeholder:'none'）不补：那是参考板，不是待填的卷子。
        if (placeholder !== 'none') {
          parts.push(rect(x + 6, y + 2, colW - 12, rh - 4, { r: 6, fill: 'none', stroke: T.faint, sw: 1.1, dash: '4 4' }));
          parts.push(text(x + colW / 2, y + rh / 2 + 5, '?', 't-label', 'middle', 'fill="' + T.faint + '"'));
        }
      }
      if (i > 0) parts.push('<line x1="' + (x + 10) + '" y1="' + y + '" x2="' + (x + colW - 10) + '" y2="' + y + '" stroke="' + T.line + '" stroke-width="0.8"/>');
      y += rh;
    }
  };

  drawCol(left, padX, lt);
  drawCol(right, W - padX - colW, rt);

  // 行对齐虚线（V2 改造，外盲评：左右卡片被读成两段独立文字）——第 n 行对第 n 行
  // 的连线就是「同一步的两种走法」这个语义本身；分叉行（delta.at）不画，让差异自己断开
  {
    let ry = bodyTop;
    for (let i = 0; i < rowCount; i += 1) {
      const midY = ry + rowHs[i] / 2;
      const isFork = delta && Number(delta.at) === i + 1;
      if (!isFork) {
        parts.push(`<line x1="${padX + colW + 6}" y1="${midY}" x2="${W - padX - colW - 6}" y2="${midY}" stroke="${T.line}" stroke-width="0.9" stroke-dasharray="3 4"/>`);
      }
      ry += rowHs[i];
    }
  }

  // 中缝 vs：同一动作的两种走法在此分岔
  const vsY = colTop + headH / 2;
  parts.push('<line x1="' + W / 2 + '" y1="' + (colTop + 8) + '" x2="' + W / 2 + '" y2="' + (vsY - 17) + '" stroke="' + T.line + '" stroke-width="1"/>');
  parts.push('<line x1="' + W / 2 + '" y1="' + (vsY + 17) + '" x2="' + W / 2 + '" y2="' + (colTop + headH + bodyH - 4) + '" stroke="' + T.line + '" stroke-width="1"/>');
  parts.push('<circle cx="' + W / 2 + '" cy="' + vsY + '" r="15" fill="' + T.surface + '" stroke="' + T.lineStrong + '" stroke-width="1.2"/>');
  parts.push(text(W / 2, vsY + 4, 'vs', 't-tiny', 'middle', 'fill="' + T.muted + '"'));

  if (delta && delta.label) {
    const dy = bodyTop + bodyH + 8;
    const lines = balancedWrap(String(delta.label), W - padX * 2 - 34, T.fontSmall);
    const boxH = Math.max(30, 12 + lines.length * 16);
    parts.push(rect(padX, dy, W - padX * 2, boxH, { r: 8, fill: T.accentSoft, stroke: 'none', sw: 0 }));
    parts.push('<path d="M' + (padX + 12) + ' ' + (dy + boxH / 2 - 5) + ' l8 5 l-8 5 Z" fill="' + T.accentInk + '"/>');
    lines.forEach((line, li) => parts.push(text(padX + 28, dy + 19 + li * 16, line, 't-small', 'start', 'fill="' + T.accentInk + '" font-weight="600"')));
  }
  return { svg: wrap(parts.join('\n'), W, h), width: W, height: h };
}

/**
 * state-strip（2026-10-26）：状态条带——不回头的进程分帧速写。
 * 布局：2~5 帧横排，帧间箭头「下一步」；每帧头部条 + 状态要点若干行（折行）。
 */
type StripFrame = { label?: unknown; tone: string; items?: unknown[] };

type StateStripSpec = { title?: string; frames?: StripFrame[]; note?: string };

function renderStateStrip({ title, frames = [], note }: StateStripSpec): RenderedFigure | null {
  if (!Array.isArray(frames) || frames.length < 2) return null;
  const W = 620;
  const padX = 20;
  const titleH = title ? T.fontTitle + 20 : 6;
  const gap = 30;
  const n = frames.length;
  const fw = Math.round((W - padX * 2 - (n - 1) * gap) / n);
  // 帧名可能比帧宽长（4 帧 × 年号/长地名时必超）：按帧宽折行，帧头高度随行数长高。
  // 不折行时标签会横穿相邻帧，并在右边缘被裁掉（2026-10-27 盲评实拍）。
  const labelLines: string[][] = frames.map((f) =>
    balancedWrap(String(f.label ?? ''), fw - 18, T.fontKey).slice(0, 2),
  );
  const maxLabelLines = Math.max(1, ...labelLines.map((ls) => ls.length));
  const headH = 10 + maxLabelLines * (T.fontKey + 3);
  const TONE: Record<string, { color: string; soft: string; ink: string }> = {
    ok: { color: T.ok, soft: T.okSoft, ink: T.ok },
    warn: { color: T.warn, soft: T.warnSoft, ink: T.warn },
    accent: { color: T.accent, soft: T.accentSoft, ink: T.accentInk },
    neutral: { color: T.muted, soft: T.soft, ink: T.muted },
  };
  // 每帧行数（items 折行后的总行数），帧高按最高帧对齐
  const frameLines: string[][] = frames.map((f) => {
    const items: string[] = Array.isArray(f.items) ? f.items.filter((x): x is string => typeof x === 'string' && Boolean(x.trim())).slice(0, 3) : [];
    const out: string[] = [];
    for (const it of items) {
      const lines = balancedWrap(it, fw - 20, T.fontSmall);
      // 每项最多 4 行：原先只留 2 行会把长条目直接截掉（2026-10-27 盲评：帧内文字断成半截句）
      out.push(...lines.slice(0, 4));
    }
    return out;
  });
  const maxLines = Math.max(1, ...frameLines.map((ls) => ls.length));
  const bodyH = maxLines * 17 + 12;
  const frameH = headH + bodyH + 8;
  const noteLines = note ? balancedWrap(note, W - padX * 2 - 8, T.fontSmall) : [];
  const noteH = noteLines.length ? 12 + noteLines.length * 16 : 0;
  const h = titleH + frameH + noteH + 30;
  const parts: string[] = [...titleBlock(title)];
  const top = titleH + 16;

  // 时基轨道（V2 改造，外盲评：帧框等大、读不出「推进」）：统一一条横轨，
  // 每帧一个进度点（已走过的实心、未走的空心），把「不回头」画在帧框之外
  const trackY = top - 10;
  {
    const x0 = padX + fw / 2;
    const x1 = padX + (n - 1) * (fw + gap) + fw / 2;
    parts.push(`<line x1="${x0}" y1="${trackY}" x2="${x1}" y2="${trackY}" stroke="${T.line}" stroke-width="1.2"/>`);
    for (let i = 0; i < n; i += 1) {
      const cx = padX + i * (fw + gap) + fw / 2;
      parts.push(`<circle cx="${cx}" cy="${trackY}" r="4.5" fill="${i === 0 ? T.accent : T.surface}" stroke="${i === 0 ? T.accent : T.lineStrong}" stroke-width="1.4"/>`);
    }
  }

  frames.forEach((f, i: number) => {
    const tone = TONE[f.tone] || TONE.neutral;
    const x = padX + i * (fw + gap);
    parts.push(rect(x, top, fw, frameH, { r: T.radius, fill: T.surface, stroke: i === n - 1 ? T.lineStrong : T.line }));
    parts.push(rect(x, top, fw, headH, { r: T.radius, fill: tone.soft, stroke: 'none', sw: 0 }));
    parts.push('<rect x="' + x + '" y="' + (top + headH - 8) + '" width="' + fw + '" height="8" fill="' + tone.soft + '"/>');
    // 帧序号 + 帧名（帧名按帧宽折行，避免横穿相邻帧）
    parts.push(text(x + 10, top + 16, String(i + 1), 't-tiny', 'start', 'fill="' + tone.ink + '" font-weight="700"'));
    labelLines[i].forEach((line, li) => {
      parts.push(
        text(x + fw / 2 + 5, top + 16 + li * (T.fontKey + 3), line, 't-key', 'middle', 'fill="' + tone.ink + '"'),
      );
    });
    const ls = frameLines[i];
    ls.forEach((line, li) => parts.push(text(x + 10, top + headH + 20 + li * 17, line, 't-small', 'start', 'fill="' + T.ink + '"')));
    if (!ls.length) parts.push(text(x + fw / 2, top + headH + bodyH / 2, '—', 't-small', 'middle', 'fill="' + T.faint + '"'));
    // 帧间箭头
    if (i < n - 1) {
      const ax1 = x + fw + 4;
      const ax2 = x + fw + gap - 4;
      const ay = top + frameH / 2;
      parts.push('<line x1="' + ax1 + '" y1="' + ay + '" x2="' + (ax2 - 7) + '" y2="' + ay + '" stroke="' + T.lineStrong + '" stroke-width="1.6"/>');
      parts.push('<path d="M' + ax2 + ' ' + ay + ' l-8 -4 l1.8 8.4 Z" fill="' + T.lineStrong + '"/>');
    }
  });

  if (noteLines.length) {
    const ny = top + frameH + 10;
    noteLines.forEach((line, li) => parts.push(text(padX + 4, ny + li * 16, line, 't-small', 'start', 'fill="' + T.muted + '"')));
  }
  return { svg: wrap(parts.join('\n'), W, h), width: W, height: h };
}

type CgPos = { x: number; y: number; w: number; h: number; cx: number; cy: number };
type CgNode = { id?: unknown; label?: unknown; sub?: unknown; tone: string; layer?: unknown };
type CgEdge = { from?: unknown; to?: unknown; tone: string; label: string; dash?: unknown };

type ConceptMapSpec = { title?: string; nodes?: CgNode[]; edges?: CgEdge[]; takeaway?: string };

function renderConceptMap({ title, nodes = [], edges = [], takeaway }: ConceptMapSpec): RenderedFigure | null {
  if (!Array.isArray(nodes) || nodes.length < 2 || !Array.isArray(edges) || !edges.length) return null;
  const byId = new Map<string, CgNode>(nodes.map((n): [string, CgNode] => [String(n.id), n]));

  // 分层：显式 layer 优先，否则按最长路径（有环时退回已算出的最大值，不追求完美）
  const depth = new Map<string, number>();
  const resolveDepth = (id: string, guard = 0): number => {
    const node = byId.get(id);
    if (node && Number.isInteger(node.layer)) return Math.max(0, Math.min(3, Number(node.layer)));
    if (depth.has(id)) return depth.get(id)!;
    if (guard > 12) return 0;
    const parents = edges.filter((e) => String(e.to) === id && byId.has(String(e.from)));
    const d = parents.length ? Math.max(...parents.map((e) => resolveDepth(String(e.from), guard + 1))) + 1 : 0;
    depth.set(id, d);
    return d;
  };
  nodes.forEach((n) => resolveDepth(String(n.id)));
  const maxDepth = Math.max(...nodes.map((n) => depth.get(String(n.id)) ?? 0));
  const layers: CgNode[][] = Array.from({ length: maxDepth + 1 }, () => []);
  nodes.forEach((n) => layers[depth.get(String(n.id)) ?? 0].push(n));

  // 每层最多 4 个一排，超了就折到下一排——环形概念图（5~8 个节点同层）靠这一条才不叠字
  const MAX_PER_ROW = 4;
  const rows: Array<{ nodes: CgNode[]; depth: number }> = [];
  layers.forEach((layer, d) => {
    for (let i = 0; i < layer.length; i += MAX_PER_ROW) {
      rows.push({ nodes: layer.slice(i, i + MAX_PER_ROW), depth: d });
    }
  });

  const TONE: Record<string, string> = { accent: T.accent, ok: T.ok, warn: T.warn, neutral: T.muted };
  const padX = 18;
  const laneGap = 30;

  // 环状知识（每个要素既被推动又推动下一个：工业革命、水循环、反馈回路）走环形布局。
  // 分层的树状版面会把「循环」读成「先后」，恰好是这类概念最容易被误解的地方。
  const inDeg = new Map<string, number>();
  const outDeg = new Map<string, number>();
  nodes.forEach((n) => { inDeg.set(String(n.id), 0); outDeg.set(String(n.id), 0); });
  edges.forEach((e) => {
    if (!byId.has(String(e.from)) || !byId.has(String(e.to))) return;
    outDeg.set(String(e.from), (outDeg.get(String(e.from)) || 0) + 1);
    inDeg.set(String(e.to), (inDeg.get(String(e.to)) || 0) + 1);
  });
  // 判环放宽：只要六成以上节点「既被推动又推动别人」，整张就按环形画——
  // 工业革命里「工厂生产」是汇点、水循环里「太阳辐射」是源点，按旧判据它们会把整张图拖回纵向瀑布（外审 #16/#17 的教训）
  const bothDeg = nodes.filter((n) => (inDeg.get(String(n.id)) || 0) >= 1 && (outDeg.get(String(n.id)) || 0) >= 1).length;
  const cyclic = nodes.length >= 3 && edges.length >= nodes.length && bothDeg * 5 >= nodes.length * 3;

  if (cyclic) {
    const titleH = title ? T.fontTitle + 18 : 0;
    const boxH = (n: CgNode) => (n.sub ? 48 : 38);
    const boxW = (n: CgNode) => Math.min(190, Math.max(112, Math.max(est(n.label, T.fontKey) + 22, est(n.sub ?? '', T.fontMicro) + 18)));
    const maxW = Math.max(...nodes.map(boxW));
    const maxH = Math.max(...nodes.map(boxH));
    const r = Math.max(118, Math.round(maxW * 0.92));
    const w = Math.max(560, Math.round(2 * r + maxW + padX * 2 + 40));
    const cx0 = w / 2;
    const cy0 = titleH + 20 + r + maxH / 2;
    const takeawayLinesR = takeaway ? balancedWrap(takeaway, w - padX * 2, T.fontSmall) : [];
    // 底部节点的关系名会往下鼓出：底部留 46px（外审实拍：水循环最下沿标签被切）
    const h = cy0 + r + maxH / 2 + 46 + (takeawayLinesR.length ? 12 + takeawayLinesR.length * 18 : 0);
    const parts: string[] = [...titleBlock(title, padX)];
    const pos = new Map<string, { x: number; y: number; w: number; h: number; cx: number; cy: number }>();
    nodes.forEach((n, i: number) => {
      const angle = -Math.PI / 2 + (i * 2 * Math.PI) / nodes.length;
      const nx = cx0 + r * Math.cos(angle);
      const ny = cy0 + r * Math.sin(angle);
      pos.set(String(n.id), { x: nx - boxW(n) / 2, y: ny - boxH(n) / 2, w: boxW(n), h: boxH(n), cx: nx, cy: ny });
    });
    const labels: string[] = [];
    const nodeRectsR = nodes.map((n) => pos.get(String(n.id))).filter((q): q is CgPos => Boolean(q));
    for (const e of edges) {
      const a = pos.get(String(e.from));
      const b = pos.get(String(e.to));
      if (!a || !b) continue;
      const tone = TONE[e.tone] || T.lineStrong;
      // 控制点从圆心往两边连线中点外侧推：弧线向外鼓，读起来是「绕一圈」
      const mx = (a.cx + b.cx) / 2;
      const my = (a.cy + b.cy) / 2;
      const dx = mx - cx0;
      const dy = my - cy0;
      const len = Math.hypot(dx, dy) || 1;
      const bulge = 34;
      const ctrlX = mx + (dx / len) * bulge;
      const ctrlY = my + (dy / len) * bulge;
      // 缩短到盒子边缘，避免箭头戳进节点
      const shrink = 0.82;
      const sx = a.cx + (ctrlX - a.cx) * 0.18;
      const sy = a.cy + (ctrlY - a.cy) * 0.18;
      const tx = b.cx - (ctrlX - b.cx) * (1 - shrink) * 1.2;
      const ty = b.cy - (ctrlY - b.cy) * (1 - shrink) * 1.2;
      parts.push(`<path d="M${sx} ${sy} Q${ctrlX} ${ctrlY} ${tx} ${ty}" fill="none" stroke="${tone}" stroke-width="1.6"${e.dash ? ' stroke-dasharray="5 4"' : ''}/>`);
      parts.push(`<path d="M${tx} ${ty} l-7 -3.4 l1.6 7.4 Z" fill="${tone}"/>`);
      // 环上的关系名容易鼓出画布：沿外法线推出去，再夹回画布内（外审：顶部标签被切一半）
      // 标签沿外法线推出去并夹回画布；若仍压在某个节点框上，继续往外推（外审 #4/#5：标签被方框压住）
      // V2 修复（外盲评：? 标签飘在节点旁，看不出属于哪条边）：标签锚定**弧顶**（ctrl 再外推 12px），
      // 而不是从弦中点径向推——跨环长弦的径向推出会远离弧线
      let lx = Math.min(Math.max(ctrlX + (dx / len) * 12, 26), w - 26);
      let ly = Math.min(Math.max(ctrlY + (dy / len) * 12, titleH + 26), h - 30);
      const lw = est(e.label, T.fontMicro);
      for (let tries = 0; tries < 6; tries += 1) {
        const r2 = { x: lx - lw / 2, y: ly - 8, w: lw, h: 14 };
        const hit = nodeRectsR.some((q) => r2.x < q.x + q.w + 4 && r2.x + r2.w > q.x - 4 && r2.y < q.y + q.h + 3 && r2.y + r2.h > q.y - 3);
        if (!hit) break;
        lx += (dx / len) * 10;
        ly += (dy / len) * 10;
        lx = Math.min(Math.max(lx, 26), w - 26);
        ly = Math.min(Math.max(ly, titleH + 26), h - 30);
      }
      labels.push(text(lx, ly, e.label, 't-tiny', 'middle', `paint-order="stroke" stroke="${T.surface}" stroke-width="3" stroke-linejoin="round" fill="${tone}"`));
    }
    for (const n of nodes) {
      const q = pos.get(String(n.id))!;
      const tone = TONE[n.tone];
      parts.push(rect(q.x, q.y, q.w, q.h, { r: 9, fill: T.surface, stroke: tone || T.line, sw: tone ? 1.6 : 1.1 }));
      parts.push(text(q.cx, n.sub ? q.y + 20 : q.y + q.h / 2 + 5, n.label, 't-key', 'middle'));
      if (n.sub) parts.push(text(q.cx, q.y + 36, n.sub, 't-tiny', 'middle'));
    }
    parts.push(...labels);
    takeawayLinesR.forEach((line: string, i: number) => {
      parts.push(text(padX, h - 14 - (takeawayLinesR.length - 1 - i) * 18, line, 't-small', 'start'));
    });
    return { svg: wrap(parts.join('\n'), w, h), width: w, height: h };
  }

  const titleH = title ? T.fontTitle + 18 : 0;
  const gapY = 56;
  const boxH = (n: CgNode) => (n.sub ? 48 : 38);
  const boxW = (n: CgNode) => Math.min(190, Math.max(112, Math.max(est(n.label, T.fontKey) + 22, est(n.sub ?? '', T.fontMicro) + 18)));
  const rowIndexOf = new Map<string, number>();
  rows.forEach((row, ri) => row.nodes.forEach((n) => rowIndexOf.set(String(n.id), ri)));
  const positionsPreview = rowIndexOf;
  const rowW = (row: CgNode[]) => row.reduce((sum, n) => sum + boxW(n) + 14, -14);
  const maxRowW = Math.max(...rows.map((r) => rowW(r.nodes)));
  // 有跨层/回环边时，右侧要留出车道 + 标签的位置，否则标签会被画布切掉（2026-10-23 实拍）
  const hasLaneEdges = edges.some((e) => {
    const a = positionsPreview.get(String(e.from));
    const b = positionsPreview.get(String(e.to));
    return a !== undefined && b !== undefined && b > a && b === a + 1;
  });
  // 每条回环边一条独立车道：三条因果线挤同一个 x 上时标签必然叠字（2026-10-23 历史概念图实拍）
  const laneEdgeCount = edges.filter((e) => {
    const a = positionsPreview.get(String(e.from));
    const b = positionsPreview.get(String(e.to));
    return a !== undefined && b !== undefined && !(b === a + 1);
  }).length;
  const laneSpace = hasLaneEdges ? Math.max(86, 26 + laneEdgeCount * 16) : 0;
  const w = Math.max(560, Math.min(1040, maxRowW + padX * 2 + laneGap + laneSpace));

  const positions = new Map<string, { x: number; y: number; w: number; h: number }>();
  let y = titleH + 10;
  let lastDepth = -1;
  for (const row of rows) {
    if (lastDepth >= 0 && row.depth !== lastDepth) y += 14; // 层与层之间多留一点，边才有地方走
    lastDepth = row.depth;
    const rw = rowW(row.nodes);
    let x = Math.max(padX, (w - laneGap - rw) / 2);
    for (const n of row.nodes) {
      const bw = boxW(n);
      positions.set(String(n.id), { x, y, w: bw, h: boxH(n) });
      x += bw + 14;
    }
    y += Math.max(...row.nodes.map(boxH)) + gapY;
  }
  const contentBottom = y - gapY;
  const takeawayLines = takeaway ? balancedWrap(takeaway, w - padX * 2, T.fontSmall) : [];
  const h = contentBottom + (takeawayLines.length ? 12 + takeawayLines.length * 18 : 0) + 14;

  const parts: string[] = [...titleBlock(title, padX)];

  const nodeRects = [...positions.values()];
  const labelRects: Array<{ x: number; y: number; w: number; h: number }> = [];
  const freeSpot = (cx: number, cy: number, wd: number) => {
    const r = { x: cx - wd / 2, y: cy - 8, w: wd, h: 13 };
    const hit = (o: { x: number; y: number; w: number; h: number }) =>
      r.x < o.x + o.w && r.x + r.w > o.x && r.y < o.y + o.h && r.y + r.h > o.y;
    return !nodeRects.some(hit) && !labelRects.some(hit);
  };
  const putLabel = (cx: number, cy: number, label: string, anchor: 'start' | 'middle' | 'end', tone: string) => {
    const wd = est(label, T.fontMicro);
    const bx = anchor === 'middle' ? cx : anchor === 'start' ? cx + wd / 2 : cx - wd / 2;
    let ly = cy;
    for (let i = 0; i < 10 && !freeSpot(bx, ly, wd); i += 1) ly += 13;
    labelRects.push({ x: bx - wd / 2, y: ly - 8, w: wd, h: 13 });
    parts.push(text(cx, ly, label, 't-tiny', anchor, `paint-order="stroke" stroke="${T.surface}" stroke-width="3" stroke-linejoin="round" fill="${tone}"`));
  };

  let lane = 0;
  // 汇入同一节点的多条边：标签沿连线错开落点，否则四条「决定·正比」会叠成一片
  // （2026-10-27 白板减负板实拍：浮力四因素同时汇入，标签互相压字）
  const fanCount = new Map<string, number>();
  for (const e of edges) {
    const a = positions.get(String(e.from));
    const b = positions.get(String(e.to));
    if (!a || !b) continue;
    const tone = TONE[e.tone] || T.lineStrong;
    const da = depth.get(String(e.from)) ?? 0;
    const db = depth.get(String(e.to)) ?? 0;
    const directlyBelow = b.y >= a.y + a.h + 6 && db === da + 1;
    if (directlyBelow) {
      const x1 = a.x + a.w / 2;
      const y1 = a.y + a.h;
      const x2 = b.x + b.w / 2;
      const y2 = b.y;
      const midY = (y1 + y2) / 2;
      parts.push(`<path d="M${x1} ${y1} C${x1} ${midY} ${x2} ${midY} ${x2} ${y2 - 2}" fill="none" stroke="${tone}" stroke-width="1.5"${e.dash ? ' stroke-dasharray="5 4"' : ''}/>`);
      parts.push(`<path d="M${x2 - 4} ${y2 - 6} L${x2} ${y2 - 1} L${x2 + 4} ${y2 - 6} Z" fill="${tone}"/>`);
      const fan = fanCount.get(String(e.to)) ?? 0;
      fanCount.set(String(e.to), fan + 1);
      const at = 0.42 + (fan % 4) * 0.13;
      putLabel((x1 + x2) / 2, y1 + (y2 - y1) * at, e.label, 'middle', tone);
    } else {
      // 跨层/同层/回环：一律走右侧车道，避免从中间那排节点身上穿过去
      const laneX = w - 20 - lane * 14;
      lane += 1;
      const ay = a.y + a.h / 2;
      const by = b.y + b.h / 2;
      const rightA = a.x + a.w;
      const rightB = b.x + b.w;
      parts.push(`<path d="M${rightA} ${ay} L${laneX} ${ay} L${laneX} ${by} L${rightB + 2} ${by}" fill="none" stroke="${tone}" stroke-width="1.5"${e.dash ? ' stroke-dasharray="5 4"' : ''}/>`);
      parts.push(`<path d="M${rightB + 9} ${by - 4} L${rightB + 2} ${by} L${rightB + 9} ${by + 4} Z" fill="${tone}"/>`);
      putLabel(laneX - 4, (ay + by) / 2, e.label, 'end', tone);
    }
  }

  // 节点最后画（压在连线之上），保证标签永远可读
  for (const n of nodes) {
    const pos = positions.get(String(n.id));
    if (!pos) continue;
    const tone = TONE[n.tone];
    parts.push(rect(pos.x, pos.y, pos.w, pos.h, { r: 9, fill: T.surface, stroke: tone || T.line, sw: tone ? 1.6 : 1.1 }));
    const cx = pos.x + pos.w / 2;
    parts.push(text(cx, n.sub ? pos.y + 20 : pos.y + pos.h / 2 + 5, n.label, 't-key', 'middle'));
    if (n.sub) parts.push(text(cx, pos.y + 36, n.sub, 't-tiny', 'middle'));
  }

  takeawayLines.forEach((line: string, i: number) => {
    parts.push(text(padX, contentBottom + 16 + i * 18, line, 't-small', 'start'));
  });

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
        return renderGrid(spec as GridSpec);
      case 'matrix':
        return renderMatrix(spec as MatrixSpec);
      case 'compare':
        return renderCompare(spec as CompareSpec);
      case 'quadrant':
        return renderQuadrant(spec as QuadrantSpec);
      case 'bipartite':
        return renderBipartite(spec as BipartiteSpec);
      case 'board':
        return renderBoard(spec as BoardSpec);
      case 'bins':
        return renderBins(spec as BinsSpec);
      case 'balance':
        return renderBalance(spec as BalanceSpec);
      case 'ladder':
        return renderLadder(spec as LadderSpec);
      case 'cycle':
        return renderCycle(spec as CycleSpec);
      case 'tree':
        return renderTree(spec as TreeSpec);
      case 'venn':
        return renderVenn(spec as VennSpec);
      case 'bullseye':
        return renderBullseye(spec as BullseyeSpec);
      case 'range-bar':
        return renderRangeBar(spec as RangeBarSpec);
      case 'cartesian-plot':
        return renderCartesianPlot(spec as CartesianSpec);
      case 'concept-map':
        return renderConceptMap(spec as ConceptMapSpec);
      case 'split-compare':
        return renderSplitCompare(spec as SplitCompareSpec);
      case 'state-strip':
        return renderStateStrip(spec as StateStripSpec);
      default:
        return null;
    }
  } catch (err) {
    if (process.env.FIG_DEBUG) console.error('[renderSpecFigure]', err);
    return null;
  } finally {
    T = previous;
    MAT = previousMat;
  }
}
