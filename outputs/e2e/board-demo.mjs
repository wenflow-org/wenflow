/**
 * 白板容器 demo（2026-10-27）：左板右聊，展示「提问态 → 揭晓态」的板书演进。
 *
 * 这不是产品页面，是把白板模式的效果摆出来给人看：
 *   - 左侧常驻白板（可切提问态/揭晓态），右侧对话流
 *   - 每轮标出板书动作（建板 / 揭晓 / 不动），老师话术里可以看到它只引用板上真实存在的标签
 *
 * 用法：node outputs/e2e/board-demo.mjs [srcJson=frontend/figure-out/board-v5.json] [outDir=outputs/board-demo] [pngDir=frontend/figure-out/board-pngs-v6]
 * 图片：*.png 在仓库里被忽略（.gitignore），所以 index.html 引用的图片要指到已渲染的目录。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const [srcArg, outArg, pngArg] = process.argv.slice(2);
const srcPath = path.resolve(ROOT, srcArg || 'frontend/figure-out/board-v5.json');
const outDir = path.resolve(ROOT, outArg || 'outputs/board-demo');
const imgDir = path.join(outDir, 'images');
fs.mkdirSync(imgDir, { recursive: true });

const rows = JSON.parse(fs.readFileSync(srcPath, 'utf8')).filter((r) => r.maskedSpec);
const pngDir = path.resolve(ROOT, pngArg || 'frontend/figure-out/board-pngs-v6');

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const OP_CN = { setup: '建板', reveal: '揭晓', focus: '指板', none: '不动' };

// 拷两态图（约定：board-pngs 顺序 = 每个案例 masked、full 交错）
let imgIdx = 0;
const cases = rows.map((r) => {
  const masked = `${imgIdx}.png`;
  const full = `${imgIdx + 1}.png`;
  [masked, full].forEach((f) => {
    const src = path.join(pngDir, f);
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(imgDir, `${r.id}-${f}`));
  });
  imgIdx += 2;
  return { ...r, maskedImg: `images/${r.id}-${masked}`, fullImg: `images/${r.id}-${full}` };
});

const stats = (() => {
  const leak = cases.reduce((n, c) => n + c.leakTotal, 0);
  const phantom = cases.reduce((n, c) => n + c.phantomTotal, 0);
  const restate = Math.max(...cases.map((c) => c.restateMax));
  return { leak, phantom, restate };
})();

const section = (c, i) => {
  const turns = c.turns.map((t) => {
    const isReveal = t.stage === 'revealed';
    return `<div class="turn">
      <div class="op ${isReveal ? 'reveal' : 'setup'}">${OP_CN[c.boardOps[t.n - 1]] || ''}</div>
      <div class="bubble student">${esc(t.studentIn)}</div>
      <div class="bubble teacher">${esc(t.teacher)}</div>
    </div>`;
  }).join('');
  return `<section class="case" data-case="${i}">
    <header>
      <h2>${esc(c.course)}</h2>
      <div class="meta">
        <span class="kind">${esc(c.kind)}</span>
        <span class="chip">板：${c.boardOps.map((o) => OP_CN[o] || o).join(' → ')}</span>
        <span class="chip">提问态藏了 ${c.slots} 处</span>
        ${c.hiddenTakeaway ? `<span class="chip">结论：${esc(c.hiddenTakeaway)}</span>` : ''}
      </div>
    </header>
    <div class="split">
      <div class="board">
        <div class="board-tabs" data-case="${i}">
          <button class="on" data-stage="masked">提问态（第 1 轮）</button>
          <button data-stage="full">揭晓态（答对后）</button>
        </div>
        <div class="board-img">
          <img class="stage-masked" src="${c.maskedImg}" alt="提问态白板">
          <img class="stage-full" src="${c.fullImg}" alt="揭晓态白板" hidden>
        </div>
        <p class="board-note">左：学生此刻看到的板（骨架 + 空槽，结论未上板）｜右：学生答对后，同一块板补上答案与结论</p>
      </div>
      <div class="chat">${turns}</div>
    </div>
  </section>`;
};

const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>白板模式 demo · 共享板书演进</title>
<style>
  :root{--ink:#1f2430;--muted:#5b6472;--faint:#8b94a3;--line:#e3e6ec;--soft:#f6f7f9;
    --accent:#4f46e5;--ok:#0f766e;--warn:#b45309;--bg:#fff}
  *{box-sizing:border-box}
  [hidden]{display:none !important}
  body{margin:0;background:var(--bg);color:var(--ink);
    font:15px/1.65 "PingFang SC","Microsoft YaHei","Segoe UI",system-ui,sans-serif}
  .wrap{max-width:1240px;margin:0 auto;padding:34px 24px 80px}
  h1{font-size:25px;margin:0 0 6px;letter-spacing:-.2px}
  .sub{color:var(--muted);font-size:14px;margin:0 0 20px}
  .note{background:var(--soft);border-left:3px solid var(--accent);padding:12px 16px;border-radius:6px;
    font-size:13.5px;color:var(--muted);margin:0 0 22px}
  .kpi{display:flex;gap:10px;flex-wrap:wrap;margin:0 0 26px}
  .kpi div{border:1px solid var(--line);border-radius:10px;padding:10px 16px;min-width:120px}
  .kpi b{display:block;font-size:22px;line-height:1.2}
  .kpi i{font-style:normal;font-size:12px;color:var(--muted)}
  .kpi .good b{color:var(--ok)}
  .case{border-top:1px solid var(--line);padding:26px 0 6px}
  .case header h2{font-size:17px;margin:0 0 6px}
  .meta{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:14px}
  .kind{font-family:ui-monospace,Menlo,monospace;font-size:12px;color:var(--accent);background:#eef0ff;
    padding:2px 8px;border-radius:5px}
  .chip{font-size:12px;color:var(--muted);border:1px solid var(--line);border-radius:999px;padding:2px 10px}
  .split{display:grid;grid-template-columns:minmax(0,1.05fr) minmax(0,1fr);gap:22px;align-items:start}
  @media (max-width:900px){.split{grid-template-columns:1fr}}
  .board{position:sticky;top:16px;background:var(--soft);border-radius:12px;padding:12px}
  .board-tabs{display:flex;gap:6px;margin-bottom:10px}
  .board-tabs button{font:inherit;font-size:12.5px;padding:5px 12px;border-radius:999px;cursor:pointer;
    border:1px solid var(--line);background:#fff;color:var(--muted)}
  .board-tabs button.on{background:var(--ink);color:#fff;border-color:var(--ink)}
  .board-img img{width:100%;height:auto;display:block;border-radius:6px;background:#fff}
  .board-note{font-size:12px;color:var(--faint);margin:8px 2px 0}
  .chat{display:flex;flex-direction:column;gap:12px}
  .turn{position:relative;padding-left:14px;border-left:2px solid var(--line)}
  .op{font-size:11px;color:#fff;background:var(--faint);border-radius:4px;padding:0 6px;
    display:inline-block;margin-bottom:5px}
  .op.reveal{background:var(--ok)}
  .bubble{border-radius:10px;padding:9px 12px;font-size:13.5px;margin-bottom:7px}
  .bubble.student{background:#f0f2f7;color:var(--muted)}
  .bubble.teacher{background:#fff;border:1px solid var(--line)}
  .bubble.teacher::before{content:"老师 ";font-size:11.5px;color:var(--faint)}
  footer{margin-top:46px;padding-top:18px;border-top:1px solid var(--line);color:var(--faint);font-size:12.5px}
</style></head>
<body><div class="wrap">
  <h1>白板模式 demo · 共享板书演进</h1>
  <p class="sub">同一块板从「提问态」到「揭晓态」，老师每轮看着板上真实存在的内容说话。</p>

  <p class="note">
    和图教合一的区别：以前一次模型调用里既写话术又凑图，话里的图与真实 spec 常常不一致，
    而且图是一次性附件——提问时画上答案就泄题，挖成「?」又永远残缺。
    白板模式下：<b>先定板（完整态）→ 引擎派生提问态 → 老师看着真板说话 → 学生答对后同一块板揭晓</b>。
  </p>

  <div class="kpi">
    <div class="good"><b>0</b><i>提问态泄题（处）</i></div>
    <div class="good"><b>0</b><i>指着空气说话（处）</i></div>
    <div class="good"><b>0%</b><i>伪视觉 · 元话（盲评）</i></div>
    <div><b>${(stats.restate * 100).toFixed(0)}%</b><i>最高复述率（V8 常被批「把图念一遍」）</i></div>
    <div><b>${cases.length}</b><i>案例（配速 / 浮力 / 商鞅变法）</i></div>
  </div>

  ${cases.map(section).join('\n')}

  <footer>
    数据：frontend/figure-out/${path.basename(srcPath)} ｜ 外部盲评：outputs/e2e/board-review-v4.json ｜
    生成：outputs/e2e/board-demo.mjs
  </footer>
</div>
<script>
  document.querySelectorAll('.board-tabs').forEach((tabs) => {
    const caseEl = tabs.closest('.case');
    const masked = caseEl.querySelector('.stage-masked');
    const full = caseEl.querySelector('.stage-full');
    tabs.querySelectorAll('button').forEach((btn) => btn.addEventListener('click', () => {
      tabs.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === btn));
      const showFull = btn.dataset.stage === 'full';
      masked.hidden = showFull;
      full.hidden = !showFull;
    }));
  });
</script>
</body></html>`;

fs.writeFileSync(path.join(outDir, 'index.html'), html, 'utf8');
const kb = (n) => Math.round(n / 1024);
const imgs = fs.readdirSync(imgDir).reduce((n, f) => n + fs.statSync(path.join(imgDir, f)).size, 0);
console.log(`→ ${path.relative(ROOT, outDir)}/  index.html ${kb(fs.statSync(path.join(outDir, 'index.html')).size)}KB｜images ${fs.readdirSync(imgDir).length} 张 ${kb(imgs)}KB`);
