#!/usr/bin/env node
/**
 * A/B 跨日重跑 —— 缺陷复检（对应 doc/local/runs/20261013/ab-pair/AB-REPORT.md 的 D1/D9/D10/D13）。
 *
 * 只读 dev.db（readOnly + busy_timeout）。对指定 userId 的**新** teaching_sessions 逐字稿做判据扫描：
 *   D1  用户发言截断：user 消息以「…」结尾且长度落在 48/80/96 硬上限
 *   D9  兜底结课虚报掌握：wrapup.sources.summary=fallback 时知识点仍标 mastered / progress=100
 *   D10 悬空图引用：assistant 消息含「（见图）/我画了…图」类引用但 payload 无 images/diagrams/figures
 *   D13 画像概念矛盾：profile 的 known ∩ struggle 非空
 *
 * 用法：node scripts/vlab-eval/ab-rerun-audit.mjs [--since=<ISO>] [--manifest=<path>]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const arg = (k, d) => { const hit = process.argv.find((a) => a.startsWith(`--${k}=`)); return hit ? hit.split('=').slice(1).join('=') : d; };
const MANIFEST = arg('manifest', path.join(ROOT, 'doc/local/runs/20261013/ab-pair-rerun/manifest-fresh.json'));
const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
const sinceIso = arg('since', manifest.fresh || '2026-10-13T00:00:00.000Z');
// teaching_sessions.createdAt 是 epoch 毫秒（Prisma DateTime → SQLite INTEGER），不能用 ISO 串比较
const since = Number.isFinite(Number(sinceIso)) ? Number(sinceIso) : Date.parse(sinceIso);

const db = new DatabaseSync(path.join(ROOT, 'backend/prisma/dev.db'), { readOnly: true });
db.exec('PRAGMA busy_timeout = 5000');

const D1_LIMITS = [48, 80, 96];
const countOccurrences = (arr, fn) => arr.reduce((n, x) => n + (fn(x) ? 1 : 0), 0);

function messagesOf(sessionId) {
  return db.prepare('SELECT payload FROM teaching_session_messages WHERE sessionId = ? ORDER BY createdAt').all(sessionId)
    .map((r) => { try { return JSON.parse(r.payload); } catch { return null; } }).filter(Boolean);
}

const report = { since: sinceIso, sinceMs: since, generatedAt: new Date().toISOString(), missing: [], totals: {}, learners: [] };

for (const p of manifest.pair) {
  const sessions = db.prepare(
    'SELECT id, topic, status, wrapup, startTime, createdAt FROM teaching_sessions WHERE userId = ? AND createdAt > ? ORDER BY createdAt'
  ).all(p.userId, since);

  const rec = { name: p.name, userId: p.userId, pathId: p.pathId, sessionCount: sessions.length, D1: { truncated: 0, samples: [] }, D9: { fallbackMastered: 0, fallbackWrapups: 0, samples: [] }, D10: { dangling: 0, samples: [] }, messages: 0, userMessages: 0, assistantMessages: 0 };
  const allMsgs = [];

  for (const s of sessions) {
    const msgs = messagesOf(s.id);
    allMsgs.push(...msgs.map((m) => ({ ...m, _sid: s.id })));

    // D9：兜底 wrapup 却标 mastered/100
    if (s.wrapup) {
      let w = null; try { w = JSON.parse(s.wrapup); } catch { /* ignore */ }
      const src = String(w?.sources?.summary || '');
      if (src.includes('fallback') || w?.status === 'summary-only') {
        rec.D9.fallbackWrapups += 1;
        const items = Array.isArray(w?.summary?.knowledgeItems) ? w.summary.knowledgeItems : [];
        const bad = items.filter((it) => it.status === 'mastered' || Number(it.progress) >= 100);
        if (bad.length) {
          rec.D9.fallbackMastered += bad.length;
          rec.D9.samples.push({ session: s.id, topic: s.topic, status: w?.status, src, bad: bad.map((b) => `${b.name}:${b.status}/${b.progress}`).slice(0, 4) });
        }
      }
    }
  }

  rec.messages = allMsgs.length;
  rec.userMessages = countOccurrences(allMsgs, (m) => m.role === 'user');
  rec.assistantMessages = countOccurrences(allMsgs, (m) => m.role === 'assistant');

  // D1
  for (const m of allMsgs) {
    if (m.role !== 'user') continue;
    const c = String(m.content || '');
    if (/…$/.test(c) && D1_LIMITS.includes(c.length)) {
      rec.D1.truncated += 1;
      if (rec.D1.samples.length < 6) rec.D1.samples.push({ sid: m._sid, len: c.length, tail: c.slice(-40) });
    }
  }

  // D10
  for (const m of allMsgs) {
    if (m.role !== 'assistant') continue;
    const c = String(m.content || '');
    const hasVisual = !!(m.images?.length || m.diagrams?.length || m.figures?.length);
    const refs = /（见图）|见下图|见上图|如下图所示|如上图所示|我(?:给你)?画了[^，。]{0,10}(?:图|示意)/.test(c);
    if (refs && !hasVisual) {
      rec.D10.dangling += 1;
      if (rec.D10.samples.length < 6) rec.D10.samples.push({ sid: m._sid, text: c.slice(0, 90) });
    }
  }

  // D13
  const prof = db.prepare('SELECT knownConcepts, struggleConcepts FROM virtual_learner_profiles WHERE userId = ?').get(p.userId);
  const known = prof?.knownConcepts ? JSON.parse(prof.knownConcepts) : [];
  const struggle = prof?.struggleConcepts ? JSON.parse(prof.struggleConcepts) : [];
  const overlap = known.filter((c) => struggle.includes(c));
  rec.D13 = { known: known.length, struggle: struggle.length, overlap: overlap.length, samples: overlap.slice(0, 8) };

  report.learners.push(rec);
}

// 汇总
report.totals = {
  D1_truncated: report.learners.reduce((n, r) => n + r.D1.truncated, 0),
  D9_fallbackMastered: report.learners.reduce((n, r) => n + r.D9.fallbackMastered, 0),
  D10_dangling: report.learners.reduce((n, r) => n + r.D10.dangling, 0),
  D13_overlap: report.learners.reduce((n, r) => n + r.D13.overlap, 0),
  messages: report.learners.reduce((n, r) => n + r.messages, 0),
};

console.log(JSON.stringify(report, null, 2));
fs.writeFileSync(path.join(ROOT, 'doc/local/runs/20261013/ab-pair-rerun/audit.json'), JSON.stringify(report, null, 2), 'utf8');
db.close();
