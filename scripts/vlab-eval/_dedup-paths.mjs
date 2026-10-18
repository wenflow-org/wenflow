import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DB = path.join(HERE, '..', '..', 'backend', 'prisma', 'dev.db');
const APPLY = process.argv.includes('--apply');
const db = new DatabaseSync(DB);
db.exec('PRAGMA busy_timeout = 15000');

// 保留（当前 manifest 在用）：林然 gaoiqwq / 周雅 kn207po
const KEEP = {
  林然: 'lp_1791871103432_gaoiqwq',
  周雅: 'lp_1791871103493_kn207po',
};
const USER = { 林然: 'd6fd4e20-a0c5-447a-84fb-874154045146', 周雅: '52c59426-f0fd-4ed2-8729-b3f038ff210d' };

// 全库扫 pathId / learningPathId 列（FK-like 引用）
const all = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((t) => t.name);
const refs = [];
for (const t of all) {
  if (t.startsWith('sqlite_')) continue;
  const cols = db.prepare(`PRAGMA table_info("${t}")`).all().map((c) => c.name);
  for (const c of ['pathId', 'learningPathId']) if (cols.includes(c)) refs.push({ t, c });
}

const stale = {};
for (const [name, keepId] of Object.entries(KEEP)) {
  const rows = db.prepare('SELECT id FROM learning_paths WHERE userId=?').all(USER[name]);
  stale[name] = rows.map((r) => r.id).filter((id) => id !== keepId);
}
const allStale = Object.values(stale).flat();
console.log('待删（非保留克隆路径）:');
for (const [n, ids] of Object.entries(stale)) console.log(`  ${n}: ${ids.length} 条 → ${ids.join(', ')}`);

console.log('\n受影响行（各引用表）:');
const plan = [];
for (const { t, c } of refs) {
  const ph = allStale.map(() => '?').join(',');
  const cnt = db.prepare(`SELECT COUNT(*) n FROM "${t}" WHERE "${c}" IN (${ph})`).get(...allStale).n;
  if (cnt > 0) { plan.push({ t, c, cnt }); console.log(`  ${t}.${c}: ${cnt}`); }
}

if (!APPLY) { console.log('\n[DRY-RUN] 加 --apply 执行（先备份 JSON）。'); db.close(); process.exit(0); }

const backup = { at: new Date().toISOString(), stale, rows: {} };
db.exec('BEGIN');
try {
  for (const { t, c } of plan) {
    const ph = allStale.map(() => '?').join(',');
    backup.rows[`${t}.${c}`] = db.prepare(`SELECT * FROM "${t}" WHERE "${c}" IN (${ph})`).all(...allStale);
    db.prepare(`DELETE FROM "${t}" WHERE "${c}" IN (${ph})`).run(...allStale);
  }
  const ph = allStale.map(() => '?').join(',');
  backup.rows['learning_paths'] = db.prepare(`SELECT * FROM learning_paths WHERE id IN (${ph})`).all(...allStale);
  db.prepare(`DELETE FROM learning_paths WHERE id IN (${ph})`).run(...allStale);
  const out = path.join(HERE, `_cleanup-dedup-backup-${Date.now()}.json`);
  const trimmed = { ...backup, rows: pruneBig(backup.rows) };
  fs.writeFileSync(out, JSON.stringify(trimmed, null, 2), 'utf8');
  db.exec('COMMIT');
  console.log(`\n已删除；备份 → ${out}`);
} catch (e) {
  db.exec('ROLLBACK');
  console.error('回滚：', e.message);
}
db.close();

function pruneBig(rows) {
  const out = {};
  for (const [k, v] of Object.entries(rows)) out[k] = { count: v.length, sample: v.slice(0, 3) };
  return out;
}
