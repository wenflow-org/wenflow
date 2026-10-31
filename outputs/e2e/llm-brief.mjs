/**
 * 单文件评审简报：一个 .md，直接复制/上传给 LLM。
 *
 * 与 llm-pack.mjs 的分工：
 *   - llm-pack：拼版 PNG + 清单 + JSON（要图时用，多文件）
 *   - 本脚本：**一个** markdown 文件，文字信息全在里面（判词/病灶/该轮对话/spec 摘要），
 *     可选 --inline 把拼版图以 base64 内嵌，真正只剩一个文件（token 会涨，见文件尾实测）。
 *
 * 用法：
 *   node outputs/e2e/llm-brief.mjs v8                       → 纯文本单文件（推荐，最省）
 *   node outputs/e2e/llm-brief.mjs v8 --inline              → 单文件内嵌图（体积大，仅当必须单文件）
 *   node outputs/e2e/llm-brief.mjs v8 --only=fix,drop       → 只含问题图
 *   node outputs/e2e/llm-brief.mjs v8 --compact             → 精简版（spec/原话截短）
 *   node outputs/e2e/llm-brief.mjs v8 --table               → 最省：只有汇总+逐图表，不展开详情块
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = process.argv.slice(2);
const version = args.find((a) => !a.startsWith('--'));
if (!version) throw new Error('用法: llm-brief.mjs <version> [--inline] [--only=fix,drop]');
const inline = args.includes('--inline');
const compact = args.includes('--compact');
const tableOnly = args.includes('--table');
const onlyArg = (args.find((a) => a.startsWith('--only=')) || '').split('=')[1];
const onlySet = onlyArg ? new Set(onlyArg.split(',').map((s) => s.trim()).filter(Boolean)) : null;

const review = JSON.parse(fs.readFileSync(path.join(ROOT, 'outputs/e2e', `${version}-review.json`), 'utf8'));
const items = JSON.parse(fs.readFileSync(path.join(ROOT, 'frontend/figure-out', `${version}-final-items.json`), 'utf8'));
const pngDir = path.join(ROOT, 'frontend/figure-out', `${version}-pngs`);
const suffix = `${tableOnly ? '-table' : compact ? '-compact' : ''}${inline ? '-withfigs' : ''}`;
const outFile = path.join(ROOT, 'outputs', `${version.toUpperCase()}-review-brief${suffix}.md`);

const rows = review.results.filter((r) => {
  if (!onlySet) return true;
  return onlySet.has(r.error ? 'error' : r.verdict);
});

const judged = review.results.filter((r) => !r.error);
const cnt = (v) => judged.filter((r) => r.verdict === v).length;
const mean = (k) => (judged.reduce((n, r) => n + (Number(r[k]) || 0), 0) / judged.length).toFixed(2);
const pct = (k) => `${Math.round((judged.filter((r) => r[k] === true).length / judged.length) * 100)}%`;

const VERDICT = { keep: '保留', fix: '要修', drop: '删掉' };
const kindOf = (r) => r.kind || items[r.i]?.figure?.kind || '?';
const itOf = (r) => items[r.i] || {};

// 按图型汇总
const byKind = {};
for (const r of judged) {
  const k = kindOf(r);
  byKind[k] = byKind[k] || { n: 0, keep: 0, fix: 0, drop: 0, redundant: 0, leak: 0 };
  byKind[k].n += 1;
  byKind[k][r.verdict] = (byKind[k][r.verdict] || 0) + 1;
  if (r.redundant) byKind[k].redundant += 1;
  if (r.leak) byKind[k].leak += 1;
}

const clip = (s, n) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
};

const section = (title, list) => {
  if (!list.length) return [`## ${title}`, '', '（无）', ''];
  const out = [`## ${title}（${list.length} 张）`, ''];
  for (const r of list) {
    const it = itOf(r);
    const spec = it.figure?.spec ? JSON.stringify(it.figure.spec) : '';
    out.push(`### #${r.i + 1} · ${kindOf(r)} · ${it.course || ''}`);
    out.push(`- 判：**${VERDICT[r.verdict] || r.error}**｜有用 ${r.usefulness ?? '—'}/3 · 几何 ${r.geometry ?? '—'}/3 · 可读 ${r.readability ?? '—'}/3｜伪视觉 ${r.redundant ? '是' : '否'} · 泄题 ${r.leak ? '是' : '否'} · 元话 ${r.meta ? '是' : '否'}`);
    if (r.oneLine) out.push(`- 图在讲：${clip(r.oneLine, 160)}`);
    if (r.worstIssue && r.worstIssue !== 'none') out.push(`- 最该修：${clip(r.worstIssue, 260)}`);
    const teacherCap = compact ? 90 : 260;
    const specCap = compact ? 90 : 300;
    if (it.context?.teacher) out.push(`- 该轮老师原话：「${clip(it.context.teacher, teacherCap)}」`);
    if (spec) out.push(`- spec 摘要：\`${clip(spec, specCap)}\``);
    out.push('');
  }
  return out;
};

// --inline：把 5 张拼版以 base64 内嵌（只有必须单文件时才用）
let inlineBlock = [];
if (inline) {
  const packDir = path.join(ROOT, 'outputs', `llm-inline-${version}`);
  fs.mkdirSync(packDir, { recursive: true });
  const r = spawnSync(process.execPath, [path.join(ROOT, 'outputs/e2e/llm-pack.mjs'), version, path.relative(ROOT, packDir)], { encoding: 'utf8' });
  const sheets = fs.readdirSync(packDir).filter((f) => f.startsWith('figures-sheet-')).sort();
  inlineBlock = ['## 图（拼版，每格左上角 #序号 对应上面的编号）', ''];
  for (const s of sheets) {
    const b64 = fs.readFileSync(path.join(packDir, s)).toString('base64');
    inlineBlock.push(`### ${s}`, '', `![${s}](data:image/png;base64,${b64})`, '');
  }
  if (!sheets.length) inlineBlock.push(`（拼版生成失败：${clip(r.stderr, 200)}）`, '');
}

const md = [
  `# 教学图评审简报 · ${version.toUpperCase()}`,
  '',
  '这是一份教学课堂「配图」质量评审结果，供你做改造决策。每张图都在真实课堂上下文里生成，',
  '由外部视觉模型按固定判据盲评（只看图和该轮对话，不看代码）。',
  '',
  '**判据**：有用性/几何承载/可读性各 0-3 分；三个红灯——伪视觉（图只是给句子加边框）、泄题（学生要产出的答案被画出来）、元认知话术（图里写做题指令而非学科实体）。',
  '',
  '**总览**：',
  `- 图数 ${review.results.length}｜已判 ${judged.length}｜保留 ${cnt('keep')} / 要修 ${cnt('fix')} / 删掉 ${cnt('drop')}`,
  `- 均分：有用 ${mean('usefulness')} · 几何 ${mean('geometry')} · 可读 ${mean('readability')}`,
  `- 红灯：伪视觉 ${pct('redundant')} · 泄题 ${pct('leak')} · 元话 ${pct('meta')}`,
  '',
  '**按图型**：',
  '',
  '| 图型 | 张数 | 保留/要修/删 | 伪视觉 | 泄题 |',
  '|---|---|---|---|---|',
  ...Object.entries(byKind).sort((a, b) => b[1].n - a[1].n).map(([k, v]) => `| ${k} | ${v.n} | ${v.keep}/${v.fix}/${v.drop} | ${v.redundant} | ${v.leak} |`),
  '',
  '**逐图总表**：',
  '',
  '| # | 图型 | 课程 | 判 | 有用/几何/可读 | 最该修 |',
  '|---|---|---|---|---|---|',
  ...rows.map((r) => `| #${r.i + 1} | ${kindOf(r)} | ${itOf(r).course || ''} | ${r.error ? '出错' : VERDICT[r.verdict] || '—'} | ${r.error ? '—' : `${r.usefulness}/${r.geometry}/${r.readability}`} | ${clip(r.worstIssue === 'none' ? '' : r.worstIssue, tableOnly ? 170 : 90)} |`),
  '',
  ...(tableOnly ? [] : [
    ...section('要修（fix）', rows.filter((r) => r.verdict === 'fix')),
    ...section('删掉（drop）', rows.filter((r) => r.verdict === 'drop')),
    ...section('保留（keep）', rows.filter((r) => r.verdict === 'keep')),
  ]),
  ...inlineBlock,
  '---',
  '',
  '请基于以上内容回答：这些图的问题集中在哪几类？哪几条改造最值得先做（按影响面排序）？',
].join('\n');

fs.writeFileSync(outFile, md, 'utf8');

const kb = Math.round(fs.statSync(outFile).size / 1024);
// 复用 token-estimate 的口径
process.env.WF_TOKEN_IMPORT_ONLY = '1';
const { textTokens } = await import('./token-estimate.mjs');
const tok = textTokens(md);
console.log(`→ ${path.relative(ROOT, outFile)}  ${kb}KB  ≈ ${tok} token${inline ? '（含内嵌图，token 按文本口径低估）' : ''}`);
if (inline) {
  const b64len = (md.match(/base64,[A-Za-z0-9+/=]+/g) || []).reduce((n, m) => n + m.length, 0);
  console.log(`  其中 base64 约 ${Math.round(b64len / 4)} token（内嵌图，体积大——非必须单文件时不要用 --inline）`);
}
