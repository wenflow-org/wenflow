/**
 * 白板模式评审件：报告 + 三案例两态对照，出成一份 PDF（12 号，接在 09/10/11 之后）。
 *
 * 为什么单独一份：白板模式验证的是「管线形态」而不是「图的质量」，评审需要先看到
 * 同一块板在两态下的差别，再读报告里的数字，两者放在同一份里才方便对照。
 *
 * 用法：node outputs/e2e/board-pack.mjs [run=outputs/e2e/board-run-v4.json] [outDir=outputs/board-pack]
 * 产出：12-白板模式-图教分离.pdf（+ 同名 .html）
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const [runArg, outDirArg] = process.argv.slice(2);
const runPath = path.resolve(ROOT, runArg || 'outputs/e2e/board-run-v5.json');
const outDir = path.resolve(ROOT, outDirArg || 'outputs/board-pack');
fs.mkdirSync(outDir, { recursive: true });

const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const esc = (s) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
// 老师话术本身带 markdown（**强调**、换行分段）；直接 esc 会把星号印出来。
// 句末标点要留在加粗里：留在 </b> 外面时，Chrome 会在行尾把「。」单独折到下一行（实拍 p10）。
const prose = (s) =>
  esc(s)
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/<\/b>([。；，！？])/g, '$1</b>')
    .replace(/\n+([。；，！？])/g, '$1')
    .replace(/\n+/g, '<br>');

// ---------- 极简 markdown → html（与 review-pack 同口径） ----------
const mdToHtml = (md) => {
  const inline = (t) =>
    esc(t).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
  const lines = md.split('\n');
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/^```/.test(line)) {
      const buf = [];
      i += 1;
      while (i < lines.length && !/^```/.test(lines[i])) { buf.push(lines[i]); i += 1; }
      i += 1;
      out.push(`<pre class="flow">${esc(buf.join('\n'))}</pre>`);
      continue;
    }
    if (/^\|/.test(line)) {
      const rows = [];
      while (i < lines.length && /^\|/.test(lines[i])) { rows.push(lines[i]); i += 1; }
      const cells = (r) => r.replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      const head = cells(rows[0]);
      const body = rows.slice(2).map(cells);
      out.push(`<table><thead><tr>${head.map((h) => `<th>${inline(h)}</th>`).join('')}</tr></thead><tbody>${body
        .map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`)
        .join('')}</tbody></table>`);
      continue;
    }
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) { out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`); i += 1; continue; }
    if (/^>\s?/.test(line)) {
      const buf = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) { buf.push(lines[i].replace(/^>\s?/, '')); i += 1; }
      out.push(`<blockquote>${buf.map(inline).join('<br>')}</blockquote>`);
      continue;
    }
    if (/^\s*[-*]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) { items.push(lines[i].replace(/^\s*[-*]\s+/, '')); i += 1; }
      out.push(`<ul>${items.map((t) => `<li>${inline(t)}</li>`).join('')}</ul>`);
      continue;
    }
    if (line.trim() === '' || /^---+$/.test(line.trim())) { i += 1; continue; }
    out.push(`<p>${inline(line)}</p>`);
    i += 1;
  }
  return out.join('\n');
};

const CSS = `
  @page { size: A4; margin: 16mm 14mm 16mm 14mm; }
  * { box-sizing: border-box; }
  body { margin:0; color:#1f2430; background:#fff;
    font: 11.5pt/1.65 "PingFang SC","Microsoft YaHei","Segoe UI",system-ui,sans-serif; }
  h1 { font-size: 21pt; margin: 0 0 6pt; letter-spacing: -.2pt; }
  h2 { font-size: 14.5pt; margin: 18pt 0 7pt; padding-bottom: 3pt; border-bottom: 1px solid #e3e6ec; }
  h3 { font-size: 12.5pt; margin: 14pt 0 6pt; }
  h4 { font-size: 11.5pt; margin: 11pt 0 5pt; color:#5b6472; }
  p { margin: 6pt 0; }
  ul { margin: 6pt 0 6pt 16pt; padding: 0; }
  li { margin: 2.5pt 0; }
  code { font-family: ui-monospace,SFMono-Regular,Menlo,monospace; font-size: 9.5pt;
    background:#f1f3f7; padding: 0 3pt; border-radius: 3pt; }
  pre.flow { background:#f6f7f9; border:1px solid #e3e6ec; border-radius:6pt; padding:9pt 11pt;
    font-size: 8.6pt; line-height: 1.55; white-space: pre-wrap; word-break: break-all; margin: 8pt 0;
    font-family: ui-monospace,SFMono-Regular,Menlo,monospace; }
  table { width:100%; border-collapse: collapse; font-size: 9.2pt; margin: 7pt 0 10pt; }
  th, td { border:1px solid #dfe3ea; padding: 3.5pt 5pt; text-align:left; vertical-align: top; }
  th { background:#f4f6f9; font-weight: 650; white-space: nowrap; }
  td:first-child { white-space: nowrap; }
  blockquote { margin: 8pt 0; padding: 7pt 10pt; background:#f6f7f9; border-left:2.5pt solid #c9cfd9;
    color:#5b6472; border-radius: 3pt; }
  .sub { color:#5b6472; font-size: 10pt; margin: 0 0 12pt; }
  .cover { page-break-after: always; padding-top: 40mm; }
  .cover h1 { font-size: 26pt; }
  .cover .meta { margin-top: 14pt; color:#5b6472; font-size: 10.5pt; line-height: 1.9; }
  .kpi { display:flex; gap:10pt; margin: 14pt 0 4pt; flex-wrap: wrap; }
  .kpi div { border:1px solid #e3e6ec; border-radius:6pt; padding:7pt 11pt; min-width: 88pt; }
  .kpi b { display:block; font-size: 16pt; line-height:1.2; }
  .kpi i { font-style:normal; font-size: 8.6pt; color:#5b6472; }
  .case-page { page-break-after: always; }
  .case-page:last-child { page-break-after: auto; }
  .case-head { display:flex; align-items:baseline; gap:8pt; margin-bottom: 6pt; flex-wrap: wrap; }
  .case-head h2 { margin:0; border:none; padding:0; }
  .kind { font-family: ui-monospace,Menlo,monospace; font-size: 9pt; color:#4f46e5;
    background:#eef0ff; padding:1pt 5pt; border-radius:3pt; }
  .board-stack figure { margin: 0 0 10pt; }
  .board-stack img { width:100%; max-height:118mm; object-fit: contain; border:1px solid #e6e9f0; border-radius:4pt; }
  .board-stack figcaption { font-size: 8.8pt; color:#5b6472; margin-top: 3pt; text-align:center; }
  .state-tag { display:inline-block; font-size:8.4pt; padding:0 5pt; border-radius:3pt; margin-right:5pt;
    background:#eef0ff; color:#4f46e5; }
  .state-tag.full { background:#e8f5f2; color:#0f766e; }
  .turn-quote { font-size: 9.4pt; background:#f6f7f9; border-radius:4pt; padding:6pt 9pt; margin:5pt 0; }
  .turn-quote b { display:block; font-size: 8.4pt; color:#8b94a3; font-weight:600; margin-bottom:2pt; }
  .audit { font-size: 9pt; color:#5b6472; }
  .badge { display:inline-block; font-size:8.4pt; padding:1pt 6pt; border-radius:999pt; color:#fff; background:#0f766e; }
  .badge.warn { background:#b45309; }
`;

const wrapDoc = (title, body) => `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>${CSS}</style></head><body>${body}</body></html>`;

const printPdf = (htmlFile, pdfFile) => {
  const toUrl = 'file:///' + path.resolve(htmlFile).split(path.sep).join('/');
  const r = spawnSync(
    CHROME,
    ['--headless=new', '--disable-gpu', '--no-sandbox', '--allow-file-access-from-files',
      '--no-pdf-header-footer', `--print-to-pdf=${path.resolve(pdfFile).split(path.sep).join('/')}`, toUrl],
    { encoding: 'utf8', timeout: 180000 },
  );
  if (!fs.existsSync(pdfFile)) throw new Error(`PDF 生成失败: ${pdfFile}\n${(r.stderr || '').slice(0, 400)}`);
  return fs.statSync(pdfFile).size;
};

// ---------- 数据 ----------
const rows = JSON.parse(fs.readFileSync(runPath, 'utf8')).filter((r) => r.maskedSpec);
const pngDir = path.join(ROOT, 'frontend/figure-out/board-pngs-v6-2x');
const dataUri = (f) => `data:image/png;base64,${fs.readFileSync(path.join(pngDir, f)).toString('base64')}`;

const OP_CN = { setup: '建板', reveal: '揭晓', focus: '指板', none: '不动' };
let imgIdx = 0;
const cases = rows.map((r) => {
  const masked = `${imgIdx}.png`;
  const full = `${imgIdx + 1}.png`;
  imgIdx += 2;
  return { ...r, masked: dataUri(masked), full: dataUri(full) };
});

const head = (c, i) => `<div class="case-head">
      <h2>${i + 1}. ${esc(c.course)}</h2>
      <span class="kind">${esc(c.kind)}</span>
      <span class="audit">任务：${esc(c.taskTitle || '')} ｜ 空槽 ${c.slots} 个 ｜ 板书动作：${c.boardOps.map((o) => OP_CN[o]).join('→')}</span>
    </div>`;

const boardPage = (c, i) => `<section class="case-page">
    ${head(c, i)}
    <div class="board-stack">
      <figure><img src="${c.masked}" alt="提问态">
        <figcaption><span class="state-tag">提问态</span>下发给学生的板：骨架 + 空槽，结论未揭晓</figcaption></figure>
      <figure><img src="${c.full}" alt="揭晓态">
        <figcaption><span class="state-tag full">揭晓态</span>学生答对后同一块板：空槽补上，结论上板</figcaption></figure>
    </div>
  </section>`;

const casePage = (c, i) => {
  const isReveal = (t) => t.stage === 'revealed';
  const turns = c.turns
    .map((t) => {
      const op = OP_CN[c.boardOps[t.n - 1]] || '';
      const leak = t.audit.leakHits.length;
      const phantom = t.audit.phantomRefs.length;
      // 揭晓轮老师引用板面答案是应有行为，不计泄题；只有提问轮才算
      const tone = isReveal(t) ? 'badge' : leak || phantom ? 'badge warn' : 'badge';
      const leakLabel = isReveal(t) ? `引用板面 ${leak}` : `泄题 ${leak}`;
      return `<div class="turn-quote"><b>第 ${t.n} 轮 · ${op} · ${isReveal(t) ? '揭晓态' : '提问态'}
        <span class="${tone}">${leakLabel} · 指空 ${phantom} · 复述 ${t.audit.restateRatio}</span></b>
        ${prose(t.teacher)}</div>`;
    })
    .join('');
  return `<section class="case-page">
    ${head(c, i)}
    <p class="sub" style="margin:0 0 4pt">本轮老师实际话术（学生在白板上看到的内容与这段文字一一对应）</p>
    ${turns}
  </section>`;
};

const reportMd = fs.readFileSync(path.join(ROOT, 'doc', 'BOARD_MODE_REPORT.md'), 'utf8')
  .replace(/^#\s+.*$/m, '');
const awaiting = rows.flatMap((r) => r.turns.filter((t) => t.stage !== 'revealed'));
const totals = {
  leak: awaiting.reduce((n, t) => n + t.audit.leakHits.length, 0),
  phantom: rows.reduce((n, r) => n + r.phantomTotal, 0),
  restate: Math.max(...rows.map((r) => r.restateMax)),
};

const html = wrapDoc(
  '白板模式（图教分离）验证报告',
  `<div class="cover">
    <h1>白板模式（图教分离）验证报告</h1>
    <p class="sub">先定板书，老师看着真板说话；学生答对后同一块板揭晓。消除 V8 的三大管线级死结，并回答「内容与几何是否也随之变好」。</p>
    <div class="kpi">
      <div><b>${totals.leak}</b><i>提问态泄题（确定性审计；V8 盲评 17%）</i></div>
      <div><b>${totals.phantom}</b><i>指着空气说话（确定性审计）</i></div>
      <div><b>${totals.restate}</b><i>复述率最高（V8: 把图念 7~8 行）</i></div>
    </div>
    <p class="sub" style="margin-top:10pt">
      外部盲评不随范式自动变好：同一批图两次评审为 0/0/6 与 0/2/4（保留/要修/删掉），
      泄题 33% / 17%，伪视觉 67% / 50%。n=6 时百分比摆动可达 ±17~33 个百分点——详见 §4.3，
      本版报告已更正上一版「盲评三灯归零」的说法。</p>
    <div class="meta">
      版本：MVP v6（2026-10-27）｜3 案例 × 3 轮，每轮两次模型调用｜归一化重放只改 1 处（delta.at）<br>
      数据来源：outputs/e2e/board-run-v5.json（确定性审计）／board-review-v6.json、board-review-v6b.json（外部盲评两次）<br>
      配套：09-教学管线.pdf（链路）／10-教学图评审报告.pdf（V8 基线）
    </div>
  </div>
  ${mdToHtml(reportMd)}
  <h1 style="page-break-before:always">附：三案例两态对照</h1>
  <p class="sub">每个案例两页：第一页是同一块板的两态（提问态 / 揭晓态），第二页是老师每轮的实际话术与确定性审计。</p>
  ${cases.map(boardPage).join('')}
  ${cases.map(casePage).join('')}`,
);

const MONTH = String(new Date().getMonth() + 1).padStart(2, '0');
const DAY = String(new Date().getDate()).padStart(2, '0');
const base = `12-白板模式-图教分离-${MONTH}${DAY}`;
const htmlFile = path.join(outDir, `${base}.html`);
const pdfFile = path.join(outDir, `${base}.pdf`);
fs.writeFileSync(htmlFile, html, 'utf8');
const size = printPdf(htmlFile, pdfFile);
console.log(`${path.basename(pdfFile)}  ${Math.round(size / 1024)}KB（源 HTML ${Math.round(fs.statSync(htmlFile).size / 1024)}KB）`);
console.log(`→ ${pdfFile}`);
