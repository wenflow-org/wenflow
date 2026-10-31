/**
 * 白板模式评审台（2026-10-27）：本地网页取代 PDF 做人工评审。
 *
 * 为什么不是 PDF：PDF 要先把页渲染成图才能给模型看（12 页 ≈ 1.3 万 token），
 * 人也要逐页翻；而评审真正需要的是「对着两态板勾判、写一句话、把结论交回去」。
 * 为什么不是把整页发给模型：图片走 <img src>，HTML 只有几十 KB，正文不含 base64。
 *
 * 两条通道分开：
 *   人 → 浏览器（零 token），勾完点「导出结论」，得到 ~1KB markdown 贴回来；
 *   模型 → 同一份数据生成的「简报」（~1KB，只含数字 + 判非保留的条目）。
 *
 * 用法：node outputs/e2e/board-review-app.mjs [run=outputs/e2e/board-run-v5.json] [outDir=outputs/board-review]
 * 产出：index.html（无 base64）+ images/*.png + brief.md（给模型的简报）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const [runArg, outArg] = process.argv.slice(2);
const runPath = path.resolve(ROOT, runArg || 'outputs/e2e/board-run-v5.json');
const outDir = path.resolve(ROOT, outArg || 'outputs/board-review');
const imgDir = path.join(outDir, 'images');
const pngSrc = path.join(ROOT, 'frontend/figure-out/board-pngs-v6-2x');
fs.mkdirSync(imgDir, { recursive: true });

const esc = (s) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const rows = JSON.parse(fs.readFileSync(runPath, 'utf8')).filter((r) => r.maskedSpec);

// 外部盲评两次（存在则读，用来在面板上标「机器怎么判的」）
const blind = { a: {}, b: {} };
for (const [slot, file] of [['a', 'board-review-v6.json'], ['b', 'board-review-v6b.json']]) {
  const p = path.join(ROOT, 'outputs/e2e', file);
  if (!fs.existsSync(p)) continue;
  for (const r of JSON.parse(fs.readFileSync(p, 'utf8')).results) {
    if (!r.user) continue;
    blind[slot][r.user] = r;
  }
}

const OP_CN = { setup: '建板', reveal: '揭晓', focus: '指板', none: '不动' };
let imgIdx = 0;
const cases = rows.map((r) => {
  const files = [`${imgIdx}.png`, `${imgIdx + 1}.png`];
  imgIdx += 2;
  files.forEach((f, i) => {
    const src = path.join(pngSrc, f);
    if (fs.existsSync(src)) {
      const name = `${r.id}-${i === 0 ? 'masked' : 'full'}.png`;
      fs.copyFileSync(src, path.join(imgDir, name));
    }
  });
  const blindOf = (state) => {
    const key = `${r.id}·${state}`;
    const a = blind.a[key];
    const b = blind.b[key];
    const fmt = (x) => (x && !x.error ? `${x.verdict}` : '—');
    return {
      a: fmt(a),
      b: fmt(b),
      issue: (a && !a.error && a.worstIssue) || (b && !b.error && b.worstIssue) || '',
    };
  };
  return {
    id: r.id,
    course: r.course,
    kind: r.kind,
    taskTitle: r.taskTitle || '',
    slots: r.slots,
    ops: (r.boardOps || []).map((o) => OP_CN[o] || o),
    maskedImg: `images/${r.id}-masked.png`,
    fullImg: `images/${r.id}-full.png`,
    turns: r.turns.map((t) => ({
      n: t.n,
      state: t.stage === 'revealed' ? '揭晓态' : '提问态',
      teacher: t.teacher,
      leak: t.audit.leakHits.length,
      phantom: t.audit.phantomRefs.length,
      restate: t.audit.restateRatio,
    })),
    blind: { masked: blindOf('提问态'), full: blindOf('揭晓态') },
  };
});

const totals = {
  leak: rows.flatMap((r) => r.turns.filter((t) => t.stage !== 'revealed')).reduce((n, t) => n + t.audit.leakHits.length, 0),
  phantom: rows.reduce((n, r) => n + r.phantomTotal, 0),
  restate: Math.max(...rows.map((r) => r.restateMax)),
};

// ---------- 给模型的简报（~1KB）：只给数字 + 判非保留的条目 ----------
const briefLines = [
  '# 白板模式评审简报（给模型）',
  '',
  `- 样本：${cases.length} 案例 × 3 轮（每轮先定板再说话）`,
  `- 确定性审计：提问态泄题 ${totals.leak} 处｜指着空气 ${totals.phantom} 处｜复述率最高 ${totals.restate}`,
  '- 外部盲评两次（同输入）：0/0/6 与 0/2/4（保留/要修/删掉）｜泄题 33%/17%｜伪视觉 67%/50%',
  '',
  '## 机器判「要修/删掉」的条目',
];
let flagged = 0;
for (const c of cases) {
  for (const [state, key] of [[c.blind.masked, 'masked'], [c.blind.full, 'full']]) {
    const verdicts = [state.a, state.b];
    if (verdicts.every((v) => v === 'keep' || v === '—')) continue;
    flagged += 1;
    briefLines.push(`- ${c.course} · ${key === 'masked' ? '提问态' : '揭晓态'}（${c.kind}）→ ${verdicts.join(' / ')}：${state.issue}`);
  }
}
if (!flagged) briefLines.push('- 无');
briefLines.push('', '## 需要你决定', '1. 哪些条目真的该改？改图还是改提示词？', '2. 内容层问题里，哪些属于知识校验层而不是白板范式？');
const brief = briefLines.join('\n');
fs.writeFileSync(path.join(outDir, 'brief.md'), brief, 'utf8');

// ---------- 页面 ----------
const DATA = JSON.stringify({ cases, totals, brief });

// 页面脚本用字符串拼接写（避免与外层模板字面量互相转义）
const PAGE_JS = `
(function () {
  var D = window.__BOARD_DATA__;
  var KEY = 'board-review-v6';
  var saved = {};
  try { saved = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { saved = {}; }
  var VERDICTS = [['keep', '保留'], ['fix', '要修'], ['drop', '删掉']];

  function persist() { localStorage.setItem(KEY, JSON.stringify(saved)); }

  function stateOf(item) {
    return saved[item] || { verdict: '', note: '' };
  }

  function paint(item, root) {
    var s = stateOf(item);
    var btns = root.querySelectorAll('[data-verdict]');
    for (var i = 0; i < btns.length; i++) {
      var on = btns[i].getAttribute('data-verdict') === s.verdict;
      btns[i].className = 'vbtn' + (on ? ' on-' + s.verdict : '');
    }
    var note = root.querySelector('[data-note]');
    if (note && note.value !== s.note) note.value = s.note;
    var tag = root.querySelector('[data-mytag]');
    if (tag) {
      tag.textContent = s.verdict ? ('你的判定：' + (s.verdict === 'keep' ? '保留' : s.verdict === 'fix' ? '要修' : '删掉')) : '未评';
      tag.className = 'mytag' + (s.verdict ? ' on' : '');
    }
  }

  function refreshProgress() {
    var n = 0;
    var keys = Object.keys(saved);
    for (var i = 0; i < keys.length; i++) if (saved[keys[i]].verdict) n++;
    var total = D.cases.length * 2;
    document.getElementById('progress').textContent = '已评 ' + n + ' / ' + total;
    document.getElementById('exportBtn').disabled = n === 0;
    document.getElementById('copyBtn').disabled = n === 0;
  }

  function bindItem(root, item) {
    var btns = root.querySelectorAll('[data-verdict]');
    for (var i = 0; i < btns.length; i++) {
      btns[i].addEventListener('click', function (e) {
        var v = e.currentTarget.getAttribute('data-verdict');
        var cur = stateOf(item);
        cur.verdict = cur.verdict === v ? '' : v;
        saved[item] = cur;
        persist(); paint(item, root); refreshProgress();
      });
    }
    var note = root.querySelector('[data-note]');
    if (note) {
      note.addEventListener('input', function () {
        var cur = stateOf(item);
        cur.note = note.value;
        saved[item] = cur;
        persist(); refreshProgress();
      });
    }
  }

  function buildExport() {
    var lines = [];
    var cnt = { keep: 0, fix: 0, drop: 0 };
    var judged = 0;
    lines.push('# 白板模式评审结论（人工）');
    lines.push('');
    for (var ci = 0; ci < D.cases.length; ci++) {
      var c = D.cases[ci];
      var parts = [];
      for (var si = 0; si < 2; si++) {
        var state = si === 0 ? 'masked' : 'full';
        var item = c.id + '·' + state;
        var s = stateOf(item);
        if (!s.verdict) continue;
        judged++; cnt[s.verdict]++;
        parts.push('  - ' + (state === 'masked' ? '提问态' : '揭晓态') + ' → ' + (s.verdict === 'keep' ? '保留' : s.verdict === 'fix' ? '要修' : '删掉') + (s.note ? '：' + s.note : ''));
      }
      if (parts.length) { lines.push('- ' + c.course + '（' + c.kind + '）'); lines = lines.concat(parts); }
    }
    lines.splice(2, 0, '已评 ' + judged + ' / ' + (D.cases.length * 2) + '｜保留 ' + cnt.keep + ' / 要修 ' + cnt.fix + ' / 删掉 ' + cnt.drop);
    if (!judged) lines.push('- （未评）');
    return lines.join('\\n');
  }
  // 导出文本挂到 window 上：浏览器里能直接核对导出内容，自动化也能断言
  window.__buildExport = buildExport;

  function download(text, name) {
    var blob = new Blob([text], { type: 'text/markdown;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name; a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
  }

  function flash(msg) {
    var el = document.getElementById('toast');
    el.textContent = msg; el.classList.add('show');
    setTimeout(function () { el.classList.remove('show'); }, 1600);
  }

  // 两态切换
  var mode = 'both';
  document.querySelectorAll('[data-mode]').forEach(function (b) {
    b.addEventListener('click', function () {
      mode = b.getAttribute('data-mode');
      document.querySelectorAll('[data-mode]').forEach(function (x) { x.classList.toggle('on', x === b); });
      var boards = document.querySelectorAll('.boards');
      for (var i = 0; i < boards.length; i++) {
        boards[i].className = 'boards mode-' + mode;
      }
      var figs = document.querySelectorAll('.board-figure');
      for (var j = 0; j < figs.length; j++) {
        var st = figs[j].getAttribute('data-state');
        figs[j].hidden = (mode === 'masked' && st === 'full') || (mode === 'full' && st === 'masked');
      }
    });
  });

  // 绑定每个条目
  document.querySelectorAll('.item').forEach(function (root) {
    var item = root.getAttribute('data-item');
    bindItem(root, item);
    paint(item, root);
  });
  refreshProgress();

  document.getElementById('exportBtn').addEventListener('click', function () {
    download(buildExport(), 'board-review-result.md'); flash('已导出 board-review-result.md');
  });
  document.getElementById('copyBtn').addEventListener('click', function () {
    var text = buildExport() + '\\n\\n' + D.brief;
    navigator.clipboard.writeText(text).then(function () { flash('已复制（结论 + 机器简报）'); },
      function () { flash('复制失败，请用导出'); });
  });
})();
`;

const card = (c) => {
  const blindLine = (b, label) => {
    const same = b.a === b.b ? b.a : `${b.a} / ${b.b}`;
    const cls = same.includes('drop') ? 'bad' : same.includes('fix') ? 'warn' : same === 'keep' ? 'ok' : '';
    return `<span class="blind ${cls}">盲评·${label}：${esc(same)}</span>`;
  };
  const turns = c.turns
    .map(
      (t) => `<div class="turn">
        <div class="turn-head">第 ${t.n} 轮 · ${t.state}
          <span class="badge ${t.leak || t.phantom ? 'warn' : ''}">泄题 ${t.leak} · 指空 ${t.phantom} · 复述 ${t.restate}</span></div>
        <div class="turn-body">${esc(t.teacher)}</div>
      </div>`,
    )
    .join('');
  const reviewBlock = (state, label, blind) => `<div class="item" data-item="${esc(c.id)}·${state}">
      <div class="item-head">
        <b>${label}</b>
        ${blindLine(blind, label)}
        <span class="mytag" data-mytag>未评</span>
        <span class="spacer"></span>
        <button class="vbtn" data-verdict="keep">保留</button>
        <button class="vbtn" data-verdict="fix">要修</button>
        <button class="vbtn" data-verdict="drop">删掉</button>
      </div>
      <input class="note" data-note placeholder="一句话：最该修的是哪里（可留空）">
      <div class="issue">${esc(blind.issue)}</div>
    </div>`;
  return `<section class="case">
    <header>
      <h2>${esc(c.course)}</h2>
      <span class="kind">${esc(c.kind)}</span>
      <span class="metaLine">任务：${esc(c.taskTitle)} ｜ 空槽 ${c.slots} ｜ ${esc(c.ops.join('→'))}</span>
    </header>
    <div class="boards mode-both">
      <figure class="board-figure" data-state="masked"><img src="${c.maskedImg}" alt="提问态"><figcaption>提问态（学生此刻看到的板）</figcaption></figure>
      <figure class="board-figure" data-state="full"><img src="${c.fullImg}" alt="揭晓态"><figcaption>揭晓态（答对后同一块板）</figcaption></figure>
    </div>
    ${reviewBlock('masked', '提问态', c.blind.masked)}
    ${reviewBlock('full', '揭晓态', c.blind.full)}
    <div class="turns">${turns}</div>
  </section>`;
};

const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>白板模式评审台 · v6</title>
<style>
  :root{--ink:#1f2430;--muted:#5b6472;--faint:#8b94a3;--line:#e3e6ec;--soft:#f6f7f9;
    --accent:#4f46e5;--ok:#0f766e;--warn:#b45309;--bad:#b42318}
  *{box-sizing:border-box}
  body{margin:0;background:#fbfbfd;color:var(--ink);
    font:15px/1.7 "PingFang SC","Microsoft YaHei","Segoe UI",system-ui,sans-serif}
  .wrap{max-width:1180px;margin:0 auto;padding:26px 22px 96px}
  h1{font-size:23px;margin:0 0 4px}
  .sub{color:var(--muted);font-size:13.5px;margin:0 0 16px}
  .kpis{display:flex;gap:10px;flex-wrap:wrap;margin:0 0 10px}
  .kpi{background:#fff;border:1px solid var(--line);border-radius:10px;padding:9px 13px;min-width:132px}
  .kpi b{display:block;font-size:21px;line-height:1.25}
  .kpi i{font-style:normal;font-size:11.5px;color:var(--muted)}
  .toolbar{position:sticky;top:0;z-index:9;display:flex;gap:8px;align-items:center;
    background:rgba(251,251,253,.94);backdrop-filter:blur(6px);padding:10px 0;border-bottom:1px solid var(--line);margin-bottom:14px}
  .toolbar .seg{display:flex;border:1px solid var(--line);border-radius:8px;overflow:hidden;background:#fff}
  .toolbar .seg button{border:0;background:transparent;padding:5px 11px;font:inherit;font-size:13px;color:var(--muted);cursor:pointer}
  .toolbar .seg button.on{background:var(--accent);color:#fff}
  .toolbar .spacer{flex:1}
  .toolbar .primary,.toolbar .ghost{border-radius:8px;padding:6px 13px;font:inherit;font-size:13px;cursor:pointer;border:1px solid var(--line);background:#fff}
  .toolbar .primary{background:var(--accent);border-color:var(--accent);color:#fff}
  .toolbar button:disabled{opacity:.45;cursor:default}
  #progress{font-size:12.5px;color:var(--muted)}
  .case{background:#fff;border:1px solid var(--line);border-radius:14px;padding:16px 18px 12px;margin:0 0 16px}
  .case header{display:flex;align-items:baseline;gap:9px;flex-wrap:wrap;margin-bottom:10px}
  .case h2{margin:0;font-size:17px;border:0;padding:0}
  .kind{font-family:ui-monospace,Menlo,monospace;font-size:11.5px;color:var(--accent);background:#eef0ff;padding:1px 6px;border-radius:5px}
  .metaLine{font-size:12px;color:var(--muted)}
  .boards{display:grid;gap:12px;margin:2px 0 10px}
  .boards.mode-both{grid-template-columns:1fr 1fr}
  .boards.mode-masked,.boards.mode-full{grid-template-columns:1fr}
  .board-figure{margin:0}
  .board-figure img{width:100%;display:block;border:1px solid #eef0f4;border-radius:9px;background:#fff}
  .board-figure figcaption{font-size:11.5px;color:var(--muted);text-align:center;margin-top:4px}
  .item{border:1px dashed var(--line);border-radius:10px;padding:8px 11px;margin:7px 0;background:#fcfcfe}
  .item-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
  .item-head b{font-size:13.5px}
  .spacer{flex:1}
  .blind{font-size:11.5px;padding:1px 7px;border-radius:999px;border:1px solid var(--line);color:var(--muted);background:#fff}
  .blind.bad{border-color:#f3c6c2;color:var(--bad);background:#fdf3f2}
  .blind.warn{border-color:#f0d3ac;color:var(--warn);background:#fdf7ee}
  .blind.ok{border-color:#bfe3dd;color:var(--ok);background:#f1f9f7}
  .mytag{font-size:11.5px;color:var(--faint)}
  .mytag.on{color:var(--accent);font-weight:600}
  .vbtn{border:1px solid var(--line);background:#fff;border-radius:7px;padding:3px 10px;font:inherit;font-size:12.5px;cursor:pointer;color:var(--muted)}
  .vbtn:hover{border-color:#cdd3e0}
  .vbtn.on-keep{background:#e8f5f2;border-color:#9fd3c9;color:var(--ok);font-weight:600}
  .vbtn.on-fix{background:#fdf1e3;border-color:#e8c79a;color:var(--warn);font-weight:600}
  .vbtn.on-drop{background:#fdeceb;border-color:#efb5b0;color:var(--bad);font-weight:600}
  .note{width:100%;margin-top:6px;border:1px solid var(--line);border-radius:7px;padding:6px 9px;font:inherit;font-size:12.5px;background:#fff}
  .note:focus{outline:2px solid #dcd9fb;border-color:#c7c2f7}
  .issue{font-size:11.5px;color:var(--faint);margin-top:5px;line-height:1.55}
  .issue:empty{display:none}
  .turns{margin-top:10px;border-top:1px solid #f0f2f6;padding-top:9px}
  .turn{margin:0 0 9px}
  .turn-head{font-size:11.5px;color:var(--faint);display:flex;gap:8px;align-items:center;margin-bottom:2px}
  .badge{font-size:11px;padding:0 6px;border-radius:999px;background:#eef7f5;color:var(--ok)}
  .badge.warn{background:#fdf1e3;color:var(--warn)}
  .turn-body{font-size:13px;color:#2a3040;background:var(--soft);border-radius:8px;padding:7px 10px;white-space:pre-wrap}
  #toast{position:fixed;left:50%;bottom:26px;transform:translateX(-50%) translateY(10px);opacity:0;
    background:#1f2430;color:#fff;font-size:13px;padding:8px 16px;border-radius:999px;transition:.18s;pointer-events:none}
  #toast.show{opacity:1;transform:translateX(-50%) translateY(0)}
  @media (max-width:860px){.boards.mode-both{grid-template-columns:1fr}}
</style></head>
<body><div class="wrap">
  <h1>白板模式评审台</h1>
  <p class="sub">对着两态板勾判 + 写一句话 → 导出结论（约 1KB）。页面本身不含 base64，图片是独立文件，所以贴给模型也不会膨胀。</p>
  <div class="kpis">
    <div class="kpi"><b>${totals.leak}</b><i>提问态泄题（确定性）</i></div>
    <div class="kpi"><b>${totals.phantom}</b><i>指着空气（确定性）</i></div>
    <div class="kpi"><b>${totals.restate}</b><i>复述率最高</i></div>
    <div class="kpi"><b>0/0/6 · 0/2/4</b><i>盲评两次（保留/要修/删掉）</i></div>
  </div>
  <div class="toolbar">
    <div class="seg">
      <button data-mode="both" class="on">两态并排</button>
      <button data-mode="masked">只看提问态</button>
      <button data-mode="full">只看揭晓态</button>
    </div>
    <span class="spacer"></span>
    <span id="progress">已评 0 / ${cases.length * 2}</span>
    <button class="ghost" id="copyBtn" disabled>复制（结论+简报）</button>
    <button class="primary" id="exportBtn" disabled>导出结论</button>
  </div>
  ${cases.map(card).join('')}
</div>
<div id="toast"></div>
<script>window.__BOARD_DATA__ = ${DATA};</script>
<script>${PAGE_JS}</script>
</body></html>`;

fs.writeFileSync(path.join(outDir, 'index.html'), html, 'utf8');
const kb = (n) => Math.round(n / 1024);
console.log(`index.html ${kb(Buffer.byteLength(html))}KB（无 base64）｜images ${cases.length * 2} 张｜brief.md ${kb(Buffer.byteLength(brief))}KB`);
console.log(`→ ${outDir}`);
