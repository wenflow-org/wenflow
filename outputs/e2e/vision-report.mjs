// 把外部视觉评审结果做成单文件 HTML（图片内嵌 base64，无外链）。
// 用法：node outputs/e2e/vision-report.mjs <review.json> <imagesDir> <items.json> <out.html> [title]
import fs from 'node:fs';
import path from 'node:path';
import { Buffer } from 'node:buffer';

const [reviewPath, imgDir, itemsPath, outPath, title = '外部视觉评审'] = process.argv.slice(2);
if (!reviewPath || !imgDir || !itemsPath || !outPath) {
  console.error('用法：node vision-report.mjs <review.json> <imagesDir> <items.json> <out.html> [title]');
  process.exit(1);
}

const review = JSON.parse(fs.readFileSync(reviewPath, 'utf8'));
const items = JSON.parse(fs.readFileSync(itemsPath, 'utf8'));
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const VERDICT = { keep: ['保留', '#0f766e'], fix: ['要修', '#b45309'], drop: ['删掉', '#b42318'] };

const rows = review.results
  .map((r) => {
    const v = VERDICT[r.verdict] || ['—', '#6b7280'];
    const imgFile = path.join(imgDir, `${r.i}.png`);
    const b64 = fs.existsSync(imgFile) ? fs.readFileSync(imgFile).toString('base64') : '';
    const item = items[r.i] || {};
    const kind = r.kind || item.figure?.kind || 'position-line';
    return `<section class="item">
  <header>
    <span class="badge" style="background:${v[1]}">${v[0]}</span>
    <b>#${r.i + 1} · ${esc(kind)} · ${esc(r.user || item.user || '')}</b>
    <span class="scores">有用 ${r.usefulness ?? '—'}/3 · 几何 ${r.geometry ?? '—'}/3 · 可读 ${r.readability ?? '—'}/3</span>
    <span class="flags">${r.meta ? '<i class="flag">元认知话术</i>' : ''}${r.leak ? '<i class="flag flag--red">泄题</i>' : ''}${r.redundant ? '<i class="flag">图多余</i>' : ''}</span>
  </header>
  ${b64 ? `<img alt="figure ${r.i + 1}" src="data:image/png;base64,${b64}">` : '<p class="err">（缺图）</p>'}
  <p class="line"><b>它在讲：</b>${esc(r.oneLine || r.error || '')}</p>
  <p class="issue"><b>最该修：</b>${esc(r.worstIssue || 'none')}</p>
  <details><summary>那一轮对话</summary>
    <p><b>学生：</b>${esc((item.context?.student || '').slice(0, 500))}</p>
    <p><b>老师：</b>${esc((item.context?.teacher || '').slice(0, 900))}</p>
  </details>
</section>`;
  })
  .join('\n');

const stat = (label, value) => `<div><b>${value}</b><span>${label}</span></div>`;

const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>
body{margin:0;padding:26px 18px 48px;background:#f5f6f8;color:#1f2430;font-family:"PingFang SC","Microsoft YaHei",system-ui,sans-serif;font-size:14px;line-height:1.7}
.page{max-width:980px;margin:0 auto}
h1{font-size:22px;margin:0 0 4px}
.meta{color:#6b7280;font-size:12px;margin:0 0 16px}
.kpi{display:flex;gap:10px;flex-wrap:wrap;margin:10px 0 18px}
.kpi div{flex:1 1 130px;background:#fff;border:1px solid #e3e7ef;border-radius:10px;padding:10px 12px}
.kpi b{display:block;font-size:22px}
.kpi span{font-size:12px;color:#6b7280}
.item{background:#fff;border:1px solid #e3e7ef;border-radius:12px;padding:12px 14px;margin:14px 0}
.item header{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:8px}
.badge{color:#fff;border-radius:6px;padding:1px 8px;font-size:12px}
.scores{color:#4a5568;font-size:12px}
.flags{margin-left:auto;display:flex;gap:6px}
.flag{font-style:normal;font-size:11px;border:1px solid #e3e7ef;border-radius:4px;padding:0 6px;color:#6b7280}
.flag--red{color:#b42318;border-color:#f3c7c3;background:#fdf3f2}
.item img{display:block;max-width:100%;border:1px solid #eef0f4;border-radius:8px;margin:6px 0;background:#fff}
.line{margin:6px 0}
.issue{margin:2px 0;color:#7c2d12}
.err{color:#b42318}
details{margin-top:6px;color:#4a5568;font-size:13px}
summary{cursor:pointer;color:#4f46e5}
</style></head><body><div class="page">
<h1>${esc(title)}</h1>
<p class="meta">${esc(review.label || '')} · 评审模型 ${esc(review.model || '')} · ${review.total} 张（成功 ${review.judged}） · 生成于 ${esc(review.generatedAt || '')}</p>
<div class="kpi">
  ${stat('保留', review.verdicts?.keep ?? 0)}
  ${stat('要修', review.verdicts?.fix ?? 0)}
  ${stat('删掉', review.verdicts?.drop ?? 0)}
  ${stat('平均有用度 /3', review.meanUsefulness ?? '—')}
  ${stat('平均几何承载 /3', review.meanGeometry ?? '—')}
  ${stat('泄题占比', (review.leakShare ?? 0) + '%')}
  ${stat('元认知话术占比', (review.metaShare ?? 0) + '%')}
  ${stat('图多余占比', (review.redundantShare ?? 0) + '%')}
</div>
${rows}
</div></body></html>`;

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, html, 'utf8');
console.log(`vision report: ${review.results.length} items, ${Math.round(Buffer.byteLength(html) / 1024)}KB → ${outPath}`);
