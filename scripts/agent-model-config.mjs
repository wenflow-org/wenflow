// 查 user_agent_model_configs 中 stage-designer 的配置
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const db = new DatabaseSync(path.resolve(__dirname, '..', 'backend', 'prisma', 'dev.db'), { readOnly: true });
const q = (s, ...a) => db.prepare(s).all(...a);

const rows = q('SELECT * FROM user_agent_model_configs');
console.log('total rows:', rows.length);
for (const r of rows) {
  const mask = r.apiKey ? `key=${r.apiKey.slice(0, 6)}…(${r.apiKey.length})` : 'key=null';
  console.log(`${r.id.slice(0, 8)} | user=${r.userId.slice(0, 12)} | agent=${r.agentId} | model=${r.model} | ep=${r.endpoint ?? '-'} | ${mask} | enabled=${r.enabled} | t=${r.temperature} | mt=${r.maxTokens}`);
}
db.close();
