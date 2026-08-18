import { DatabaseSync } from 'node:sqlite';
const devDb = new DatabaseSync('D:/wenflow/wenflow/backend/prisma/dev.db', { readOnly: true });
const q = (s) => devDb.prepare(s).all();

const rows = q(`SELECT errorMessage, sourceEntry FROM llm_execution_attempts WHERE errorCode='INVALID_RESPONSE_SCHEMA' AND sourceEntry='platform' ORDER BY rowid DESC LIMIT 3`);
for (const r of rows) {
  console.log('src=', r.sourceEntry);
  console.log((r.errorMessage || '').slice(0, 600));
  console.log('---');
}
devDb.close();