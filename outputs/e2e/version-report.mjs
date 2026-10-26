// 版本报告生成器：三版迭代各落一份独立报告（管线 / 版本 / 改造 / 课程）。
// 用法：node outputs/e2e/version-report.mjs <version> <meta.json> <out.md>
// meta.json 字段：label, date, items, review, changes[{title, detail, files}], notes
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const resolveFromRoot = (p) => (path.isAbsolute(p) ? p : path.join(ROOT, p));

const [version, metaPath, outPath] = process.argv.slice(2);
if (!version || !metaPath || !outPath) throw new Error('用法: version-report.mjs <version> <meta.json> <out.md>');

const meta = JSON.parse(fs.readFileSync(resolveFromRoot(metaPath), 'utf8'));
const items = JSON.parse(fs.readFileSync(resolveFromRoot(meta.items), 'utf8'));
const review = JSON.parse(fs.readFileSync(resolveFromRoot(meta.review), 'utf8'));
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const from = new Map(items.map((it, i) => [i, it]));
const judged = review.results.filter((r) => !r.error);
const verdicts = { keep: 0, fix: 0, drop: 0 };
for (const r of judged) verdicts[r.verdict] = (verdicts[r.verdict] || 0) + 1;
const mean = (k) => (judged.length ? Math.round((judged.reduce((n, r) => n + (Number(r[k]) || 0), 0) / judged.length) * 100) / 100 : null);
const share = (pred) => (judged.length ? Math.round((judged.filter(pred).length / judged.length) * 100) : 0);

const kindCount = {};
for (const it of items) kindCount[it.figure?.kind || '?'] = (kindCount[it.figure?.kind || '?'] || 0) + 1;
const kinds = Object.entries(kindCount).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}×${n}`).join('、');

const typeCount = {};
for (const it of items) typeCount[it.taskType || '?'] = (typeCount[it.taskType || '?'] || 0) + 1;
const types = Object.entries(typeCount).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}×${n}`).join('、');

const courses = [...new Set(items.map((it) => it.course).filter(Boolean))];

const perKindRows = (() => {
  const by = {};
  for (const r of judged) {
    const k = r.kind || '?';
    by[k] = by[k] || { keep: 0, fix: 0, drop: 0, redundant: 0, leak: 0, n: 0 };
    by[k].n += 1;
    if (verdicts[r.verdict] !== undefined) by[k][r.verdict] += 1;
    if (r.redundant === true) by[k].redundant += 1;
    if (r.leak === true) by[k].leak += 1;
  }
  return Object.entries(by).sort((a, b) => b[1].redundant - a[1].redundant)
    .map(([k, v]) => `| ${k} | ${v.n} | ${v.keep}/${v.fix}/${v.drop} | ${v.redundant} | ${v.leak} |`).join('\n');
})();

const tableRows = review.results.map((r) => {
  const it = from.get(r.i) || {};
  const v = { keep: '保留', fix: '要修', drop: '删掉' }[r.verdict] || (r.error ? `出错` : '—');
  const one = esc(r.oneLine || r.error || '').slice(0, 60);
  const worst = r.worstIssue && r.worstIssue !== 'none' ? esc(r.worstIssue).slice(0, 70) : '';
  return `| #${r.i + 1} | ${esc(it.course || '')} | ${r.kind || it.figure?.kind || ''} | ${v} | ${r.usefulness ?? '—'}/${r.geometry ?? '—'}/${r.readability ?? '—'} | ${one} | ${worst} |`;
}).join('\n');

const changes = (meta.changes || []).map((c) => `- **${c.title}**：${c.detail}\n  - 涉及：${(c.files || []).join('、')}`).join('\n') || '- （本轮为基线版本，无改造——以下一版评审病灶为改造输入）';

const md = `# 教学图版本报告 ${meta.label}（${version}）

> 日期：${meta.date} ｜ 评审：外部视觉盲评（deepseek-v4.1-flash，不看代码只看图与对话）
> 判据：usefulness / geometry / readability 各 0-3，meta（元认知话术）/ leak（泄题）/ redundant（伪视觉）三红灯

## 一、管线（本版跑的完整链路）

课程上下文 → **versioned-probe**（真实 teaching-turn 提示词 prompts/skill.teaching-turn.md + 编排层出图信号：路由命中用 KIND_RULES 真路由，未命中补通用出图时机；直连通道，**并发 3**，402/429 退避重试）→ **归一化**（normalizeTeachingFigureForProbe：图型白名单、字段校验、退役图型拒绝）→ **确定性渲染**（frontend renderSpecFigure → SVG → Chrome headless 截 PNG）→ **外部视觉盲评**（并发 3，图+该轮对话一起评）→ 病灶统计 → 改造 → 下一版。

密钥约束：通道 key 只从临时文件读取（WF_VISION_KEY_FILE），不进仓库、不回显；本轮无任何主树/主库写入。

## 二、版本 ${version}

- 出土：**${items.length} 张**（出图并被归一化通过）
- 图型分布：${kinds}
- taskType 分布：${types}
- 盲评（${judged.length} 判 / ${review.results.length - judged.length} 错）：保留 **${verdicts.keep}** / 要修 **${verdicts.fix}** / 删掉 **${verdicts.drop}**
- 均分：有用 ${mean('usefulness')}/3 · 几何 ${mean('geometry')}/3 · 可读 ${mean('readability')}/3
- 红灯：伪视觉（装框文字）${share((r) => r.redundant === true)}% · 泄题 ${share((r) => r.leak === true)}% · 元认知话术 ${share((r) => r.meta === true)}%

### 按图型病灶

| 图型 | 张数 | 保留/要修/删 | 伪视觉 | 泄题 |
|---|---|---|---|---|
${perKindRows}

## 三、改造（本版 → 下一版）

${changes}

## 四、课程（本版 30 张来自这些课）

${courses.map((c) => `- ${c}`).join('\n')}

## 五、逐图明细

| # | 课程 | 图型 | 判 | 有用/几何/可读 | 一句话 | 最该修 |
|---|---|---|---|---|---|---|
${tableRows}

图文页（含图）：见 outputs/${meta.html ? path.basename(meta.html) : 'v1-review.html'}
`;

fs.writeFileSync(outPath, md, 'utf8');
console.log('report →', outPath, `(${md.length} chars)`);
