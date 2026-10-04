/** 汇总 v4-ui-audit 结果（scripts/v4-ui-audit-results/*.json）→ 控制台摘要 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = join(dirname(fileURLToPath(import.meta.url)), 'v4-ui-audit-results');
const files = readdirSync(DIR).filter((f) => f.endsWith('.json'));
const all = [];
for (const f of files) {
  const rows = JSON.parse(readFileSync(join(DIR, f), 'utf8'));
  for (const r of rows) all.push({ ...r, run: f.replace(/\.json$/, '') });
}

const byRun = {};
for (const r of all) (byRun[r.run] ||= []).push(r);

const agg = (rows, key, sub) => {
  const m = new Map();
  for (const r of rows) {
    const v = sub ? r[key] || {} : r[key];
    if (sub) for (const [k, arr] of Object.entries(v)) m.set(k, (m.get(k) || 0) + (Array.isArray(arr) ? arr.length : arr));
    else if (v) m.set(String(v), (m.get(String(v)) || 0) + 1);
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
};

for (const [run, rows] of Object.entries(byRun)) {
  console.log(`\n════════ ${run}  (${rows.length} 页) ════════`);
  const empties = rows.filter((r) => r.error || !r.bodyLen);
  if (empties.length) console.log('  空/错误页:', empties.map((e) => e.name + (e.error ? '(' + e.error.slice(0, 40) + ')' : '')).join(', '));

  const ovf = rows.filter((r) => (r.overflow?.diff || 0) > 1);
  console.log(`  横向溢出: ${ovf.length} 页 ${ovf.map((r) => r.name + '(' + r.overflow.diff + 'px)').join(' ')}`);

  const rb = agg(rows, 'radiusBad', true);
  console.log(`  圆角档外: ${rows.reduce((a, r) => a + (r.radiusBadCount || 0), 0)} 处; 值分布 ${rb.map(([v, n]) => v + '×' + n).join(' | ') || '无'}`);

  const sb = agg(rows, 'shadowBad', true);
  console.log(`  彩色阴影: ${rows.reduce((a, r) => a + (r.shadowBadCount || 0), 0)} 处; ${sb.map(([v, n]) => v.slice(0, 46) + '×' + n).join(' | ') || '无'}`);

  const bf = rows.filter((r) => r.backdropCount);
  console.log(`  backdrop-filter: ${bf.length} 页 ${bf.map((r) => r.name + '(' + r.backdropCount + ')').join(' ')}`);

  const gr = rows.filter((r) => r.gradientButtonCount);
  console.log(`  渐变主按钮: ${gr.length} 页 ${gr.map((r) => r.name).join(' ')}`);

  const hm = agg(rows, 'hoverMove', true);
  console.log(`  hover 位移: ${rows.reduce((a, r) => a + (r.hoverMoveCount || 0), 0)} 条; ${hm.map(([v, n]) => v.slice(0, 60) + '×' + n).join(' | ') || '无'}`);

  const cb = [];
  for (const r of rows) for (const c of r.contrastBad || []) cb.push({ page: r.name, ...c });
  console.log(`  对比度失败: ${cb.length} 条`);
  const cbKey = new Map();
  for (const c of cb) { const k = c.fg + '@' + c.bg + '|' + c.fs + '|' + c.el.split('.').slice(-1)[0]; cbKey.set(k, (cbKey.get(k) || 0) + 1); }
  for (const [k, n] of [...cbKey.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)) console.log(`      ${k}  ×${n}`);

  const of = agg(rows, 'offScaleFonts', true);
  console.log(`  档外文本字号: ${of.map(([v, n]) => v + '×' + n).join(' ') || '无'}`);
  const samp = {};
  for (const r of rows) for (const [sz, arr] of Object.entries(r.offScaleSamples || {})) for (const s of arr) (samp[sz] ||= new Set()).add(s.el);
  for (const [sz, set] of Object.entries(samp)) console.log(`      ${sz}: ${[...set].slice(0, 8).join(', ')}`);

  const tr = rows.filter((r) => r.tableRows?.under40);
  console.log(`  表格行高<40: ${tr.length} 页 ${tr.map((r) => r.name + '(' + r.tableRows.under40 + ')' + (r.tableRows.min ? '/' + r.tableRows.min + 'px' : '')).join(' ')}`);

  const nm = rows.filter((r) => r.numCells > 0 && r.numMono < r.numCells);
  console.log(`  数字未等宽: ${nm.length} 页 ${nm.map((r) => r.name + '(' + (r.numCells - r.numMono) + '/' + r.numCells + ')').join(' ')}`);
}