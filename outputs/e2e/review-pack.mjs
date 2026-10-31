/**
 * 评审三件套：管线 / 报告 / 课堂图片，各出一份 PDF（可打印、可转发）。
 *
 * 为什么用 PDF：三份都是给「评审」看的，需要固定版式、翻页、不依赖浏览器环境；
 * 图片合集一图一页，比 HTML 更适合逐张过。
 *
 * 用法：node outputs/e2e/review-pack.mjs [version=v8] [outDir=outputs/review-pack]
 * 产出：09-教学管线.pdf / 10-教学图评审报告.pdf / 11-课堂图片合集.pdf（+ 同名 .html 便于改）
 *       编号沿用主树既有约定（06/07/08 已是既有评审件）
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const [versionArg, outDirArg] = process.argv.slice(2);
const version = versionArg || 'v8';
const V = version.toUpperCase();
const outDir = path.resolve(ROOT, outDirArg || 'outputs/review-pack');
fs.mkdirSync(outDir, { recursive: true });

const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const esc = (s) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const clip = (s, n) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
};

// ---------- 极简 markdown → html（标题/表格/代码块/列表/引用/段落） ----------
const mdToHtml = (md) => {
  const inline = (t) => esc(t).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
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

const BASE_CSS = `
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
    font-size: 8.6pt; line-height: 1.55; white-space: pre; overflow: hidden; margin: 8pt 0;
    font-family: ui-monospace,SFMono-Regular,Menlo,monospace; }
  table { width:100%; border-collapse: collapse; font-size: 9.2pt; margin: 7pt 0 10pt; }
  th, td { border:1px solid #dfe3ea; padding: 3.5pt 5pt; text-align:left; vertical-align: top; }
  th { background:#f4f6f9; font-weight: 650; white-space: nowrap; }
  td:first-child { white-space: nowrap; }
  td code { white-space: nowrap; }
  blockquote { margin: 8pt 0; padding: 7pt 10pt; background:#f6f7f9; border-left:2.5pt solid #c9cfd9;
    color:#5b6472; border-radius: 3pt; }
  .sub { color:#5b6472; font-size: 10pt; margin: 0 0 12pt; }
  .cover { page-break-after: always; padding-top: 40mm; }
  .cover h1 { font-size: 26pt; }
  .cover .meta { margin-top: 14pt; color:#5b6472; font-size: 10.5pt; line-height: 1.9; }
  .kpi { display:flex; gap:10pt; margin: 14pt 0 4pt; flex-wrap: wrap; }
  .kpi div { border:1px solid #e3e6ec; border-radius:6pt; padding:7pt 11pt; min-width: 76pt; }
  .kpi b { display:block; font-size: 16pt; line-height:1.2; }
  .kpi i { font-style:normal; font-size: 8.6pt; color:#5b6472; }
  .verdict { font-size: 8.6pt; padding: 1pt 5pt; border-radius: 999pt; color:#fff; }
  .keep { background:#0f766e; } .fix { background:#b45309; } .drop { background:#b42318; }
  .figure-page { page-break-after: always; }
  .figure-page:last-child { page-break-after: auto; }
  .fig-head { display:flex; align-items:baseline; gap:7pt; margin-bottom: 5pt; flex-wrap: wrap; }
  .fig-no { font-weight:700; font-size: 13pt; }
  .fig-kind { font-family: ui-monospace,Menlo,monospace; font-size: 9pt; color:#4f46e5;
    background:#eef0ff; padding:1pt 5pt; border-radius:3pt; }
  .fig-course { color:#5b6472; font-size: 9.5pt; }
  .fig-img { text-align:center; margin: 6pt 0; }
  .fig-img img { max-width: 100%; max-height: 158mm; object-fit: contain; border:1px solid #eef0f4; border-radius:4pt; }
  .fig-meta { font-size: 9.3pt; color:#5b6472; }
  .fig-issue { font-size: 9.6pt; margin-top: 4pt; }
  .fig-issue span { font-size:8.4pt; color:#8b94a3; border:1px solid #e3e6ec; border-radius:3pt;
    padding:0 4pt; margin-right:5pt; }
  .fig-quote { font-size: 9pt; color:#5b6472; background:#f6f7f9; border-radius:4pt;
    padding:5pt 8pt; margin-top:5pt; }
`;

const wrapDoc = (title, body, extraCss = '') => `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>${BASE_CSS}${extraCss}</style></head><body>${body}</body></html>`;

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
const review = JSON.parse(fs.readFileSync(path.join(ROOT, 'outputs/e2e', `${version}-review.json`), 'utf8'));
const items = JSON.parse(fs.readFileSync(path.join(ROOT, 'frontend/figure-out', `${version}-final-items.json`), 'utf8'));
const pngDir = path.join(ROOT, 'frontend/figure-out', `${version}-pngs`);
const rows = review.results;
const judged = rows.filter((r) => !r.error);
const cnt = (v) => judged.filter((r) => r.verdict === v).length;
const mean = (k) => (judged.reduce((n, r) => n + (Number(r[k]) || 0), 0) / judged.length).toFixed(2);
const pct = (k) => Math.round((judged.filter((r) => r[k] === true).length / judged.length) * 100);
const kindOf = (r) => r.kind || items[r.i]?.figure?.kind || '?';
const itOf = (r) => items[r.i] || {};
const VCN = { keep: '保留', fix: '要修', drop: '删掉' };

// 八版历史（存在则读）
const versions = ['v1', 'v2', 'v3', 'v4', 'v5', 'v6', 'v7', 'v8'];
const history = [];
for (const v of versions) {
  const rv = path.join(ROOT, 'outputs/e2e', `${v}-review.json`);
  const it = path.join(ROOT, 'frontend/figure-out', `${v}-final-items.json`);
  if (!fs.existsSync(rv) || !fs.existsSync(it)) continue;
  const rj = JSON.parse(fs.readFileSync(rv, 'utf8')).results.filter((r) => !r.error);
  const c = (x) => rj.filter((r) => r.verdict === x).length;
  const m = (k) => (rj.reduce((n, r) => n + (Number(r[k]) || 0), 0) / rj.length).toFixed(2);
  const p = (k) => Math.round((rj.filter((r) => r[k] === true).length / rj.length) * 100);
  history.push({
    v: v.toUpperCase(), n: JSON.parse(fs.readFileSync(it, 'utf8')).length,
    keep: c('keep'), fix: c('fix'), drop: c('drop'),
    use: m('usefulness'), geo: m('geometry'), read: m('readability'),
    redundant: p('redundant'), leak: p('leak'), meta: p('meta'),
  });
}

// 改造历程：读每版 meta.changes
const changes = [];
for (const v of versions) {
  const mp = path.join(ROOT, 'outputs/e2e', `${v}-meta.json`);
  if (!fs.existsSync(mp)) continue;
  const meta = JSON.parse(fs.readFileSync(mp, 'utf8'));
  if (Array.isArray(meta.changes) && meta.changes.length) {
    changes.push({ v: v.toUpperCase(), items: meta.changes });
  }
}

// ---------- 01 管线 ----------
const pipelineMd = fs.readFileSync(path.join(ROOT, 'doc', 'TEACHING_PIPELINE_REPORT.md'), 'utf8')
  .replace(/^#\s+.*$/m, '');
const pipelineHtml = wrapDoc(
  '教学课堂管线报告',
  `<div class="cover">
    <h1>教学课堂管线报告</h1>
    <p class="sub">从学生发一句话，到老师回话并配图，中间经过哪些层、按什么顺序、各层字段是什么。</p>
    <div class="meta">
      版本：${V} 迭代后（2026-10-27）<br>
      口径：当前分支代码的真实调用链，文件路径与函数名可直接对照<br>
      配套：10-教学图评审报告.pdf（质量数据）／11-课堂图片合集.pdf（30 张原图）
    </div>
  </div>
  ${mdToHtml(pipelineMd)}`,
);

// ---------- 02 报告 ----------
const histTable = `<table>
  <thead><tr><th>版本</th><th>出土</th><th>保留</th><th>要修</th><th>删掉</th><th>有用/3</th><th>几何/3</th><th>可读/3</th><th>伪视觉</th><th>泄题</th><th>元话</th></tr></thead>
  <tbody>${history.map((h) => `<tr><td><b>${h.v}</b></td><td>${h.n}</td><td>${h.keep}</td><td>${h.fix}</td><td>${h.drop}</td><td>${h.use}</td><td>${h.geo}</td><td>${h.read}</td><td>${h.redundant}%</td><td>${h.leak}%</td><td>${h.meta}%</td></tr>`).join('')}</tbody>
</table>`;

const byKind = {};
for (const r of judged) {
  const k = kindOf(r);
  byKind[k] = byKind[k] || { n: 0, keep: 0, fix: 0, drop: 0, redundant: 0, leak: 0 };
  byKind[k].n += 1;
  byKind[k][r.verdict] = (byKind[k][r.verdict] || 0) + 1;
  if (r.redundant) byKind[k].redundant += 1;
  if (r.leak) byKind[k].leak += 1;
}
const kindTable = `<table>
  <thead><tr><th>图型</th><th>张数</th><th>保留/要修/删</th><th>伪视觉</th><th>泄题</th></tr></thead>
  <tbody>${Object.entries(byKind).sort((a, b) => b[1].n - a[1].n)
    .map(([k, v]) => `<tr><td>${esc(k)}</td><td>${v.n}</td><td>${v.keep} / ${v.fix} / ${v.drop}</td><td>${v.redundant}</td><td>${v.leak}</td></tr>`).join('')}</tbody>
</table>`;

const detailTable = `<table>
  <thead><tr><th style="width:8%">#</th><th style="width:16%">图型</th><th style="width:24%">课程</th><th style="width:8%">判</th><th style="width:10%">分</th><th>最该修</th></tr></thead>
  <tbody>${rows.map((r) => `<tr>
    <td>#${r.i + 1}</td><td>${esc(kindOf(r))}</td><td>${esc(itOf(r).course || '')}</td>
    <td>${r.error ? '出错' : VCN[r.verdict] || '—'}</td>
    <td>${r.error ? '—' : `${r.usefulness}/${r.geometry}/${r.readability}`}</td>
    <td>${esc(clip(r.worstIssue === 'none' ? '' : r.worstIssue, 150))}</td></tr>`).join('')}</tbody>
</table>`;

const changeBlocks = changes.map((c) => `
  <h3>${c.v} 的改造</h3>
  <ul>${c.items.map((x) => `<li><b>${esc(x.title)}</b>：${esc(x.detail)}</li>`).join('')}</ul>`).join('');

const reportHtml = wrapDoc(
  `教学图评审报告 · ${V}`,
  `<div class="cover">
    <h1>教学图评审报告 · ${V}</h1>
    <p class="sub">${rows.length} 张课堂配图，在真实课堂上下文中生成，由外部视觉模型盲评（只看图与该轮对话，不看代码）。</p>
    <div class="kpi">
      <div><b>${cnt('keep')}</b><i>保留</i></div>
      <div><b>${cnt('fix')}</b><i>要修</i></div>
      <div><b>${cnt('drop')}</b><i>删掉</i></div>
      <div><b>${mean('usefulness')}</b><i>有用 /3</i></div>
      <div><b>${mean('geometry')}</b><i>几何 /3</i></div>
      <div><b>${mean('readability')}</b><i>可读 /3</i></div>
      <div><b>${pct('redundant')}%</b><i>伪视觉</i></div>
      <div><b>${pct('leak')}%</b><i>泄题</i></div>
    </div>
    <div class="meta">
      判据：有用性 / 几何承载 / 可读性各 0–3 分；三个红灯——伪视觉（图只是给句子加边框）、
      泄题（学生要产出的答案被画出来）、元认知话术（图里写做题步骤而非学科实体）。<br>
      配套：09-教学管线.pdf（链路与字段）／11-课堂图片合集.pdf（30 张原图与逐图判词）
    </div>
  </div>

  <h2>一、八版趋势（同一 case 库、同一管线、七轮改造）</h2>
  ${histTable}
  <p>可读性 ${history.length ? history[0].read : '—'} → ${history.length ? history[history.length - 1].read : '—'}（逐轮修复累积）；
  伪视觉 ${history.length ? history[0].redundant : '—'}% → ${history.length ? history[history.length - 1].redundant : '—'}%（V5 后稳定在 10% 以内）；
  保留数在 V4 达峰后回落，是因为评审口径按轮意图收紧，V6 之后的「要修」集中在内容层（语义与数值），管线层问题已清完。</p>

  <h2>二、${V} 按图型</h2>
  ${kindTable}

  <h2>三、${V} 逐图总表</h2>
  ${detailTable}

  <h2>四、改造历程</h2>
  <p>每一版都是「跑 30 张 → 外部盲评 → 按病灶改造 → 下一版」，下面是每版改了什么。</p>
  ${changeBlocks}

  <h2>五、结论</h2>
  <ul>
    <li><b>管线层已清完</b>：路由、归一化、渲染、脱敏、内容核验（算式复算/并列边合并/行数差）的问题在 V1–V8 内逐项修掉，剩余「要修」集中在模型 spec 的语义质量。</li>
    <li><b>伪视觉是最大单项改善</b>：58% → 10% 以内，靠的是渲染层结构增强（行对齐线、时基轨道、空槽）+ 判据精确化 + 模型侧 spec 质量上升。</li>
    <li><b>下一步杠杆</b>：① 知识校验层——用上游 <code>kcGraph</code> / <code>anticipatedMisconceptions</code> 交叉核验因果方向（算式复算兜不住「冬季陆地写成低压」这类错误）；② 场景类图型的能力上限——漏斗剖面、木箱受力这类空间场景，文本框图型画不出来。</li>
  </ul>`,
);

// ---------- 03 图片合集 ----------
const figPages = rows.map((r) => {
  const it = itOf(r);
  const file = path.join(pngDir, `${r.i}.png`);
  const b64 = fs.existsSync(file) ? fs.readFileSync(file).toString('base64') : '';
  const v = r.error ? '出错' : VCN[r.verdict] || '—';
  const vc = r.error ? 'fix' : r.verdict;
  return `<section class="figure-page">
    <div class="fig-head">
      <span class="fig-no">#${r.i + 1}</span>
      <span class="fig-kind">${esc(kindOf(r))}</span>
      <span class="verdict ${vc}">${v}</span>
      <span class="fig-course">${esc(it.course || '')}</span>
    </div>
    <div class="fig-img">${b64 ? `<img src="data:image/png;base64,${b64}" alt="#${r.i + 1}">` : '<p>（缺图）</p>'}</div>
    <div class="fig-meta">有用 ${r.usefulness ?? '—'}/3 · 几何 ${r.geometry ?? '—'}/3 · 可读 ${r.readability ?? '—'}/3${r.redundant ? ' · 伪视觉' : ''}${r.leak ? ' · 泄题' : ''}${r.meta ? ' · 元话' : ''}</div>
    ${r.worstIssue && r.worstIssue !== 'none' ? `<p class="fig-issue"><span>最该修</span>${esc(clip(r.worstIssue, 260))}</p>` : ''}
    ${it.context?.teacher ? `<div class="fig-quote"><b>该轮老师原话：</b>${esc(clip(it.context.teacher, 300))}</div>` : ''}
  </section>`;
}).join('');

const figuresHtml = wrapDoc(
  `课堂图片合集 · ${V}`,
  `<div class="cover">
    <h1>课堂图片合集 · ${V}</h1>
    <p class="sub">${rows.length} 张，一图一页；每页带图型、课程、判词与该轮老师原话，便于逐张过。</p>
    <div class="meta">
      评分：有用 / 几何 / 可读 各 0–3；判词：保留 / 要修 / 删掉。<br>
      配套：09-教学管线.pdf（链路）／10-教学图评审报告.pdf（趋势与改造历程）
    </div>
  </div>
  ${figPages}`,
);

// ---------- 生成 ----------
// 沿用主树既有的编号约定（主树根已有 06/07/08 号评审 PDF）
const outputs = [
  ['09-教学管线', pipelineHtml],
  ['10-教学图评审报告', reportHtml],
  ['11-课堂图片合集', figuresHtml],
];
const kb = (n) => Math.round(n / 1024);
let total = 0;
for (const [name, html] of outputs) {
  const htmlFile = path.join(outDir, `${name}.html`);
  const pdfFile = path.join(outDir, `${name}.pdf`);
  fs.writeFileSync(htmlFile, html, 'utf8');
  const size = printPdf(htmlFile, pdfFile);
  total += size;
  console.log(`${name}.pdf  ${kb(size)}KB（源 HTML ${kb(fs.statSync(htmlFile).size)}KB）`);
}
console.log(`\n→ ${path.relative(ROOT, outDir)}/  三份合计 ${kb(total)}KB`);
