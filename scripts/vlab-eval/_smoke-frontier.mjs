import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BASE = 'http://127.0.0.1:3011';
const envText = fs.readFileSync(path.join(ROOT, 'backend', '.env'), 'utf8');
const envGet = (k) => (envText.match(new RegExp('^' + k + '=(.*)$', 'm')) || [])[1]?.trim() || '';
const { getAdminCookie } = await import(pathToFileURL(path.join(ROOT, 'scripts', 'vlab-eval', 'admin-session.mjs')).href);
const cookie = await getAdminCookie(BASE, envGet);

const db = new DatabaseSync(path.join(ROOT, 'backend/prisma/dev.db'), { readOnly: true });
const rows = db.prepare('SELECT id, presetKey, profile FROM virtual_learner_profiles').all();
db.close();

for (const r of rows) {
  const pool = JSON.parse(r.profile).storyPool || [];
  const succ = new Set(pool.map((s) => s.progressesFrom).filter(Boolean));
  let best = 0, bestCi = -1;
  pool.forEach((s, i) => { if (succ.has(s.id)) return; const ci = Number.isFinite(Number(s.chapterIndex)) ? Number(s.chapterIndex) : 1; if (ci >= bestCi) { bestCi = ci; best = i; } });
  const res = await fetch(`${BASE}/api/admin/virtual-learners/${r.id}/start-session`, {
    method: 'POST', headers: { cookie, 'content-type': 'application/json', origin: 'http://localhost:5173' },
    body: JSON.stringify({ storyIndex: best }),
  });
  const j = await res.json().catch(() => ({}));
  const sid = j?.data?.id || j?.data?.sessionId;
  console.log(`${r.presetKey}: frontierIdx=${best} (「${pool[best]?.title}」) → start-session http=${res.status} sid=${sid ? sid.slice(0, 12) : 'NONE'} err=${j?.error?.message || '-'}`);
  if (sid) {
    await fetch(`${BASE}/api/admin/virtual-learners/sessions/terminate`, {
      method: 'POST', headers: { cookie, 'content-type': 'application/json', origin: 'http://localhost:5173' },
      body: JSON.stringify({ sessionIds: [sid], dryRun: false }),
    });
  }
}
