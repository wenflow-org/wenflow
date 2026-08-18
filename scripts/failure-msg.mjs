import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync('D:/wenflow/wenflow/backend/prisma/dev.db', { readOnly: true });
const q = (s, ...a) => db.prepare(s).all(...a);
const trunc = (s, n = 180) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n) + '...' : t; };

console.log('===== errorCode -> 典型 errorMessage (llm_execution_attempts, 最近 8000) =====');
for (const code of ['INVALID_RESPONSE_SCHEMA', 'CALLER_ABORTED', 'RETRY_BUDGET_EXHAUSTED', 'UPSTREAM_503', 'UPSTREAM_500', 'UPSTREAM_404', 'QUOTA_EXHAUSTED', 'AUTH_INVALID', 'RATE_LIMITED', 'ATTEMPT_TIMEOUT', 'UPSTREAM_524', 'UPSTREAM_529']) {
  const rows = q(`SELECT errorMessage, requestedModel, sourceEntry, COUNT(*) c FROM (SELECT * FROM llm_execution_attempts ORDER BY rowid DESC LIMIT 8000) WHERE errorCode = ? GROUP BY errorMessage, requestedModel, sourceEntry ORDER BY c DESC LIMIT 4`, code);
  console.log(`\n--- ${code} ---`);
  for (const r of rows) console.log(`  (${r.c}) model=${r.requestedModel} src=${r.sourceEntry} :: ${trunc(r.errorMessage, 170)}`);
}

console.log('\n===== INVALID_RESPONSE_SCHEMA 来自哪些 sourceEntry / promptCall =====');
for (const r of q(`SELECT sourceEntry, requestedModel, COUNT(*) c FROM llm_execution_attempts WHERE errorCode='INVALID_RESPONSE_SCHEMA' GROUP BY sourceEntry, requestedModel ORDER BY c DESC LIMIT 10`))
  console.log(`src=${r.sourceEntry} model=${r.requestedModel} x${r.c}`);

console.log('\n===== INVALID_RESPONSE_SCHEMA 是否有 promptCallId（哪些技能触发）=====');
try {
  for (const r of q(`SELECT promptCallId IS NOT NULL hasPrompt, sourceEntry, COUNT(*) c FROM llm_execution_attempts WHERE errorCode='INVALID_RESPONSE_SCHEMA' GROUP BY hasPrompt, sourceEntry ORDER BY c DESC LIMIT 8`))
    console.log(`hasPrompt=${r.hasPrompt} src=${r.sourceEntry} x${r.c}`);
} catch (e) { console.log('err:', e.message); }

db.close();