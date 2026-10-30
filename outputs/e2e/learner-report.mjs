#!/usr/bin/env node
/**
 * 10 个虚拟学习者的课堂报告：每案例一份 MD + 图册 HTML。
 *
 * 数据来源是 export-classroom.mjs 导出的 outputs/e2e/classroom/<id>.json。
 * 课堂图不落库，只有实际下发过的 figure 才会出现在这里；0 图也是结论。
 *
 * 用法：node outputs/e2e/learner-report.mjs
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const classroomDir = resolve(here, 'classroom');
const docDir = resolve(root, 'doc/learners');
const pngDir = resolve(root, 'doc/learners/pngs');
const pagesDir = resolve(here, 'learners-report-pages');
mkdirSync(docDir, { recursive: true });
mkdirSync(pngDir, { recursive: true });

const personas = JSON.parse(readFileSync(resolve(here, 'learner-cases-10.json'), 'utf8')).cases;
const byId = new Map(personas.map((c) => [c.id, c]));

const files = existsSync(classroomDir)
  ? readdirSync(classroomDir).filter((f) => /^f\d+\.json$/.test(f))
  : [];
const cases = files
  .map((f) => JSON.parse(readFileSync(resolve(classroomDir, f), 'utf8')))
  .sort((a, b) => a.caseId.localeCompare(b.caseId, 'en', { numeric: true }));

// 1) 把图交回既有渲染链（确定性 SVG → PNG）
const items = [];
for (const c of cases) {
  for (const l of c.lessons) {
    for (const fig of l.figures || []) {
      const spec = fig.spec || {};
      const title = String(spec.title || l.topic || '课堂图');
      items.push({
        id: c.caseId,
        state: `${c.caseId}-${items.length + 1}`,
        figure: { kind: fig.kind, spec },
        user: `${c.learnerName} · ${title}`,
        course: l.topic,
        context: { student: '', teacher: '' },
      });
    }
  }
}
if (items.length) {
  writeFileSync(resolve(here, 'learners-report-items.json'), JSON.stringify(items, null, 1));
  spawnSync('node', [resolve(here, 'board-pages.mjs'), 'outputs/e2e/learners-report-items.json', 'outputs/e2e/learners-report-pages'], { stdio: 'inherit' });
  spawnSync('node', [resolve(here, 'render-pngs.mjs'), pagesDir, pngDir], { stdio: 'inherit' });
}

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));

// 2) 每案例一份 MD
let itemCursor = -1;
const indexRows = [];
const htmlCases = [];
for (const c of cases) {
  const persona = byId.get(c.caseId);
  const lines = [];
  lines.push(`# ${c.caseId}｜${c.learnerName}`);
  lines.push('');
  if (persona) {
    lines.push(`- **身份**：${persona.public.profileRole}｜${persona.public.profileScenario}`);
    lines.push(`- **目标**：${persona.public.learningGoal}`);
    lines.push(`- **开场**：${persona.public.storyOpening}`);
  }
  lines.push(`- **会话**：${c.sessionId}（${c.sessionStatus || '?'} / ${c.stage || '?'}）`);
  lines.push(`- **课堂**：${c.lessonCount} 节；实际下发图 ${c.figureCount} 张；可见回合 ${c.phases.length}`);
  lines.push('');
  lines.push('## 课程与对话');
  lines.push('');
  const schoolFigures = [];
  for (const [i, l] of c.lessons.entries()) {
    lines.push(`### ${i + 1}. ${l.topic || '（未命名）'}`);
    lines.push('');
    lines.push(`- 任务类型：\`${l.taskType}\`｜状态：\`${l.status}\`｜消息：${l.messages.length}`);
    lines.push('');
    for (const m of l.messages.slice(0, 24)) {
      const who = m.role === 'user' ? '学习者' : m.role === 'assistant' ? '老师' : m.role;
      lines.push(`- **${who}**：${String(m.content || '').replace(/\n+/g, ' ').slice(0, 420)}`);
    }
    if (l.messages.length > 24) lines.push(`- …（另有 ${l.messages.length - 24} 条）`);
    lines.push('');
    for (const fig of l.figures || []) {
      itemCursor += 1;
      const png = join('pngs', `${itemCursor}.png`);
      schoolFigures.push({ kind: fig.kind, title: String((fig.spec || {}).title || l.topic || ''), png });
      lines.push(`![${c.caseId} 课堂图 ${itemCursor}](${png})`);
      lines.push('');
      lines.push(`> 图型：\`${fig.kind}\`｜标题：${String((fig.spec || {}).title || '（无）')}`);
      lines.push('');
    }
  }
  if (!c.figureCount) {
    lines.push('> 本案例这一天课没有下发任何课堂图（引擎未触发视觉机会）。这不是导出遗漏：`virtual_session_logs` 里本轮输出没有 `figure` 字段。');
    lines.push('');
  }
  writeFileSync(resolve(docDir, `${c.caseId}.md`), lines.join('\n'));
  indexRows.push(`| ${c.caseId} | ${c.learnerName} | ${c.lessonCount} | ${c.figureCount} | [打开](${c.caseId}.md) |`);
  htmlCases.push({ ...c, persona, schoolFigures });
}

// 3) 索引
const md = [
  '# 10 个虚拟学习者 · 课堂记录',
  '',
  '每个案例只跑 1 个模拟日（不要求上完），记录真实课堂里发生了什么。',
  '注意：课堂图由生产引擎的视觉机会触发，**0 图表示引擎这一轮没有出图**，不是导出问题。',
  '',
  '| Case | 学习者 | 课节 | 下发图 | 详情 |',
  '|---|---|---|---|---|',
  ...indexRows,
  '',
].join('\n');
writeFileSync(resolve(docDir, 'README.md'), md);

// 4) 自包含 HTML（有图内联 SVG/PNG，无图只列对话）
const figureSvgs = [];
items.forEach((it, idx) => {
  try {
    const outPath = resolve(pagesDir, `${idx}.html`);
    if (existsSync(outPath)) {
      const html = readFileSync(outPath, 'utf8');
      const m = html.match(/<svg[\s\S]*?<\/svg>/);
      if (m) figureSvgs[idx] = m[0];
    }
  } catch { /* ignore */ }
});
let figCursor = 0;
const card = (c) => {
  const p = c.persona?.public || {};
  const figs = c.lessons.flatMap((l) => (l.figures || []).map((f) => ({ ...f, topic: l.topic })));
  return `<section class="case">
  <h2>${esc(c.caseId)}｜${esc(c.learnerName)}</h2>
  <p class="meta">${esc(p.profileRole || '')}｜${esc(p.learningGoal || '')}</p>
  <p class="meta">课节 ${c.lessonCount}｜下发图 ${c.figureCount}｜回合 ${c.phases.length}</p>
  ${c.lessons.map((l, i) => `<details ${i === 0 ? 'open' : ''}><summary>${i + 1}. ${esc(l.topic)}（${esc(l.taskType)} / ${esc(l.status)}）</summary>
    ${l.messages.slice(0, 16).map((m) => `<p class="${m.role === 'user' ? 'u' : 'a'}"><b>${m.role === 'user' ? '学习者' : '老师'}</b>：${esc(String(m.content || '').slice(0, 360))}</p>`).join('')}
  </details>`).join('')}
  ${figs.map((f) => { const svg = figureSvgs[figCursor++]; return `<figure>${svg || ''}<figcaption>${esc(f.kind)}｜${esc((f.spec || {}).title || f.topic || '')}</figcaption></figure>`; }).join('')}
</section>`;
};
const html = `<!doctype html><meta charset="utf-8"><title>10 个虚拟学习者 · 课堂记录</title>
<style>body{font:15px/1.7 -apple-system,"Segoe UI","Noto Sans SC",sans-serif;max-width:980px;margin:30px auto;padding:0 18px;color:#1f2328;background:#fff}.case{border-top:1px solid #e5e7eb;padding:18px 0}h2{font-size:20px}.meta{color:#57606a;margin:4px 0}.u{color:#0b6bcb}.a{color:#1f2328}details{margin:10px 0}summary{cursor:pointer;font-weight:600}figure{margin:14px 0;text-align:center}figure svg{max-width:100%;height:auto;border:1px solid #e5e7eb;border-radius:8px}figcaption{color:#57606a;font-size:13px}</style>
<h1>10 个虚拟学习者 · 课堂记录</h1><p>每案例 1 个模拟日；课堂图由生产引擎的视觉机会触发，0 图即引擎未出图。</p>
${htmlCases.map(card).join('')}`;
writeFileSync(resolve(docDir, 'index.html'), html);
console.log(`cases=${cases.length} items=${items.length} → doc/learners/`);
