// 搜索 qoder provider 与 skill_model_configs / platform_api_configs
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const db = new DatabaseSync(path.resolve(__dirname, '..', 'backend', 'prisma', 'system.db'), { readOnly: true });
const q = (s, ...a) => db.prepare(s).all(...a);

for (const t of ['agent_lab_configs', 'skill_model_configs', 'platform_api_configs', 'platform_settings', 'agent_registrations', 'skill_registrations']) {
  const rows = q(`SELECT * FROM ${t}`);
  console.log(`=== ${t} (${rows.length}) ===`);
  for (const r of rows) {
    const s = JSON.stringify(r);
    const hit = /qoder/i.test(s);
    console.log((hit ? 'HIT> ' : '     ') + s.slice(0, 350));
  }
}
db.close();
