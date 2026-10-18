import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const BASE = 'http://127.0.0.1:3011';
const V = path.join(ROOT, 'doc', 'local', 'runs', '20261011', 'vl-evals');
const envText = fs.readFileSync(path.join(ROOT, 'backend', '.env'), 'utf8');
const envGet = (k) => (envText.match(new RegExp('^' + k + '=(.*)$', 'm')) || [])[1]?.trim() || '';
const { getAdminCookie } = await import(pathToFileURL(path.join(ROOT, 'scripts', 'vlab-eval', 'admin-session.mjs')).href);
const cookie = await getAdminCookie(BASE, envGet);
const db = new DatabaseSync(path.join(ROOT, 'backend/prisma/dev.db'), { readOnly: true });
const live = db.prepare("SELECT id FROM virtual_sessions WHERE userId IN (SELECT userId FROM virtual_learner_profiles) AND status NOT IN ('completed','failed','abandoned','discarded','superseded')").all();
db.close();
for (const s of live) {
  await fetch(BASE + '/api/admin/virtual-learners/sessions/terminate', { method: 'POST', headers: { cookie, 'content-type': 'application/json', origin: 'http://localhost:5173' }, body: JSON.stringify({ sessionIds: [s.id], dryRun: false }) }).catch(() => {});
}
console.log('terminated live sessions:', live.length);
let n = 0;
for (const f of fs.readdirSync(V)) { if (/^vlstate-preset[:_].*\.json$/.test(f)) { fs.unlinkSync(path.join(V, f)); n++; } }
console.log('cleared state files:', n);
