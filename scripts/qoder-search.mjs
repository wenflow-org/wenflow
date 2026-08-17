// 在 system.db 中查找 qoder / stage-designer 相关配置
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const db = new DatabaseSync(path.resolve(__dirname, '..', 'backend', 'prisma', 'system.db'), { readOnly: true });
const q = (s, ...a) => db.prepare(s).all(...a);

const tables = q("SELECT name FROM sqlite_master WHERE type='table'").map(t => t.name);
console.log('system tables:', tables.join(', '));
for (const t of tables) {
  if (!/agent|prompt|model|config|provider|api|skill/.test(t)) continue;
  try {
    const cols = q(`PRAGMA table_info(${t})`).map(c => c.name);
    const rows = q(`SELECT * FROM ${t} LIMIT 200`);
    for (const r of rows) {
      const s = JSON.stringify(r);
      if (/qoder|stage-designer/i.test(s)) {
        console.log(`[${t}] ${s.slice(0, 400)}`);
      }
    }
  } catch { /* skip */ }
}
db.close();
