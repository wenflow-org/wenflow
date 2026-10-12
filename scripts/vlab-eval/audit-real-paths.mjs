#!/usr/bin/env node
/**
 * 真路径保真审计（2026-10-13）
 *
 * 背景：2026-10-12 对真人路径 lp_1791817016486_mot0ov1 对照 goal 对话人工审查，
 * 暴露「内部痕迹漏出 / 预算承诺与交付脱节 / 时间说明不可见 / M1 越界 / 模板复读」五类缺陷。
 * 本脚本把那次人肉判据固化为可重复的机器审计，用于每次真机生成后批量复查
 * （亦可对存量全库扫一遍看家族分布）。
 *
 * 只读（node:sqlite readOnly），不改任何数据；输出 markdown 报告 + JSON 到
 * doc/local/runs/<YYYYMMDD>/real-path-audit/。
 *
 * 用法：
 *   node scripts/vlab-eval/audit-real-paths.mjs                 # 全库（默认最近 40 条）
 *   node scripts/vlab-eval/audit-real-paths.mjs --limit 200
 *   node scripts/vlab-eval/audit-real-paths.mjs --path-id lp_xxx
 *   node scripts/vlab-eval/audit-real-paths.mjs --since 1791810000000   # createdAt >= 纪元 ms
 *   node scripts/vlab-eval/audit-real-paths.mjs --db <path-to-db>
 */
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);

function argValue(name, fallback = null) {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}

const DB_PATH = argValue('--db', path.join(ROOT, 'backend/prisma/dev.db'));
const LIMIT = Number(argValue('--limit', '40'));
const PATH_ID = argValue('--path-id', null);
const SINCE = argValue('--since', null) ? Number(argValue('--since')) : null;

const db = new DatabaseSync(DB_PATH, { readOnly: true });
const q = (sql, ...a) => db.prepare(sql).all(...a);
const q1 = (sql, ...a) => db.prepare(sql).all(...a)[0] ?? null;

/* 内部流程术语（P1 档：出现即判——只收"学习者文本里必然是漏出"的词）。
   校准记录（2026-10-13 首跑）：初版含「口径/兜底/断言/复读」等，实测大量误报——
   「取数口径 / 手工汇总口径」「给这一行兜底」是正常业务中文；已收窄到三词。 */
const INTERNAL_TERMS_P1 = ['回捞', '落库', '打标'];
/** 第三人称内部分析口吻（path.description/subject 出现=隐患） */
const THIRD_PERSON_RE = /(本人|他都|该用户|学习者本人)/;
/** 「回捞…关系」式模板复读句 */
const BOILERPLATE_RE = /回捞[^。；，,、\n]{0,40}关系/g;

const findings = [];
function add(level, pathId, check, detail, evidence) {
  findings.push({ level, pathId, check, detail, evidence: String(evidence ?? '').slice(0, 200) });
}

function parseTemplate(raw) {
  try { return raw ? JSON.parse(raw) : null; } catch { return null; }
}

function loadPaths() {
  if (PATH_ID) return q(`SELECT * FROM learning_paths WHERE id = ?`, PATH_ID);
  const where = SINCE ? 'WHERE createdAt >= ?' : '';
  const rows = q(`SELECT * FROM learning_paths ${where} ORDER BY createdAt DESC LIMIT ?`, ...(SINCE ? [SINCE, LIMIT] : [LIMIT]));
  return rows;
}

/** CJK/字母词元（>=2 字）用于重叠启发式 */
function tokens(text) {
  const s = String(text || '');
  const set = new Set();
  for (const m of s.matchAll(/[\u4e00-\u9fa5]{2,6}|[A-Za-z]{3,}/g)) set.add(m[0]);
  return set;
}

function auditPath(p) {
  const pid = p.id;
  const template = parseTemplate(p.aiPromptTemplate);
  const milestones = q(`SELECT * FROM milestones WHERE learningPathId = ? ORDER BY stageNumber`, pid);
  const subtasks = q(
    `SELECT s.*, m.stageNumber FROM subtasks s JOIN milestones m ON s.milestoneId = m.id
     WHERE m.learningPathId = ? ORDER BY m.stageNumber, s."order"`, pid);
  const goalConv = template?.sourceConversationId
    ? q1(`SELECT id, description, messages FROM goal_conversations WHERE id = ?`, template.sourceConversationId)
    : q1(`SELECT id, description, messages FROM goal_conversations WHERE learningPathId = ? LIMIT 1`, pid);

  if (!goalConv) add('P2', pid, 'goal对话', `${p.status} 路径无关联 goal 对话（source=goal 时可疑）`, p.title);

  // C1 内部术语泄漏（用户可见字段；每词每路径报一条，证据取首例）
  const surfaces = [
    ...subtasks.map((s) => ['task.title', s.title, `阶段${s.stageNumber}`]),
    ...subtasks.map((s) => ['task.description', s.description, `阶段${s.stageNumber}`]),
    ...milestones.map((m) => ['stage.title', m.title, `阶段${m.stageNumber}`]),
    ...milestones.map((m) => ['stage.goal', m.goal, `阶段${m.stageNumber}`]),
    ['path.title', p.title, ''],
    ['path.description', p.description, ''],
  ];
  const leaked = new Map(); // term -> evidence
  for (const [field, text, extra] of surfaces) {
    for (const term of INTERNAL_TERMS_P1) {
      if (text && String(text).includes(term) && !leaked.has(term)) {
        leaked.set(term, `${field}${extra ? '（' + extra + '）' : ''}：${text}`);
      }
    }
  }
  for (const [term, evidence] of leaked) {
    add('P1', pid, '内部术语泄漏', `含「${term}」（首例字段见证据）`, evidence);
  }

  // C2 时间说明（生成期诚实声明）：报告锚 vs 实付；渲染出口已由前端保障
  for (const m of milestones) {
    const noteMatch = String(m.description || '').match(/(?:容量说明|时间说明)[：:][^\n]*/);
    if (noteMatch) {
      add('INFO', pid, '时间说明', `阶段${m.stageNumber} 带诚实声明（前端阶段头已渲染）`, noteMatch[0]);
    }
  }

  // C3 预算承诺 vs 交付
  const totalMinutes = subtasks.reduce((a, s) => a + (Number(s.estimatedMinutes) || 0), 0);
  const deliveredH = Math.round((totalMinutes / 60) * 10) / 10;
  const target = Number(template?.budgetConservation?.target) || null;
  if (target && deliveredH > 0) {
    const ratio = deliveredH / target;
    if (ratio < 0.6) add('P1', pid, '预算缺口', `交付 ${deliveredH}h / 承诺 ${target}h = ${(ratio * 100).toFixed(0)}%（<60% 阈值）`, p.title);
    else if (ratio < 0.85) add('P2', pid, '预算缺口', `交付 ${deliveredH}h / 承诺 ${target}h = ${(ratio * 100).toFixed(0)}%（关注档）`, p.title);
  }

  // C4 path.description / subject 第三人称内部分析口吻
  for (const [field, text] of [['path.description', p.description], ['path.subject', p.subject]]) {
    if (text && THIRD_PERSON_RE.test(String(text))) {
      add('P2', pid, '第三人称口吻', `${field} 含内部第三人称表述`, text);
    }
  }

  // C5 M1 越界：首阶段任务标题与后段阶段标题词元重叠 ≥2
  const m1Tasks = subtasks.filter((s) => s.stageNumber === 1);
  const laterStages = milestones.filter((m) => m.stageNumber > 1);
  for (const t of m1Tasks) {
    const tset = tokens(t.title);
    for (const m of laterStages) {
      const mset = tokens(m.title);
      const overlap = [...tset].filter((x) => mset.has(x));
      if (overlap.length >= 2) {
        add('P2', pid, 'M1越界', `M1任务「${t.title}」与阶段${m.stageNumber}「${m.title}」词元重叠 ${overlap.join('/')}`, t.title);
        break;
      }
    }
  }

  // C6 阶段描述模板复读：同一 8+ 字句在 ≥3 个阶段出现
  // （先剥掉「容量说明/时间说明」声明句——那是**应该**逐阶段同款的诚实声明，不是复读）
  const stripNotes = (d) => String(d || '').replace(/(?:容量说明|时间说明)[：:][^\n]*/g, '');
  const clauseCount = new Map();
  for (const m of milestones) {
    for (const match of stripNotes(m.description).matchAll(/[\u4e00-\u9fa5]{8,}/g)) {
      const c = match[0];
      clauseCount.set(c, (clauseCount.get(c) || 0) + 1);
    }
  }
  for (const [clause, count] of clauseCount) {
    if (count >= 3) add('P2', pid, '模板复读', `${count} 个阶段描述共用同句`, clause);
  }

  return {
    pathId: pid,
    title: p.title,
    status: p.status,
    createdAt: p.createdAt,
    stages: milestones.length,
    tasks: subtasks.length,
    deliveredHours: deliveredH,
    targetHours: target,
    goalSummary: goalConv ? String(goalConv.description || '').slice(0, 80) : null,
  };
}

const paths = loadPaths();
const overview = [];
for (const p of paths) {
  try {
    overview.push(auditPath(p));
  } catch (error) {
    add('P2', p.id, '审计异常', error instanceof Error ? error.message : String(error), p.id);
  }
}

/* 报告 */
const byLevel = { P1: findings.filter((f) => f.level === 'P1'), P2: findings.filter((f) => f.level === 'P2'), INFO: findings.filter((f) => f.level === 'INFO') };
const runDate = new Date().toISOString().slice(0, 10).replace(/-/g, '');
const outDir = path.join(ROOT, 'doc/local/runs', runDate, 'real-path-audit');
fs.mkdirSync(outDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const jsonPath = path.join(outDir, `audit-${stamp}.json`);
const mdPath = path.join(outDir, `audit-${stamp}.md`);

const lines = [];
lines.push(`# 真路径保真审计（${new Date().toLocaleString('zh-CN')}）`);
lines.push('');
lines.push(`数据库：\`${DB_PATH}\`｜路径 ${paths.length} 条｜P1 ${byLevel.P1.length} / P2 ${byLevel.P2.length} / INFO ${byLevel.INFO.length}`);
lines.push('');
lines.push('## 路径总览');
lines.push('');
lines.push('| 路径 | 状态 | 阶段 | 任务 | 交付h | 承诺h | 比 |');
lines.push('|---|---|---|---|---|---|---|');
for (const o of overview) {
  const ratio = o.targetHours ? `${(o.deliveredHours / o.targetHours * 100).toFixed(0)}%` : '-';
  lines.push(`| ${o.title} (\`${o.pathId}\`) | ${o.status} | ${o.stages} | ${o.tasks} | ${o.deliveredHours} | ${o.targetHours ?? '-'} | ${ratio} |`);
}
for (const [level, list] of [['P1', byLevel.P1], ['P2', byLevel.P2], ['INFO', byLevel.INFO]]) {
  lines.push('');
  lines.push(`## ${level}（${list.length}）`);
  lines.push('');
  if (!list.length) lines.push('（无）');
  for (const f of list) {
    lines.push(`- **[${f.check}]** ${f.pathId}｜${f.detail}${f.evidence ? `｜证据：${f.evidence}` : ''}`);
  }
}
fs.writeFileSync(mdPath, lines.join('\n'), 'utf8');
fs.writeFileSync(jsonPath, JSON.stringify({ generatedAt: new Date().toISOString(), db: DB_PATH, overview, findings }, null, 2), 'utf8');

console.log(JSON.stringify({
  db: DB_PATH,
  paths: paths.length,
  P1: byLevel.P1.length,
  P2: byLevel.P2.length,
  INFO: byLevel.INFO.length,
  report: mdPath,
}, null, 2));
db.close();
