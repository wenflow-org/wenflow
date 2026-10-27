/**
 * 「同一堂课、三种板」对照页（2026-10-27）：把范式改动摆在一页上，人肉评审用。
 *
 * 三列：
 *   旧口径（做题区）  v6 的提问态：答案位挖成 ?，副标注撤掉
 *   新口径（减负区）  none：材料、步骤、副标注、结论全在板上，0 个 ?
 *   换题后            update：老师换了数据，同结构的板换成新数字
 *
 * 页面不含 base64（图片是独立文件）；给模型的简报另出一份 brief.md。
 *
 * 用法：node outputs/e2e/board-compare.mjs [outDir=outputs/board-compare]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const outDir = path.resolve(ROOT, process.argv[2] || 'outputs/board-compare');
const imgDir = path.join(outDir, 'images');
fs.mkdirSync(imgDir, { recursive: true });

const esc = (s) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const oldPng = path.join(ROOT, 'frontend/figure-out/board-pngs-v6-2x');
const newPng = path.join(ROOT, 'frontend/figure-out/board-turn-all-pngs-2x');
const run = JSON.parse(fs.readFileSync(path.join(ROOT, 'frontend/figure-out/board-show2.json'), 'utf8'));
const oldReview = JSON.parse(fs.readFileSync(path.join(ROOT, 'outputs/e2e/board-review-v6.json'), 'utf8')).results;
const oldReviewB = JSON.parse(fs.readFileSync(path.join(ROOT, 'outputs/e2e/board-review-v6b.json'), 'utf8')).results;
const newReview = JSON.parse(fs.readFileSync(path.join(ROOT, 'outputs/e2e/board-review-load.json'), 'utf8')).results;

const copy = (src, name) => {
  const dst = path.join(imgDir, name);
  if (fs.existsSync(src)) fs.copyFileSync(src, dst);
  return `images/${name}`;
};

// 旧口径图：v6 的两态按案例交错（0/1 = b1 masked/full，2/3 = b2，4/5 = b3）
const oldIdx = { 'b1-math-pace': 0, 'b2-phys-buoyancy': 2, 'b3-hist-shangyang': 4 };
// 新口径图：逐轮 9 张，顺序 = 案例 × 3 轮
const newIdx = { 'b1-math-pace': 0, 'b2-phys-buoyancy': 3, 'b3-hist-shangyang': 6 };

const verdictCN = { keep: '保留', fix: '要修', drop: '删掉' };
const oldVerdict = (name) => {
  const a = oldReview.find((r) => r.user === name);
  const b = oldReviewB.find((r) => r.user === name);
  const f = (x) => (x && !x.error ? verdictCN[x.verdict] || x.verdict : '未判');
  return `${f(a)} / ${f(b)}`;
};
const newVerdict = (name) => {
  const r = newReview.find((x) => x.user === name);
  return r && !r.error ? verdictCN[r.verdict] || r.verdict : '未判';
};

const cases = run.map((r, i) => {
  const label = r.course;
  const oldImg = copy(path.join(oldPng, `${oldIdx[r.id]}.png`), `${r.id}-old.png`);
  const newImg = copy(path.join(newPng, `${newIdx[r.id]}.png`), `${r.id}-new.png`);
  // 配速这张：第 3 轮的板是「换题后」的板（800 m / 60 s），单独一列
  const updated = r.turns.find((t) => t.boardOp === 'update');
  const updImg = updated ? copy(path.join(newPng, `${newIdx[r.id] + updated.n - 1}.png`), `${r.id}-updated.png`) : null;
  return {
    id: r.id,
    course: label,
    kind: r.kind,
    ops: r.boardOps.join(' → '),
    oldImg,
    newImg,
    updImg,
    oldJudge: oldVerdict(`${r.id}·提问态`),
    newJudge: newVerdict(`${r.id}·第1轮`),
    updJudge: updated ? newVerdict(`${r.id}·第${updated.n}轮`) : '',
    q1: r.turns[0].teacher,
    qUpd: updated ? updated.teacher : '',
    oldIssue: (oldReview.find((x) => x.user === `${r.id}·提问态`) || {}).worstIssue || '',
    newIssue: (newReview.find((x) => x.user === `${r.id}·第1轮`) || {}).worstIssue || '',
  };
});

const card = (c) => `<section class="case">
  <header>
    <h2>${esc(c.course)}</h2><span class="kind">${esc(c.kind)}</span>
    <span class="meta">板书动作：${esc(c.ops)}</span>
  </header>
  <div class="cols${c.updImg ? ' three' : ''}">
    <figure>
      <figcaption><span class="tag old">旧：做题区</span>${esc(c.oldJudge)}</figcaption>
      <img src="${c.oldImg}" alt="旧口径">
      <p class="issue">${esc(c.oldIssue)}</p>
    </figure>
    <figure>
      <figcaption><span class="tag new">新：减负区（0 问号）</span>${esc(c.newJudge)}</figcaption>
      <img src="${c.newImg}" alt="新口径">
      <p class="issue">${esc(c.newIssue)}</p>
    </figure>
    ${c.updImg ? `<figure>
      <figcaption><span class="tag upd">换题后</span>${esc(c.updJudge)}</figcaption>
      <img src="${c.updImg}" alt="换题后的板">
      <p class="issue">老师换了数据，同一块板换成新数字——学生不用再记「现在讨论的是哪组数」。</p>
    </figure>` : ''}
  </div>
  <div class="talk"><b>新口径下老师这一轮说的话</b>${esc(c.q1)}</div>
</section>`;

const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>白板口径对照：做题区 vs 减负区</title>
<style>
  :root{--ink:#1f2430;--muted:#5b6472;--faint:#8b94a3;--line:#e3e6ec;--soft:#f6f7f9;--accent:#4f46e5;--ok:#0f766e;--warn:#b45309;--bad:#b42318}
  *{box-sizing:border-box}
  body{margin:0;background:#fbfbfd;color:var(--ink);font:15px/1.7 "PingFang SC","Microsoft YaHei","Segoe UI",system-ui,sans-serif}
  .wrap{max-width:1320px;margin:0 auto;padding:26px 22px 60px}
  h1{font-size:23px;margin:0 0 6px}
  .sub{color:var(--muted);font-size:13.5px;margin:0 0 14px}
  .kpis{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:16px}
  .kpi{background:#fff;border:1px solid var(--line);border-radius:10px;padding:9px 13px;min-width:150px}
  .kpi b{display:block;font-size:20px;line-height:1.25}
  .kpi i{font-style:normal;font-size:11.5px;color:var(--muted)}
  .case{background:#fff;border:1px solid var(--line);border-radius:14px;padding:15px 17px 13px;margin:0 0 16px}
  .case header{display:flex;align-items:baseline;gap:9px;flex-wrap:wrap;margin-bottom:10px}
  .case h2{margin:0;font-size:16.5px}
  .kind{font-family:ui-monospace,Menlo,monospace;font-size:11.5px;color:var(--accent);background:#eef0ff;padding:1px 6px;border-radius:5px}
  .meta{font-size:12px;color:var(--muted)}
  .cols{display:grid;gap:12px;grid-template-columns:1fr 1fr}
  .cols.three{grid-template-columns:1fr 1fr 1fr}
  .cols figure{margin:0}
  .cols img{width:100%;display:block;border:1px solid #eef0f4;border-radius:9px;background:#fff}
  .cols figcaption{font-size:12px;color:var(--muted);margin-bottom:5px;display:flex;gap:7px;align-items:center}
  .tag{font-size:11px;padding:1px 7px;border-radius:999px;color:#fff;background:var(--faint)}
  .tag.old{background:#9a3412}.tag.new{background:var(--ok)}.tag.upd{background:var(--accent)}
  .issue{font-size:11.5px;color:var(--faint);margin:5px 0 0;line-height:1.55}
  .issue:empty{display:none}
  .talk{margin-top:10px;border-top:1px solid #f0f2f6;padding-top:8px;font-size:13px;color:#2a3040;white-space:pre-wrap}
  .talk b{display:block;font-size:11px;color:var(--faint);font-weight:600;margin-bottom:3px}
  .note{background:#fff;border:1px solid var(--line);border-radius:12px;padding:13px 16px;font-size:13px}
  .note h3{margin:0 0 6px;font-size:14px}
  .note ul{margin:6px 0 0 18px;padding:0}
  .note li{margin:3px 0}
  @media (max-width:1000px){.cols,.cols.three{grid-template-columns:1fr}}
</style></head><body><div class="wrap">
  <h1>白板口径对照：做题区 → 减负区</h1>
  <p class="sub">同一堂课、同一份板面数据，只改「藏什么」：旧口径把答案位挖成问号；新口径把材料、步骤、副标注全部摆出来，0 个问号。</p>
  <div class="kpis">
    <div class="kpi"><b>0 / 0</b><i>提问轮泄题（旧 / 新，确定性）</i></div>
    <div class="kpi"><b>0%</b><i>板面问号占比（9/9 张为 0）</i></div>
    <div class="kpi"><b>2.78 / 2.56</b><i>盲评：减负度 / 自明性（旧 1.0 / 1.17）</i></div>
    <div class="kpi"><b>6 / 3 / 0</b><i>盲评保留 / 要修 / 删掉（旧 0/0/6、0/2/4）</i></div>
  </div>
  ${cases.map(card).join('')}
  <div class="note">
    <h3>这套改动落地后，管线里发生了什么</h3>
    <ul>
      <li><b>maskFigureAnswers 不再是默认</b>：三种口径 <code>none / takeaway / full</code>，默认走减负；挖空保留给「检索练习」场景。</li>
      <li><b>stripSecondaryAnnotations 只在 full 口径用</b>：副标注（单位、俗称、简短解释）本来就是降负荷的，不该被撤。</li>
      <li><b>新增 update 动作</b>：老师换例子/条件时，同一结构的板换成新数据；判据是「话里出现了板上没有的数字」。</li>
      <li><b>老师话术改成禁止复述</b>：boardContext 结尾从「X 个空槽待学生补」改为「板面已完整，严禁用文字复述，直接引用标签，一次 2~3 句」。</li>
      <li><b>标题不许写结论</b>：商鞅板标题从「先取信，再分两步推开」改成点题式后，两次盲评都不再判泄题。</li>
    </ul>
  </div>
</div></body></html>`;

fs.writeFileSync(path.join(outDir, 'index.html'), html, 'utf8');
const brief = [
  '# 白板口径对照（给模型）',
  '',
  '- 改动：白板从「做题区（挖空）」改为「减负区（0 问号，材料/步骤/副标注全上板）」',
  '- 确定性：提问轮泄题 0 处（两口径相同）；新口径 9/9 张板 0 个问号',
  '- 盲评（load 判据，n=9）：减负度 2.78/3、自明性 2.56/3、保留 6 / 要修 3 / 删掉 0',
  '- 旧口径（leak 判据，n=6 两次）：保留 0、要修 0~2、删掉 4~6；有用 0.83~1.0、几何 0.83~1.17',
  '- 动作：setup →（换例子时）update → none；老师话术禁止复述板面',
  '',
  '## 仍未修好的三处',
  cases.filter((c) => c.newIssue).map((c) => `- ${c.course}：${c.newIssue}`).join('\n'),
].join('\n');
fs.writeFileSync(path.join(outDir, 'brief.md'), brief, 'utf8');

const kb = (n) => Math.round(n / 1024);
console.log(`index.html ${kb(Buffer.byteLength(html))}KB（无 base64）｜images ${cases.length * 2 + cases.filter((c) => c.updImg).length} 张｜brief.md ${kb(Buffer.byteLength(brief))}KB`);
console.log(`→ ${outDir}`);
