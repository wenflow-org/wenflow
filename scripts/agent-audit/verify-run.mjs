// 跑后取证：对最近 X 分钟内创建的 virtual_sessions，核对各 LLM 技能调用、
// teaching-turn prompt 里画像字段注入、误解台账/预测/快照刷新等闭环痕迹
// 用法: node scripts/agent-audit/verify-run.mjs [minutes=90]
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DB_PATH = path.join(ROOT, 'backend', 'prisma', 'dev.db');
const WINDOW_MIN = Number(process.argv[2] || 90);
const db = new DatabaseSync(DB_PATH, { readOnly: true });
const q = (sql, p = []) => db.prepare(sql).all(...p);
const g = (sql, p = []) => db.prepare(sql).get(...p);
const fmt = v => (v && /^\d{13}$/.test(String(v))) ? new Date(Number(v)).toISOString().replace('T', ' ').slice(0, 19) : String(v ?? '-').slice(0, 19);

const sessions = q(`SELECT id, virtualProfileId, userId, status, currentStage, completedTasks, totalTasks, createdAt, updatedAt FROM virtual_sessions WHERE createdAt >= ? ORDER BY createdAt DESC`, [Date.now() - WINDOW_MIN * 60 * 1000]);
console.log(`=== 最近 ${WINDOW_MIN} 分钟创建的虚拟会话: ${sessions.length} 个 ===`);
for (const s of sessions) console.log(JSON.stringify({ id: s.id.slice(0, 14), presetProfile: s.virtualProfileId.slice(0, 8), userId: s.userId.slice(0, 8), status: s.status, stage: s.currentStage, tasks: `${s.completedTasks}/${s.totalTasks}`, at: fmt(s.createdAt) }));

for (const s of sessions) {
  console.log(`\n########## 会话 ${s.id.slice(0, 14)} (user=${s.userId.slice(0, 8)}) ##########`);
  const winStart = Number(s.createdAt) - 60 * 1000;
  const winEnd = Math.max(Number(s.updatedAt || s.createdAt), Date.now() - 30 * 1000);

  // 1. 该窗口内 LLM 技能调用
  const calls = q(`SELECT agentId, COUNT(*) n, SUM(CASE WHEN success=0 THEN 1 ELSE 0 END) fails, SUM(promptTokens) pTok, SUM(completionTokens) cTok, MAX(calledAt) last
                   FROM agent_call_logs WHERE calledAt BETWEEN ? AND ? AND (sessionId=? OR userId=? OR (sessionId IS NULL AND userId IS NULL))
                   GROUP BY agentId ORDER BY n DESC`, [winStart, winEnd, s.id, s.userId]);
  console.log('--- LLM 技能调用（窗口内）---');
  for (const c of calls) console.log(`${c.agentId.padEnd(50)} n=${String(c.n).padStart(4)} fail=${c.fails} tok≈${(c.pTok || 0) + (c.cTok || 0)} last=${fmt(c.last)}`);

  // 2. teaching-turn prompt 注入检查
  const tt = q(`SELECT id, userPayload, createdAt, success FROM prompt_call_logs WHERE agentId='skill:teaching-turn' AND createdAt BETWEEN ? AND ? ORDER BY createdAt ASC`, [winStart, winEnd]);
  console.log(`--- teaching-turn prompt 调用: ${tt.length} 次 ---`);
  tt.forEach((r, i) => {
    try {
      const p = JSON.parse(r.userPayload || '{}');
      const keys = Object.keys(p);
      const flat = JSON.stringify(p);
      const markers = {
        learnerProfile: !!(p.learner || p.learnerProfile || p.stableProfile),
        learnerField: ['stableProfile', 'liveState', 'mastery', 'taskDifficulty'].filter(k => flat.includes(`"${k}"`)),
        priorMisconceptions: flat.includes('priorMisconceptions') || flat.includes('misconception'),
        learnerInsights: flat.includes('learnerInsights'),
        learnerPrediction: flat.includes('learnerPrediction') || flat.includes('stallRisk'),
        recommendedApproach: flat.includes('recommendedApproach') || flat.includes('recommendedPacing'),
        learningSignalKey: flat.includes('learningSignal'),
        teachingHints: flat.includes('teachingHints') || flat.includes('emphasize'),
        knowledgeMemory: flat.includes('knowledgeMemory') || flat.includes('conceptLedger'),
      };
      console.log(`  [turn ${i + 1}] ${fmt(r.createdAt)} success=${r.success} payloadKeys=${keys.slice(0, 14).join(',')} | ${JSON.stringify(markers)}`);
    } catch { console.log(`  [turn ${i + 1}] payload not JSON`); }
  });

  // 3. 闭环痕迹
  const mis = q(`SELECT conceptKey, status, confidence, substr(hypothesis,1,50) h FROM misconception_ledger WHERE userId=? AND updatedAt BETWEEN ? AND ? ORDER BY updatedAt DESC LIMIT 8`, [s.userId, winStart, winEnd]);
  console.log(`--- 窗口内误解台账写入: ${mis.length} 条 ---`);
  for (const m of mis) console.log(`   ${m.conceptKey} [${m.status}] conf=${m.confidence} ${m.h}`);
  const preds = q(`SELECT stallRisk, predictedTone, suggestedDepth, focusConcepts, outcome, createdAt FROM prediction_records WHERE userId=? AND createdAt BETWEEN ? AND ? ORDER BY createdAt DESC LIMIT 5`, [s.userId, winStart, winEnd]);
  console.log(`--- 窗口内学习预测: ${preds.length} 条 ---`);
  for (const p of preds) console.log(`   stall=${p.stallRisk} tone=${p.predictedTone} depth=${String(p.suggestedDepth).slice(0, 20)} focus=${JSON.stringify(p.focusConcepts).slice(0, 60)} outcome=${p.outcome ?? '(未回填)'}`);
  const ev = q(`SELECT evidenceType, COUNT(*) n FROM learner_evidence WHERE userId=? AND createdAt BETWEEN ? AND ? GROUP BY evidenceType ORDER BY n DESC LIMIT 10`, [s.userId, winStart, winEnd]);
  console.log(`--- 窗口内学习证据: ${JSON.stringify(ev)}`);
  const proj = q(`SELECT scope, COUNT(*) n, MAX(updatedAt) last FROM learner_projections WHERE userId=? AND updatedAt BETWEEN ? AND ? GROUP BY scope ORDER BY n DESC LIMIT 8`, [s.userId, winStart, winEnd]);
  console.log(`--- 窗口内画像投影刷新: ${JSON.stringify(proj.map(r => ({ ...r, last: fmt(r.last) })))}`);

  // 4. wrapup / advisory
  const tsess = q(`SELECT id, status, substr(wrapup,1,120) w, substr(advisory,1,150) a, startTime FROM teaching_sessions WHERE userId=? AND startTime BETWEEN ? AND ? ORDER BY startTime DESC LIMIT 6`, [s.userId, winStart, winEnd]);
  console.log(`--- 窗口内教学会话: ${tsess.length} 个 ---`);
  for (const t of tsess) console.log(`   ${t.id.slice(0, 12)} status=${t.status} wrapup=${t.w ? t.w.slice(0, 60) : 'NULL'} advisory=${t.a ? t.a.slice(0, 70) : 'NULL'}`);
}

// 5. 跨课闭环：同一 VL 用户前后两条 teaching-turn prompt 的 priorMisconceptions 对比
console.log('\n=== 跨课注入对比（最近 2 个有教学消息的用户） ===');
const users = q(`SELECT DISTINCT userId FROM virtual_sessions WHERE createdAt >= ? LIMIT 3`, [Date.now() - WINDOW_MIN * 60 * 1000]);
for (const u of users) {
  const turns = q(`SELECT userPayload, createdAt FROM prompt_call_logs WHERE agentId='skill:teaching-turn' AND createdAt >= ? ORDER BY createdAt ASC`, [Date.now() - WINDOW_MIN * 60 * 1000]);
  if (turns.length < 2) continue;
  const first = JSON.parse(turns[0].userPayload || '{}');
  const last = JSON.parse(turns[turns.length - 1].userPayload || '{}');
  const fFlat = JSON.stringify(first), lFlat = JSON.stringify(last);
  console.log(`user=${u.userId.slice(0, 8)} turns=${turns.length} 首turn含priorMisconceptions=${fFlat.includes('priorMisconceptions')} 末turn含=${lFlat.includes('priorMisconceptions')} 首turn含learnerInsights=${fFlat.includes('learnerInsights')} 末turn含=${lFlat.includes('learnerInsights')}`);
}

db.close();
console.log('\nDONE');
