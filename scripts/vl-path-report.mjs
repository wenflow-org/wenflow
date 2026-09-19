/**
 * 虚拟学习者全景报告（**只读**）：人设背景 + 故事池 + 路径，一页看完。
 *
 * 产出 `backend/vlab-runs/<tag>-paths.html`：
 * - 顶部：人数 / 有路径人数 / 任务合计 + 姓名胶囊（点击跳转）+ **姓名过滤框**；
 * - 每人一张卡，卡内三段可折叠：
 *   ① 🧑 人设背景 —— background/年龄职业学历、学习特征（风格/时间/技术舒适度）、
 *      性格与情绪基线、行为模式（求助/对抗/自我觉察/执行/过载/记忆修复）、
 *      动机与情绪触发、失败模式、已知/挣扎概念、学习偏好与边界；
 *   ② 📖 故事池 —— 每个故事的 标题/来源/大纲/触发事件/可见开场/隐藏细节/误判/
 *      压力点/行为钩子/问题知识/目标种子/披露计划；
 *   ③ 🗺 路径 —— 阶段目标 + 任务清单（类型/标题/时长/状态）+ scope/target/预计小时。
 *
 * 只读（node:sqlite 直查，不依赖 Prisma 生成客户端，不改库、不调 LLM）。
 * 用法：node scripts/vl-path-report.mjs --tag=vl50 [--only-with-path] [--out=xxx.html]
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
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const jparse = (s) => { try { return JSON.parse(s || '{}') || {}; } catch { return {}; } };
const arr = (v) => (Array.isArray(v) ? v.filter((x) => x !== null && x !== undefined && String(x).trim()) : (v ? [v] : []));

/** 人设字段 → [标签, 值]（只保留有值的） */
function personaRows(p) {
  const list = [
    ['背景', p.background],
    ['年龄 / 职业 / 学历', [p.age ? `${p.age} 岁` : '', p.occupation, p.education].filter(Boolean).join(' · ')],
    ['学习特征', [p.learningStyle ? `风格:${p.learningStyle}` : '', p.availableTime ? `可用时间:${p.availableTime}` : '', p.techComfort ? `技术舒适度:${p.techComfort}` : ''].filter(Boolean).join(' · ')],
    ['性格底色', p.corePersonality],
    ['情绪基线', p.emotionalBaseline],
    ['求助模式', p.helpSeekingPattern],
    ['对抗模式', p.adversarialPattern],
    ['自我觉察', p.selfAwarenessPattern],
    ['执行与坚持', p.planningFollowThrough],
    ['过载反应', p.overloadReaction],
    ['记忆修复', p.memoryRepairPattern],
    ['行为画像总结', p.behavioralProfileSummary],
    ['元认知', p.metacognitiveProfile],
    ['自我调节', p.selfRegulationStyle],
    ['认知负荷耐受', p.cognitiveLoadTolerance],
    ['动机类型', [p.motivationType, p.motivationOrientation].filter(Boolean).join(' / ')],
    ['动机驱动', arr(p.personalityDrivers).join('、')],
    ['情绪触发', arr(p.emotionalTriggers).join('、')],
    ['失败模式', arr(p.failurePatterns).join('、')],
    ['性格特质', arr(p.personalityTraits).join('、')],
    ['既有尝试', arr(p.priorAttempts).join('；')],
    ['沟通风格', p.communicationStyle],
    ['韧性模式', p.resiliencePattern],
    ['数字素养', p.digitalLiteracy],
    ['行为边界', arr(p.behaviorBoundaries).join('；')],
    ['学习偏好', arr(p.learningPreferences).join('、')],
    ['已掌握概念', arr(p.knownConcepts).join('、')],
    ['挣扎概念', arr(p.struggleConcepts).join('、')],
  ];
  return list.filter(([, v]) => String(v ?? '').trim());
}

const storyRows = (s) => [
  ['来源', s.sourceType],
  ['故事大纲', s.storyOutline],
  ['触发事件', s.triggerEvent],
  ['可见开场', s.visibleOpening],
  ['隐藏细节', s.hiddenDetails],
  ['误判', s.misdiagnosis],
  ['压力点', arr(s.pressurePoints).join('；')],
  ['行为钩子', arr(s.behaviorHooks).join('；')],
  ['问题知识', s.problemKnowledge],
  ['目标种子', s.goalSeed],
  ['披露计划', arr(s.disclosurePlan).join('；') || (typeof s.disclosurePlan === 'string' ? s.disclosurePlan : '')],
].filter(([, v]) => String(v ?? '').trim());

const learners = all(
  `SELECT p.id AS profileId, p.userId, u.name, p.profile, p.knowledgeLevel, p.simulationModel, p.tags
     FROM virtual_learner_profiles p JOIN users u ON u.id = p.userId
    WHERE p.notes LIKE ? OR p.tags LIKE ?
    ORDER BY u.name`,
  [`%${TAG}%`, `%${TAG}%`],
);

const rows = [];
for (const l of learners) {
  const prof = jparse(l.profile);
  const stories = Array.isArray(prof.storyPool) ? prof.storyPool : [];
  const lp = all('SELECT id, title, status, estimatedHours, aiPromptTemplate FROM learning_paths WHERE userId=? ORDER BY updatedAt DESC LIMIT 1', [l.userId])[0];
  if (!lp && ONLY_WITH_PATH) continue;
  let hints = null;
  try { hints = jparse(lp?.aiPromptTemplate)?.sceneFraming?.normalizedInput?.planningHints || null; } catch { /* ignore */ }
  const stages = lp ? all('SELECT id, stageNumber, title, goal, description FROM milestones WHERE learningPathId=? ORDER BY stageNumber', [lp.id]) : [];
  const withTasks = stages.map((m) => ({
    ...m,
    tasks: all('SELECT title, taskType, estimatedMinutes, status FROM subtasks WHERE milestoneId=? ORDER BY "order", title', [m.id]),
  }));
  rows.push({ ...l, persona: prof, stories, path: lp || null, hints, stages: withTasks, taskCount: withTasks.reduce((a, m) => a + m.tasks.length, 0) });
}

const withPath = rows.filter((r) => r.path);
const totalTasks = withPath.reduce((a, r) => a + r.taskCount, 0);
const generated = new Date().toISOString().replace('T', ' ').slice(0, 19);
const totalStories = rows.reduce((a, r) => a + r.stories.length, 0);

const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>虚拟学习者全景报告 · ${esc(TAG)}</title>
<style>
 body{font:14px/1.55 -apple-system,"Segoe UI",system-ui,"Microsoft YaHei",sans-serif;margin:0;background:#f6f8fb;color:#1a2a44}
 header{position:sticky;top:0;background:#fff;border-bottom:1px solid #e6ebf4;padding:12px 22px;z-index:2}
 h1{font-size:17px;margin:0 0 6px}
 .meta{color:#5b6577;font-size:12.5px}
 #filter{margin:8px 0 2px;padding:6px 10px;width:260px;border:1px solid #d7e0f0;border-radius:8px;font-size:13px}
 .toc{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0 0;max-height:88px;overflow:auto}
 .toc a{font-size:12px;border:1px solid #d7e0f0;border-radius:999px;padding:2px 9px;text-decoration:none;color:#2c63d0;background:#fff}
 .wrap{padding:16px 22px 60px;max-width:1180px;margin:0 auto}
 .card{background:#fff;border:1px solid #e6ebf4;border-radius:10px;margin:10px 0;padding:2px 14px 12px}
 .card>summary{cursor:pointer;padding:10px 0;font-weight:600;display:flex;gap:10px;align-items:baseline;flex-wrap:wrap}
 .pill{font-weight:400;font-size:12px;color:#5b6577}
 .ok{color:#15803d}.no{color:#b45309}
 details.sub{margin:6px 0 2px;border-top:1px dashed #eef1f7;padding-top:6px}
 details.sub>summary{cursor:pointer;font-size:13px;color:#2c63d0;padding:3px 0;font-weight:600}
 dl{display:grid;grid-template-columns:118px 1fr;gap:4px 10px;margin:6px 0 4px;font-size:13px}
 dt{color:#5f6f8c}
 dd{margin:0}
 h3{font-size:13.5px;margin:12px 0 5px;color:#2c63d0}
 .task{display:flex;gap:8px;padding:3px 0;border-top:1px dashed #eef1f7;font-size:13px}
 .task:first-of-type{border-top:0}
 .tt{color:#5f6f8c;font-size:12px;min-width:96px}
 .goal{color:#5b6577;font-size:12.5px;margin:2px 0 0}
 .story{border:1px solid #eef1f7;border-radius:8px;padding:8px 10px;margin:8px 0}
 .story h4{margin:0 0 4px;font-size:13px}
 .hidden{color:#b45309}
 .hide{display:none}
</style></head><body>
<header>
  <h1>虚拟学习者全景报告 · <code>${esc(TAG)}</code></h1>
  <div class="meta">共 ${rows.length} 人｜有路径 ${withPath.length} 人｜任务合计 ${totalTasks}｜故事合计 ${totalStories}｜生成于 ${esc(generated)}（只读快照）</div>
  <input id="filter" type="search" placeholder="按姓名/职业/概念过滤…（回车或输入即筛）">
  <div class="toc">${rows.map((r, i) => `<a href="#l${i}">${esc(r.name)}${r.path ? '' : ' · 无路径'}</a>`).join('')}</div>
</header>
<div class="wrap">
${rows.map((r, i) => `
  <details class="card" id="l${i}" data-hay="${esc([r.name, r.persona.occupation, r.persona.background, r.persona.struggleConcepts, r.path?.title, ...r.stories.map((s) => s.title)].flat().join(' '))}"${i < 2 ? ' open' : ''}>
    <summary>${esc(r.name)}
      <span class="pill">${esc(r.persona.age ? r.persona.age + '岁' : '')} ${esc(r.persona.occupation || '')}</span>
      <span class="pill">${esc(r.knowledgeLevel || '')}</span>
      <span class="pill ${r.path ? 'ok' : 'no'}">${r.path ? `${esc(r.path.title)}｜${r.stages.length} 阶段 / ${r.taskCount} 任务｜${r.path.estimatedHours ?? '-'} 小时｜${esc(r.path.status)}` : '尚无路径'}</span>
      <span class="pill">scope=${esc(r.hints?.scopeSize ?? '-')} target=${esc(r.hints?.targetMilestones ?? '-')} 每阶段任务=${esc(r.hints?.targetSubtasksPerStage ?? '-')}</span>
      <span class="pill">故事 ${r.stories.length}</span>
    </summary>

    <details class="sub"${i < 2 ? ' open' : ''}><summary>🧑 人设背景</summary>
      <dl>${personaRows(r.persona).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
    </details>

    <details class="sub"><summary>📖 故事池（${r.stories.length}）</summary>
      ${r.stories.length === 0 ? '<p class="goal">（无故事）</p>' : r.stories.map((s, si) => `
        <div class="story"><h4>${si + 1}. ${esc(s.title || '(无标题)')}</h4>
          <dl>${storyRows(s).map(([k, v]) => `<dt class="${k === '隐藏细节' || k === '误判' ? 'hidden' : ''}">${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
        </div>`).join('')}
    </details>

    <details class="sub"${r.path && i < 2 ? ' open' : ''}><summary>🗺 路径${r.path ? '' : '（尚无）'}</summary>
      ${r.path ? r.stages.map((m) => `
        <h3>阶段 ${m.stageNumber} · ${esc(m.title)}</h3>
        <p class="goal">${esc(m.goal || m.description || '')}</p>
        ${m.tasks.map((t) => `<div class="task"><span class="tt">${esc(t.taskType || '')}</span><span>${esc(t.title)}</span><span class="tt" style="margin-left:auto">${t.estimatedMinutes ? t.estimatedMinutes + ' 分钟' : ''} ${esc(t.status || '')}</span></div>`).join('')}
      `).join('') : '<p class="goal">尚未生成路径</p>'}
    </details>
  </details>`).join('')}
</div>
<script>
 (function () {
   var box = document.getElementById('filter');
   var cards = Array.prototype.slice.call(document.querySelectorAll('details.card'));
   box.addEventListener('input', function () {
     var q = box.value.trim().toLowerCase();
     cards.forEach(function (c) {
       var hit = !q || (c.getAttribute('data-hay') || '').toLowerCase().indexOf(q) >= 0;
       c.classList.toggle('hide', !hit);
     });
   });
 })();
</script>
</body></html>`;

const outDir = path.join(ROOT, 'backend', 'vlab-runs');
fs.mkdirSync(outDir, { recursive: true });
const outFile = String(arg('out') || path.join(outDir, `${TAG}-paths.html`));
fs.writeFileSync(outFile, html, 'utf8');
console.log(`报告已生成：${outFile}`);
console.log(`人数 ${rows.length}｜有路径 ${withPath.length}｜任务合计 ${totalTasks}｜故事合计 ${totalStories}`);
db.close();
