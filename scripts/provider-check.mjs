// 查 stage-designer 相关模型/凭证配置
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const db = new DatabaseSync(path.resolve(__dirname, '..', 'backend', 'prisma', 'dev.db'), { readOnly: true });
const q = (s, ...a) => db.prepare(s).all(...a);

const tables = q("SELECT name FROM sqlite_master WHERE type='table' AND (name LIKE '%model%' OR name LIKE '%api_config%' OR name LIKE '%prompt%')");
console.log('tables:', tables.map(t => t.name).join(', '));

for (const t of ['agent_prompts', 'user_agent_model_configs', 'user_api_configs', 'user_agent_configs', 'user_skill_configs']) {
  try {
    const cols = q(`PRAGMA table_info(${t})`).map(c => c.name);
    console.log(`\n=== ${t} cols: ${cols.join(', ')}`);
    const rows = q(`SELECT * FROM ${t} LIMIT 12`);
    for (const r of rows) {
      const s = JSON.stringify(r);
      console.log(s.slice(0, 220));
    }
  } catch (e) { console.log(`\n=== ${t}: ERR ${e.message}`); }
}
db.close();
