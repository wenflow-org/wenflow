/**
 * 虚拟学习者「每个人的 Path」单页报告（**只读**）——解决"看每个人的 path 要来回点"的问题。
 *
 * 产出 `backend/vlab-runs/<tag>-paths.html`：一页列出该批次每个学习者的完整路径
 * （阶段 / 任务 / 类型 / 时长 / scope 与预计投入），按人折叠，顶部有汇总与跳转。
 * 打开即用（无需点进管理端的画像→会话→路径）。
 *
 * 用法：node scripts/vl-path-report.mjs --tag=vl50 [--out=xxx.html] [--only-with-path]
 */
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DB = path.join(ROOT, 'backend', 'prisma', 'dev.db');
const arg = (n, d = null) => { const h = process.argv.find((a) => a.startsWith(`--${n}=`)); return h ? h.slice(n.length + 3) : (process.argv.includes(`--${n}`) ? true : d); };
const TAG = String(arg('tag') || 'vl50');
const ONLY_WITH_PATH = process.argv.includes('--only-with-path');

const db = new DatabaseSync(DB, { readOnly: true });
const all = (sql, p = []) => db.prepare(sql).all(...p);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const learners = all(
  `SELECT p.id AS profileId, p.userId, u.name, p.knowledgeLevel, p.tags
     FROM virtual_learner_profiles p JOIN users u ON u.id = p.userId
    WHERE p.notes LIKE ? OR p.tags LIKE ?
    ORDER BY u.name`,
  [`%${TAG}%`, `%${TAG}%`],
);

const rows = [];
for (const l of learners) {
  const lp = all('SELECT id, title, status, estimatedHours, aiPromptTemplate FROM learning_paths WHERE userId=? ORDER BY updatedAt DESC LIMIT 1', [l.userId])[0];
  if (!lp && ONLY_WITH_PATH) continue;
  let hints = null;
  try { hints = JSON.parse(lp?.aiPromptTemplate || '{}')?.sceneFraming?.normalizedInput?.planningHints || null; } catch { /* ignore */ }
  const stages = lp
    ? all('SELECT stageNumber, title, goal, description FROM milestones WHERE learningPathId=? ORDER BY stageNumber', [lp.id])
    : [];
  const withTasks = stages.map((m) => ({
    ...m,
    tasks: lp ? all(
      `SELECT s.title, s.taskType, s.estimatedMinutes, s.status
         FROM subtasks s JOIN milestones mm ON mm.id = s.milestoneId
        WHERE mm.learningPathId=? AND s.milestoneId = (SELECT id FROM milestones WHERE learningPathId=? AND stageNumber=?)
        ORDER BY s."order", s.title`,
      [lp.id, lp.id, m.stageNumber],
    ) : [],
  }));
  const taskCount = withTasks.reduce((a, m) => a + m.tasks.length, 0);
  rows.push({ ...l, path: lp || null, hints, stages: withTasks, taskCount });
}

const withPath = rows.filter((r) => r.path);
const totalTasks = withPath.reduce((a, r) => a + r.taskCount, 0);
const generated = new Date().toISOString().replace('T', ' ').slice(0, 19);

const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>虚拟学习者路径报告 · ${esc(TAG)}</title>
<style>
 body{font:14px/1.55 -apple-system,"Segoe UI",system-ui,"Microsoft YaHei",sans-serif;margin:0;background:#f6f8fb;color:#1a2a44}
 header{position:sticky;top:0;background:#fff;border-bottom:1px solid #e6ebf4;padding:14px 22px;z-index:2}
 h1{font-size:17px;margin:0 0 6px}
 .meta{color:#5b6577;font-size:12.5px}
 .wrap{padding:16px 22px 60px;max-width:1180px;margin:0 auto}
 .toc{display:flex;flex-wrap:wrap;gap:6px;margin:10px 0 4px}
 .toc a{font-size:12px;border:1px solid #d7e0f0;border-radius:999px;padding:2px 9px;text-decoration:none;color:#2c63d0;background:#fff}
 details{background:#fff;border:1px solid #e6ebf4;border-radius:10px;margin:9px 0;padding:2px 14px 10px}
 details[open]{box-shadow:0 1px 3px rgba(20,40,80,.06)}
 summary{cursor:pointer;padding:10px 0;font-weight:600;display:flex;gap:10px;align-items:baseline;flex-wrap:wrap}
 .pill{font-weight:400;font-size:12px;color:#5b6577}
 .ok{color:#15803d}.no{color:#b45309}
 h3{font-size:13.5px;margin:12px 0 5px;color:#2c63d0}
 .task{display:flex;gap:8px;padding:3px 0;border-top:1px dashed #eef1f7;font-size:13px}
 .task:first-of-type{border-top:0}
 .tt{color:#5f6f8c;font-size:12px;min-width:96px}
 .goal{color:#5b6577;font-size:12.5px;margin:2px 0 0}
</style></head><body>
<header>
  <h1>虚拟学习者路径报告 · <code>${esc(TAG)}</code></h1>
  <div class="meta">共 ${rows.length} 人｜有路径 ${withPath.length} 人｜任务合计 ${totalTasks}｜生成于 ${esc(generated)}（只读快照）</div>
  <div class="toc">${rows.map((r, i) => `<a href="#l${i}">${esc(r.name)}${r.path ? '' : ' · 无路径'}</a>`).join('')}</div>
</header>
<div class="wrap">
${rows.map((r, i) => `
  <details id="l${i}"${i < 3 ? ' open' : ''}>
    <summary>${esc(r.name)}
      <span class="pill">${esc(r.knowledgeLevel || '')}</span>
      <span class="pill ${r.path ? 'ok' : 'no'}">${r.path ? `路径：${esc(r.path.title)}｜${r.stages.length} 阶段 / ${r.taskCount} 任务｜${r.path.estimatedHours ?? '-'} 小时｜${esc(r.path.status)}` : '尚无路径'}</span>
      <span class="pill">scope=${esc(r.hints?.scopeSize ?? '-')} target=${esc(r.hints?.targetMilestones ?? '-')} 每阶段任务=${esc(r.hints?.targetSubtasksPerStage ?? '-')}</span>
    </summary>
    ${r.stages.map((m) => `
      <h3>阶段 ${m.stageNumber} · ${esc(m.title)}</h3>
      <p class="goal">${esc(m.goal || m.description || '')}</p>
      ${m.tasks.map((t) => `<div class="task"><span class="tt">${esc(t.taskType || '')}</span><span>${esc(t.title)}</span><span class="tt" style="margin-left:auto">${t.estimatedMinutes ? t.estimatedMinutes + ' 分钟' : ''} ${esc(t.status || '')}</span></div>`).join('')}
    `).join('')}
  </details>`).join('')}
</div></body></html>`;

const outDir = path.join(ROOT, 'backend', 'vlab-runs');
fs.mkdirSync(outDir, { recursive: true });
const outFile = String(arg('out') || path.join(outDir, `${TAG}-paths.html`));
fs.writeFileSync(outFile, html, 'utf8');
console.log(`报告已生成：${outFile}`);
console.log(`人数 ${rows.length}｜有路径 ${withPath.length}｜任务合计 ${totalTasks}`);
db.close();
