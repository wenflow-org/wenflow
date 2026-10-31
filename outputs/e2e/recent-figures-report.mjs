// 最近绘图报告：20 张图 + 课堂上下文，单文件 HTML（图内嵌 base64）。
// 用法：node outputs/e2e/recent-figures-report.mjs
import fs from 'node:fs';
import path from 'node:path';

const items = JSON.parse(fs.readFileSync('frontend/figure-out/recent-items.json', 'utf8'));
const IMG = 'frontend/figure-out/recent-img';
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// 已有外审结果按来源对上（一一对应最近一次评审的索引）
const reviews = {
  '广度扫测': { file: 'frontend/figure-out/breadth-review.json', start: 0 },
  '概念可视化': { file: 'frontend/figure-out/concept-review.json', start: 0 },
  '平抛直出': { file: 'frontend/figure-out/probe-review.json', start: 0 },
  '课堂实测': { file: 'frontend/figure-out/vis7-review.json', start: 0 },
};
const VERDICT = { keep: ['保留', '#0f766e'], fix: ['要修', '#b45309'], drop: ['删掉', '#b42318'] };
const KIND_LABEL = {
  'position-line': '位置线', grid: '网格表', matrix: '命中矩阵', compare: '对照', quadrant: '四格',
  bipartite: '二分指向', board: '棋盘', bins: '分栏', balance: '权衡', ladder: '阶梯',
  cycle: '闭环', tree: '辐射树', venn: '交集', bullseye: '靶盘', 'range-bar': '区间条',
  'cartesian-plot': '二维坐标图', 'concept-map': '概念图',
};

const srcCounts = {};
items.forEach((it) => (srcCounts[it.source] = (srcCounts[it.source] || 0) + 1));
const kindCounts = {};
items.forEach((it) => (kindCounts[it.figure?.kind || 'position-line'] = (kindCounts[it.figure?.kind || 'position-line'] || 0) + 1));

const sections = items
  .map((it, idx) => {
    const imgFile = path.join(IMG, `${idx}.png`);
    const b64 = fs.existsSync(imgFile) ? fs.readFileSync(imgFile).toString('base64') : '';
    const rev = reviews[it.source];
    let r = null;
    if (rev) {
      try {
        const data = JSON.parse(fs.readFileSync(rev.file, 'utf8'));
        r = (data.results || []).find((x) => (x.user || '').includes(it.user?.split('·')?.pop() || '###')) || null;
      } catch { /* 没有评审就只展示上下文 */ }
    }
    const v = r && VERDICT[r.verdict] ? VERDICT[r.verdict] : null;
    return `<section class="item">
  <header>
    <b>#${idx + 1} · ${esc(KIND_LABEL[it.figure?.kind] || it.figure?.kind)} · ${esc(it.user)}</b>
    <span class="src">${esc(it.source)}</span>
    ${v ? `<span class="badge" style="background:${v[1]}">${v[0]}</span>` : ''}
    ${r ? `<span class="scores">有用 ${r.usefulness ?? '—'}/3 · 几何 ${r.geometry ?? '—'}/3 · 可读 ${r.readability ?? '—'}/3</span>` : ''}
  </header>
  ${it.sourceNote ? `<p class="note">${esc(it.sourceNote)}</p>` : ''}
  ${b64 ? `<img alt="figure ${idx + 1}" src="data:image/png;base64,${b64}">` : '<p class="err">（缺图）</p>'}
  ${r?.oneLine ? `<p class="line"><b>它在讲：</b>${esc(r.oneLine)}</p>` : ''}
  ${r?.worstIssue && r.worstIssue !== 'none' ? `<p class="issue"><b>最该修：</b>${esc(r.worstIssue)}</p>` : ''}
  <details><summary>课堂上下文（那一轮对话）</summary>
    <p><b>学生：</b>${esc((it.context?.student || '（无）').slice(0, 500))}</p>
    <p><b>老师：</b>${esc((it.context?.teacher || '（无）').slice(0, 1100))}</p>
  </details>
</section>`;
  })
  .join('\n');

const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>最近绘图报告 · 20 图与课堂上下文</title>
<style>
body{margin:0;padding:26px 18px 48px;background:#f5f6f8;color:#1f2430;font-family:"PingFang SC","Microsoft YaHei",system-ui,sans-serif;font-size:14px;line-height:1.7}
.page{max-width:960px;margin:0 auto}
h1{font-size:22px;margin:0 0 4px}
.meta{color:#6b7280;font-size:12.5px;margin:0 0 14px}
.kpi{display:flex;gap:10px;flex-wrap:wrap;margin:10px 0 20px}
.kpi div{flex:1 1 150px;background:#fff;border:1px solid #e3e7ef;border-radius:10px;padding:10px 12px}
.kpi b{display:block;font-size:20px}
.kpi span{font-size:12px;color:#6b7280}
.item{background:#fff;border:1px solid #e3e7ef;border-radius:12px;padding:12px 14px;margin:14px 0}
.item header{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:6px}
.src{color:#6b7280;font-size:12px;background:#f2f4f8;border-radius:6px;padding:1px 8px}
.badge{color:#fff;border-radius:6px;padding:1px 8px;font-size:12px}
.scores{color:#4a5568;font-size:12px}
img{max-width:100%;border:1px solid #eceff5;border-radius:8px;margin:6px 0}
.line{margin:4px 0;color:#374151}
.issue{margin:4px 0;color:#b42318}
.note{margin:2px 0 6px;color:#8a93a5;font-size:12px}
.err{color:#b42318}
details{margin-top:6px;font-size:13px;color:#4a5568}
summary{cursor:pointer;color:#4f46e5}
details p{margin:6px 0}
</style></head><body><div class="page">
<h1>最近绘图报告 · 20 图与课堂上下文</h1>
<p class="meta">生成于 2026-10-26 · 图分支 feat/teaching-figures · 每张图都附「那一轮」的学生/老师原话，可展开</p>
<div class="kpi">
  <div><b>20</b><span>图（全部为模型真实产出，除 #20 为用户点名的退役基线）</span></div>
  <div><b>${srcCounts['广度扫测'] || 0}</b><span>广度扫测（数学/物理/化学/生物/地理/经济/CS/历史）</span></div>
  <div><b>${srcCounts['概念可视化'] || 0}</b><span>概念图（concept-map 新图型）</span></div>
  <div><b>${Object.entries(kindCounts).filter(([k]) => k === 'cartesian-plot').map(([, n]) => n)[0] || 0}</b><span>二维坐标图（本轮新增能力）</span></div>
</div>
<p class="meta">图型分布：${Object.entries(kindCounts).map(([k, n]) => `${esc(KIND_LABEL[k] || k)}×${n}`).join(' · ')}</p>
${sections}
<p class="meta">出图来源明细：广度探针走真实 teaching-turn 提示词 + 线上归一化；概念图走概念卡探针；平抛直出为同一提示词的独立采样；何澄一张来自新闸门下的真课；#20 为用户点名批评的退役基线，仅作对照。</p>
</div></body></html>`;

fs.writeFileSync('outputs/recent-figures-report.html', html);
console.log(`recent figures report: ${items.length} items → outputs/recent-figures-report.html (${Math.round(html.length / 1024)}KB)`);
