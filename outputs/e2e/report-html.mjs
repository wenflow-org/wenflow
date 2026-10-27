/**
 * 可复制的评审报告（HTML + 独立图片文件）。
 *
 * 与另两个脚本的分工：
 *   - vision-report.mjs：单文件 HTML，图片 base64 内嵌（850KB，给人看但不可喂模型）
 *   - llm-brief.mjs    ：纯文本单文件（3K token，喂模型最省）
 *   - 本脚本           ：HTML + images/ 独立 PNG（**图片是图片格式**，HTML 只有几十 KB）
 *                       整个输出目录拷走即可，双击 index.html 就能看，也能整包发给模型/同事
 *
 * 用法：node outputs/e2e/report-html.mjs v8 [outDir]
 *   产出 <outDir>/index.html + <outDir>/images/NN.png
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const [version, outDirArg] = process.argv.slice(2);
if (!version) throw new Error('用法: report-html.mjs <version> [outDir]');
const outDir = path.resolve(ROOT, outDirArg || `outputs/${version.toUpperCase()}-review`);
const imgDir = path.join(outDir, 'images');
fs.mkdirSync(imgDir, { recursive: true });

const review = JSON.parse(fs.readFileSync(path.join(ROOT, 'outputs/e2e', `${version}-review.json`), 'utf8'));
const items = JSON.parse(fs.readFileSync(path.join(ROOT, 'frontend/figure-out', `${version}-final-items.json`), 'utf8'));
const pngSrc = path.join(ROOT, 'frontend/figure-out', `${version}-pngs`);

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const clip = (s, n) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
};

// 拷图片（用图片格式，不内嵌）
const rows = review.results;
for (const r of rows) {
  const src = path.join(pngSrc, `${r.i}.png`);
  if (fs.existsSync(src)) fs.copyFileSync(src, path.join(imgDir, `${String(r.i + 1).padStart(2, '0')}.png`));
}

const judged = rows.filter((r) => !r.error);
const cnt = (v) => judged.filter((r) => r.verdict === v).length;
const mean = (k) => (judged.reduce((n, r) => n + (Number(r[k]) || 0), 0) / judged.length).toFixed(2);
const pct = (k) => Math.round((judged.filter((r) => r[k] === true).length / judged.length) * 100);
const kindOf = (r) => r.kind || items[r.i]?.figure?.kind || '?';
const itOf = (r) => items[r.i] || {};

const byKind = {};
for (const r of judged) {
  const k = kindOf(r);
  byKind[k] = byKind[k] || { n: 0, keep: 0, fix: 0, drop: 0, redundant: 0, leak: 0 };
  byKind[k].n += 1;
  byKind[k][r.verdict] = (byKind[k][r.verdict] || 0) + 1;
  if (r.redundant) byKind[k].redundant += 1;
  if (r.leak) byKind[k].leak += 1;
}

const VERDICT = { keep: ['保留', 'ok'], fix: ['要修', 'fix'], drop: ['删掉', 'drop'] };
const badge = (r) => {
  if (r.error) return '<span class="badge err">出错</span>';
  const [label, cls] = VERDICT[r.verdict] || ['—', 'fix'];
  return `<span class="badge ${cls}">${label}</span>`;
};

const cards = rows.map((r) => {
  const it = itOf(r);
  const n = String(r.i + 1).padStart(2, '0');
  const spec = it.figure?.spec ? JSON.stringify(it.figure.spec, null, 1) : '';
  const flags = [
    r.redundant ? '<span class="flag red">伪视觉</span>' : '',
    r.leak ? '<span class="flag red">泄题</span>' : '',
    r.meta ? '<span class="flag amber">元话</span>' : '',
  ].join('');
  const score = (label, v) =>
    r.error ? '' : `<span class="score"><b>${v ?? '—'}</b><i>${label}</i></span>`;
  return `<article class="card" data-verdict="${r.error ? 'error' : r.verdict}" id="fig-${r.i + 1}">
  <header>
    <span class="no">#${r.i + 1}</span>
    <span class="kind">${esc(kindOf(r))}</span>
    ${badge(r)}
    ${flags}
    <span class="course">${esc(it.course || '')}</span>
  </header>
  <div class="figure"><img src="images/${n}.png" alt="第 ${r.i + 1} 张教学图（${esc(kindOf(r))}）" loading="lazy"></div>
  <div class="scores">
    ${score('有用', r.usefulness)}${score('几何', r.geometry)}${score('可读', r.readability)}
  </div>
  ${r.oneLine ? `<p class="oneline"><span>图在讲</span>${esc(clip(r.oneLine, 200))}</p>` : ''}
  ${r.worstIssue && r.worstIssue !== 'none' ? `<p class="issue"><span>最该修</span>${esc(clip(r.worstIssue, 320))}</p>` : ''}
  ${it.context?.teacher ? `<details><summary>该轮老师原话</summary><p class="quote">${esc(clip(it.context.teacher, 500))}</p></details>` : ''}
  ${spec ? `<details><summary>spec（模型给的结构数据）</summary><pre>${esc(clip(spec, 1400))}</pre></details>` : ''}
</article>`;
}).join('\n');

const kindRows = Object.entries(byKind)
  .sort((a, b) => b[1].n - a[1].n)
  .map(([k, v]) => `<tr><td>${esc(k)}</td><td>${v.n}</td><td>${v.keep} / ${v.fix} / ${v.drop}</td><td>${v.redundant}</td><td>${v.leak}</td></tr>`)
  .join('\n');

const tableRows = rows.map((r) => {
  const it = itOf(r);
  return `<tr data-verdict="${r.error ? 'error' : r.verdict}">
    <td><a href="#fig-${r.i + 1}">#${r.i + 1}</a></td>
    <td>${esc(kindOf(r))}</td>
    <td>${esc(it.course || '')}</td>
    <td>${badge(r)}</td>
    <td>${r.error ? '—' : `${r.usefulness}/${r.geometry}/${r.readability}`}</td>
    <td>${esc(clip(r.worstIssue === 'none' ? '' : r.worstIssue, 110))}</td>
  </tr>`;
}).join('\n');

const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>教学图评审报告 · ${version.toUpperCase()}</title>
<style>
  :root{
    --ink:#1f2430; --muted:#5b6472; --faint:#8b94a3; --line:#e3e6ec; --soft:#f6f7f9;
    --accent:#4f46e5; --ok:#0f766e; --fix:#b45309; --drop:#b42318; --bg:#fff;
  }
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--ink);
    font:15px/1.65 "PingFang SC","Microsoft YaHei","Segoe UI",system-ui,sans-serif}
  .wrap{max-width:1180px;margin:0 auto;padding:36px 24px 80px}
  h1{font-size:26px;margin:0 0 6px;letter-spacing:-.2px}
  h2{font-size:18px;margin:36px 0 14px;padding-bottom:8px;border-bottom:1px solid var(--line)}
  .sub{color:var(--muted);font-size:14px;margin:0 0 22px}
  .note{background:var(--soft);border-left:3px solid var(--accent);padding:12px 16px;border-radius:6px;
    font-size:13.5px;color:var(--muted);margin:0 0 24px}
  .stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin:0 0 8px}
  .stat{border:1px solid var(--line);border-radius:10px;padding:14px 16px;background:#fff}
  .stat b{display:block;font-size:24px;line-height:1.2;font-weight:700}
  .stat i{font-style:normal;font-size:12.5px;color:var(--muted)}
  .stat.ok b{color:var(--ok)} .stat.fix b{color:var(--fix)} .stat.drop b{color:var(--drop)}
  table{width:100%;border-collapse:collapse;font-size:13.5px}
  th,td{text-align:left;padding:8px 10px;border-bottom:1px solid var(--line);vertical-align:top}
  th{font-weight:650;color:var(--muted);background:var(--soft);position:sticky;top:0}
  td a{color:var(--accent);text-decoration:none}
  .toolbar{display:flex;gap:8px;flex-wrap:wrap;margin:18px 0 6px}
  .toolbar button{font:inherit;font-size:13px;padding:6px 14px;border-radius:999px;cursor:pointer;
    border:1px solid var(--line);background:#fff;color:var(--muted)}
  .toolbar button.on{background:var(--ink);color:#fff;border-color:var(--ink)}
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(420px,1fr));gap:18px;margin-top:14px}
  .card{border:1px solid var(--line);border-radius:12px;padding:14px 16px 16px;background:#fff;
    display:flex;flex-direction:column;gap:10px}
  .card.hide{display:none}
  .card header{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
  .no{font-weight:700;font-size:15px}
  .kind{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;color:var(--accent);
    background:#eef0ff;padding:2px 8px;border-radius:5px}
  .badge{font-size:12px;padding:2px 9px;border-radius:999px;color:#fff;font-weight:600}
  .badge.ok{background:var(--ok)} .badge.fix{background:var(--fix)}
  .badge.drop{background:var(--drop)} .badge.err{background:var(--faint)}
  .flag{font-size:11.5px;padding:1px 7px;border-radius:5px;border:1px solid}
  .flag.red{color:var(--drop);border-color:#f0c8c4;background:#fdf3f2}
  .flag.amber{color:var(--fix);border-color:#f0dcc0;background:#fdf8ef}
  .course{font-size:12.5px;color:var(--muted);margin-left:auto}
  .figure{background:var(--soft);border-radius:8px;padding:8px;text-align:center}
  .figure img{max-width:100%;height:auto;display:block;margin:0 auto;border-radius:4px}
  .scores{display:flex;gap:18px}
  .score{font-size:12.5px;color:var(--muted)}
  .score b{font-size:16px;color:var(--ink);margin-right:3px}
  .score i{font-style:normal}
  .oneline,.issue{margin:0;font-size:13.5px}
  .oneline span,.issue span{display:inline-block;font-size:11.5px;color:var(--faint);
    border:1px solid var(--line);border-radius:4px;padding:0 5px;margin-right:7px;vertical-align:1px}
  .issue{color:#7a3b12}
  details{font-size:13px}
  summary{cursor:pointer;color:var(--muted);font-size:12.5px}
  .quote{margin:8px 0 0;padding:10px 12px;background:var(--soft);border-radius:6px;color:var(--muted);
    white-space:pre-wrap}
  pre{margin:8px 0 0;padding:10px 12px;background:#0f1117;color:#d6deeb;border-radius:6px;
    font-size:11.5px;line-height:1.55;overflow:auto;max-height:260px}
  footer{margin-top:52px;padding-top:18px;border-top:1px solid var(--line);color:var(--faint);font-size:12.5px}
  @media print{.toolbar{display:none}.card{break-inside:avoid}}
</style>
</head>
<body>
<div class="wrap">

  <h1>教学图评审报告 · ${version.toUpperCase()}</h1>
  <p class="sub">30 张课堂配图，在真实课堂上下文中生成，由外部视觉模型盲评（只看图与该轮对话，不看代码）。</p>

  <p class="note">
    判据：有用性 / 几何承载 / 可读性各 0–3 分。三个红灯——
    <b>伪视觉</b>（图只是给句子加边框，没有空间或数值上的降维增益）、
    <b>泄题</b>（学生这一轮要产出的答案被图直接画出来）、
    <b>元话</b>（图里写的是做题步骤/评语，而不是学科实体）。
  </p>

  <div class="stats">
    <div class="stat ok"><b>${cnt('keep')}</b><i>保留（keep）</i></div>
    <div class="stat fix"><b>${cnt('fix')}</b><i>要修（fix）</i></div>
    <div class="stat drop"><b>${cnt('drop')}</b><i>删掉（drop）</i></div>
    <div class="stat"><b>${mean('usefulness')}</b><i>有用均分 /3</i></div>
    <div class="stat"><b>${mean('geometry')}</b><i>几何均分 /3</i></div>
    <div class="stat"><b>${mean('readability')}</b><i>可读均分 /3</i></div>
    <div class="stat drop"><b>${pct('redundant')}%</b><i>伪视觉占比</i></div>
    <div class="stat drop"><b>${pct('leak')}%</b><i>泄题占比</i></div>
  </div>

  <h2>按图型</h2>
  <table>
    <thead><tr><th>图型</th><th>张数</th><th>保留 / 要修 / 删</th><th>伪视觉</th><th>泄题</th></tr></thead>
    <tbody>${kindRows}</tbody>
  </table>

  <h2>逐图总表</h2>
  <table>
    <thead><tr><th>#</th><th>图型</th><th>课程</th><th>判</th><th>有用/几何/可读</th><th>最该修</th></tr></thead>
    <tbody>${tableRows}</tbody>
  </table>

  <h2>逐图详情</h2>
  <div class="toolbar" id="filter">
    <button data-v="all" class="on">全部 ${rows.length}</button>
    <button data-v="fix">要修 ${cnt('fix')}</button>
    <button data-v="drop">删掉 ${cnt('drop')}</button>
    <button data-v="keep">保留 ${cnt('keep')}</button>
  </div>
  <div class="grid" id="grid">
${cards}
  </div>

  <footer>
    图片为独立 PNG 文件（images/ 目录），本页不内嵌 base64——整个文件夹可直接拷走或分享。<br>
    生成：outputs/e2e/report-html.mjs ${version} ｜ 评审模型：deepseek-v4.1-flash（温度 0）
  </footer>
</div>
<script>
  const btns = document.querySelectorAll('#filter button');
  const cards = Array.from(document.querySelectorAll('.card'));
  btns.forEach((b) => b.addEventListener('click', () => {
    btns.forEach((x) => x.classList.toggle('on', x === b));
    const v = b.dataset.v;
    cards.forEach((c) => c.classList.toggle('hide', v !== 'all' && c.dataset.verdict !== v));
  }));
</script>
</body>
</html>
`;

fs.writeFileSync(path.join(outDir, 'index.html'), html, 'utf8');

const kb = (n) => Math.round(n / 1024);
const imgTotal = fs.readdirSync(imgDir).reduce((n, f) => n + fs.statSync(path.join(imgDir, f)).size, 0);
console.log(`→ ${path.relative(ROOT, outDir)}/`);
console.log(`   index.html  ${kb(fs.statSync(path.join(outDir, 'index.html')).size)}KB`);
console.log(`   images/     ${fs.readdirSync(imgDir).length} 张，合计 ${kb(imgTotal)}KB`);
console.log(`   整个文件夹约 ${kb(fs.statSync(path.join(outDir, 'index.html')).size + imgTotal)}KB（图片是独立文件，HTML 不含 base64）`);
