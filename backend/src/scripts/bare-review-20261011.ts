/* eslint-disable @typescript-eslint/no-explicit-any -- 一次性裸评审脚本：sqlite 行与上游 JSON 载荷形状动态（对齐 probe / eval 系列先例） */
/**
 * bare-review-20261011.ts — 裸评审当前数据（2026-10-11 用户令）
 *
 * 口径：不注入任何评审提示词/角色/评分维度——只把数据原文发给 LLM，问一句
 *   「这个学习路径有什么问题？」/「这段课堂对话有什么问题？」
 * 平台密钥仅在本进程内解密使用（不落日志不落盘）；与夜跑共享上游池，串行 + 4s 间隔。
 * 输出：doc/local/runs/20261011/vl-evals/bare-review-20261011/{samples.jsonl,results.jsonl,bare-review-20261011.md}
 * 用法：npx ts-node --transpile-only src/scripts/bare-review-20261011.ts
 */
import fs from 'node:fs';
import path from 'node:path';
// node:sqlite 属 Node 22 实验 API，本仓库 @types/node 尚未声明；运行时可 require 到。
// eslint-disable-next-line @typescript-eslint/no-require-imports -- 实验 API 无类型声明，import 无法表达运行时存在性
const { DatabaseSync } = require('node:sqlite') as { DatabaseSync: any };
import apiConfigService from '../services/apiConfig.service';

const ROOT = path.resolve(__dirname, '..', '..');
const OUT = path.join(ROOT, '..', 'doc', 'local', 'runs', '20261011', 'vl-evals', 'bare-review-20261011');
fs.mkdirSync(OUT, { recursive: true });
const DB = path.join(__dirname, '..', '..', 'prisma', 'dev.db');

const PATH_Q = '这个学习路径有什么问题？';
const CLASS_Q = '这段课堂对话有什么问题？';
const TRANSCRIPT_CAP = 24000;
const PUBLISH_TS = Date.parse('2026-10-10T16:35:00Z'); // 新 prompt 规则发布时刻（00:35+08）

export function fmtPathTree(db: any, pathId: string): string {
  const p = db.prepare('SELECT title, subject, description, status, difficulty, estimatedHours, totalMilestones FROM learning_paths WHERE id=?').get(pathId) as any;
  const lines: string[] = [];
  lines.push(`路径名称：${p.title}`);
  lines.push(`学科/主题：${p.subject || '—'}`);
  lines.push(`难度：${p.difficulty} 估时：${p.estimatedHours}h 阶段数：${p.totalMilestones} 状态：${p.status}`);
  if (p.description) lines.push(`路径描述：${p.description}`);
  const ms = db.prepare('SELECT id, stageNumber, title, description, goal, estimatedHours, status FROM milestones WHERE learningPathId=? ORDER BY stageNumber').all(pathId) as any[];
  for (const m of ms) {
    lines.push(`\n## 阶段${m.stageNumber} ${m.title}（${m.estimatedHours}h，${m.status}）`);
    if (m.description) lines.push(`描述：${m.description}`);
    if (m.goal) lines.push(`目标：${m.goal}`);
    const sts = db.prepare('SELECT title, taskType, estimatedMinutes, status FROM subtasks WHERE milestoneId=? ORDER BY id').all(m.id) as any[];
    for (const s of sts) lines.push(`  - [${s.taskType}/${s.estimatedMinutes}分/${s.status}] ${s.title}`);
    if (!sts.length) lines.push('  -（无任务）');
  }
  return lines.join('\n');
}

export function fmtTranscript(db: any, sessionId: string): string {
  const rows = db.prepare('SELECT payload FROM teaching_session_messages WHERE sessionId=? ORDER BY createdAt').all(sessionId) as any[];
  const lines: string[] = [];
  for (const r of rows) {
    try {
      const m = JSON.parse(r.payload);
      const who = m.role === 'assistant' ? '老师' : m.role === 'user' ? '学生' : m.role;
      lines.push(`${who}：${String(m.content || '')}`);
    } catch { /* 半写行 */ }
  }
  let text = lines.join('\n\n');
  if (text.length > TRANSCRIPT_CAP) {
    text = text.slice(0, 4000) + '\n\n……[中段略去]……\n\n' + text.slice(-TRANSCRIPT_CAP + 4000);
  }
  return text;
}

async function main() {
  const db = new DatabaseSync(DB, { readOnly: true });
  db.exec('PRAGMA busy_timeout=5000');

  // ---- 抽样：路径 8（3 条新规则 + 3 条旧规则存量 + 2 条 cohort 深度轨）----
  const newPathRows = db.prepare(`
    SELECT lp.id, lp.title FROM learning_paths lp
    JOIN virtual_learner_profiles vlp ON vlp.userId = lp.userId
    WHERE lp.updatedAt >= ? AND lp.totalMilestones > 0
    ORDER BY lp.updatedAt DESC LIMIT 6`).all(PUBLISH_TS) as any[];
  const oldPathRows = db.prepare(`
    SELECT lp.id, lp.title FROM learning_paths lp
    JOIN virtual_learner_profiles vlp ON vlp.userId = lp.userId
    WHERE lp.updatedAt < ? AND lp.totalMilestones >= 3
    ORDER BY lp.updatedAt DESC LIMIT 40`).all(PUBLISH_TS) as any[];
  const cohort = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'scripts', 'measurement-verify', 'cohort-epoch2.json'), 'utf-8'));
  const cohortUserIds = (Array.isArray(cohort) ? cohort : Object.values(cohort)).map((v: any) => v.userId);
  const cohortPaths = db.prepare(`
    SELECT lp.id, lp.title FROM learning_paths lp
    WHERE lp.userId IN (${cohortUserIds.map(() => '?').join(',')}) AND lp.totalMilestones >= 3
    ORDER BY lp.updatedAt ASC LIMIT 10`).all(...cohortUserIds) as any[];

  const seen = new Set<string>();
  const pathPicks: Array<{ id: string; bucket: string }> = [];
  for (const r of newPathRows.slice(0, 3)) if (!seen.has(r.id)) { seen.add(r.id); pathPicks.push({ id: r.id, bucket: 'new-rules' }); }
  for (const r of oldPathRows.slice(0, 3)) if (!seen.has(r.id)) { seen.add(r.id); pathPicks.push({ id: r.id, bucket: 'stock' }); }
  for (const r of cohortPaths.slice(0, 2)) if (!seen.has(r.id)) { seen.add(r.id); pathPicks.push({ id: r.id, bucket: 'cohort' }); }

  // ---- 抽样：课堂 8（近 14h 完结课，每人一节，挑消息数多的）----
  const since = Date.now() - 14 * 3600 * 1000;
  const sess = db.prepare(`
    SELECT ts.id, ts.userId, ts.topic, ts.status,
           (SELECT COUNT(*) FROM teaching_session_messages m WHERE m.sessionId = ts.id) AS msgs
    FROM teaching_sessions ts
    WHERE ts.createdAt >= ? AND ts.endTime IS NOT NULL AND ts.status = 'completed'
    ORDER BY ts.endTime DESC LIMIT 200`).all(since) as any[];
  const classSeen = new Set<string>();
  const classPicks: Array<{ id: string; topic: string; msgs: number }> = [];
  for (const s of sess) {
    if (classSeen.has(s.userId) || s.msgs < 20) continue;
    classSeen.add(s.userId);
    classPicks.push({ id: s.id, topic: s.topic, msgs: s.msgs });
    if (classPicks.length >= 8) break;
  }

  // ---- 落样本清单 ----
  const samples: Array<{ kind: 'path' | 'class'; id: string; bucket?: string; title: string; question: string; text: string }> = [];
  for (const p of pathPicks) {
    const row = db.prepare('SELECT title FROM learning_paths WHERE id=?').get(p.id) as any;
    samples.push({ kind: 'path', id: p.id, bucket: p.bucket, title: row.title, question: PATH_Q, text: fmtPathTree(db, p.id) });
  }
  for (const c of classPicks) {
    samples.push({ kind: 'class', id: c.id, title: c.topic, question: CLASS_Q, text: fmtTranscript(db, c.id) });
  }
  db.close();
  // 审计 2026-10-12：必须保留原文 text——否则 samples.jsonl 不自足，retry-empty-bare 复打时
  // textOf 取不到 → 发空提示语，模型回「你没给内容」被当有效答案写回 results（污染证据）。
  fs.writeFileSync(path.join(OUT, 'samples.jsonl'), samples.map((s) => JSON.stringify({ ...s, chars: String(s.text || '').length })).join('\n') + '\n');
  console.log(`样本：路径 ${pathPicks.length}（${pathPicks.map((p) => p.bucket).join('/')}）+ 课堂 ${classPicks.length}`);

  // ---- 裸调用（无 system 消息）----
  const cfg = await apiConfigService.getConfig();
  const base = String(cfg.apiUrl || '').replace(/\/$/, '');
  const endpoint = base.endsWith('/v1') ? `${base}/chat/completions` : `${base}/v1/chat/completions`;
  const model = String(cfg.defaultModel || 'deepseek-v4.1-flash');
  console.log(`模型 ${model} @ ${new URL(endpoint).host}`);

  const results: any[] = [];
  for (const [i, s] of samples.entries()) {
    const body = {
      model,
      temperature: 0.3,
      max_tokens: 2000,
      messages: [{ role: 'user', content: `${s.text}\n\n${s.question}` }],
    };
    let answer = '';
    let httpStatus = 0;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(240_000),
        });
        httpStatus = res.status;
        const j: any = await res.json().catch(() => ({}));
        if (res.ok && j.choices?.[0]?.message?.content) {
          answer = String(j.choices[0].message.content).trim();
          break;
        }
        console.log(`[${i + 1}/${samples.length}] HTTP ${res.status} ${String(j?.error?.message || '').slice(0, 80)}${attempt === 1 ? '，30s 后重试' : ''}`);
      } catch (e: any) {
        console.log(`[${i + 1}/${samples.length}] ${e.message}${attempt === 1 ? '，30s 后重试' : ''}`);
      }
      if (attempt === 1) await new Promise((r) => setTimeout(r, 30_000));
    }
    results.push({ kind: s.kind, id: s.id, bucket: s.bucket, title: s.title, question: s.question, chars: s.text.length, model, httpStatus, answer });
    fs.writeFileSync(path.join(OUT, 'results.jsonl'), results.map((r) => JSON.stringify(r)).join('\n') + '\n');
    console.log(`[${i + 1}/${samples.length}] ${s.kind} ${s.title.slice(0, 24)} → ${answer ? `${answer.length} 字` : '无回答'}`);
    await new Promise((r) => setTimeout(r, 4000));
  }

  // ---- 汇总 md（原文照录，不打分不加工）----
  const md: string[] = ['# 裸评审 · 当前数据（2026-10-11）', '',
    `- 口径：无评审提示词/无角色/无评分维度，数据原文 + 一句「有什么问题」；无 system 消息；temperature 0.3`,
    `- 模型：${model}；样本：路径 ${pathPicks.length} 条（bucket: new-rules=新规则后再生 / stock=存量 / cohort=深度轨）+ 课堂 ${classPicks.length} 节（近 14h 完结课）`,
    `- 原始结果：results.jsonl（逐字）；样本清单：samples.jsonl`, ''];
  for (const r of results) {
    md.push(`\n---\n\n## [${r.kind === 'path' ? '路径' : '课堂'}｜${r.bucket || '-'}] ${r.title}`, '', `**问**：${r.question}`, '');
    md.push(r.answer || `（无回答，HTTP ${r.httpStatus}）`);
  }
  fs.writeFileSync(path.join(OUT, 'bare-review-20261011.md'), md.join('\n') + '\n');
  console.log(`完成 → ${OUT}`);
}

if (require.main === module) {
  main().catch((e) => { console.error('FATAL', e); process.exit(1); });
}

