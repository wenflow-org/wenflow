import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync('D:/wenflow/wenflow/backend/prisma/dev.db', { readOnly: true });
const q = (s) => db.prepare(s).all();
console.log('drift/offset tables:');
for (const r of q("SELECT name FROM sqlite_master WHERE type='table' AND (name LIKE '%drift%' OR name LIKE '%offset%')"))
  console.log(' ', r.name);
console.log('llm_execution_attempts total:', q('SELECT COUNT(*) c FROM llm_execution_attempts')[0].c);
console.log('agent_call_logs total:', q('SELECT COUNT(*) c FROM agent_call_logs')[0].c);
console.log('failed llm_execution_attempts (24h):', q("SELECT COUNT(*) c FROM llm_execution_attempts WHERE success=0 AND createdAt > (unixepoch('now')*1000 - 86400000)")[0].c);
console.log('total llm_execution_attempts (24h):', q("SELECT COUNT(*) c FROM llm_execution_attempts WHERE createdAt > (unixepoch('now')*1000 - 86400000)")[0].c);
db.close();